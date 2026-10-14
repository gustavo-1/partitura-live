import { resolveTies } from './notation';
import { measureTicks, spellMidi, ticksToDurations } from './theory';
import { PPQ, type Clef, type Hand, type Measure, type NoteEl, type Pitch, type Song } from './types';

export interface RawChord {
  start: number; // ticks
  dur: number;
  pitches: Pitch[];
  fingers?: (number | undefined)[];
}

export interface RawStaff {
  clef: Clef;
  hand: Hand;
  chords: RawChord[];
}

export interface SongMeta {
  id: string;
  title: string;
  composer?: string;
  description?: string;
  tempo: number;
  timeSig: [number, number];
  keySig: number;
  source: Song['source'];
  level?: number;
}

/** Monta uma música notada a partir de acordes em ticks (compassos, pausas, ligaduras). */
export function songFromChords(meta: SongMeta, staves: RawStaff[]): Song {
  const mLen = measureTicks(meta.timeSig);
  let end = 0;
  for (const s of staves) for (const c of s.chords) end = Math.max(end, c.start + c.dur);
  const nMeasures = Math.max(1, Math.ceil(end / mLen - 1e-6));
  const measures: Measure[] = [];
  for (let i = 0; i < nMeasures; i++) {
    measures.push({ index: i, start: i * mLen, length: mLen, timeSig: meta.timeSig, keySig: meta.keySig, timeSigChange: i === 0, keySigChange: i === 0 });
  }
  const notes: NoteEl[] = [];
  let id = 0;
  staves.forEach((staff, si) => {
    const chords = [...staff.chords].sort((a, b) => a.start - b.start);
    // remove sobreposições (uma voz por pauta)
    for (let i = 0; i < chords.length - 1; i++) {
      const next = chords[i + 1].start;
      if (chords[i].start + chords[i].dur > next) chords[i].dur = Math.max(PPQ / 8, next - chords[i].start);
    }
    let cursor = 0;
    const push = (start: number, dur: number, c: RawChord | null) => {
      // divide em barras de compasso e em figuras representáveis
      let t = start;
      const stop = start + dur;
      const pieces: { t: number; d: number; dur: string; dots: number }[] = [];
      while (t < stop - 1) {
        const mi = Math.min(nMeasures - 1, Math.floor(t / mLen));
        const mEnd = (mi + 1) * mLen;
        const segEnd = Math.min(stop, mEnd);
        const segLen = segEnd - t;
        if (!c && Math.abs(t - mi * mLen) < 1 && Math.abs(segLen - mLen) < 1) {
          pieces.push({ t, d: mLen, dur: 'w', dots: 0 });
          t = segEnd;
          continue;
        }
        let tt = t;
        for (const p of ticksToDurations(segLen)) {
          pieces.push({ t: tt, d: p.ticks, dur: p.dur, dots: p.dots });
          tt += p.ticks;
        }
        t = segEnd;
      }
      pieces.forEach((p, i) => {
        const mi = Math.min(nMeasures - 1, Math.floor((p.t + 1) / mLen));
        const full = !c && p.d === mLen && p.dur === 'w';
        notes.push({
          id: id++,
          t: p.t,
          d: p.d,
          staff: si,
          voice: 0,
          keys: c ? c.pitches : [],
          dur: p.dur,
          dots: p.dots,
          fingers: c && i === 0 ? c.fingers : undefined,
          tieStart: c && i < pieces.length - 1 ? c.pitches.map(() => true) : undefined,
          measure: mi,
          fullRest: full || undefined,
        });
      });
    };
    for (const c of chords) {
      if (c.start > cursor) push(cursor, c.start - cursor, null);
      const s = Math.max(c.start, cursor);
      const d = c.start + c.dur - s;
      if (d > 0) push(s, d, c);
      cursor = Math.max(cursor, c.start + c.dur);
    }
    const total = nMeasures * mLen;
    if (cursor < total) push(cursor, total - cursor, null);
  });

  const song: Song = {
    id: meta.id,
    title: meta.title,
    composer: meta.composer,
    description: meta.description,
    level: meta.level ?? estimateLevel(notes, meta.tempo, staves.length),
    source: meta.source,
    tempo: meta.tempo,
    timeSig: meta.timeSig,
    keySig: meta.keySig,
    staves: staves.length,
    clefs: staves.map((s) => s.clef),
    measures,
    notes,
    staffHands: staves.map((s) => s.hand),
  };
  resolveTies(song);
  return song;
}

export function estimateLevel(notes: NoteEl[], tempo: number, staves: number): number {
  const played = notes.filter((n) => n.keys.length && !n.tieEnd?.every(Boolean));
  if (!played.length) return 1;
  const minDur = Math.min(...played.map((n) => n.d));
  const notesPerBeat = (PPQ / minDur) * (tempo / 90);
  const chords = played.filter((n) => n.keys.length > 1).length / played.length;
  const accidentals = played.filter((n) => n.keys.some((k) => k.alter !== 0)).length / played.length;
  let lvl = 1 + (staves > 1 ? 1 : 0) + (notesPerBeat > 2.2 ? 2 : notesPerBeat > 1.1 ? 1 : 0) + (chords > 0.2 ? 1 : 0) + (accidentals > 0.1 ? 0.5 : 0);
  lvl = Math.round(lvl);
  return Math.max(1, Math.min(5, lvl));
}

/** Estima a armadura (em quintas) pela distribuição de classes de altura. */
export function guessKeySig(midis: number[]): number {
  if (!midis.length) return 0;
  const hist = new Array(12).fill(0);
  for (const m of midis) hist[((m % 12) + 12) % 12]++;
  const major = [0, 2, 4, 5, 7, 9, 11];
  let best = 0;
  let bestScore = -1;
  for (let f = -6; f <= 6; f++) {
    const tonic = (((f * 7) % 12) + 12) % 12;
    let score = 0;
    for (const d of major) score += hist[(tonic + d) % 12];
    score -= Math.abs(f) * 0.01 * midis.length; // desempate: menos acidentes
    if (score > bestScore) {
      bestScore = score;
      best = f;
    }
  }
  return best;
}

export function spell(midi: number, fifths: number): Pitch {
  return spellMidi(midi, fifths);
}

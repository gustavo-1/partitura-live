import { resolveTies } from './notation';
import { measureTicks, spellMidi, ticksToDurations } from './theory';
import { PPQ, type Clef, type Hand, type Measure, type NoteEl, type Pitch, type Song } from './types';

export interface RawChord {
  start: number; // ticks
  dur: number;
  pitches: Pitch[];
  fingers?: (number | undefined)[];
  /** intensidade de cada nota (0..1) */
  vels?: number[];
}

export interface RawStaff {
  clef: Clef;
  hand: Hand;
  chords: RawChord[];
  /** pauta (padrão: a posição na lista) e voz dentro da pauta (padrão 0) */
  staff?: number;
  voice?: number;
}

const TRIP = PPQ / 3; // colcheia de tercina
const isStraight = (v: number) => Math.abs(v - Math.round(v / (PPQ / 8)) * (PPQ / 8)) < 1;

/** Divide um trecho em figuras escrevíveis; tempos com tercinas viram colcheias de tercina ligadas. */
export function splitDur(t: number, len: number): { t: number; d: number; dur: string; dots: number; tuplet?: { actual: number; normal: number } }[] {
  const out: { t: number; d: number; dur: string; dots: number; tuplet?: { actual: number; normal: number } }[] = [];
  const end = t + len;
  let x = t;
  let guard = 0;
  while (x < end - 1 && guard++ < 400) {
    if (isStraight(x) && isStraight(end)) {
      for (const p of ticksToDurations(end - x)) {
        out.push({ t: x, d: p.ticks, dur: p.dur, dots: p.dots });
        x += p.ticks;
      }
      break;
    }
    const beatEnd = (Math.floor((x + 1) / PPQ) + 1) * PPQ;
    const segEnd = Math.min(end, beatEnd);
    if (isStraight(x) && isStraight(segEnd)) {
      for (const p of ticksToDurations(segEnd - x)) {
        out.push({ t: x, d: p.ticks, dur: p.dur, dots: p.dots });
        x += p.ticks;
      }
    } else {
      const n = Math.max(1, Math.round((segEnd - x) / TRIP));
      for (let k = 0; k < n; k++) out.push({ t: x + k * TRIP, d: TRIP, dur: '8', dots: 0, tuplet: { actual: 3, normal: 2 } });
    }
    x = segEnd;
  }
  return out;
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
  // pautas: várias vozes podem dividir a mesma pauta
  const nStaves = Math.max(1, ...staves.map((s, i) => (s.staff ?? i) + 1));
  const clefs: Clef[] = [];
  const staffHands: Hand[] = [];
  staves.forEach((s, i) => {
    const k = s.staff ?? i;
    clefs[k] ??= s.clef;
    staffHands[k] ??= s.hand;
  });
  for (let i = 0; i < nStaves; i++) {
    clefs[i] ??= i === 0 ? 'treble' : 'bass';
    staffHands[i] ??= i === 0 ? 'R' : 'L';
  }
  const measures: Measure[] = [];
  for (let i = 0; i < nMeasures; i++) {
    measures.push({ index: i, start: i * mLen, length: mLen, timeSig: meta.timeSig, keySig: meta.keySig, timeSigChange: i === 0, keySigChange: i === 0 });
  }
  const notes: NoteEl[] = [];
  let id = 0;
  staves.forEach((staff, idx) => {
    const si = staff.staff ?? idx;
    const voice = staff.voice ?? 0;
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
      const pieces: { t: number; d: number; dur: string; dots: number; tuplet?: { actual: number; normal: number } }[] = [];
      while (t < stop - 1) {
        const mi = Math.min(nMeasures - 1, Math.floor(t / mLen));
        const mEnd = (mi + 1) * mLen;
        const segEnd = Math.min(stop, mEnd);
        const segLen = segEnd - t;
        if (segLen <= 0) break;
        if (!c && Math.abs(t - mi * mLen) < 1 && Math.abs(segLen - mLen) < 1) {
          pieces.push({ t, d: mLen, dur: 'w', dots: 0 });
          t = segEnd;
          continue;
        }
        pieces.push(...splitDur(t, segLen));
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
          voice,
          keys: c ? c.pitches : [],
          dur: p.dur,
          dots: p.dots,
          tuplet: p.tuplet,
          fingers: c && i === 0 ? c.fingers : undefined,
          tieStart: c && i < pieces.length - 1 ? c.pitches.map(() => true) : undefined,
          vel: c?.vels,
          measure: mi,
          fullRest: full || undefined,
          // pausas da segunda voz ficam invisíveis
          hidden: !c && voice > 0 ? true : undefined,
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
    level: meta.level ?? estimateLevel(notes, meta.tempo, nStaves),
    source: meta.source,
    tempo: meta.tempo,
    timeSig: meta.timeSig,
    keySig: meta.keySig,
    staves: nStaves,
    clefs,
    measures,
    notes,
    staffHands,
  };
  notes.sort((a, b) => a.t - b.t || a.staff - b.staff || a.voice - b.voice);
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

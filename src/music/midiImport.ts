import { Midi } from '@tonejs/midi';
import { guessKeySig, songFromChords, spell, type RawChord, type RawStaff } from './build';
import { IMPORT_VERSION, PPQ, type Song } from './types';

interface N {
  midi: number;
  start: number; // ticks normalizados (PPQ interno)
  dur: number;
  track: number;
  vel: number; // 0..1
}

const TRIP = PPQ / 3; // grade de tercinas (colcheia de tercina)
const SIXTEENTH = PPQ / 4;

/** Andamento que vale na maior parte da música (não só o primeiro do arquivo). */
function mainTempo(tempos: { ticks: number; bpm: number }[], endTick: number): number {
  if (!tempos.length) return 100;
  const span = new Map<number, number>();
  tempos.forEach((t, i) => {
    const until = tempos[i + 1]?.ticks ?? endTick;
    const bpm = Math.round(t.bpm);
    span.set(bpm, (span.get(bpm) ?? 0) + Math.max(0, until - t.ticks));
  });
  let best = Math.round(tempos[0].bpm);
  let bestLen = -1;
  for (const [bpm, len] of span) if (len > bestLen) [best, bestLen] = [bpm, len];
  return Math.max(30, Math.min(260, best));
}

/**
 * Quantização tempo a tempo: em cada tempo escolhe a grade que melhor explica os ataques —
 * semicolcheias ou tercinas de colcheia (para não "entortar" tercinas e swing).
 */
function quantizer(starts: number[]): (x: number) => number {
  const byBeat = new Map<number, number[]>();
  for (const x of starts) {
    const b = Math.floor(x / PPQ);
    if (!byBeat.has(b)) byBeat.set(b, []);
    byBeat.get(b)!.push(x);
  }
  const trip = new Set<number>();
  for (const [b, xs] of byBeat) {
    const offs = xs.map((x) => x - b * PPQ).filter((o) => o > PPQ * 0.04); // ignora o ataque no próprio tempo
    if (offs.length < 1) continue;
    const err = (g: number) => offs.reduce((a, o) => a + Math.abs(o - Math.round(o / g) * g), 0);
    const e16 = err(SIXTEENTH);
    const e3 = err(TRIP);
    if (e3 + 1 < e16 * 0.5) trip.add(b);
  }
  return (x: number) => {
    const b = Math.floor((x + PPQ * 0.02) / PPQ);
    const g = trip.has(b) ? TRIP : SIXTEENTH;
    return b * PPQ + Math.round((x - b * PPQ) / g) * g;
  };
}

/** Importa um arquivo MIDI: quantiza, separa as mãos e gera a partitura. */
export function importMidi(data: ArrayBuffer, fileName: string): Song {
  const midi = new Midi(data);
  const scale = PPQ / (midi.header.ppq || 480);
  const all: N[] = [];
  const pedalEvents: { t: number; down: boolean }[] = [];
  midi.tracks.forEach((tr, ti) => {
    if (tr.channel === 9 || tr.instrument?.percussion) return;
    for (const n of tr.notes)
      all.push({ midi: n.midi, start: n.ticks * scale, dur: Math.max(1, n.durationTicks * scale), track: ti, vel: n.velocity ?? 0.7 });
    for (const cc of tr.controlChanges[64] ?? []) pedalEvents.push({ t: cc.ticks * scale, down: cc.value >= 0.5 });
  });
  if (!all.length) throw new Error('O arquivo MIDI não tem notas.');

  const ts = midi.header.timeSignatures[0]?.timeSignature as [number, number] | undefined;
  const timeSig: [number, number] = ts && ts[0] > 0 && ts[1] > 0 ? [ts[0], ts[1]] : [4, 4];
  const lastTick = Math.max(...all.map((n) => n.start + n.dur));
  const tempo = mainTempo(
    midi.header.tempos.map((t) => ({ ticks: t.ticks * scale, bpm: t.bpm })),
    lastTick,
  );

  const minStart = Math.min(...all.map((n) => n.start));
  const shift = minStart > PPQ * 8 ? Math.floor(minStart / (PPQ * 4)) * PPQ * 4 : 0; // remove silêncio inicial longo
  for (const n of all) n.start -= shift;

  // pedal de sustentação: trechos [abaixa, levanta]
  pedalEvents.sort((a, b) => a.t - b.t);
  const pedal: [number, number][] = [];
  let down: number | null = null;
  for (const ev of pedalEvents) {
    const t = Math.max(0, ev.t - shift);
    if (ev.down && down === null) down = t;
    else if (!ev.down && down !== null) {
      if (t > down) pedal.push([down, t]);
      down = null;
    }
  }
  if (down !== null) pedal.push([down, lastTick - shift + PPQ]);

  // mãos: 2 trilhas com notas => trilha mais aguda = direita; senão divide pela altura
  const tracks = [...new Set(all.map((n) => n.track))];
  let rh: N[];
  let lh: N[];
  if (tracks.length === 2) {
    const avg = (t: number) => {
      const xs = all.filter((n) => n.track === t);
      return xs.reduce((a, b) => a + b.midi, 0) / xs.length;
    };
    const [hi, lo] = avg(tracks[0]) >= avg(tracks[1]) ? [tracks[0], tracks[1]] : [tracks[1], tracks[0]];
    rh = all.filter((n) => n.track === hi);
    lh = all.filter((n) => n.track === lo);
  } else {
    rh = [];
    lh = [];
    for (const n of all) (n.midi >= 60 ? rh : lh).push(n);
  }

  // quantiza cada mão com a própria grade (ex.: tercinas na melodia sobre colcheias retas no acompanhamento)
  for (const hand of [rh, lh]) {
    const q = quantizer(hand.map((n) => n.start));
    for (const n of hand) {
      const s0 = Math.max(0, q(n.start));
      const e = q(n.start + n.dur);
      n.start = s0;
      n.dur = Math.max(TRIP / 2, e - s0);
    }
  }

  const keySig = midi.header.keySignatures[0] ? keyFromName(midi.header.keySignatures[0].key, midi.header.keySignatures[0].scale) : guessKeySig(all.map((n) => n.midi));

  /**
   * Uma mão vira até duas vozes: a principal (ritmo que se move) e uma segunda com as notas
   * que continuam soando por cima das outras (ex.: baixo longo sob acordes quebrados).
   * Assim nenhuma nota longa é encurtada.
   */
  const toVoices = (ns: N[]): { main: RawChord[]; held: RawChord[] } => {
    const map = new Map<number, N[]>();
    for (const n of ns) {
      if (!map.has(n.start)) map.set(n.start, []);
      map.get(n.start)!.push(n);
    }
    const groups = [...map.entries()].sort((a, b) => a[0] - b[0]);
    const main: RawChord[] = [];
    const held: RawChord[] = [];
    let heldFree = 0; // a segunda voz está livre a partir daqui
    groups.forEach(([start, group], gi) => {
      const uniq = [...new Map(group.map((g) => [g.midi, g])).values()].sort((a, b) => a.midi - b.midi);
      const next = groups[gi + 1]?.[0] ?? Infinity;
      const gap = next - start;
      // notas que continuam soando pelo menos meio tempo depois do próximo ataque (legato curto não conta)
      const long = uniq.filter((g) => g.dur - gap >= PPQ / 2);
      const canHold = long.length > 0 && start >= heldFree;
      const inMain = canHold ? uniq.filter((g) => !long.includes(g)) : uniq;
      if (canHold) {
        const hd = Math.min(...long.map((g) => g.dur));
        held.push({ start, dur: hd, pitches: long.map((g) => spell(g.midi, keySig)), vels: long.map((g) => g.vel) });
        heldFree = start + hd;
      }
      if (inMain.length)
        main.push({
          start,
          dur: Math.min(...inMain.map((g) => g.dur)),
          pitches: inMain.map((g) => spell(g.midi, keySig)),
          vels: inMain.map((g) => g.vel),
        });
    });
    return { main, held };
  };

  const staves: RawStaff[] = [];
  let staffIdx = 0;
  for (const [hand, notes, clef] of [
    ['R', rh, 'treble'],
    ['L', lh, 'bass'],
  ] as const) {
    if (!notes.length) continue;
    const v = toVoices(notes);
    staves.push({ clef, hand, chords: v.main, staff: staffIdx, voice: 0 });
    if (v.held.length) staves.push({ clef, hand, chords: v.held, staff: staffIdx, voice: 1 });
    staffIdx++;
  }

  const title = midi.header.name?.trim() || fileName.replace(/\.(mid|midi)$/i, '');
  const song = songFromChords(
    {
      id: 'imp-' + slug(title) + '-' + Date.now().toString(36),
      title,
      composer: 'Importado (MIDI)',
      tempo,
      timeSig,
      keySig,
      source: 'import',
    },
    staves,
  );
  if (pedal.length) song.pedal = pedal;
  song.importVersion = IMPORT_VERSION;
  return song;
}

function keyFromName(key: string, scale: string): number {
  const majors: Record<string, number> = { C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, Gb: -6, Db: -5, Ab: -4, Eb: -3, Bb: -2, F: -1, 'C#': 7, Cb: -7 };
  let f = majors[key] ?? 0;
  if (scale === 'minor') {
    // relativa maior: 3 semitons acima
    const minors: Record<string, number> = { A: 0, E: 1, B: 2, 'F#': 3, 'C#': 4, 'G#': 5, 'D#': 6, D: -1, G: -2, C: -3, F: -4, Bb: -5, Eb: -6 };
    f = minors[key] ?? 0;
  }
  return f;
}

export function slug(s: string): string {
  return (
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'musica'
  );
}

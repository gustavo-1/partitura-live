import { Midi } from '@tonejs/midi';
import { guessKeySig, songFromChords, spell, type RawChord, type RawStaff } from './build';
import { PPQ, type Song } from './types';

interface N {
  midi: number;
  start: number; // ticks normalizados (PPQ interno)
  dur: number;
  track: number;
}

/** Importa um arquivo MIDI: quantiza, separa as mãos e gera a partitura. */
export function importMidi(data: ArrayBuffer, fileName: string): Song {
  const midi = new Midi(data);
  const scale = PPQ / (midi.header.ppq || 480);
  const all: N[] = [];
  midi.tracks.forEach((tr, ti) => {
    if (tr.channel === 9 || tr.instrument?.percussion) return;
    for (const n of tr.notes) all.push({ midi: n.midi, start: n.ticks * scale, dur: Math.max(1, n.durationTicks * scale), track: ti });
  });
  if (!all.length) throw new Error('O arquivo MIDI não tem notas.');

  const ts = midi.header.timeSignatures[0]?.timeSignature as [number, number] | undefined;
  const timeSig: [number, number] = ts && ts[0] > 0 && ts[1] > 0 ? [ts[0], ts[1]] : [4, 4];
  const tempo = Math.round(midi.header.tempos[0]?.bpm ?? 100);

  // quantização em semicolcheias (ou tercinas de colcheia se encaixar melhor)
  const grid = PPQ / 4;
  const minStart = Math.min(...all.map((n) => n.start));
  const shift = minStart > PPQ * 8 ? Math.floor(minStart / (PPQ * 4)) * PPQ * 4 : 0; // remove silêncio inicial longo
  for (const n of all) {
    const s = Math.round((n.start - shift) / grid) * grid;
    const e = Math.round((n.start - shift + n.dur) / grid) * grid;
    n.start = Math.max(0, s);
    n.dur = Math.max(grid, e - n.start);
  }

  // mãos: 2 trilhas com notas => trilha 1 = direita, 2 = esquerda; senão divide pela altura
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
    // divisão por instante: notas >= Dó central na direita, com histerese simples
    rh = [];
    lh = [];
    for (const n of all) (n.midi >= 60 ? rh : lh).push(n);
  }

  const keySig = midi.header.keySignatures[0] ? keyFromName(midi.header.keySignatures[0].key, midi.header.keySignatures[0].scale) : guessKeySig(all.map((n) => n.midi));

  const toChords = (ns: N[]): RawChord[] => {
    const map = new Map<number, N[]>();
    for (const n of ns) {
      if (!map.has(n.start)) map.set(n.start, []);
      map.get(n.start)!.push(n);
    }
    return [...map.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([start, group]) => {
        const uniq = [...new Map(group.map((g) => [g.midi, g])).values()].sort((a, b) => a.midi - b.midi);
        return { start, dur: Math.min(...uniq.map((g) => g.dur)), pitches: uniq.map((g) => spell(g.midi, keySig)) };
      });
  };

  const staves: RawStaff[] = [];
  if (rh.length) staves.push({ clef: 'treble', hand: 'R', chords: toChords(rh) });
  if (lh.length) staves.push({ clef: 'bass', hand: 'L', chords: toChords(lh) });

  const title = midi.header.name?.trim() || fileName.replace(/\.(mid|midi)$/i, '');
  return songFromChords(
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

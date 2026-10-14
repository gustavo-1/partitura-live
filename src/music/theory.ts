import { PPQ, type Pitch, type Step } from './types';

export const STEPS: Step[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const STEP_SEMI: Record<Step, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export const SOLFEGE: Record<Step, string> = {
  C: 'Dó',
  D: 'Ré',
  E: 'Mi',
  F: 'Fá',
  G: 'Sol',
  A: 'Lá',
  B: 'Si',
};

export type NamingStyle = 'solfege' | 'letters';

export function pitchToMidi(step: Step, alter: number, octave: number): number {
  return (octave + 1) * 12 + STEP_SEMI[step] + alter;
}

export function makePitch(step: Step, alter: number, octave: number): Pitch {
  return { step, alter, octave, midi: pitchToMidi(step, alter, octave) };
}

export function isBlackKey(midi: number): boolean {
  const pc = ((midi % 12) + 12) % 12;
  return pc === 1 || pc === 3 || pc === 6 || pc === 8 || pc === 10;
}

export function pitchClass(midi: number): number {
  return ((midi % 12) + 12) % 12;
}

// Ordem dos sustenidos/bemóis na armadura
const SHARP_ORDER: Step[] = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER: Step[] = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

/** Alteração implícita de cada nota natural em uma armadura (em quintas). */
export function keySigAlters(fifths: number): Record<Step, number> {
  const res: Record<Step, number> = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 };
  if (fifths > 0) for (let i = 0; i < fifths && i < 7; i++) res[SHARP_ORDER[i]] = 1;
  if (fifths < 0) for (let i = 0; i < -fifths && i < 7; i++) res[FLAT_ORDER[i]] = -1;
  return res;
}

const MAJOR_KEYS: Record<number, string> = {
  [-7]: 'Cb',
  [-6]: 'Gb',
  [-5]: 'Db',
  [-4]: 'Ab',
  [-3]: 'Eb',
  [-2]: 'Bb',
  [-1]: 'F',
  0: 'C',
  1: 'G',
  2: 'D',
  3: 'A',
  4: 'E',
  5: 'B',
  6: 'F#',
  7: 'C#',
};

export function keySigToVex(fifths: number): string {
  return MAJOR_KEYS[Math.max(-7, Math.min(7, Math.round(fifths)))] ?? 'C';
}

export function keySigName(fifths: number, style: NamingStyle): string {
  const k = keySigToVex(fifths);
  const step = k[0] as Step;
  const acc = k.length > 1 ? (k[1] === '#' ? '♯' : '♭') : '';
  return (style === 'solfege' ? SOLFEGE[step] : step) + acc + ' maior';
}

/** Grafia padrão de uma nota MIDI, preferindo sustenidos ou bemóis conforme a armadura. */
export function spellMidi(midi: number, fifths = 0): Pitch {
  const pc = pitchClass(midi);
  const octave = Math.floor(midi / 12) - 1;
  const alters = keySigAlters(fifths);
  // 1) nota diatônica na armadura?
  for (const s of STEPS) {
    const a = alters[s];
    const semi = STEP_SEMI[s] + a;
    if (((semi % 12) + 12) % 12 === pc) {
      // Cb/B# atravessam a oitava
      const oct = semi < 0 ? octave + 1 : semi > 11 ? octave - 1 : octave;
      return { midi, step: s, alter: a, octave: oct };
    }
  }
  // 2) natural
  for (const s of STEPS) if (STEP_SEMI[s] === pc) return { midi, step: s, alter: 0, octave };
  // 3) acidente
  const useFlats = fifths < 0;
  const sharpNames: Record<number, Step> = { 1: 'C', 3: 'D', 6: 'F', 8: 'G', 10: 'A' };
  const flatNames: Record<number, Step> = { 1: 'D', 3: 'E', 6: 'G', 8: 'A', 10: 'B' };
  if (useFlats) return { midi, step: flatNames[pc], alter: -1, octave };
  return { midi, step: sharpNames[pc], alter: 1, octave };
}

export function accidentalSymbol(alter: number): string {
  switch (alter) {
    case 1:
      return '♯';
    case -1:
      return '♭';
    case 2:
      return '𝄪';
    case -2:
      return '𝄫';
    default:
      return '';
  }
}

export function pitchName(p: Pitch, style: NamingStyle, withOctave = false): string {
  const base = style === 'solfege' ? SOLFEGE[p.step] : p.step;
  return base + accidentalSymbol(p.alter) + (withOctave ? String(p.octave) : '');
}

export function midiName(midi: number, style: NamingStyle, withOctave = false, fifths = 0): string {
  return pitchName(spellMidi(midi, fifths), style, withOctave);
}

/** Nome em formato VexFlow, ex.: "c#/4" */
export function pitchToVexKey(p: Pitch): string {
  const acc = p.alter === 1 ? '#' : p.alter === -1 ? 'b' : p.alter === 2 ? '##' : p.alter === -2 ? 'bb' : '';
  return `${p.step.toLowerCase()}${acc}/${p.octave}`;
}

export function midiToFreq(midi: number, a4 = 440): number {
  return a4 * Math.pow(2, (midi - 69) / 12);
}

export function freqToMidi(freq: number, a4 = 440): number {
  return 69 + 12 * Math.log2(freq / a4);
}

/** Converte nome como "C#4" / "Bb3" / "En4" em Pitch */
export function parsePitch(s: string): Pitch | null {
  const m = /^([A-Ga-g])(##|bb|#|b|n)?(-?\d)$/.exec(s.trim());
  if (!m) return null;
  const step = m[1].toUpperCase() as Step;
  const acc = m[2] ?? '';
  const alter = acc === '#' ? 1 : acc === 'b' ? -1 : acc === '##' ? 2 : acc === 'bb' ? -2 : 0;
  return makePitch(step, alter, parseInt(m[3], 10));
}

// Durações ------------------------------------------------------------

export const DUR_TICKS: Record<string, number> = {
  w: PPQ * 4,
  h: PPQ * 2,
  q: PPQ,
  '8': PPQ / 2,
  '16': PPQ / 4,
  '32': PPQ / 8,
};

export function durTicks(dur: string, dots: number): number {
  let base = DUR_TICKS[dur];
  let total = base;
  for (let i = 0; i < dots; i++) {
    base /= 2;
    total += base;
  }
  return total;
}

/** Decompõe uma duração em ticks em figuras notáveis (maior primeiro). */
export function ticksToDurations(ticks: number): { dur: string; dots: number; ticks: number }[] {
  const out: { dur: string; dots: number; ticks: number }[] = [];
  let rest = Math.round(ticks);
  const options: { dur: string; dots: number; ticks: number }[] = [];
  for (const dur of ['w', 'h', 'q', '8', '16', '32']) {
    for (const dots of [1, 0]) options.push({ dur, dots, ticks: durTicks(dur, dots) });
  }
  options.sort((a, b) => b.ticks - a.ticks);
  let guard = 0;
  while (rest >= DUR_TICKS['32'] && guard++ < 32) {
    const opt = options.find((o) => o.ticks <= rest);
    if (!opt) break;
    out.push(opt);
    rest -= opt.ticks;
  }
  return out;
}

export const DUR_NAMES_PT: Record<string, string> = {
  w: 'semibreve',
  h: 'mínima',
  q: 'semínima',
  '8': 'colcheia',
  '16': 'semicolcheia',
  '32': 'fusa',
};

export function measureTicks(ts: [number, number]): number {
  return Math.round((ts[0] * PPQ * 4) / ts[1]);
}

export function beatTicks(ts: [number, number]): number {
  // compassos compostos (6/8, 9/8, 12/8): pulso = semínima pontuada
  if (ts[1] === 8 && ts[0] % 3 === 0 && ts[0] > 3) return (PPQ / 2) * 3;
  return (PPQ * 4) / ts[1];
}

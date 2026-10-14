import { buildSong } from './notation';
import type { Song } from './types';

/**
 * Gera exercícios curtos de leitura à primeira vista (melodias em posição fixa,
 * com passos, saltos e ritmos de acordo com o nível).
 */
interface Pos {
  name: string;
  rh: string[]; // 5 notas da posição (dedos 1..5)
  lh: string[]; // 5 notas (dedos 5..1)
  key: number;
}

const POSITIONS: Pos[] = [
  { name: 'Dó', rh: ['C4', 'D4', 'E4', 'F4', 'G4'], lh: ['C3', 'D3', 'E3', 'F3', 'G3'], key: 0 },
  { name: 'Sol', rh: ['G4', 'A4', 'B4', 'C5', 'D5'], lh: ['G2', 'A2', 'B2', 'C3', 'D3'], key: 1 },
  { name: 'Fá', rh: ['F4', 'G4', 'A4', 'Bb4', 'C5'], lh: ['F2', 'G2', 'A2', 'Bb2', 'C3'], key: -1 },
  { name: 'Ré', rh: ['D4', 'E4', 'F#4', 'G4', 'A4'], lh: ['D3', 'E3', 'F#3', 'G3', 'A3'], key: 2 },
];

const RHYTHMS: Record<number, string[]> = {
  1: ['q q q q', 'h q q', 'q q h', 'h h'],
  2: ['q q q q', 'h q q', 'q q h', 'h h', 'q h q', 'h. q'],
  3: ['q q q q', 'e e q q q', 'q q e e q', 'q. e q q', 'h q q', 'q q h', 'e e e e q q'],
  4: ['e e q e e q', 'q. e q q', 'q e e q q', 'e e e e h', 'q q e e e e', 'h e e q'],
};

const DUR: Record<string, string> = { w: 'w', h: 'h', 'h.': 'h.', q: 'q', 'q.': 'q.', e: 'e' };

function rnd<T>(arr: T[], r: () => number): T {
  return arr[Math.floor(r() * arr.length)];
}

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function walk(len: number, r: () => number, level: number, start: number): number[] {
  const out = [start];
  let cur = start;
  for (let i = 1; i < len; i++) {
    const x = r();
    let step: number;
    if (x < (level <= 1 ? 0.7 : 0.5)) step = r() < 0.5 ? 1 : -1;
    else if (x < (level <= 1 ? 0.88 : 0.8)) step = r() < 0.5 ? 2 : -2;
    else if (x < 0.92 || level < 3) step = 0;
    else step = r() < 0.5 ? 3 : -3;
    let next = cur + step;
    if (next < 0 || next > 4) next = cur - step;
    next = Math.max(0, Math.min(4, next));
    out.push(next);
    cur = next;
  }
  return out;
}

export function generateExercise(level: number, seed = Date.now()): Song {
  const r = mulberry(seed);
  const lvl = Math.max(1, Math.min(4, Math.round(level)));
  const pos = lvl <= 1 ? POSITIONS[0] : lvl === 2 ? rnd(POSITIONS.slice(0, 2), r) : rnd(POSITIONS, r);
  const bars = lvl <= 1 ? 4 : lvl <= 2 ? 6 : 8;
  const rhythms: string[][] = [];
  for (let b = 0; b < bars - 1; b++) rhythms.push(rnd(RHYTHMS[lvl], r).split(' '));
  rhythms.push(lvl <= 2 ? ['w'] : rnd([['h', 'h'], ['q', 'q', 'h'], ['w']], r));
  const count = rhythms.reduce((a, b) => a + b.length, 0);
  const degrees = walk(count, r, lvl, rnd([0, 0, 2, 4], r));
  // termina na tônica
  degrees[degrees.length - 1] = 0;
  if (degrees.length > 1 && Math.abs(degrees[degrees.length - 2]) > 2) degrees[degrees.length - 2] = 1;

  let i = 0;
  let lastDeg = -1;
  const rhParts: string[] = [];
  for (const bar of rhythms) {
    const toks = bar.map((d) => {
      const deg = degrees[i++];
      const note = pos.rh[deg];
      const finger = deg !== lastDeg ? `@${deg + 1}` : '';
      lastDeg = deg;
      return `${note}${DUR[d] ?? 'q'}${finger}`;
    });
    rhParts.push(toks.join(' '));
  }

  let lh: string | undefined;
  if (lvl >= 2) {
    // mão esquerda: notas longas (tônica / dominante), nível 4 com acordes simples
    const lhBars: string[] = [];
    for (let b = 0; b < bars; b++) {
      const last = b === bars - 1;
      const deg = last ? 0 : r() < 0.6 ? 0 : 4;
      const note = pos.lh[deg];
      const finger = deg === 0 ? 5 : 1;
      if (lvl >= 4 && !last) lhBars.push(`(${pos.lh[0]}@5 ${pos.lh[deg === 0 ? 2 : 3]} ${pos.lh[4]}@1)h ${note}h@${finger}`);
      else if (lvl >= 3 && !last) lhBars.push(`${note}h@${finger} ${pos.lh[deg === 0 ? 4 : 0]}h@${deg === 0 ? 1 : 5}`);
      else lhBars.push(`${note}w@${finger}`);
    }
    lh = lhBars.join(' | ');
  }

  return buildSong({
    id: `gen-${lvl}-${seed.toString(36)}`,
    title: `Leitura à primeira vista — posição de ${pos.name}`,
    composer: 'Exercício gerado',
    level: lvl,
    tempo: lvl <= 1 ? 72 : lvl === 2 ? 80 : 88,
    key: pos.key,
    rh: rhParts.join(' | '),
    lh,
    source: 'generated',
  });
}

import { isBlackKey } from '../music/theory';

export interface KeyRect {
  midi: number;
  x: number;
  w: number;
  black: boolean;
}

/** Ajusta a faixa para começar e terminar em teclas brancas. */
export function normalizeRange(lo: number, hi: number): [number, number] {
  let a = lo;
  let b = hi;
  while (isBlackKey(a)) a--;
  while (isBlackKey(b)) b++;
  return [a, b];
}

// deslocamento das teclas pretas em relação à divisa entre brancas (fração da largura branca)
const BLACK_OFFSET: Record<number, number> = { 1: -0.12, 3: 0.12, 6: -0.15, 8: 0, 10: 0.15 };

export function keyboardLayout(lo: number, hi: number, width: number): KeyRect[] {
  const [a, b] = normalizeRange(lo, hi);
  let whites = 0;
  for (let m = a; m <= b; m++) if (!isBlackKey(m)) whites++;
  const ww = width / whites;
  const bw = ww * 0.62;
  const keys: KeyRect[] = [];
  let wi = 0;
  for (let m = a; m <= b; m++) {
    if (!isBlackKey(m)) {
      keys.push({ midi: m, x: wi * ww, w: ww, black: false });
      wi++;
    } else {
      const center = wi * ww + (BLACK_OFFSET[m % 12] ?? 0) * ww;
      keys.push({ midi: m, x: center - bw / 2, w: bw, black: true });
    }
  }
  return keys;
}

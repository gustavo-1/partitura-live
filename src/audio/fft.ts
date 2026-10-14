/** FFT radix-2 in-place (Cooley–Tukey). Tamanho deve ser potência de 2. */
export class FFT {
  readonly n: number;
  private rev: Uint32Array;
  private cos: Float64Array;
  private sin: Float64Array;
  readonly re: Float64Array;
  readonly im: Float64Array;

  constructor(n: number) {
    if ((n & (n - 1)) !== 0) throw new Error('FFT size must be power of 2');
    this.n = n;
    this.re = new Float64Array(n);
    this.im = new Float64Array(n);
    this.rev = new Uint32Array(n);
    const bits = Math.log2(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / n);
      this.sin[i] = -Math.sin((2 * Math.PI * i) / n);
    }
  }

  /** Calcula a FFT de `input` (real), aplicando `window`, e escreve magnitudes em `out` (n/2). */
  magnitudes(input: ArrayLike<number>, window: Float64Array, out: Float64Array, offset = 0): void {
    const { n, re, im, rev } = this;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      re[j] = input[offset + i] * window[i];
      im[j] = 0;
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let start = 0; start < n; start += size) {
        for (let k = 0; k < half; k++) {
          const tw = k * step;
          const wr = this.cos[tw];
          const wi = this.sin[tw];
          const a = start + k;
          const b = a + half;
          const xr = re[b] * wr - im[b] * wi;
          const xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr;
          im[b] = im[a] - xi;
          re[a] += xr;
          im[a] += xi;
        }
      }
    }
    const half = n >> 1;
    for (let k = 0; k < half; k++) out[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
  }
}

export function hann(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  return w;
}

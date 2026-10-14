import { FFT, hann } from './fft';

/**
 * Detector polifônico de notas de piano a partir do microfone.
 *
 * Baseado em "soma de amplitudes harmônicas" com estimação iterativa e cancelamento
 * (Klapuri, ISMIR 2006), com branqueamento espectral, mais:
 *  - normalização pela mediana do espectro (independe do volume do microfone);
 *  - inarmonicidade das cordas do piano (parciais esticados);
 *  - detecção de ataque por nota usando uma janela curta (re-toques da mesma tecla).
 *
 * É puro (sem Web Audio) para poder ser testado no Node.
 */

export interface DetectorOptions {
  sampleRate: number;
  minMidi?: number;
  maxMidi?: number;
  /** 0 (menos sensível, menos falsos positivos) .. 1 (mais sensível) */
  sensitivity?: number;
  maxPolyphony?: number;
  a4?: number;
}

export interface NoteOnset {
  midi: number;
  time: number;
  strength: number;
}

export interface DetectorFrame {
  time: number;
  rms: number;
  gated: boolean;
  active: number[];
  onsets: NoteOnset[];
  /** saliência normalizada por nota (índice = midi - minMidi), para visualização */
  salience: Float64Array;
  /** estimativa monofônica (nota mais forte) com desvio em cents */
  top?: { midi: number; cents: number; freq: number };
}

interface Partial {
  lo: number;
  hi: number;
  g: number;
  pen: number;
}

interface Candidate {
  midi: number;
  f0: number;
  partials: Partial[];
  gSum: number;
}

const EVID_OFFSET = Math.log(2.2); // picos de ruído ficam ~2x a mediana
const EVID_CAP = 3.2;
const STRONG_PARTIAL = 6; // parcial "forte" (x mediana)
const MAX_PARTIALS = 12;
const DYN_FLOOR = Math.pow(10, -50 / 20); // ignora o que está 50 dB abaixo do pico
const CANCEL_SLACK = 1.5;
const HARMONIC_REL = 0.75; // nota em posição de harmônico precisa de 75% da saliência da principal
const RISE_PARTIALS = 4;
const RISE_LOOKBACK: [number, number] = [0.04, 0.2];
const RISE_EPISODE_GAP = 0.1;
const ONSET_DELAY = 0.07; // atraso médio entre o ataque real e a detecção (compensado)
const ONSET_MIN_REL = 0.03; // energia mínima (vs. nota mais forte) para um ataque contar
const RISE_NEW = 2.5; // +4 dB em ~100 ms
const RISE_RESTRIKE = 3.5; // re-toque de nota que já soa
const RESTRIKE_PEAK_FRAC = 0.2; // re-toque precisa atingir 20% (-7 dB) do pico do ataque anterior
const MISSING_PENALTY_LOW = 0.6; // parcial 1..3 ausente
const MISSING_PENALTY_HIGH = 0.12;
const MIN_PEAK_REL = Math.pow(10, -28 / 20); // nota precisa ter parcial a até 28 dB do pico

/** Intervalos (semitons) dos harmônicos 2..16, já com o "esticamento" típico do piano. */
const HARMONIC_INTERVALS: number[] = [];
for (let h = 2; h <= 16; h++) {
  const B = 0.0003;
  HARMONIC_INTERVALS.push(12 * Math.log2(h) + 12 * Math.log2(Math.sqrt(1 + B * h * h)));
}

/** `upper` está a um intervalo que coincide com um harmônico de `lower`? */
export function isHarmonicOf(upper: number, lower: number): boolean {
  const d = upper - lower;
  if (d < 11) return false;
  return HARMONIC_INTERVALS.some((x) => Math.abs(d - x) <= 0.6);
}

export class NoteDetector {
  readonly sampleRate: number;
  readonly nLong: number;
  readonly nShort: number;
  readonly minMidi: number;
  readonly maxMidi: number;
  sensitivity: number;
  maxPolyphony: number;

  private fftLong: FFT;
  private winLong: Float64Array;
  private magLong: Float64Array;
  private white: Float64Array;
  private resid: Float64Array;
  private gammaK: Float64Array;
  private prefix: Float64Array;
  private cands: Candidate[];
  private salience: Float64Array;
  private salNorm: Float64Array;

  // estado temporal
  private hist: { time: number; energy: Float64Array }[] = [];
  private presence: Uint8Array; // contagem de quadros recentes com a nota
  private activeSet = new Set<number>();
  private lastOnset: Float64Array;
  private riseTime: Float64Array;
  private riseRatio: Float64Array;
  private riseLastFrame: Float64Array;
  private onsetPeak: Float64Array;
  lastDetected: number[] = [];
  private noiseRms = 0.001;
  private suppressUntil = 0;
  private ignored = new Map<number, number>(); // midi -> até quando ignorar

  constructor(opts: DetectorOptions) {
    this.sampleRate = opts.sampleRate;
    this.nLong = opts.sampleRate > 32000 ? 8192 : 4096;
    this.nShort = this.nLong / 4;
    this.minMidi = opts.minMidi ?? 24;
    this.maxMidi = opts.maxMidi ?? 103;
    this.sensitivity = opts.sensitivity ?? 0.5;
    this.maxPolyphony = opts.maxPolyphony ?? 6;
    const a4 = opts.a4 ?? 440;

    this.fftLong = new FFT(this.nLong);
    this.winLong = hann(this.nLong);
    this.magLong = new Float64Array(this.nLong / 2);
    this.white = new Float64Array(this.nLong / 2);
    this.resid = new Float64Array(this.nLong / 2);
    this.gammaK = new Float64Array(this.nLong / 2);

    this.prefix = new Float64Array(this.nLong / 2 + 1);

    const nm = this.maxMidi - this.minMidi + 1;
    this.salience = new Float64Array(nm);
    this.salNorm = new Float64Array(nm);
    this.presence = new Uint8Array(nm);
    this.lastOnset = new Float64Array(nm).fill(-1e9);
    this.riseTime = new Float64Array(nm).fill(-1e9);
    this.riseRatio = new Float64Array(nm);
    this.riseLastFrame = new Float64Array(nm).fill(-1e9);
    this.onsetPeak = new Float64Array(nm);

    const binHz = this.sampleRate / this.nLong;
    const maxBin = this.nLong / 2 - 2;
    const fMax = Math.min(8000, this.sampleRate / 2 - 200);
    this.cands = [];
    for (let m = this.minMidi; m <= this.maxMidi; m++) {
      const f0 = a4 * Math.pow(2, (m - 69) / 12);
      const B = Math.max(0.00008, 0.0003 * Math.pow(2, (m - 60) / 18));
      const partials: Partial[] = [];
      let gSum = 0;
      for (let h = 1; h <= MAX_PARTIALS; h++) {
        const stretch = Math.sqrt(1 + B * h * h);
        const fc = h * f0;
        if (fc * stretch > fMax) break;
        const tol = Math.pow(2, 0.3 / 12);
        const lo = Math.max(1, Math.floor((fc / tol) / binHz));
        const hi = Math.min(maxBin, Math.ceil((fc * stretch * tol) / binHz));
        const g = 1 / Math.pow(h, 0.25);
        partials.push({ lo, hi: Math.max(lo, hi), g, pen: h <= 3 ? MISSING_PENALTY_LOW : MISSING_PENALTY_HIGH });
        gSum += g;
      }
      this.cands.push({ midi: m, f0, partials, gSum });
    }
  }

  /** Ignora ataques por um tempo (ex.: clique do metrônomo). */
  suppress(until: number): void {
    this.suppressUntil = Math.max(this.suppressUntil, until);
  }

  /** Ignora uma nota específica (ex.: o próprio app está tocando essa nota). */
  ignoreNote(midi: number, until: number): void {
    this.ignored.set(midi, Math.max(this.ignored.get(midi) ?? 0, until));
  }

  reset(): void {
    this.hist = [];
    this.presence.fill(0);
    this.activeSet.clear();
    this.lastOnset.fill(-1e9);
    this.riseTime.fill(-1e9);
  }

  /**
   * Processa um quadro. `buf` deve conter pelo menos nLong amostras; usa as últimas nLong.
   * `time` em segundos.
   */
  process(buf: Float32Array, time: number): DetectorFrame {
    const nL = this.nLong;
    const off = buf.length - nL;
    const offS = buf.length - this.nShort;

    // nível (janela curta)
    let sum = 0;
    for (let i = offS; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / this.nShort);
    // piso de ruído adaptativo
    if (rms < this.noiseRms) this.noiseRms = this.noiseRms * 0.8 + rms * 0.2;
    else this.noiseRms *= 1.002;
    this.noiseRms = Math.max(this.noiseRms, 1e-5);

    const gateRatio = 2.2 - this.sensitivity * 1.0;
    const gated = rms < Math.max(this.noiseRms * gateRatio, 0.0006);

    const nc = this.cands.length;
    const onsets: NoteOnset[] = [];
    let detected: number[] = [];
    let top: DetectorFrame['top'];
    // energia por parcial (janela longa, alta resolução) para detectar ataques
    const pEnergy = new Float64Array(nc * RISE_PARTIALS);
    const energy = new Float64Array(nc);

    // a FFT é sempre calculada: o histórico de energia precisa refletir o sinal real,
    // inclusive nos silêncios curtos entre notas (senão todo ataque parece re-toque)
    this.fftLong.magnitudes(buf, this.winLong, this.magLong, off);
    for (let i = 0; i < nc; i++) {
      const ps = this.cands[i].partials;
      let e = 0;
      for (let h = 0; h < ps.length && h < 6; h++) {
        let mx = 0;
        for (let k = ps[h].lo; k <= ps[h].hi; k++) if (this.magLong[k] > mx) mx = this.magLong[k];
        e += mx * mx;
        if (h < RISE_PARTIALS) pEnergy[i * RISE_PARTIALS + h] = mx * mx;
      }
      energy[i] = e;
    }
    if (!gated) {
      this.whiten();
      detected = this.estimate();
      if (detected.length) top = this.refineTop(detected[0]);
    } else {
      this.salNorm.fill(0);
    }
    this.lastDetected = detected;
    this.hist.push({ time, energy: pEnergy });
    while (this.hist.length && time - this.hist[0].time > 0.35) this.hist.shift();

    // persistência temporal: nota precisa aparecer em 2 quadros
    const detSet = new Set(detected);
    for (let i = 0; i < nc; i++) {
      const m = this.cands[i].midi;
      if (detSet.has(m)) this.presence[i] = Math.min(3, this.presence[i] + 1);
      else this.presence[i] = Math.max(0, this.presence[i] - (gated ? 3 : 1));
    }

    // ataques: energia dos parciais agora vs. mínimo de RISE_LOOKBACK atrás.
    // Usa a mediana entre os parciais para não confundir com parciais
    // compartilhados com outra nota que acabou de começar.
    let eMax = 0;
    for (let i = 0; i < nc; i++) if (energy[i] > eMax) eMax = energy[i];
    for (let i = 0; i < nc; i++) {
      if (gated || energy[i] < eMax * ONSET_MIN_REL) continue;
      const np = Math.min(RISE_PARTIALS, this.cands[i].partials.length);
      const ratios: number[] = [];
      for (let h = 0; h < np; h++) {
        let minE = Infinity;
        for (const hh of this.hist) {
          const dt = time - hh.time;
          if (dt < RISE_LOOKBACK[0] || dt > RISE_LOOKBACK[1]) continue;
          const v = hh.energy[i * RISE_PARTIALS + h];
          if (v < minE) minE = v;
        }
        if (minE === Infinity) continue;
        ratios.push(pEnergy[i * RISE_PARTIALS + h] / (minE + eMax * 1e-6 + 1e-12));
      }
      if (!ratios.length) continue;
      ratios.sort((a, b) => a - b);
      const ratio = ratios.length >= 3 ? ratios[Math.floor((ratios.length - 1) / 2)] : ratios[ratios.length - 1];
      if (ratio < RISE_NEW) continue;
      // a fundamental (ou 2º harmônico nos graves) precisa ser um pico tonal
      const ps = this.cands[i].partials;
      let fundY = 0;
      for (const h of this.cands[i].midi < 52 ? [0, 1] : [0]) {
        const p = ps[h];
        if (!p) continue;
        for (let k = p.lo; k <= p.hi; k++) if (this.white[k] > fundY) fundY = this.white[k];
      }
      if (fundY < STRONG_PARTIAL) continue;
      if (time - this.riseLastFrame[i] > RISE_EPISODE_GAP || ratio > this.riseRatio[i] * 4) {
        this.riseTime[i] = time;
        this.riseRatio[i] = ratio;
      } else this.riseRatio[i] = Math.max(this.riseRatio[i], ratio);
      this.riseLastFrame[i] = time;
    }

    for (let i = 0; i < nc; i++) {
      if (time - this.lastOnset[i] < 0.3 && energy[i] > this.onsetPeak[i]) this.onsetPeak[i] = energy[i];
    }

    const newActive = new Set<number>();
    for (let i = 0; i < this.cands.length; i++) {
      const m = this.cands[i].midi;
      const wasActive = this.activeSet.has(m);
      const isActive = wasActive ? this.presence[i] > 0 : this.presence[i] >= 2;
      if (isActive) newActive.add(m);
      if (!isActive || !detSet.has(m)) continue;
      // houve ataque recente desta nota que ainda não foi reportado?
      const rise = this.riseTime[i];
      if (time - rise > 0.25 || rise <= this.lastOnset[i]) continue;
      const needed = wasActive ? RISE_RESTRIKE : RISE_NEW;
      if (this.riseRatio[i] < needed) continue;
      // re-toque precisa chegar perto do nível do ataque anterior (batimentos não contam)
      if (wasActive && energy[i] < this.onsetPeak[i] * RESTRIKE_PEAK_FRAC) continue;
      if (time - this.lastOnset[i] < 0.1) continue;
      if (rise < this.suppressUntil) continue;
      const ign = this.ignored.get(m);
      if (ign && time < ign) continue;
      this.lastOnset[i] = rise;
      this.onsetPeak[i] = energy[i];
      onsets.push({ midi: m, time: rise - ONSET_DELAY, strength: this.salNorm[i] });
    }
    this.activeSet = newActive;

    return {
      time,
      rms,
      gated,
      active: [...newActive].sort((a, b) => a - b),
      onsets,
      salience: this.salNorm,
      top,
    };
  }

  /**
   * Normalização por contraste local: divide cada bin pela média geométrica da vizinhança
   * (excluindo o próprio pico). Parciais tonais ficam >> 1, ruído ~ 1, independente do volume
   * e da resposta de frequência do microfone/sala.
   */
  private whiten(): void {
    const mag = this.magLong;
    const n = mag.length;
    const logm = this.white; // reaproveita buffer
    let mx = 0;
    for (let k = 0; k < n; k++) if (mag[k] > mx) mx = mag[k];
    const eps = mx * DYN_FLOOR + 1e-12;
    const pre = this.prefix;
    pre[0] = 0;
    for (let k = 0; k < n; k++) {
      logm[k] = Math.log(mag[k] + eps);
      pre[k + 1] = pre[k] + logm[k];
    }
    const out = this.gammaK; // buffer temporário
    for (let k = 0; k < n; k++) {
      const W = Math.max(8, Math.round(k * 0.07));
      const a = Math.max(0, k - W);
      const b = Math.min(n - 1, k + W);
      const ia = Math.max(a, k - 2);
      const ib = Math.min(b, k + 2);
      const total = pre[b + 1] - pre[a] - (pre[ib + 1] - pre[ia]);
      const cnt = b - a + 1 - (ib - ia + 1);
      const local = total / Math.max(1, cnt);
      out[k] = Math.exp(logm[k] - local);
    }
    this.white.set(out);
  }

  /** Evidência (log) de cada parcial; ruído ~ 0 ou negativo, parcial ausente penaliza. */
  private computeSalience(spec: Float64Array, out: Float64Array, skip: Set<number>): number {
    let best = -1;
    let bestS = 0;
    for (let i = 0; i < this.cands.length; i++) {
      const c = this.cands[i];
      if (skip.has(c.midi)) {
        out[i] = -1e9;
        continue;
      }
      let s = 0;
      for (const p of c.partials) {
        let mx = 0;
        for (let k = p.lo; k <= p.hi; k++) if (spec[k] > mx) mx = spec[k];
        s += p.g * Math.max(-p.pen, Math.min(EVID_CAP, Math.log(mx + 1e-9) - EVID_OFFSET));
      }
      out[i] = s;
      if (s > bestS) {
        bestS = s;
        best = i;
      }
    }
    return best;
  }

  /** Estimação iterativa com cancelamento. Retorna notas MIDI detectadas (mais forte primeiro). */
  private estimate(): number[] {
    const Y = this.white;
    const R = this.resid;
    R.set(Y);
    const out: number[] = [];
    const skip = new Set<number>();
    const sal = this.salience;
    const thr = 5 - this.sensitivity * 2; // pontuação mínima absoluta
    const relThr = 0.25 - this.sensitivity * 0.1; // relativa à nota mais forte
    let magMax = 0;
    for (let k = 0; k < this.magLong.length; k++) if (this.magLong[k] > magMax) magMax = this.magLong[k];
    const minPeak = magMax * MIN_PEAK_REL;
    let firstS = 0;
    this.computeSalience(Y, sal, skip);
    for (let i = 0; i < sal.length; i++) this.salNorm[i] = Math.max(0, sal[i]);

    const rejected: { midi: number; s: number }[] = [];
    const outS: number[] = [];
    let guard = 0;
    while (out.length < this.maxPolyphony && guard++ < 24) {
      const bi = this.computeSalience(R, sal, skip);
      if (bi < 0) break;
      const c = this.cands[bi];
      const s = sal[bi];
      if (s < thr * 0.5 || s < firstS * relThr) break;
      const thrC = thr * Math.min(1, Math.max(0.6, c.partials.length / 6));
      if (s < thrC) {
        skip.add(c.midi);
        continue;
      }
      // candidato acima de um candidato mais forte que foi rejeitado (ex.: início do ataque)
      if (rejected.some((r) => r.s > s && isHarmonicOf(c.midi, r.midi))) {
        skip.add(c.midi);
        rejected.push({ midi: c.midi, s });
        continue;
      }
      // precisa de evidência forte em pelo menos 2 parciais (1 se for muito aguda)
      let strong = 0;
      let loudest = 0;
      const amps: number[] = [];
      const pos: number[] = [];
      for (const p of c.partials) {
        let mx = 0;
        let kMax = p.lo;
        for (let k = p.lo; k <= p.hi; k++)
          if (R[k] > mx) {
            mx = R[k];
            kMax = k;
          }
        amps.push(mx);
        pos.push(kMax);
        if (mx > STRONG_PARTIAL) strong++;
        if (this.magLong[kMax] > loudest) loudest = this.magLong[kMax];
      }
      skip.add(c.midi);
      // a fundamental (ou o 2º harmônico, nos graves) precisa existir como pico
      const fundOk = c.midi >= 52 ? amps[0] > STRONG_PARTIAL : amps[0] > STRONG_PARTIAL || (amps[1] ?? 0) > STRONG_PARTIAL;
      if (strong < Math.min(2, c.partials.length) || !fundOk || loudest < minPeak) {
        rejected.push({ midi: c.midi, s });
        continue;
      }
      // nota que coincide com um harmônico de uma nota já detectada exige mais evidência
      if (out.some((m) => isHarmonicOf(c.midi, m)) && (s < thr * 2 || s < firstS * HARMONIC_REL)) continue;
      if (!out.length) firstS = s;
      out.push(c.midi);
      outS.push(s);
      // cancela parciais com suavidade espectral: remove só o que a envoltória explica
      for (let h = 0; h < amps.length; h++) {
        const a0 = amps[Math.max(0, h - 1)];
        const a2 = amps[Math.min(amps.length - 1, h + 1)];
        const smooth = Math.exp((Math.log(a0 + 1e-9) + Math.log(amps[h] + 1e-9) + Math.log(a2 + 1e-9)) / 3);
        const sub = Math.min(amps[h], smooth * CANCEL_SLACK);
        const k0 = pos[h];
        for (let k = Math.max(0, k0 - 2); k <= Math.min(R.length - 1, k0 + 2); k++) {
          const ratio = amps[h] > 0 ? R[k] / amps[h] : 0;
          R[k] = Math.max(1, R[k] - sub * ratio);
        }
      }
    }
    // revalida notas que caem em harmônicos de notas mais graves detectadas depois
    return out.filter((m, i) => {
      for (let j = 0; j < out.length; j++) {
        if (j === i || !isHarmonicOf(m, out[j])) continue;
        if (outS[i] < Math.max(thr * 2, outS[j] * HARMONIC_REL) && j > i) return false;
      }
      return true;
    });
  }

  private refineTop(midi: number): DetectorFrame['top'] {
    const c = this.cands[midi - this.minMidi];
    // usa o parcial mais forte entre os 3 primeiros para estimar a afinação
    const binHz = this.sampleRate / this.nLong;
    let bestK = -1;
    let bestV = 0;
    let bestH = 1;
    c.partials.slice(0, 3).forEach((p, idx) => {
      for (let k = p.lo; k <= p.hi; k++)
        if (this.magLong[k] > bestV) {
          bestV = this.magLong[k];
          bestK = k;
          bestH = idx + 1;
        }
    });
    if (bestK <= 0) return undefined;
    const a = this.magLong[bestK - 1];
    const b = this.magLong[bestK];
    const g = this.magLong[bestK + 1];
    const denom = a - 2 * b + g;
    const delta = denom !== 0 ? (0.5 * (a - g)) / denom : 0;
    const freq = ((bestK + delta) * binHz) / bestH;
    const cents = 1200 * Math.log2(freq / c.f0);
    return { midi, cents, freq };
  }
}

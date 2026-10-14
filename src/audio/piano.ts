import { audioCtx } from './context';

/**
 * Piano amostrado (FluidR3_GM, CC BY 3.0). Uma amostra a cada 3 semitons;
 * as notas intermediárias são transpostas via playbackRate.
 */
const SAMPLE_STEP = 3;
const FIRST = 21;
const LAST = 108;

const buffers = new Map<number, AudioBuffer>();
const loading = new Map<number, Promise<AudioBuffer | null>>();
let master: GainNode | null = null;
let volume = 0.8;

function out(): GainNode {
  const ctx = audioCtx();
  if (!master) {
    master = ctx.createGain();
    master.gain.value = volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.ratio.value = 4;
    master.connect(comp).connect(ctx.destination);
  }
  return master;
}

export function setPianoVolume(v: number): void {
  volume = v;
  if (master) master.gain.value = v;
}

function nearestSample(midi: number): number {
  const m = Math.max(FIRST, Math.min(LAST, midi));
  return FIRST + Math.round((m - FIRST) / SAMPLE_STEP) * SAMPLE_STEP;
}

function sampleUrl(s: number): string {
  return `${import.meta.env.BASE_URL}samples/piano/${s}.mp3`;
}

function loadSample(s: number): Promise<AudioBuffer | null> {
  if (buffers.has(s)) return Promise.resolve(buffers.get(s)!);
  if (loading.has(s)) return loading.get(s)!;
  const p = fetch(sampleUrl(s))
    .then((r) => {
      if (!r.ok) throw new Error(String(r.status));
      return r.arrayBuffer();
    })
    .then((ab) => audioCtx().decodeAudioData(ab))
    .then((buf) => {
      buffers.set(s, buf);
      return buf;
    })
    .catch(() => null);
  loading.set(s, p);
  return p;
}

/** Pré-carrega amostras para uma faixa de notas. */
export async function preloadPiano(lo = 48, hi = 84): Promise<void> {
  const set = new Set<number>();
  for (let m = lo; m <= hi; m++) set.add(nearestSample(m));
  await Promise.all([...set].map(loadSample));
}

export interface Voice {
  stop(when?: number): void;
}

function synthFallback(midi: number, when: number, dur: number, vel: number): Voice {
  const ctx = audioCtx();
  const f = 440 * Math.pow(2, (midi - 69) / 12);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(0.25 * vel, when + 0.005);
  g.gain.exponentialRampToValueAtTime(0.02 * vel + 1e-4, when + Math.max(0.3, dur));
  g.connect(out());
  const oscs = [1, 2, 3, 4].map((h) => {
    const o = ctx.createOscillator();
    o.frequency.value = f * h;
    const gh = ctx.createGain();
    gh.gain.value = 1 / (h * h);
    o.connect(gh).connect(g);
    o.start(when);
    o.stop(when + dur + 0.5);
    return o;
  });
  return {
    stop(t = ctx.currentTime) {
      g.gain.cancelScheduledValues(t);
      g.gain.setTargetAtTime(0, t, 0.05);
      oscs.forEach((o) => o.stop(t + 0.3));
    },
  };
}

/** Toca uma nota. `when` em tempo do AudioContext; `dur` em segundos. */
export function playNote(midi: number, when?: number, dur = 1, velocity = 0.8): Voice {
  const ctx = audioCtx();
  const t = when ?? ctx.currentTime;
  const s = nearestSample(midi);
  const buf = buffers.get(s);
  if (!buf) {
    void loadSample(s);
    return synthFallback(midi, t, dur, velocity);
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = Math.pow(2, (midi - s) / 12);
  const g = ctx.createGain();
  const peak = 0.3 + 0.7 * velocity;
  g.gain.setValueAtTime(peak, t);
  const release = t + Math.max(0.05, dur);
  g.gain.setValueAtTime(peak, release);
  g.gain.setTargetAtTime(0, release, 0.12);
  src.connect(g).connect(out());
  src.start(t);
  src.stop(release + 1.2);
  return {
    stop(at = ctx.currentTime) {
      g.gain.cancelScheduledValues(at);
      g.gain.setTargetAtTime(0, at, 0.08);
      try {
        src.stop(at + 0.6);
      } catch {
        /* já parado */
      }
    },
  };
}

// notas sustentadas (teclado na tela / teclado do computador)
const held = new Map<number, Voice>();

export function noteOn(midi: number, velocity = 0.8): void {
  held.get(midi)?.stop();
  held.set(midi, playNote(midi, undefined, 4, velocity));
}

export function noteOff(midi: number): void {
  held.get(midi)?.stop();
  held.delete(midi);
}

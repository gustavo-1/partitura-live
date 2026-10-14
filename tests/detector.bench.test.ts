/**
 * Avalia o detector com amostras reais de piano (FluidR3_GM).
 * Rode com:  SAMPLES_RAW=/caminho/raw npx vitest run tests/detector.bench.test.ts
 * (arquivos <Nota><oitava>.f32, mono float32 a 48 kHz; ex.: C4.f32, Db4.f32)
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NoteDetector } from '../src/audio/detector';

const DIR = process.env.SAMPLES_RAW ?? '';
const SR = 48000;
const NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const cache = new Map<number, Float32Array>();

function sample(midi: number): Float32Array {
  if (cache.has(midi)) return cache.get(midi)!;
  const name = NAMES[midi % 12] + (Math.floor(midi / 12) - 1);
  const buf = readFileSync(join(DIR, name + '.f32'));
  const arr = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  cache.set(midi, arr);
  return arr;
}

let seed = 1;
function rnd() {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
}

interface NoteSpec {
  midi: number;
  t: number;
  dur?: number;
  gain?: number;
}

function render(notes: NoteSpec[], total: number, noise = 0.0005, reverb = false): Float32Array {
  const out = new Float32Array(Math.ceil(total * SR));
  for (const n of notes) {
    const s = sample(n.midi);
    const start = Math.floor(n.t * SR);
    const len = Math.min(s.length, Math.floor((n.dur ?? 3) * SR));
    const g = n.gain ?? 0.6;
    for (let i = 0; i < len && start + i < out.length; i++) {
      // corte suave ao soltar a tecla
      const rel = len - i < 2400 ? (len - i) / 2400 : 1;
      out[start + i] += s[i] * g * rel;
    }
  }
  if (reverb) {
    // reverberação simples: ruído com decaimento exponencial (RT60 ~ 0.5 s)
    const irLen = Math.floor(0.5 * SR);
    const ir = new Float32Array(irLen);
    for (let i = 0; i < irLen; i++) ir[i] = (rnd() * 2 - 1) * Math.exp((-6.9 * i) / irLen) * 0.02;
    const wet = new Float32Array(out.length);
    // convolução esparsa (amostra a IR) para manter rápido
    for (let j = 0; j < irLen; j += 37) {
      const h = ir[j] * 37 * 0.5;
      for (let i = 0; i + j < out.length; i++) wet[i + j] += out[i] * h;
    }
    for (let i = 0; i < out.length; i++) out[i] += wet[i];
  }
  for (let i = 0; i < out.length; i++) out[i] += (rnd() * 2 - 1) * noise;
  return out;
}

function run(signal: Float32Array, hop = 800, sensitivity = 0.5) {
  const det = new NoteDetector({ sampleRate: SR, sensitivity });
  const onsets: { midi: number; time: number }[] = [];
  const N = det.nLong;
  const buf = new Float32Array(N);
  for (let end = N; end <= signal.length; end += hop) {
    buf.set(signal.subarray(end - N, end));
    const t = end / SR;
    const f = det.process(buf, t);
    for (const o of f.onsets) onsets.push({ midi: o.midi, time: o.time });
  }
  return onsets;
}

function score(truth: NoteSpec[], onsets: { midi: number; time: number }[], win = 0.3) {
  const used = new Set<number>();
  let hit = 0;
  const misses: number[] = [];
  const latencies: number[] = [];
  for (const n of truth) {
    const idx = onsets.findIndex((o, i) => !used.has(i) && o.midi === n.midi && o.time >= n.t - 0.1 && o.time <= n.t + win);
    if (idx >= 0) {
      used.add(idx);
      hit++;
      latencies.push(onsets[idx].time - n.t);
    } else misses.push(n.midi);
  }
  const extras = onsets.filter((_, i) => !used.has(i));
  return { hit, total: truth.length, misses, extras, latencies };
}

const enabled = DIR !== '' && existsSync(join(DIR, 'C4.f32'));

describe.skipIf(!enabled)('detector com amostras reais', { timeout: 120000 }, () => {
  it('notas isoladas (A0..C8)', () => {
    let hits = 0;
    let total = 0;
    let extras = 0;
    let hits61 = 0;
    let extras61 = 0;
    const lat: number[] = [];
    const fails: string[] = [];
    for (let m = 24; m <= 103; m++) {
      const truth = [{ midi: m, t: 0.4, dur: 1.5 }];
      const sig = render(truth, 2.4);
      const r = score(truth, run(sig));
      hits += r.hit;
      total += r.total;
      extras += r.extras.length;
      if (m >= 36 && m <= 96) {
        hits61 += r.hit;
        extras61 += r.extras.length;
      }
      lat.push(...r.latencies);
      if (r.hit === 0 || r.extras.length) fails.push(`${m}: hit=${r.hit} extras=${r.extras.map((e) => e.midi).join(',')}`);
    }
    lat.sort((a, b) => a - b);
    console.log(
      `isoladas: ${hits}/${total}, extras=${extras}; C2..C7: ${hits61}/61 extras=${extras61}; ` +
        `latência mediana=${(lat[lat.length >> 1] * 1000).toFixed(0)}ms`,
    );
    if (fails.length) console.log('  falhas:', fails.join(' | '));
    // faixa principal do teclado de 61 teclas (C2..C7)
    expect(hits61 / 61).toBeGreaterThan(0.9);
    expect(extras61).toBeLessThan(8);
  });

  it('acordes e intervalos', () => {
    const chords = [
      [60, 64, 67],
      [48, 60],
      [48, 55, 64],
      [60, 62],
      [53, 57, 60],
      [55, 59, 62, 67],
      [43, 50, 59, 67],
      [60, 67],
      [62, 65, 69],
      [57, 60, 64],
      [36, 48],
      [72, 76, 79],
      [48, 52, 55, 60, 64],
    ];
    let hits = 0;
    let total = 0;
    let extras = 0;
    for (const ch of chords) {
      const truth = ch.map((m) => ({ midi: m, t: 0.4, dur: 1.5, gain: 0.4 }));
      const r = score(truth, run(render(truth, 2.2)));
      hits += r.hit;
      total += r.total;
      extras += r.extras.length;
      console.log(`  acorde ${ch.join(',')}: ${r.hit}/${r.total} faltou=[${r.misses}] extras=[${r.extras.map((e) => e.midi)}]`);
    }
    console.log(`acordes: ${hits}/${total}, extras=${extras}`);
    expect(hits / total).toBeGreaterThan(0.7);
  });

  it('melodia com notas repetidas (Brilha brilha estrelinha)', () => {
    const mel = [60, 60, 67, 67, 69, 69, 67, 65, 65, 64, 64, 62, 62, 60];
    const beat = 0.5;
    const truth = mel.map((m, i) => ({ midi: m, t: 0.4 + i * beat, dur: beat * 0.95 }));
    for (const rev of [false, true]) {
      const r = score(truth, run(render(truth, 0.4 + mel.length * beat + 1, 0.0005, rev)));
      console.log(
        `melodia (reverb=${rev}): ${r.hit}/${r.total} faltou=[${r.misses}] extras=[${r.extras.map((e) => `${e.midi}@${e.time.toFixed(2)}`)}]`,
      );
      expect(r.hit / r.total).toBeGreaterThan(0.85);
    }
  });

  it('colcheias rápidas repetidas', () => {
    const truth = Array.from({ length: 8 }, (_, i) => ({ midi: 64, t: 0.4 + i * 0.25, dur: 0.24 }));
    const r = score(truth, run(render(truth, 3)));
    console.log(`colcheias: ${r.hit}/${r.total} extras=[${r.extras.map((e) => e.midi)}]`);
    expect(r.hit / r.total).toBeGreaterThan(0.7);
  });

  it('duas mãos (melodia + baixo)', () => {
    const truth: NoteSpec[] = [];
    const rh = [64, 62, 60, 62, 64, 64, 64];
    rh.forEach((m, i) => truth.push({ midi: m, t: 0.4 + i * 0.5, dur: 0.48 }));
    truth.push({ midi: 48, t: 0.4, dur: 1.9, gain: 0.35 });
    truth.push({ midi: 43, t: 2.4, dur: 1.4, gain: 0.35 });
    const r = score(truth, run(render(truth, 4.5)));
    console.log(`duas mãos: ${r.hit}/${r.total} faltou=[${r.misses}] extras=[${r.extras.map((e) => `${e.midi}@${e.time.toFixed(2)}`)}]`);
    expect(r.hit / r.total).toBeGreaterThan(0.75);
  });

  it('volume baixo com ruído de fundo', () => {
    const mel = [60, 62, 64, 65, 67, 65, 64, 62, 60, 55, 60];
    const truth = mel.map((m, i) => ({ midi: m, t: 0.6 + i * 0.5, dur: 0.48, gain: 0.08 + (i % 3) * 0.04 }));
    const r = score(truth, run(render(truth, 0.6 + mel.length * 0.5 + 1, 0.002, true)));
    console.log(`volume baixo: ${r.hit}/${r.total} faltou=[${r.misses}] extras=[${r.extras.map((e) => `${e.midi}@${e.time.toFixed(2)}`)}]`);
    expect(r.hit / r.total).toBeGreaterThan(0.8);
  });

  it('ruído não gera notas', () => {
    const sig = render([], 3, 0.02);
    const r = run(sig);
    console.log(`ruído: ${r.length} detecções`);
    expect(r.length).toBeLessThan(2);
  });
});

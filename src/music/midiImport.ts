import { Midi } from '@tonejs/midi';
import { buildMeasures, guessKeySig, songFromChords, spell, type RawChord, type RawStaff } from './build';
import { buildEvents, tempoSegs, tickToSecs } from './timeline';
import { IMPORT_VERSION, PPQ, type ImportReport, type Song } from './types';
import { bytesToB64 } from '../lib/b64';
import { measureTicks } from './theory';

export type HandChoice = 'R' | 'L' | 'auto';
export interface TrackChoice {
  index: number;
  hand: HandChoice;
}

/** Resumo de uma trilha do arquivo (para escolher o que vira partitura). */
export interface MidiTrackInfo {
  index: number;
  name: string;
  instrument: string;
  family: string;
  program: number;
  percussion: boolean;
  piano: boolean;
  notes: number;
  lo: number;
  hi: number;
  avg: number;
  /** média de notas soando juntas (1 = linha melódica) */
  poly: number;
  /** intensidade média (0..1) */
  vel: number;
  /** quase sem som (ex.: trilha-guia de acordes com volume mínimo) */
  quiet: boolean;
}

interface N {
  midi: number;
  start: number; // ticks normalizados (PPQ interno)
  dur: number;
  rawStart: number; // onde soa no arquivo (ticks da partitura, antes de alinhar às figuras)
  rawEnd: number; // fim no arquivo (ticks), para a duração que soa
  track: number;
  hand: 'R' | 'L';
  vel: number; // 0..1
}

const TRIP = PPQ / 3; // grade de tercinas (colcheia de tercina)
const SIXTEENTH = PPQ / 4;
const THIRTYSECOND = PPQ / 8;
/** erro médio (ticks) abaixo do qual uma grade "explica" os ataques de um tempo (arquivo já quantizado) */
const FIT = PPQ * 0.0125;
/** andamento padrão do MIDI quando o arquivo não diz nenhum */
const MIDI_DEFAULT_BPM = 120;
const KEEP_ORIGINAL_MAX = 512 * 1024;

const FAMILY_PT: Record<string, string> = {
  piano: 'Piano',
  'chromatic percussion': 'Percussão melódica',
  organ: 'Órgão',
  guitar: 'Violão/guitarra',
  bass: 'Baixo',
  strings: 'Cordas',
  ensemble: 'Conjunto/coro',
  brass: 'Metais',
  reed: 'Palhetas',
  pipe: 'Flautas',
  'synth lead': 'Sintetizador (melodia)',
  'synth pad': 'Sintetizador (fundo)',
  'synth effects': 'Efeitos',
  world: 'Étnicos',
  ethnic: 'Étnicos',
  percussive: 'Percussivos',
  'sound effects': 'Efeitos sonoros',
  drums: 'Bateria',
};

/** Nome do instrumento em português (pela família General MIDI, com alguns casos comuns à parte). */
function instrumentPt(program: number, family: string, percussion: boolean): string {
  if (percussion) return 'Bateria';
  if (program >= 48 && program <= 51) return 'Cordas (conjunto)';
  if (program >= 52 && program <= 54) return 'Coro/voz';
  if (program === 40 || program === 41) return 'Violino/viola';
  if (program === 42 || program === 43) return 'Violoncelo/contrabaixo';
  if (program >= 56 && program <= 58) return 'Trompete/trombone/tuba';
  if (program === 73) return 'Flauta';
  return FAMILY_PT[family] ?? family;
}

export function midiTracks(midi: Midi): MidiTrackInfo[] {
  const infos = midi.tracks.map((tr, index) => {
    const percussion = tr.channel === 9 || !!tr.instrument?.percussion;
    const ms = tr.notes.map((n) => n.midi);
    const family = percussion ? 'drums' : tr.instrument?.family ?? 'piano';
    const program = tr.instrument?.number ?? 0;
    const name = (tr.name ?? '').trim();
    // polifonia: quantas notas começam juntas (mesmo tick) em média
    const starts = new Map<number, number>();
    for (const n of tr.notes) starts.set(n.ticks, (starts.get(n.ticks) ?? 0) + 1);
    const vel = tr.notes.length ? tr.notes.reduce((a, n) => a + (n.velocity ?? 0.7), 0) / tr.notes.length : 0;
    return {
      index,
      name,
      instrument: instrumentPt(program, family, percussion),
      family,
      program,
      percussion,
      piano: !percussion && (program <= 7 || /piano|pno|keys|keyboard|teclado/i.test(name)),
      notes: tr.notes.length,
      lo: ms.length ? Math.min(...ms) : 0,
      hi: ms.length ? Math.max(...ms) : 0,
      avg: ms.length ? ms.reduce((a, b) => a + b, 0) / ms.length : 0,
      poly: starts.size ? tr.notes.length / starts.size : 0,
      vel,
      quiet: tr.notes.length > 0 && vel < 0.12,
    };
  });
  // duas trilhas com o mesmo nome (ex.: "Piano" e "Piano"): numera para dar para distinguir
  const used = infos.filter((t) => t.notes > 0);
  const labels = used.map((t) => t.name || t.instrument);
  used.forEach((t, i) => {
    if (labels.filter((l) => l === labels[i]).length > 1) t.name = `${labels[i]} (trilha ${i + 1})`;
  });
  return infos;
}

/**
 * Sugestão inicial de trilhas:
 *  - 1 ou 2 trilhas com notas: todas (2 trilhas = uma por mão, a mais aguda na direita);
 *  - várias trilhas: se há piano com boa parte das notas, só o(s) piano(s);
 *    senão a melodia (direita) e o baixo (esquerda).
 */
export function suggestTracks(infos: MidiTrackInfo[]): TrackChoice[] {
  const withNotes = infos.filter((t) => !t.percussion && t.notes > 0);
  // trilhas quase mudas (guias com volume mínimo) ficam de fora, a não ser que só haja elas
  const audible = withNotes.filter((t) => !t.quiet);
  const mel = audible.length ? audible : withNotes;
  const byHeight = (a: MidiTrackInfo, b: MidiTrackInfo) => b.avg - a.avg;
  const pair = (ts: MidiTrackInfo[]): TrackChoice[] => {
    if (ts.length === 1) return [{ index: ts[0].index, hand: 'auto' }];
    const [hi, lo] = [...ts].sort(byHeight);
    return [
      { index: hi.index, hand: 'R' },
      { index: lo.index, hand: 'L' },
    ];
  };
  if (mel.length <= 2) return mel.length ? pair(mel) : [];
  const total = mel.reduce((a, t) => a + t.notes, 0);
  const pianos = mel.filter((t) => t.piano);
  const pianoNotes = pianos.reduce((a, t) => a + t.notes, 0);
  if (pianos.length && pianos.length <= 2 && pianoNotes >= total * 0.25) return pair(pianos);
  const bass = [...mel].filter((t) => t.family === 'bass' || t.avg < 52).sort((a, b) => a.avg - b.avg)[0];
  const melody = mel.filter((t) => t !== bass && t.poly < 1.3 && t.notes >= 16).sort(byHeight)[0] ?? mel.filter((t) => t !== bass).sort(byHeight)[0];
  const out: TrackChoice[] = [];
  if (melody) out.push({ index: melody.index, hand: 'R' });
  if (bass) out.push({ index: bass.index, hand: 'L' });
  return out.length ? out : pair(mel.slice(0, 2));
}

/** Vale perguntar quais trilhas usar? (mais de um instrumento, ou mais de duas trilhas) */
export function needsTrackChoice(infos: MidiTrackInfo[]): boolean {
  const mel = infos.filter((t) => !t.percussion && t.notes > 0);
  if (mel.length <= 1) return false;
  if (mel.length === 2 && mel.every((t) => t.piano)) return false;
  return true;
}

/**
 * Notas do arquivo como um sequenciador as tocaria: segundos pelo mapa de andamento do próprio arquivo,
 * pedal de sustentação e a mesma tecla não empilhando. Serve de referência para comparar com a conversão.
 */
export function originalSounds(midi: Midi, tracks: number[]): { midi: number; time: number; dur: number; vel: number }[] {
  const out: { midi: number; time: number; dur: number; vel: number }[] = [];
  for (const ti of tracks) {
    const tr = midi.tracks[ti];
    if (!tr || tr.channel === 9 || tr.instrument?.percussion) continue;
    // pedal desta trilha (segundos)
    const ped: [number, number][] = [];
    let down: number | null = null;
    for (const cc of [...(tr.controlChanges[64] ?? [])].sort((a, b) => a.time - b.time)) {
      if (cc.value >= 0.5 && down === null) down = cc.time;
      else if (cc.value < 0.5 && down !== null) {
        ped.push([down, cc.time]);
        down = null;
      }
    }
    if (down !== null) ped.push([down, Infinity]);
    for (const n of tr.notes) {
      let end = n.time + n.duration;
      for (const [a, b] of ped) if (a <= end && end < b && b > n.time) end = Math.min(b, n.time + 30);
      out.push({ midi: n.midi, time: n.time, dur: end - n.time, vel: 0.25 + 0.75 * (n.velocity ?? 0.7) });
    }
  }
  out.sort((a, b) => a.time - b.time || a.midi - b.midi);
  // mesma tecla tocada de novo: o som anterior acaba ali; no mesmo instante, toca uma vez só
  const last = new Map<number, (typeof out)[number]>();
  const res: typeof out = [];
  for (const n of out) {
    const p = last.get(n.midi);
    if (p && Math.abs(p.time - n.time) < 0.001) {
      p.dur = Math.max(p.dur, n.dur);
      p.vel = Math.max(p.vel, n.vel);
      continue;
    }
    if (p && p.time + p.dur > n.time) p.dur = n.time - p.time;
    last.set(n.midi, n);
    res.push(n);
  }
  return res;
}

/** Andamentos (ticks da partitura) a partir do silêncio inicial removido; o primeiro vale desde o tick 0. */
function tempoMapOf(entries: { t: number; qpm: number }[], shift: number): { t: number; qpm: number }[] {
  const tempos = [...entries].sort((a, b) => a.t - b.t);
  const out: { t: number; qpm: number }[] = [];
  let first = tempos[0].qpm;
  for (const tp of tempos) if (tp.t <= shift) first = tp.qpm;
  out.push({ t: 0, qpm: Math.round(first * 1000) / 1000 });
  for (const tp of tempos) {
    const t = Math.round(tp.t - shift);
    if (t <= 0) continue;
    const qpm = Math.round(tp.qpm * 1000) / 1000;
    const last = out[out.length - 1];
    if (Math.abs(last.qpm - qpm) < 0.005) continue;
    if (last.t === t) last.qpm = qpm;
    else out.push({ t, qpm });
  }
  return out;
}

/** Andamento que vale na maior parte da música (não só o primeiro do arquivo). */
function mainTempo(map: { t: number; qpm: number }[], endTick: number): number {
  const span = new Map<number, number>();
  map.forEach((m, i) => {
    const until = map[i + 1]?.t ?? endTick;
    const q = Math.round(m.qpm * 100) / 100;
    span.set(q, (span.get(q) ?? 0) + Math.max(0, until - m.t));
  });
  let best = map[0].qpm;
  let bestLen = -1;
  for (const [q, len] of span) if (len > bestLen) [best, bestLen] = [q, len];
  return Math.round(best * 100) / 100;
}

const onAGrid = (x: number) => [SIXTEENTH, TRIP, THIRTYSECOND].some((g) => Math.abs(x - Math.round(x / g) * g) <= 3);

/**
 * Grade refeita: tempo da partitura b = (x - fase) / período + deslocamento (x em tempos do arquivo),
 * com um ajuste fino a cada dois compassos (quem toca acelera e segura um pouco): pontos (x, b) ligados por retas.
 */
interface GridFix {
  period: number;
  phase: number;
  offset: number;
  xs: number[];
  bs: number[];
}

/** Tempo da partitura (em tempos) para uma posição do arquivo (em tempos), seguindo os pontos da grade. */
function gridBeat(f: GridFix, x: number): number {
  const { xs, bs } = f;
  if (!xs.length) return (x - f.phase) / f.period + f.offset;
  if (x <= xs[0]) return bs[0] + (x - xs[0]) / f.period;
  if (x >= xs[xs.length - 1]) return bs[bs.length - 1] + (x - xs[xs.length - 1]) / f.period;
  let i = 0;
  while (xs[i + 1] < x) i++;
  return bs[i] + ((x - xs[i]) * (bs[i + 1] - bs[i])) / (xs[i + 1] - xs[i]);
}

/** Inclinação (tempos da partitura por tempo do arquivo) no trecho que começa em x. */
function gridSlope(f: GridFix, x: number): number {
  const { xs, bs } = f;
  if (xs.length < 2 || x < xs[0] || x >= xs[xs.length - 1]) return 1 / f.period;
  let i = 0;
  while (xs[i + 1] <= x) i++;
  return (bs[i + 1] - bs[i]) / (xs[i + 1] - xs[i]);
}

/**
 * Arquivos gravados "à mão" (sem metrônomo, ou com o andamento do arquivo diferente do tocado):
 * as notas não caem na grade do arquivo. Procura o período e a fase dos tempos de verdade
 * (periodograma dos ataques) e em que tempo começa o compasso (onde caem os baixos e as notas longas).
 * Devolve null quando a grade do próprio arquivo já serve.
 */
export function findGrid(notes: { x: number; midi: number; dur: number }[], beatsPerBar: number): GridFix | null {
  if (notes.length < 24) return null;
  const step = Math.max(1, Math.floor(notes.length / 4000));
  const pts = notes.filter((_, i) => i % step === 0);
  const w = pts.map((n) => 1 + (n.midi < 55 ? 1 : 0));
  const W = w.reduce((a, b) => a + b, 0);
  // alinhamento ao tempo e à colcheia (com colcheias retas os contratempos anulariam só o tempo)
  const R = (P: number) => {
    let c = 0;
    let sn = 0;
    let c2 = 0;
    let s2 = 0;
    pts.forEach((n, i) => {
      const a = (2 * Math.PI * n.x) / P;
      c += w[i] * Math.cos(a);
      sn += w[i] * Math.sin(a);
      c2 += w[i] * Math.cos(2 * a);
      s2 += w[i] * Math.sin(2 * a);
    });
    return (Math.hypot(c, sn) + 0.5 * Math.hypot(c2, s2)) / W;
  };
  const r1 = R(1);
  let P = 1;
  let rBest = r1;
  for (let p = 0.8; p <= 1.25; p += 0.0005) {
    const r = R(p);
    if (r > rBest) [P, rBest] = [p, r];
  }
  for (let p = P - 0.0005; p <= P + 0.0005; p += 0.00002) {
    const r = R(p);
    if (r > rBest) [P, rBest] = [p, r];
  }
  // só refaz quando a grade do arquivo claramente não explica as notas e outra explica bem
  if (!(r1 < 0.3 && rBest >= 0.22 && rBest >= 2.5 * r1 && Math.abs(P - 1) > 0.004)) return null;
  // fase: o máximo de ataques perto do tempo (robusto ao swing, que puxaria a média)
  const near = (ph: number) =>
    pts.reduce((a, n, i) => {
      const b = (n.x - ph) / P;
      return a + w[i] * Math.max(0, 1 - Math.abs(b - Math.round(b)) / 0.1);
    }, 0);
  let phase = 0;
  let best = -1;
  for (let i = 0; i < 240; i++) {
    const ph = (i / 240) * P;
    const v = near(ph);
    if (v > best) [phase, best] = [ph, v];
  }
  for (let ph = phase - P / 240; ph <= phase + P / 240; ph += P / 2400) {
    const v = near(ph);
    if (v > best) [phase, best] = [ph, v];
  }
  // colcheias retas: o tempo pode ter caído no contratempo; fica a fase com mais baixos e notas longas no tempo
  const weightOn = (ph: number) =>
    notes.reduce((a, n) => {
      const b = (n.x - ph) / P;
      return a + (Math.abs(b - Math.round(b)) < 0.12 ? (n.midi < 55 ? 2 : 1) * Math.min(2, n.dur / P) : 0);
    }, 0);
  if (weightOn(phase + P / 2) > weightOn(phase) * 1.15) phase = (phase + P / 2) % P;
  // tempo forte do compasso
  const bpb = Math.max(1, Math.round(beatsPerBar));
  const strong = new Array(bpb).fill(0);
  let minB = Infinity;
  for (const n of notes) {
    const b = (n.x - phase) / P;
    minB = Math.min(minB, b);
    const r = Math.round(b);
    if (Math.abs(b - r) < 0.15) strong[((r % bpb) + bpb) % bpb] += (n.midi < 55 ? 2 : 1) * Math.min(2, n.dur / P);
  }
  const k = strong.indexOf(Math.max(...strong));
  // tudo em tempos ≥ 0 (um começo antes do primeiro tempo forte vira anacruse)
  const n = Math.max(0, Math.ceil((k - (minB + 0.25)) / bpb));
  const offset = -k + bpb * n;

  // ajuste fino: a cada 2 compassos, quanto o tempo de quem toca está adiantado/atrasado em relação à grade
  const span = 2 * bpb;
  const gb = notes.map((nt) => (nt.x - phase) / P);
  const wt = notes.map((nt) => (nt.midi < 55 ? 2 : 1) * Math.min(2, nt.dur / P));
  const lo = Math.min(...gb);
  const hi = Math.max(...gb);
  const centers: number[] = [];
  const deltas: (number | null)[] = [];
  for (let c = lo; c <= hi; c += span) {
    const idx = gb.map((b, i) => (b >= c && b < c + span ? i : -1)).filter((i) => i >= 0);
    centers.push(c + span / 2);
    if (idx.length < 6) {
      deltas.push(null);
      continue;
    }
    let bestD = 0;
    let bestV = -1;
    for (let d = -0.2; d <= 0.2001; d += 0.005) {
      const v = idx.reduce((a, i) => {
        const b = gb[i] - d;
        return a + wt[i] * Math.max(0, 1 - Math.abs(b - Math.round(b)) / 0.1);
      }, 0);
      if (v > bestV + 1e-9 || (Math.abs(v - bestV) <= 1e-9 && Math.abs(d) < Math.abs(bestD))) [bestD, bestV] = [d, v];
    }
    deltas.push(bestD);
  }
  // trechos sem notas suficientes: o vizinho mais próximo; depois suaviza (mediana de 3)
  const filled = deltas.map((d, i) => {
    if (d !== null) return d;
    for (let r = 1; r < deltas.length; r++) {
      const v = deltas[i - r] ?? deltas[i + r];
      if (v !== null && v !== undefined) return v;
    }
    return 0;
  });
  const smooth = filled.map((d, i) => [filled[i - 1] ?? d, d, filled[i + 1] ?? d].sort((a, b) => a - b)[1]);
  const xs = centers.map((c) => phase + P * c);
  const bs = centers.map((c, i) => c - smooth[i] + offset);
  // só usa os pontos se continuarem em ordem (sem "voltar no tempo")
  const ok = bs.every((b, i) => i === 0 || b - bs[i - 1] > span * 0.5);
  return { period: P, phase, offset, xs: ok ? xs : [], bs: ok ? bs : [] };
}

interface Quantizer {
  snap: (x: number) => number;
  /** fim das notas: ao vivo, prefere figuras ainda mais simples (soltar a tecla é impreciso; o som usa a duração real) */
  snapEnd: (x: number) => number;
  step: (x: number) => number;
  /** arquivo já quantizado (pausas e durações escritas de propósito) */
  quantized: boolean;
  /** posição do contratempo com swing (fração do tempo), quando há */
  swing: number | null;
}

/**
 * Quantização. Arquivo já quantizado (ataques exatamente numa grade): em cada tempo a grade mais simples
 * que encaixa certinho (semicolcheia, tercina, fusa). Tocado "ao vivo": cada ataque vai para a figura
 * mais próxima, preferindo as mais simples; com swing, o contratempo "balançado" é escrito como colcheia
 * reta (o som continua com o balanço do arquivo); tercinas só onde há ataques perto de 1/3 e de 2/3.
 */
function quantizer(starts: number[]): Quantizer {
  const byBeat = new Map<number, number[]>();
  for (const x of starts) {
    const b = Math.floor(x / PPQ);
    if (!byBeat.has(b)) byBeat.set(b, []);
    byBeat.get(b)!.push(x);
  }
  const quantized = starts.filter(onAGrid).length >= starts.length * 0.8;
  if (quantized) {
    const grid = new Map<number, number>();
    for (const [b, xs] of byBeat) {
      const offs = xs.map((x) => x - b * PPQ).filter((o) => o > PPQ * 0.04); // ignora o ataque no próprio tempo
      if (offs.length < 1) continue;
      const avg = (g: number) => offs.reduce((a, o) => a + Math.abs(o - Math.round(o / g) * g), 0) / offs.length;
      const [e16, e3, e32] = [avg(SIXTEENTH), avg(TRIP), avg(THIRTYSECOND)];
      if (e16 <= FIT) continue;
      if (e3 <= FIT) grid.set(b, TRIP);
      else if (e32 <= FIT) grid.set(b, THIRTYSECOND);
      else if (e3 + 0.25 < e16 * 0.5) grid.set(b, TRIP);
    }
    const step = (x: number) => grid.get(Math.floor((x + PPQ * 0.02) / PPQ)) ?? SIXTEENTH;
    const snap = (x: number) => {
      const b = Math.floor((x + PPQ * 0.02) / PPQ);
      const g = grid.get(b) ?? SIXTEENTH;
      return b * PPQ + Math.round((x - b * PPQ) / g) * g;
    };
    return { step, swing: null, quantized: true, snap, snapEnd: snap };
  }
  // ao vivo
  const frac = (x: number) => (x - Math.floor(x / PPQ) * PPQ) / PPQ;
  const fs = starts.map(frac);
  const off = fs.filter((f) => f > 0.15 && f < 0.9);
  const sw = fs.filter((f) => f >= 0.56 && f <= 0.76).sort((a, b) => a - b);
  const straight = fs.filter((f) => f >= 0.42 && f < 0.56).length;
  let swing: number | null = null;
  if (sw.length >= 12 && sw.length >= off.length * 0.35 && straight < sw.length * 0.4) {
    const med = sw[Math.floor(sw.length / 2)];
    if (med >= 0.58 && med <= 0.74) swing = med;
  }
  const trip = new Set<number>();
  for (const [b, xs] of byBeat) {
    const f = xs.map(frac);
    if (f.some((v) => v >= 0.26 && v <= 0.41) && f.some((v) => v >= 0.59 && v <= 0.74)) trip.add(b);
  }
  // [onde soa, onde se escreve, "custo" da figura]: figuras simples ganham nas dúvidas
  type C = [number, number, number];
  const straightC: C[] = [
    [0, 0, 0],
    [0.25, 0.25, 0.06],
    [0.5, 0.5, 0.02],
    [0.75, 0.75, 0.06],
    [1, 1, 0],
  ];
  const tripC: C[] = [
    [0, 0, 0],
    [1 / 3, 1 / 3, 0.02],
    [2 / 3, 2 / 3, 0.02],
    [1, 1, 0],
  ];
  const swingC: C[] = swing
    ? [
        [0, 0, 0],
        [swing / 2, 0.25, 0.08],
        [swing, 0.5, 0.02],
        [swing + (1 - swing) / 2, 0.75, 0.08],
        [1, 1, 0],
      ]
    : straightC;
  const snapWith = (x: number, extra: number) => {
    const b = Math.floor(x / PPQ);
    const f = frac(x);
    const cs = trip.has(b) ? tripC : swingC;
    let bestC = cs[0];
    let bestCost = Infinity;
    for (const c of cs) {
      // as figuras menores (semicolcheias) custam mais no fim das notas
      const cost = Math.abs(f - c[0]) + c[2] + (c[2] >= 0.06 ? extra : 0);
      if (cost < bestCost) [bestC, bestCost] = [c, cost];
    }
    return Math.round((b + bestC[1]) * PPQ);
  };
  return {
    swing,
    quantized: false,
    step: (x: number) => (trip.has(Math.floor(x / PPQ)) ? TRIP : SIXTEENTH),
    snap: (x: number) => snapWith(x, 0),
    snapEnd: (x: number) => snapWith(x, 0.1),
  };
}

export interface MidiImportOptions {
  /** trilhas usadas e a mão de cada uma (padrão: sugestão automática) */
  tracks?: TrackChoice[];
  /** guarda o arquivo original na música (para ouvir e reconverter) */
  keepOriginal?: boolean;
}

/** Importa um arquivo MIDI: escolhe as trilhas, acha a grade, quantiza, separa as mãos e gera a partitura. */
export function importMidi(data: ArrayBuffer, fileName: string, opts: MidiImportOptions = {}): Song {
  const midi = new Midi(data);
  const infos = midiTracks(midi);
  const choice = (opts.tracks ?? suggestTracks(infos)).filter((c) => infos[c.index] && !infos[c.index].percussion && infos[c.index].notes > 0);
  if (!choice.length) throw new Error(infos.some((t) => t.notes > 0) ? 'Escolha pelo menos uma trilha com notas.' : 'O arquivo MIDI não tem notas.');
  const handOf = new Map(choice.map((c) => [c.index, c.hand]));
  const scale = PPQ / (midi.header.ppq || 480);

  // fórmulas de compasso e andamentos do arquivo (ticks internos)
  const tsFile = midi.header.timeSignatures
    .map((x) => ({ t: x.ticks * scale, ts: x.timeSignature as [number, number] }))
    .filter((x) => x.ts?.[0] > 0 && x.ts?.[1] > 0)
    .sort((a, b) => a.t - b.t);
  const timeSig0: [number, number] = tsFile[0] && tsFile[0].t <= PPQ / 16 ? [tsFile[0].ts[0], tsFile[0].ts[1]] : [4, 4];
  const temposFile = midi.header.tempos.length
    ? [...midi.header.tempos].sort((a, b) => a.ticks - b.ticks).map((t) => ({ t: t.ticks * scale, qpm: t.bpm }))
    : [{ t: 0, qpm: MIDI_DEFAULT_BPM }];
  if (temposFile[0].t > 0) temposFile.unshift({ t: 0, qpm: MIDI_DEFAULT_BPM });

  const raw = choice.flatMap((c) => midi.tracks[c.index].notes.map((n) => ({ n, ti: c.index })));
  // a grade do arquivo segue a música? se não, refaz (período e fase dos tempos de verdade)
  const fix =
    raw.filter(({ n }) => onAGrid(n.ticks * scale)).length >= raw.length * 0.6
      ? null
      : findGrid(
          raw.map(({ n }) => ({ x: (n.ticks * scale) / PPQ, midi: n.midi, dur: (n.durationTicks * scale) / PPQ })),
          measureTicks(timeSig0) / PPQ,
        );
  const warp = (x: number) => (fix ? gridBeat(fix, x / PPQ) * PPQ : x);

  const all: N[] = [];
  const pedalEvents: { t: number; down: boolean }[] = [];
  for (const { n, ti } of raw) {
    const h = handOf.get(ti)!;
    const start = warp(n.ticks * scale);
    const end = warp((n.ticks + Math.max(1, n.durationTicks)) * scale);
    all.push({ midi: n.midi, start, dur: Math.max(1, end - start), rawStart: start, rawEnd: end, track: ti, hand: h === 'auto' ? (n.midi >= 60 ? 'R' : 'L') : h, vel: n.velocity ?? 0.7 });
  }
  for (const c of choice) for (const cc of midi.tracks[c.index].controlChanges[64] ?? []) pedalEvents.push({ t: warp(cc.ticks * scale), down: cc.value >= 0.5 });
  const origNotes = all.length;
  // com a grade refeita, as mudanças de compasso do arquivo (na grade errada) não valem
  const tsList = fix ? [] : tsFile;
  // andamento na grade refeita: o mesmo segundo para cada nota (andamento do arquivo × tempos da partitura por tempo do arquivo)
  let tempoEntries = temposFile;
  if (fix) {
    const qpmFileAt = (x: number) => {
      let q = temposFile[0].qpm;
      for (const tp of temposFile) if (tp.t <= x + 1e-6) q = tp.qpm;
      return q;
    };
    const cuts = [...new Set([0, ...temposFile.map((tp) => tp.t), ...fix.xs.map((x) => x * PPQ)])].sort((a, b) => a - b);
    // antes do primeiro ponto (anacruse/contagem) vale a inclinação global
    if (fix.xs.length) cuts.unshift(fix.xs[0] * PPQ - PPQ * 64);
    tempoEntries = cuts.map((x) => ({ t: warp(x), qpm: qpmFileAt(x) * gridSlope(fix, x / PPQ) }));
  }

  // silêncio inicial longo: corta compassos inteiros (respeitando a fórmula de compasso, para as barras não saírem do lugar)
  const minStart = Math.min(...all.map((n) => n.start));
  const before = buildMeasures({ timeSig: timeSig0, keySig: 0, timeSigs: tsList }, minStart + 1);
  let firstM = before[0];
  for (const m of before) if (m.start <= minStart + 1) firstM = m;
  const shift = firstM.index >= 2 ? firstM.start : 0;
  for (const n of all) {
    n.start -= shift;
    n.rawStart -= shift;
    n.rawEnd -= shift;
  }
  const lastTick = Math.max(...all.map((n) => n.rawEnd));

  let timeSig: [number, number] = timeSig0;
  for (const x of tsList) if (x.t <= shift + PPQ / 16) timeSig = [x.ts[0], x.ts[1]];
  const timeSigs = tsList.filter((x) => x.t > shift + PPQ / 16).map((x) => ({ t: x.t - shift, ts: x.ts }));

  const tempoMap = tempoMapOf(tempoEntries, shift);
  const tempo = mainTempo(tempoMap, lastTick);

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
  if (down !== null) pedal.push([down, lastTick + PPQ * 8]); // pedal que nunca sobe: deixa o último acorde soar

  const rh = all.filter((n) => n.hand === 'R');
  const lh = all.filter((n) => n.hand === 'L');

  // quantiza cada mão com a própria grade (ex.: tercinas na melodia sobre colcheias retas no acompanhamento)
  let swung = false;
  const live = new Set<N[]>();
  for (const hand of [rh, lh]) {
    if (!hand.length) continue;
    const q = quantizer(hand.map((n) => n.start));
    if (q.swing) swung = true;
    if (!q.quantized) live.add(hand);
    for (const n of hand) {
      const s0 = Math.max(0, q.snap(n.start));
      const e = q.snapEnd(n.start + n.dur);
      n.start = s0;
      n.dur = Math.max(q.step(s0), e - s0);
    }
  }

  // armadura do arquivo, a não ser que seja Dó maior/Lá menor (muitas vezes só o padrão do programa) — aí deduz pelas notas
  const fileKey = midi.header.keySignatures[0] ? keyFromName(midi.header.keySignatures[0].key, midi.header.keySignatures[0].scale) : 0;
  const keySig = fileKey !== 0 ? fileKey : guessKeySig(all.map((n) => n.midi));
  // som: a nota soa onde e quanto soava no arquivo (a escrita fica nas figuras da partitura)
  const soundDur = (g: N) => Math.max(PPQ / 16, Math.round(g.rawEnd - g.rawStart));
  const soundOfs = (gs: N[]) => {
    const o = gs.map((g) => Math.round(g.rawStart - g.start));
    return o.some((x) => x !== 0) ? o : undefined;
  };

  /**
   * Uma mão vira até duas vozes: a principal (ritmo que se move) e uma segunda com as notas
   * que continuam soando por cima das outras (ex.: baixo longo sob acordes quebrados).
   * Assim nenhuma nota longa é encurtada.
   */
  const toVoices = (ns: N[], legato: boolean): { main: RawChord[]; held: RawChord[] } => {
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
      // a mesma tecla duas vezes no mesmo instante (trilhas dobradas) vira uma só, a mais longa e forte
      const byKey = new Map<number, N>();
      for (const g of group) {
        const o = byKey.get(g.midi);
        if (!o) byKey.set(g.midi, g);
        else byKey.set(g.midi, { ...o, dur: Math.max(o.dur, g.dur), rawEnd: Math.max(o.rawEnd, g.rawEnd), vel: Math.max(o.vel, g.vel) });
      }
      const uniq = [...byKey.values()].sort((a, b) => a.midi - b.midi);
      const next = groups[gi + 1]?.[0] ?? Infinity;
      const gap = next - start;
      // notas que continuam soando pelo menos meio tempo depois do próximo ataque (legato curto não conta)
      const long = uniq.filter((g) => g.dur - gap >= PPQ / 2);
      const canHold = long.length > 0 && start >= heldFree;
      const inMain = canHold ? uniq.filter((g) => !long.includes(g)) : uniq;
      if (canHold) {
        const hd = Math.min(...long.map((g) => g.dur));
        held.push({ start, dur: hd, pitches: long.map((g) => spell(g.midi, keySig)), vels: long.map((g) => g.vel), sdurs: long.map(soundDur), sofs: soundOfs(long) });
        heldFree = start + hd;
      }
      // tocado ao vivo: um buraco de até meio tempo antes do próximo ataque é só a tecla solta um pouco antes —
      // escreve a nota até lá (o som continua com a duração real)
      const mainDur = Math.min(...inMain.map((g) => g.dur));
      if (inMain.length)
        main.push({
          start,
          dur: legato && next !== Infinity && gap > mainDur && gap - mainDur <= PPQ / 2 ? gap : mainDur,
          pitches: inMain.map((g) => spell(g.midi, keySig)),
          vels: inMain.map((g) => g.vel),
          sdurs: inMain.map(soundDur),
          sofs: soundOfs(inMain),
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
    const v = toVoices(notes, live.has(notes as N[]));
    // clave com menos linhas suplementares (ex.: mão esquerda tocando acima do Dó central fica em clave de Sol)
    const ledgers = (lo: number, hi: number) => notes.reduce((a, n) => a + (n.midi < lo ? Math.ceil((lo - n.midi) / 3.5) : n.midi > hi ? Math.ceil((n.midi - hi) / 3.5) : 0), 0);
    const [tr, ba] = [ledgers(64, 77), ledgers(43, 57)];
    const cl = clef === 'treble' ? (ba < tr * 0.6 ? 'bass' : 'treble') : tr < ba * 0.6 ? 'treble' : 'bass';
    staves.push({ clef: cl, hand, chords: v.main, staff: staffIdx, voice: 0 });
    if (v.held.length) staves.push({ clef: cl, hand, chords: v.held, staff: staffIdx, voice: 1 });
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
      timeSigs,
      keySig,
      source: 'import',
    },
    staves,
  );
  if (pedal.length) song.pedal = pedal;
  if (tempoMap.length > 1) song.tempoMap = tempoMap;
  else song.tempo = tempoMap[0].qpm;
  song.importVersion = IMPORT_VERSION;

  // relatório: cada nota do arquivo comparada com o que o app vai tocar e com onde ficou escrita
  // (segundos desde o tick 0 da partitura, que no arquivo corresponde a `zero`)
  const fileSegs = tempoSegs({ tempo: temposFile[0].qpm, tempoMap: temposFile });
  // posição do arquivo que virou o tick 0 da partitura (inverte a grade por busca binária)
  let zeroTick = shift;
  if (fix) {
    let a = -1e7;
    let b = 1e7;
    for (let i = 0; i < 80; i++) {
      const mid = (a + b) / 2;
      if (warp(mid) < shift) a = mid;
      else b = mid;
    }
    zeroTick = (a + b) / 2;
  }
  const zero = tickToSecs(fileSegs, zeroTick);
  const segs = tempoSegs(song);
  const played = new Map<number, { s: number; w: number }[]>();
  for (const e of buildEvents(song)) {
    if (e.dup) continue;
    if (!played.has(e.midi)) played.set(e.midi, []);
    played.get(e.midi)!.push({ s: tickToSecs(segs, e.st ?? e.t), w: tickToSecs(segs, e.t) });
  }
  let exact = 0;
  let maxShift = 0;
  let gridExact = 0;
  let gridMax = 0;
  for (const { n } of raw) {
    const at = tickToSecs(fileSegs, n.ticks * scale) - zero;
    const cands = played.get(n.midi) ?? [];
    let bestE: { s: number; w: number } | null = null;
    for (const c of cands) if (!bestE || Math.abs(c.s - at) < Math.abs(bestE.s - at)) bestE = c;
    if (!bestE) continue;
    const d = Math.abs(bestE.s - at);
    if (d <= 0.01) exact++;
    maxShift = Math.max(maxShift, d);
    const g = Math.abs(bestE.w - at);
    if (g <= 0.01) gridExact++;
    gridMax = Math.max(gridMax, g);
  }
  const nPlayed = [...played.values()].reduce((a, xs) => a + xs.length, 0);
  const label = (t: MidiTrackInfo) => t.name || t.instrument;
  const report: ImportReport = {
    notes: origNotes,
    exact,
    maxShiftMs: Math.round(maxShift * 1000),
    gridExact,
    gridMaxMs: Math.round(gridMax * 1000),
    merged: Math.max(0, origNotes - nPlayed),
    // com a grade refeita, o mapa ganha pequenos ajustes de quem tocou: conta só as mudanças escritas no arquivo
    tempoChanges: fix ? temposFile.length - 1 : tempoMap.length - 1,
    timeSigChanges: song.measures.filter((m) => m.timeSigChange && m.index > 0).length,
    tracksUsed: choice.map((c) => label(infos[c.index])),
    tracksIgnored: infos.filter((t) => t.notes > 0 && !handOf.has(t.index)).map(label),
  };
  if (fix) report.tempoFix = { file: Math.round(mainTempo(tempoMapOf(temposFile, 0), lastTick)), real: Math.round(tempo) };
  if (swung) report.swing = true;
  song.importReport = report;
  if (opts.keepOriginal !== false && data.byteLength <= KEEP_ORIGINAL_MAX) {
    song.original = { kind: 'midi', name: fileName, data: bytesToB64(new Uint8Array(data)), tracks: choice };
  }
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

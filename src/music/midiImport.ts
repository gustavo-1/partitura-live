import { Midi } from '@tonejs/midi';
import { buildMeasures, guessKeySig, songFromChords, spell, type RawChord, type RawStaff } from './build';
import { buildEvents, tempoSegs, tickToSecs } from './timeline';
import { IMPORT_VERSION, PPQ, type ImportReport, type Song } from './types';
import { bytesToB64 } from '../lib/b64';

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
}

interface N {
  midi: number;
  start: number; // ticks normalizados (PPQ interno)
  dur: number;
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
  return midi.tracks.map((tr, index) => {
    const percussion = tr.channel === 9 || !!tr.instrument?.percussion;
    const ms = tr.notes.map((n) => n.midi);
    const family = percussion ? 'drums' : tr.instrument?.family ?? 'piano';
    const program = tr.instrument?.number ?? 0;
    const name = (tr.name ?? '').trim();
    // polifonia: quantas notas começam juntas (mesmo tick) em média
    const starts = new Map<number, number>();
    for (const n of tr.notes) starts.set(n.ticks, (starts.get(n.ticks) ?? 0) + 1);
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
    };
  });
}

/**
 * Sugestão inicial de trilhas:
 *  - 1 ou 2 trilhas com notas: todas (2 trilhas = uma por mão, a mais aguda na direita);
 *  - várias trilhas: se há piano com boa parte das notas, só o(s) piano(s);
 *    senão a melodia (direita) e o baixo (esquerda).
 */
export function suggestTracks(infos: MidiTrackInfo[]): TrackChoice[] {
  const mel = infos.filter((t) => !t.percussion && t.notes > 0);
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

/** Trechos de andamento do arquivo em ticks internos (já descontado o silêncio inicial removido). */
function tempoMapOf(midi: Midi, scale: number, shift: number): { t: number; qpm: number }[] {
  const tempos = [...midi.header.tempos].sort((a, b) => a.ticks - b.ticks);
  if (!tempos.length) return [{ t: 0, qpm: MIDI_DEFAULT_BPM }];
  const out: { t: number; qpm: number }[] = [];
  // o andamento em vigor no início (antes do primeiro evento vale o padrão do MIDI)
  let first = tempos[0].ticks * scale <= shift ? tempos[0].bpm : MIDI_DEFAULT_BPM;
  for (const tp of tempos) if (tp.ticks * scale <= shift) first = tp.bpm;
  out.push({ t: 0, qpm: first });
  for (const tp of tempos) {
    const t = Math.round(tp.ticks * scale - shift);
    if (t <= 0) continue;
    const qpm = Math.round(tp.bpm * 1000) / 1000;
    const last = out[out.length - 1];
    if (Math.abs(last.qpm - qpm) < 0.005) continue;
    if (last.t === t) last.qpm = qpm;
    else out.push({ t, qpm });
  }
  for (const o of out) o.qpm = Math.round(o.qpm * 1000) / 1000;
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

/**
 * Quantização tempo a tempo: em cada tempo escolhe a grade que explica os ataques —
 * semicolcheias, tercinas de colcheia ou fusas (arquivo já quantizado: a grade mais simples que encaixa
 * certinho; tocado "ao vivo": semicolcheia ou tercina, a que errar menos).
 */
function quantizer(starts: number[]): { snap: (x: number) => number; step: (x: number) => number } {
  const byBeat = new Map<number, number[]>();
  for (const x of starts) {
    const b = Math.floor(x / PPQ);
    if (!byBeat.has(b)) byBeat.set(b, []);
    byBeat.get(b)!.push(x);
  }
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
  return {
    step,
    snap: (x: number) => {
      const b = Math.floor((x + PPQ * 0.02) / PPQ);
      const g = grid.get(b) ?? SIXTEENTH;
      return b * PPQ + Math.round((x - b * PPQ) / g) * g;
    },
  };
}

export interface MidiImportOptions {
  /** trilhas usadas e a mão de cada uma (padrão: sugestão automática) */
  tracks?: TrackChoice[];
  /** guarda o arquivo original na música (para ouvir e reconverter) */
  keepOriginal?: boolean;
}

/** Importa um arquivo MIDI: escolhe as trilhas, quantiza, separa as mãos e gera a partitura. */
export function importMidi(data: ArrayBuffer, fileName: string, opts: MidiImportOptions = {}): Song {
  const midi = new Midi(data);
  const infos = midiTracks(midi);
  const choice = (opts.tracks ?? suggestTracks(infos)).filter((c) => infos[c.index] && !infos[c.index].percussion && infos[c.index].notes > 0);
  if (!choice.length) throw new Error(infos.some((t) => t.notes > 0) ? 'Escolha pelo menos uma trilha com notas.' : 'O arquivo MIDI não tem notas.');
  const handOf = new Map(choice.map((c) => [c.index, c.hand]));
  const scale = PPQ / (midi.header.ppq || 480);

  const all: N[] = [];
  const pedalEvents: { t: number; down: boolean }[] = [];
  midi.tracks.forEach((tr, ti) => {
    const h = handOf.get(ti);
    if (!h) return;
    for (const n of tr.notes) {
      const start = n.ticks * scale;
      const dur = Math.max(1, n.durationTicks * scale);
      all.push({ midi: n.midi, start, dur, rawEnd: start + dur, track: ti, hand: h === 'auto' ? (n.midi >= 60 ? 'R' : 'L') : h, vel: n.velocity ?? 0.7 });
    }
    for (const cc of tr.controlChanges[64] ?? []) pedalEvents.push({ t: cc.ticks * scale, down: cc.value >= 0.5 });
  });
  const origNotes = all.length;

  // fórmulas de compasso do arquivo
  const tsList = midi.header.timeSignatures
    .map((x) => ({ t: x.ticks * scale, ts: x.timeSignature as [number, number] }))
    .filter((x) => x.ts?.[0] > 0 && x.ts?.[1] > 0)
    .sort((a, b) => a.t - b.t);
  const timeSig0: [number, number] = tsList[0] && tsList[0].t <= PPQ / 16 ? [tsList[0].ts[0], tsList[0].ts[1]] : [4, 4];

  // silêncio inicial longo: corta compassos inteiros (respeitando a fórmula de compasso, para as barras não saírem do lugar)
  const minStart = Math.min(...all.map((n) => n.start));
  const before = buildMeasures({ timeSig: timeSig0, keySig: 0, timeSigs: tsList }, minStart + 1);
  let firstM = before[0];
  for (const m of before) if (m.start <= minStart + 1) firstM = m;
  const shift = firstM.index >= 2 ? firstM.start : 0;
  for (const n of all) {
    n.start -= shift;
    n.rawEnd -= shift;
  }
  const lastTick = Math.max(...all.map((n) => n.rawEnd));

  let timeSig: [number, number] = timeSig0;
  for (const x of tsList) if (x.t <= shift + PPQ / 16) timeSig = [x.ts[0], x.ts[1]];
  const timeSigs = tsList.filter((x) => x.t > shift + PPQ / 16).map((x) => ({ t: x.t - shift, ts: x.ts }));

  const tempoMap = tempoMapOf(midi, scale, shift);
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
  if (down !== null) pedal.push([down, lastTick + PPQ]);

  const rh = all.filter((n) => n.hand === 'R');
  const lh = all.filter((n) => n.hand === 'L');

  // quantiza cada mão com a própria grade (ex.: tercinas na melodia sobre colcheias retas no acompanhamento)
  for (const hand of [rh, lh]) {
    const q = quantizer(hand.map((n) => n.start));
    for (const n of hand) {
      const s0 = Math.max(0, q.snap(n.start));
      const e = q.snap(n.start + n.dur);
      n.start = s0;
      n.dur = Math.max(q.step(s0), e - s0);
    }
  }

  const keySig = midi.header.keySignatures[0] ? keyFromName(midi.header.keySignatures[0].key, midi.header.keySignatures[0].scale) : guessKeySig(all.map((n) => n.midi));
  // som: a nota soa até onde soava no arquivo (a escrita pode ser encurtada para caber na voz)
  const soundDur = (g: N) => Math.max(PPQ / 16, Math.round(g.rawEnd - g.start));

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
        held.push({ start, dur: hd, pitches: long.map((g) => spell(g.midi, keySig)), vels: long.map((g) => g.vel), sdurs: long.map(soundDur) });
        heldFree = start + hd;
      }
      if (inMain.length)
        main.push({
          start,
          dur: Math.min(...inMain.map((g) => g.dur)),
          pitches: inMain.map((g) => spell(g.midi, keySig)),
          vels: inMain.map((g) => g.vel),
          sdurs: inMain.map(soundDur),
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

  // relatório: cada nota do arquivo comparada com o que o app vai tocar (no andamento original)
  const shiftSec = midi.header.ticksToSeconds(shift / scale);
  const segs = tempoSegs(song);
  const played = new Map<number, number[]>();
  for (const e of buildEvents(song)) {
    if (e.dup) continue;
    if (!played.has(e.midi)) played.set(e.midi, []);
    played.get(e.midi)!.push(tickToSecs(segs, e.t));
  }
  let exact = 0;
  let maxShift = 0;
  for (const ti of handOf.keys())
    for (const n of midi.tracks[ti].notes) {
      const at = n.time - shiftSec;
      const d = Math.min(...(played.get(n.midi) ?? [Infinity]).map((x) => Math.abs(x - at)));
      if (d <= 0.01) exact++;
      if (Number.isFinite(d)) maxShift = Math.max(maxShift, d);
    }
  const nPlayed = [...played.values()].reduce((a, xs) => a + xs.length, 0);
  const label = (t: MidiTrackInfo) => t.name || t.instrument;
  const report: ImportReport = {
    notes: origNotes,
    exact,
    maxShiftMs: Math.round(maxShift * 1000),
    merged: Math.max(0, origNotes - nPlayed),
    tempoChanges: tempoMap.length - 1,
    timeSigChanges: song.measures.filter((m) => m.timeSigChange && m.index > 0).length,
    tracksUsed: choice.map((c) => label(infos[c.index])),
    tracksIgnored: infos.filter((t) => t.notes > 0 && !handOf.has(t.index)).map(label),
  };
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

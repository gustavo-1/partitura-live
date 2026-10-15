/**
 * Relógio do motor de prática: nos modos "ouvir" e "no tempo" o som segue o relógio de áudio,
 * então quadros lentos (celular ocupado) não podem atrasar nem "entortar" o ritmo.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const clock = vi.hoisted(() => ({ t: 0 }));
const played = vi.hoisted(() => [] as { midi: number; when: number; stopped?: number }[]);

vi.mock('../src/audio/context', () => ({
  now: () => clock.t,
  audioCtx: () => ({ currentTime: clock.t }),
  resumeAudio: async () => ({}),
}));
vi.mock('../src/audio/piano', () => ({
  playNote: (midi: number, when: number) => {
    const rec: { midi: number; when: number; stopped?: number } = { midi, when };
    played.push(rec);
    return { stop: (at?: number) => (rec.stopped = at ?? clock.t) };
  },
}));
const clicks = vi.hoisted(() => [] as { at: number; accent: boolean }[]);
vi.mock('../src/audio/metronome', () => ({
  click: (at: number, accent: boolean) => {
    clicks.push({ at, accent });
    return { stop() {} };
  },
}));
vi.mock('../src/audio/mic', () => ({ mic: { ignoreNotes() {}, suppress() {}, state: 'off' } }));

import { PracticeEngine } from '../src/practice/engine';
import { builtinSong } from '../src/data/songs';
import { importMidi } from '../src/music/midiImport';
import { Midi } from '@tonejs/midi';

function midiBuf(m: Midi): ArrayBuffer {
  const u8 = m.toArray();
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

function run(engine: PracticeEngine, seconds: number, frame: (i: number) => number) {
  let i = 0;
  const end = clock.t + seconds;
  while (clock.t < end) {
    clock.t += frame(i++) / 1000;
    engine.update();
  }
}

const opts = { hands: ['R', 'L'] as ('R' | 'L')[], mode: 'listen' as const, tempoFactor: 1, loop: null, repeat: false, metronome: false, playOtherHand: false, autoSpeedUp: false, naming: 'solfege' as const };

describe('relógio da reprodução', () => {
  beforeEach(() => {
    clock.t = 10;
    played.length = 0;
    clicks.length = 0;
  });

  it('segue as mudanças de andamento da música, também com o andamento ajustado', () => {
    const m = new Midi();
    m.header.tempos.push({ ticks: 0, bpm: 120 }, { ticks: 4 * 480, bpm: 60 });
    m.header.update();
    const tr = m.addTrack();
    for (let i = 0; i < 8; i++) tr.addNote({ midi: 60 + i, ticks: i * 960, durationTicks: 480 });
    const song = importMidi(midiBuf(m), 'rit.mid');
    for (const factor of [1, 0.5]) {
      played.length = 0;
      const engine = new PracticeEngine(song, { ...opts, tempoFactor: factor });
      engine.start();
      run(engine, 30, (i) => (i % 15 === 14 ? 120 : 16));
      const sounding = played.filter((p) => p.stopped === undefined);
      expect(sounding.map((p) => p.midi)).toEqual([60, 61, 62, 63, 64, 65, 66, 67]);
      const t0 = sounding[0].when;
      sounding.forEach((p, i) => {
        // tonejs calcula o segundo de cada nota pelo mapa de andamento do arquivo
        const ideal = tr.notes[i].time / factor;
        expect(Math.abs(p.when - t0 - ideal) * 1000, `nota ${i} (fator ${factor})`).toBeLessThan(1);
      });
    }
  });

  it('metrônomo acompanha mudanças de compasso (acento em cada barra)', () => {
    const m = new Midi();
    m.header.tempos.push({ ticks: 0, bpm: 120 });
    m.header.timeSignatures.push({ ticks: 0, timeSignature: [4, 4] }, { ticks: 4 * 480, timeSignature: [3, 4] });
    m.header.update();
    const tr = m.addTrack();
    for (let i = 0; i < 10; i++) tr.addNote({ midi: 72, ticks: i * 480, durationTicks: 400 });
    const song = importMidi(midiBuf(m), 'ts.mid');
    const engine = new PracticeEngine(song, { ...opts, metronome: true });
    engine.start();
    run(engine, 8, () => 16);
    // contagem (4) + 4/4 (4) + 3/4 (3) + 3/4 (3)…
    const acc = clicks.map((c) => (c.accent ? 'A' : '.')).join('');
    expect(acc.startsWith('A...' + 'A...' + 'A..' + 'A..')).toBe(true);
    const gaps = clicks.slice(1).map((c, i) => Math.round((c.at - clicks[i].at) * 1000));
    expect(new Set(gaps.slice(0, 12))).toEqual(new Set([500]));
  });

  it('quadros lentos não atrasam nem desalinham as notas', () => {
    const song = builtinSong('fur-elise')!;
    const engine = new PracticeEngine(song, { ...opts });
    engine.start();
    // quadros de 16 ms com travadas de 150 ms a cada 20 quadros (celular ocupado)
    run(engine, 8, (i) => (i % 20 === 19 ? 150 : 16));
    const sounding = played.filter((p) => p.stopped === undefined);
    expect(sounding.length).toBeGreaterThan(20);
    const tps = (song.tempo * PPQ_) / 60;
    const evs = engine.events;
    // cada nota tocada no instante ideal relativo à primeira
    const first = sounding[0];
    const firstEv = evs.find((e) => e.midi === first.midi)!;
    let maxErr = 0;
    for (const p of sounding) {
      const ideal = evs.filter((e) => e.midi === p.midi).map((e) => first.when + (e.t - firstEv.t) / tps);
      maxErr = Math.min(...ideal.map((x) => Math.abs(x - p.when))) > maxErr ? Math.min(...ideal.map((x) => Math.abs(x - p.when))) : maxErr;
    }
    expect(maxErr * 1000).toBeLessThan(1);
  });

  it('mudar o andamento tocando não repete notas já agendadas', () => {
    const song = builtinSong('maria-carneirinho')!;
    const engine = new PracticeEngine(song, { ...opts });
    engine.start();
    run(engine, 2.5, () => 16);
    engine.setOptions({ tempoFactor: 0.8 });
    run(engine, 3, () => 16);
    const sounding = played.filter((p) => p.stopped === undefined || p.stopped >= p.when);
    for (let i = 1; i < sounding.length; i++) {
      const dup = sounding.slice(0, i).some((p) => p.midi === sounding[i].midi && Math.abs(p.when - sounding[i].when) < 0.05);
      expect(dup, `nota ${sounding[i].midi} duplicada em ${sounding[i].when.toFixed(3)}`).toBe(false);
    }
  });

  it('pausar cancela o que já estava agendado', () => {
    const song = builtinSong('maria-carneirinho')!;
    const engine = new PracticeEngine(song, { ...opts });
    engine.start();
    // passa da contagem inicial (1 compasso) e pausa entre duas notas já agendadas
    run(engine, 4.4, () => 16);
    engine.pause();
    const future = played.filter((p) => p.when > clock.t + 0.005);
    expect(future.length).toBeGreaterThan(0);
    expect(future.every((p) => p.stopped !== undefined)).toBe(true);
  });
});

const PPQ_ = 480;

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
vi.mock('../src/audio/metronome', () => ({ click: () => ({ stop() {} }) }));
vi.mock('../src/audio/mic', () => ({ mic: { ignoreNotes() {}, suppress() {}, state: 'off' } }));

import { PracticeEngine } from '../src/practice/engine';
import { builtinSong } from '../src/data/songs';

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

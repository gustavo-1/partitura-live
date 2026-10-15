import { audioCtx, resumeAudio } from './context';
import { playNote, preloadPiano, type Voice } from './piano';

/** Uma nota para tocar (segundos). */
export interface SeqNote {
  midi: number;
  time: number;
  dur: number;
  vel: number; // 0..1 (já no volume do piano)
}

export interface SeqHandle {
  stop(): void;
}

let current: SeqHandle | null = null;

export function stopSequence() {
  current?.stop();
  current = null;
}

/**
 * Toca uma sequência de notas com o piano do app, agendando aos poucos (não cria milhares de sons de uma vez).
 * Usado para comparar o arquivo original com o que a conversão produziu. Só uma sequência toca por vez.
 */
export async function playSequence(notes: SeqNote[], opts: { onEnd?: () => void } = {}): Promise<SeqHandle> {
  stopSequence();
  await resumeAudio();
  const sorted = [...notes].sort((a, b) => a.time - b.time);
  const handle: SeqHandle = { stop: () => undefined };
  current = handle;
  if (!sorted.length) {
    opts.onEnd?.();
    return handle;
  }
  const lo = Math.min(...sorted.map((n) => n.midi));
  const hi = Math.max(...sorted.map((n) => n.midi));
  await Promise.race([preloadPiano(lo, hi), new Promise((r) => setTimeout(r, 4000))]);
  if (current !== handle) return handle; // outra sequência começou enquanto carregava
  const ctx = audioCtx();
  const t0 = ctx.currentTime + 0.15 - sorted[0].time;
  const end = Math.max(...sorted.map((n) => n.time + n.dur));
  let i = 0;
  let voices: { v: Voice; at: number }[] = [];
  let stopped = false;
  const pump = () => {
    if (stopped) return;
    const horizon = ctx.currentTime + 0.6;
    while (i < sorted.length && t0 + sorted[i].time <= horizon) {
      const n = sorted[i++];
      const at = t0 + n.time;
      voices.push({ v: playNote(n.midi, at, n.dur, n.vel), at });
    }
    if (voices.length > 200) voices = voices.filter((x) => x.at > ctx.currentTime - 8);
    if (i >= sorted.length && ctx.currentTime > t0 + end + 0.3) {
      finish();
      opts.onEnd?.();
    }
  };
  const finish = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    const now = ctx.currentTime;
    for (const x of voices) x.v.stop(now);
    if (current === handle) current = null;
  };
  const timer = setInterval(pump, 100);
  handle.stop = finish;
  pump();
  return handle;
}

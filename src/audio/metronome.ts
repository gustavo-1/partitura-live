import { audioCtx } from './context';

let volume = 0.6;

export function setMetronomeVolume(v: number): void {
  volume = v;
}

/** Agenda um clique. `accent` = primeiro tempo do compasso. */
export function click(when: number, accent = false): void {
  if (volume <= 0) return;
  const ctx = audioCtx();
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'square';
  o.frequency.value = accent ? 1760 : 1175;
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(0.25 * volume * (accent ? 1 : 0.7), when + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = o.frequency.value;
  f.Q.value = 2;
  o.connect(f).connect(g).connect(ctx.destination);
  o.start(when);
  o.stop(when + 0.07);
}

/** Metrônomo independente (para a tela de ferramentas e exercícios de ritmo). */
export class Metronome {
  bpm = 80;
  beatsPerBar = 4;
  onBeat?: (beat: number, time: number) => void;
  private timer: number | null = null;
  private nextTime = 0;
  private beat = 0;

  start(startAt?: number): void {
    const ctx = audioCtx();
    this.stop();
    this.nextTime = startAt ?? ctx.currentTime + 0.1;
    this.beat = 0;
    const tick = () => {
      const c = audioCtx();
      while (this.nextTime < c.currentTime + 0.12) {
        click(this.nextTime, this.beat % this.beatsPerBar === 0);
        const b = this.beat;
        const t = this.nextTime;
        const delay = Math.max(0, (t - c.currentTime) * 1000);
        window.setTimeout(() => this.onBeat?.(b, t), delay);
        this.beat++;
        this.nextTime += 60 / this.bpm;
      }
    };
    tick();
    this.timer = window.setInterval(tick, 25);
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  get running(): boolean {
    return this.timer !== null;
  }
}

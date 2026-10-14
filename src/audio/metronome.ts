import { audioCtx } from './context';

let volume = 0.6;

export function setMetronomeVolume(v: number): void {
  volume = v;
}

let noise: AudioBuffer | null = null;

/**
 * Agenda um clique. `accent` = primeiro tempo do compasso.
 * O clique é um ruído filtrado (tipo "woodblock"), sem altura definida, para que
 * o detector de notas do microfone não o confunda com uma tecla.
 */
export function click(when: number, accent = false): void {
  if (volume <= 0) return;
  const ctx = audioCtx();
  if (!noise) {
    const len = Math.floor(ctx.sampleRate * 0.04);
    noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len * 0.18));
  }
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = accent ? 3200 : 2200;
  f.Q.value = 1.2;
  const g = ctx.createGain();
  g.gain.value = 1.6 * volume * (accent ? 1 : 0.65);
  src.connect(f).connect(g).connect(ctx.destination);
  src.start(when);
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

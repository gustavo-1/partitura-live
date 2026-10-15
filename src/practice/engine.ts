import { now } from '../audio/context';
import type { NoteEvent } from '../audio/input';
import { mic } from '../audio/mic';
import { click } from '../audio/metronome';
import { playNote, type Voice } from '../audio/piano';
import { isHarmonicOf } from '../audio/detector';
import { beatTicks, measureTicks, midiName, type NamingStyle } from '../music/theory';
import { buildEvents, buildSteps, songEnd } from '../music/timeline';
import { PPQ, type Hand, type PlayEvent, type PracticeStep, type Song } from '../music/types';
import type { Ghost, NoteMark } from '../components/score/Score';

export type PracticeMode = 'wait' | 'tempo' | 'listen';

export interface EngineOptions {
  hands: Hand[];
  mode: PracticeMode;
  tempoFactor: number;
  loop: [number, number] | null;
  repeat: boolean; // repetir o trecho continuamente
  metronome: boolean;
  playOtherHand: boolean;
  autoSpeedUp: boolean;
  naming: NamingStyle;
}

export interface Feedback {
  id: number;
  kind: 'ok' | 'bad' | 'info';
  text: string;
}

export interface EngineStats {
  steps: number; // passos avaliados
  clean: number; // passos acertados de primeira (espera) / notas no tempo (tempo)
  hits: number;
  wrong: number;
  missed: number;
  streak: number;
  bestStreak: number;
  timing: number[]; // desvios (s) no modo tempo
}

export interface PassResult {
  accuracy: number;
  stats: EngineStats;
  tempoFactor: number;
  mode: PracticeMode;
  hands: Hand[];
  loop: [number, number] | null;
  measureErrors: Record<number, number>;
  full: boolean;
}

type Status = 'idle' | 'playing' | 'paused' | 'finished';

const emptyStats = (): EngineStats => ({ steps: 0, clean: 0, hits: 0, wrong: 0, missed: 0, streak: 0, bestStreak: 0, timing: [] });

export class PracticeEngine {
  readonly song: Song;
  opts: EngineOptions;
  events: PlayEvent[];
  steps: PracticeStep[] = [];
  status: Status = 'idle';
  /** posição atual em ticks */
  tick = 0;
  pending = 0; // índice do próximo passo esperado (modo espera)
  stats = emptyStats();
  marks = new Map<number, NoteMark>();
  ghosts: Ghost[] = [];
  feedback: Feedback | null = null;
  measureErrors: Record<number, number> = {};
  passes: PassResult[] = [];
  onFinish?: (r: PassResult) => void;
  onPass?: (r: PassResult) => void;

  private listeners = new Set<() => void>();
  private lastCtx = 0;
  /**
   * Âncora do relógio nos modos "no tempo" e "ouvir": a posição vem do relógio de áudio,
   * então um quadro lento (celular ocupado desenhando) não atrasa a música.
   */
  private anchor: { ctx: number; tick: number; tps: number } | null = null;
  /** sons já agendados para o futuro (cancelados ao pausar, mudar andamento etc.) */
  private scheduled: { v: Voice; at: number }[] = [];
  private startTick = 0;
  private endTick = 0;
  private hitEvents = new Set<PlayEvent>();
  private stepHit = new Map<number, Set<number>>(); // passo -> midis acertados
  private stepWrong = new Set<number>(); // passos com erro
  private scheduledUntil = 0;
  private metroUntil = 0;
  private ghostId = 0;
  private fbId = 0;
  private recentOk: { midi: number; time: number }[] = [];
  private evalIndex = 0; // modo tempo: próximo evento a verificar como perdido

  constructor(song: Song, opts: EngineOptions) {
    this.song = song;
    this.opts = { ...opts };
    this.events = buildEvents(song);
    this.rebuild();
  }

  // ---- assinatura (React) ----
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  private version = 0;
  getVersion = () => this.version;
  private emit() {
    this.version++;
    this.listeners.forEach((fn) => fn());
  }

  get qpm(): number {
    return this.song.tempo * this.opts.tempoFactor;
  }
  get ticksPerSec(): number {
    return (this.qpm * PPQ) / 60;
  }
  tickToSec(t: number): number {
    return t / this.ticksPerSec;
  }
  get range(): [number, number] {
    return [this.startTick, this.endTick];
  }

  private rebuild() {
    const { loop } = this.opts;
    const ms = this.song.measures;
    if (loop) {
      const a = Math.max(0, Math.min(loop[0], ms.length - 1));
      const b = Math.max(a, Math.min(loop[1], ms.length - 1));
      this.startTick = ms[a].start;
      this.endTick = ms[b].start + ms[b].length;
    } else {
      this.startTick = 0;
      this.endTick = songEnd(this.song);
    }
    const hands = this.opts.mode === 'listen' ? (['R', 'L'] as Hand[]) : this.opts.hands;
    this.steps = buildSteps(this.events, hands).filter((s) => s.t >= this.startTick && s.t < this.endTick);
    this.resetPass();
  }

  setOptions(p: Partial<EngineOptions>) {
    const structural = p.hands !== undefined || p.loop !== undefined || p.mode !== undefined;
    this.opts = { ...this.opts, ...p };
    // o que já estava agendado seria tocado de novo (ou no andamento antigo)
    this.cancelScheduled();
    this.anchor = null;
    if (structural) {
      this.status = 'idle';
      this.rebuild();
    }
    this.scheduledUntil = this.tick;
    this.metroUntil = this.tick;
    this.emit();
  }

  private resetPass() {
    this.pending = 0;
    this.stats = emptyStats();
    this.hitEvents.clear();
    this.stepHit.clear();
    this.stepWrong.clear();
    this.ghosts = [];
    this.measureErrors = {};
    this.evalIndex = 0;
    this.tick = this.startTick - this.preRoll();
    this.scheduledUntil = this.tick;
    this.metroUntil = this.tick;
    this.anchor = null;
    this.refreshMarks();
  }

  /** Silencia o que estava agendado para depois de agora. */
  private cancelScheduled() {
    const t = now();
    for (const s of this.scheduled) if (s.at > t + 0.005) s.v.stop(t);
    this.scheduled = [];
  }

  private preRoll(): number {
    const ts = this.song.measures[0]?.timeSig ?? [4, 4];
    if (this.opts.mode === 'wait') return beatTicks(ts);
    // contagem de um compasso
    return measureTicks(ts);
  }

  start() {
    if (this.status === 'finished' || this.status === 'idle') this.resetPass();
    this.status = 'playing';
    this.lastCtx = now();
    this.emit();
  }

  pause() {
    if (this.status !== 'playing') return;
    this.status = 'paused';
    this.cancelScheduled();
    // ao continuar, reagenda a partir de onde parou
    this.scheduledUntil = this.tick;
    this.metroUntil = this.tick;
    this.anchor = null;
    this.emit();
  }

  restart() {
    this.status = 'idle';
    this.cancelScheduled();
    this.resetPass();
    this.start();
  }

  stop() {
    this.status = 'idle';
    this.cancelScheduled();
    this.resetPass();
    this.emit();
  }

  /** Avança o relógio. Chamar a cada quadro. */
  update() {
    if (this.status !== 'playing') return;
    const t = now();
    let next: number;
    if (this.opts.mode === 'wait') {
      const dt = Math.min(0.1, Math.max(0, t - this.lastCtx));
      next = this.tick + dt * this.ticksPerSec;
      const step = this.steps[this.pending];
      if (step && next > step.t) next = step.t; // espera o aluno
      this.anchor = null;
    } else {
      const tps = this.ticksPerSec;
      if (!this.anchor || this.anchor.tps !== tps) this.anchor = { ctx: t, tick: this.tick, tps };
      next = this.anchor.tick + (t - this.anchor.ctx) * tps;
      // aba em segundo plano por muito tempo: retoma de onde estava em vez de pular a música
      if (next - this.tick > tps * 1.0) {
        this.anchor = { ctx: t, tick: this.tick, tps };
        next = this.tick;
      }
    }
    this.lastCtx = t;
    this.tick = next;

    this.scheduleAudio(t);

    if (this.opts.mode === 'tempo') this.checkMissed();
    if (this.opts.mode !== 'wait') {
      // passo "atual" para o cursor
      let idx = this.pending;
      while (idx < this.steps.length && this.steps[idx].t <= this.tick + 2) idx++;
      if (idx !== this.pending) {
        this.pending = idx;
        this.refreshMarks();
        this.emit();
      }
    }
    if (this.tick >= this.endTick || (this.opts.mode === 'wait' && this.pending >= this.steps.length && this.tick >= this.lastStepEnd())) {
      this.finishPass();
    }
  }

  private lastStepEnd(): number {
    const last = this.steps[this.steps.length - 1];
    if (!last) return this.startTick;
    const d = Math.max(...last.events.map((e) => e.d));
    return Math.min(this.endTick, last.t + Math.min(d, PPQ));
  }

  private finishPass() {
    const r = this.result();
    this.passes.push(r);
    if (this.opts.repeat && this.opts.loop) {
      this.onPass?.(r);
      if (this.opts.autoSpeedUp && r.accuracy >= 0.9 && this.opts.tempoFactor < 1.5) {
        this.opts.tempoFactor = Math.min(1.5, Math.round((this.opts.tempoFactor + 0.05) * 100) / 100);
        this.toast('info', `Ótimo! Andamento: ${Math.round(this.opts.tempoFactor * 100)}%`);
      } else {
        this.toast(r.accuracy >= 0.9 ? 'ok' : 'info', `Rodada: ${Math.round(r.accuracy * 100)}% — de novo!`);
      }
      const fb = this.feedback;
      this.resetPass();
      this.feedback = fb;
      this.lastCtx = now();
      this.anchor = null;
      this.emit();
      return;
    }
    this.status = 'finished';
    this.emit();
    this.onFinish?.(r);
  }

  result(): PassResult {
    const s = this.stats;
    let accuracy: number;
    if (this.opts.mode === 'wait') accuracy = s.steps ? s.clean / s.steps : 0;
    else {
      const total = s.hits + s.missed + s.wrong;
      accuracy = total ? s.hits / total : 0;
    }
    return {
      accuracy,
      stats: { ...s },
      tempoFactor: this.opts.tempoFactor,
      mode: this.opts.mode,
      hands: [...this.opts.hands],
      loop: this.opts.loop,
      measureErrors: { ...this.measureErrors },
      full: !this.opts.loop,
    };
  }

  // ---- áudio agendado (metrônomo, acompanhamento, modo ouvir) ----
  private scheduleAudio(ctxNow: number) {
    // margem maior nos modos com som contínuo: aguenta quadros lentos sem buracos
    const ahead = (this.opts.mode === 'wait' ? 0.15 : 0.3) * this.ticksPerSec;
    const horizon = this.tick + ahead;
    const toCtx = (tk: number) => ctxNow + (tk - this.tick) / this.ticksPerSec;
    const blocked = this.opts.mode === 'wait';

    // metrônomo (e contagem inicial)
    if (!blocked) {
      const ts = this.song.measures[0]?.timeSig ?? [4, 4];
      const bt = beatTicks(ts);
      const mt = measureTicks(ts);
      let b = Math.ceil(this.metroUntil / bt) * bt;
      if (b === this.metroUntil && this.metroUntil !== this.startTick - this.preRoll()) b += bt;
      for (; b <= horizon; b += bt) {
        if (b < this.tick - 1) continue;
        const inCount = b < this.startTick;
        if (this.opts.metronome || inCount) {
          const accent = inCount
            ? Math.round(b - (this.startTick - this.preRoll())) % mt === 0
            : this.song.measures.some((m) => m.start === Math.round(b));
          const at = toCtx(b);
          this.scheduled.push({ v: click(at, accent), at });
        }
      }
      this.metroUntil = Math.max(this.metroUntil, horizon);
    }

    // notas tocadas pelo app
    const playAll = this.opts.mode === 'listen';
    const playOther = this.opts.mode === 'tempo' && this.opts.playOtherHand;
    if (!playAll && !playOther) {
      this.scheduledUntil = horizon;
      return;
    }
    for (const e of this.events) {
      if (e.t < this.startTick || e.t >= this.endTick) continue;
      if (e.t <= this.scheduledUntil || e.t > horizon) continue;
      if (!playAll && this.opts.hands.includes(e.hand)) continue;
      const when = toCtx(e.t);
      // ficou para trás (quadro muito lento): pular é melhor do que tocar tudo de uma vez
      if (when < ctxNow - 0.03) continue;
      const dur = (e.sd ?? e.d) / this.ticksPerSec;
      const vel = e.vel !== undefined ? 0.25 + 0.75 * e.vel : 0.7;
      this.scheduled.push({ v: playNote(e.midi, when, dur * (e.sd ? 1 : 0.95), vel), at: when });
      mic.ignoreNotes([e.midi], when + dur + 0.3);
    }
    if (this.scheduled.length > 64) this.scheduled = this.scheduled.filter((x) => x.at > ctxNow - 0.05);
    this.scheduledUntil = horizon;
  }

  // ---- entrada ----
  handleInput(e: NoteEvent) {
    if (e.type !== 'on') return;
    if (this.status !== 'playing') {
      // aceitar a primeira nota como "começar" no modo espera
      if (this.status === 'idle' && this.opts.mode === 'wait' && this.steps[0]?.events.some((x) => x.midi === e.midi)) {
        this.start();
      } else return;
    }
    if (this.opts.mode === 'listen') return;
    if (this.opts.mode === 'wait') this.inputWait(e);
    else this.inputTempo(e);
  }

  private isArtifact(e: NoteEvent, expected: number[]): boolean {
    if (e.source !== 'mic') return false;
    // eco/rebote de uma nota acertada há pouco
    const t = e.time;
    if (this.recentOk.some((r) => r.midi === e.midi && t - r.time < 0.35)) return true;
    // harmônico de nota esperada ou recém-tocada
    const sounding = [...expected, ...this.recentOk.filter((r) => t - r.time < 1.5).map((r) => r.midi)];
    return sounding.some((m) => isHarmonicOf(e.midi, m) || isHarmonicOf(m, e.midi));
  }

  private inputWait(e: NoteEvent) {
    const step = this.steps[this.pending];
    if (!step) return;
    const got = this.stepHit.get(step.index) ?? new Set<number>();
    const expected = step.events.map((x) => x.midi);
    if (expected.includes(e.midi)) {
      if (got.has(e.midi)) return;
      // pelo microfone, notas em oitava/harmônico dentro do mesmo acorde são inseparáveis
      // (ex.: Sol3 + Sol4): a detecção de uma vale para as duas
      const also =
        e.source === 'mic' ? expected.filter((m) => m !== e.midi && !got.has(m) && (isHarmonicOf(m, e.midi) || isHarmonicOf(e.midi, m))) : [];
      for (const m of [e.midi, ...also]) {
        got.add(m);
        this.recentOk.push({ midi: m, time: e.time });
        for (const ev of step.events) if (ev.midi === m) this.hitEvents.add(ev);
      }
      this.stepHit.set(step.index, got);
      while (this.recentOk.length > 12) this.recentOk.shift();
      if (expected.every((m) => got.has(m))) this.completeStep(step);
      else {
        this.refreshMarks();
        this.emit();
      }
      return;
    }
    // nota diferente
    if (this.isArtifact(e, expected)) return;
    // nota do próximo passo tocada antes? (ex.: aluno adiantou) — ignora sem punir
    const nextStep = this.steps[this.pending + 1];
    if (got.size > 0 && nextStep?.events.some((x) => x.midi === e.midi)) return;
    this.registerWrong(e.midi, step);
    const want = step.events
      .filter((x) => !got.has(x.midi))
      .map((x) => midiName(x.midi, this.opts.naming, true, this.song.keySig));
    const played = midiName(e.midi, this.opts.naming, true, this.song.keySig);
    const dir = step.events.some((x) => x.midi > e.midi) && !step.events.some((x) => x.midi < e.midi) ? ' (mais agudo →)' : step.events.every((x) => x.midi < e.midi) ? ' (← mais grave)' : '';
    this.toast('bad', `Você tocou ${played} — procure ${want.join(' + ')}${dir}`);
    this.emit();
  }

  private registerWrong(midi: number, step: PracticeStep) {
    this.stats.wrong++;
    this.stats.streak = 0;
    this.stepWrong.add(step.index);
    this.measureErrors[step.measure] = (this.measureErrors[step.measure] ?? 0) + 1;
    // nota fantasma na pauta mais próxima
    const near = step.events.reduce((a, b) => (Math.abs(b.midi - midi) < Math.abs(a.midi - midi) ? b : a));
    this.ghosts = [
      ...this.ghosts.filter((g) => g.nearElId !== near.elId).slice(-6),
      { id: ++this.ghostId, midi, staff: near.staff, nearElId: near.elId, kind: 'wrong' },
    ];
    this.refreshMarks();
  }

  private completeStep(step: PracticeStep) {
    this.stats.steps++;
    this.stats.hits += step.events.length;
    const clean = !this.stepWrong.has(step.index);
    if (clean) {
      this.stats.clean++;
      this.stats.streak++;
      this.stats.bestStreak = Math.max(this.stats.bestStreak, this.stats.streak);
    }
    this.ghosts = this.ghosts.filter((g) => !step.events.some((ev) => ev.elId === g.nearElId));
    // acompanhamento da outra mão
    if (this.opts.playOtherHand) {
      for (const ev of this.events) {
        if (ev.t === step.t && !this.opts.hands.includes(ev.hand)) {
          playNote(ev.midi, undefined, Math.min(1.5, ev.d / this.ticksPerSec), 0.6);
          mic.ignoreNotes([ev.midi], now() + 1.2);
        }
      }
    }
    this.pending++;
    if (this.tick < step.t) this.tick = step.t;
    if (this.stats.streak > 0 && this.stats.streak % 10 === 0) this.toast('ok', `${this.stats.streak} seguidas! 🔥`);
    this.refreshMarks();
    this.emit();
  }

  private inputTempo(e: NoteEvent) {
    const tps = this.ticksPerSec;
    const inputTick = this.tick - (now() - e.time) * tps;
    const beatSec = 60 / this.qpm;
    const win = Math.max(0.16, Math.min(0.32, 0.45 * beatSec)) * tps;
    let best: PlayEvent | null = null;
    let bestD = Infinity;
    for (const step of this.steps) {
      if (step.t < inputTick - win) continue;
      if (step.t > inputTick + win) break;
      for (const ev of step.events) {
        if (ev.midi !== e.midi || this.hitEvents.has(ev)) continue;
        const d = Math.abs(ev.t - inputTick);
        if (d < bestD) {
          bestD = d;
          best = ev;
        }
      }
    }
    if (best) {
      this.hitEvents.add(best);
      if (e.source === 'mic') {
        const step = this.steps.find((s) => s.events.includes(best!));
        for (const ev of step?.events ?? []) {
          if (ev !== best && !this.hitEvents.has(ev) && (isHarmonicOf(ev.midi, best.midi) || isHarmonicOf(best.midi, ev.midi))) {
            this.hitEvents.add(ev);
            this.stats.hits++;
          }
        }
      }
      this.stats.hits++;
      this.stats.streak++;
      this.stats.bestStreak = Math.max(this.stats.bestStreak, this.stats.streak);
      const dev = (inputTick - best.t) / tps;
      this.stats.timing.push(dev);
      this.recentOk.push({ midi: e.midi, time: e.time });
      if (this.recentOk.length > 12) this.recentOk.shift();
      if (Math.abs(dev) < 0.07) this.toast('ok', 'Perfeito!');
      else this.toast('ok', dev < 0 ? 'Um pouco adiantado' : 'Um pouco atrasado');
      this.refreshMarks();
      this.emit();
      return;
    }
    // nota errada
    const nearby = this.steps.filter((s) => Math.abs(s.t - inputTick) < win * 2).flatMap((s) => s.events.map((x) => x.midi));
    if (this.isArtifact(e, nearby)) return;
    const step = this.steps.find((s) => s.t >= inputTick - win) ?? this.steps[this.steps.length - 1];
    if (!step) return;
    this.registerWrong(e.midi, step);
    this.toast('bad', `${midiName(e.midi, this.opts.naming, true, this.song.keySig)} não estava na partitura aqui`);
    this.emit();
  }

  private checkMissed() {
    const tps = this.ticksPerSec;
    const beatSec = 60 / this.qpm;
    const win = Math.max(0.16, Math.min(0.32, 0.45 * beatSec)) * tps;
    let changed = false;
    while (this.evalIndex < this.steps.length && this.steps[this.evalIndex].t + win < this.tick) {
      const step = this.steps[this.evalIndex];
      for (const ev of step.events) {
        if (!this.hitEvents.has(ev)) {
          this.stats.missed++;
          this.stats.streak = 0;
          this.measureErrors[step.measure] = (this.measureErrors[step.measure] ?? 0) + 1;
          changed = true;
        }
      }
      this.stats.steps++;
      this.evalIndex++;
    }
    if (changed) {
      this.refreshMarks();
      this.emit();
    }
  }

  private toast(kind: Feedback['kind'], text: string) {
    this.feedback = { id: ++this.fbId, kind, text };
  }

  /** Notas esperadas agora (para as dicas no teclado). */
  expected(): PlayEvent[] {
    if (this.opts.mode === 'wait') {
      const step = this.steps[this.pending];
      if (!step) return [];
      const got = this.stepHit.get(step.index);
      return step.events.filter((e) => !got?.has(e.midi));
    }
    const tps = this.ticksPerSec;
    const out: PlayEvent[] = [];
    for (const s of this.steps) {
      if (s.t > this.tick + 0.25 * tps) break;
      for (const ev of s.events) if (ev.t + ev.d > this.tick && !this.hitEvents.has(ev) && ev.t <= this.tick + 0.25 * tps) out.push(ev);
    }
    return out;
  }

  /** Elementos do passo atual (para o cursor). */
  cursorEls(): number[] {
    const idx = this.opts.mode === 'wait' ? this.pending : this.pending - 1;
    const step = this.steps[Math.max(0, Math.min(idx, this.steps.length - 1))];
    return step ? [...new Set(step.events.map((e) => e.elId))] : [];
  }

  eventState(ev: PlayEvent): 'ok' | 'missed' | undefined {
    if (this.hitEvents.has(ev)) return 'ok';
    if (this.opts.mode === 'tempo') {
      const idx = this.steps.findIndex((s) => s.events.includes(ev));
      if (idx >= 0 && idx < this.evalIndex) return 'missed';
    }
    return undefined;
  }

  private refreshMarks() {
    const marks = new Map<number, NoteMark>();
    const practiced = new Set<number>();
    for (const s of this.steps) for (const ev of s.events) practiced.add(ev.elId);
    for (const n of this.song.notes) {
      if (!n.keys.length) continue;
      if (!practiced.has(n.id) && this.opts.mode !== 'listen') {
        const inRange = n.t >= this.startTick && n.t < this.endTick;
        if (inRange) marks.set(n.id, 'dim');
      }
    }
    // estado por elemento
    const byEl = new Map<number, PlayEvent[]>();
    for (const s of this.steps) for (const ev of s.events) {
      if (!byEl.has(ev.elId)) byEl.set(ev.elId, []);
      byEl.get(ev.elId)!.push(ev);
    }
    const stepOfEl = new Map<number, number>();
    for (const s of this.steps) for (const ev of s.events) stepOfEl.set(ev.elId, s.index);
    for (const [elId, evs] of byEl) {
      const allHit = evs.every((e) => this.hitEvents.has(e));
      const stepIdx = stepOfEl.get(elId)!;
      const hadWrong = this.stepWrong.has(stepIdx);
      if (this.opts.mode === 'listen') continue;
      if (allHit) marks.set(elId, hadWrong ? 'bad' : 'ok');
      else if (this.opts.mode === 'tempo' && evs.some((e) => this.eventState(e) === 'missed')) marks.set(elId, 'missed');
    }
    if (this.opts.mode === 'wait') {
      for (const elId of this.cursorEls()) if (!marks.has(elId) || marks.get(elId) === 'dim') marks.set(elId, 'current');
    }
    this.marks = marks;
  }
}

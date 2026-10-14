import { audioCtx, resumeAudio } from './context';
import { NoteDetector, type DetectorFrame } from './detector';

export type MicState = 'off' | 'starting' | 'on' | 'denied' | 'error' | 'unsupported';

type FrameListener = (f: DetectorFrame) => void;
type StateListener = (s: MicState) => void;

/** Captura o microfone e roda o detector de notas continuamente. */
class MicListener {
  state: MicState = 'off';
  detector: NoteDetector | null = null;
  lastFrame: DetectorFrame | null = null;
  errorMessage = '';
  sensitivity = 0.5;
  /** latência de entrada estimada (s): subtraída dos tempos de ataque */
  latency = 0.04;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private buf: Float32Array<ArrayBuffer> | null = null;
  private timer: number | null = null;
  private frameListeners = new Set<FrameListener>();
  private stateListeners = new Set<StateListener>();

  get supported(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  }

  onFrame(fn: FrameListener): () => void {
    this.frameListeners.add(fn);
    return () => this.frameListeners.delete(fn);
  }

  onState(fn: StateListener): () => void {
    this.stateListeners.add(fn);
    return () => this.stateListeners.delete(fn);
  }

  private setState(s: MicState) {
    this.state = s;
    this.stateListeners.forEach((fn) => fn(s));
  }

  setSensitivity(v: number) {
    this.sensitivity = v;
    if (this.detector) this.detector.sensitivity = v;
  }

  async start(): Promise<boolean> {
    if (this.state === 'on') return true;
    if (!this.supported) {
      this.setState('unsupported');
      return false;
    }
    this.setState('starting');
    try {
      const ctx = await resumeAudio();
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
        },
      });
      this.source = ctx.createMediaStreamSource(this.stream);
      this.detector = new NoteDetector({ sampleRate: ctx.sampleRate, sensitivity: this.sensitivity });
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = this.detector.nLong;
      this.analyser.smoothingTimeConstant = 0;
      this.source.connect(this.analyser);
      this.buf = new Float32Array(this.analyser.fftSize);
      this.timer = window.setInterval(() => this.tick(), 16);
      this.setState('on');
      return true;
    } catch (e) {
      const err = e as DOMException;
      this.errorMessage = err?.message ?? String(e);
      this.setState(err?.name === 'NotAllowedError' || err?.name === 'SecurityError' ? 'denied' : 'error');
      this.cleanup();
      return false;
    }
  }

  private tick() {
    if (!this.analyser || !this.buf || !this.detector) return;
    const ctx = audioCtx();
    this.analyser.getFloatTimeDomainData(this.buf);
    const frame = this.detector.process(this.buf, ctx.currentTime);
    for (const o of frame.onsets) o.time -= this.latency;
    this.lastFrame = frame;
    this.frameListeners.forEach((fn) => fn(frame));
  }

  /** O app vai tocar estas notas: não as conte como tocadas pelo usuário. */
  ignoreNotes(midis: number[], until: number) {
    if (!this.detector) return;
    for (const m of midis) this.detector.ignoreNote(m, until);
  }

  suppress(until: number) {
    this.detector?.suppress(until);
  }

  private cleanup() {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.source?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.source = null;
    this.analyser = null;
  }

  stop() {
    this.cleanup();
    this.setState('off');
  }
}

export const mic = new MicListener();

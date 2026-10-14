import { audioCtx, now, resumeAudio } from './context';
import { mic } from './mic';
import { noteOff, noteOn } from './piano';

export type InputSource = 'mic' | 'midi' | 'screen' | 'keyboard';

export interface NoteEvent {
  type: 'on' | 'off';
  midi: number;
  time: number; // tempo do AudioContext (s)
  source: InputSource;
  velocity: number;
}

type Listener = (e: NoteEvent) => void;

/**
 * Barramento único de entrada: microfone, MIDI (USB/Bluetooth), teclado na tela
 * e teclado do computador geram os mesmos eventos de nota.
 */
class InputBus {
  private listeners = new Set<Listener>();
  private changeListeners = new Set<() => void>();
  /** notas soando agora (para destacar no teclado) */
  sounding = new Map<number, InputSource>();
  midiConnected = false;
  midiNames: string[] = [];
  private version = 0;

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Para useSyncExternalStore */
  subscribe = (fn: () => void): (() => void) => {
    this.changeListeners.add(fn);
    return () => this.changeListeners.delete(fn);
  };

  getVersion = (): number => this.version;

  private changed() {
    this.version++;
    this.changeListeners.forEach((fn) => fn());
  }

  emit(e: NoteEvent) {
    if (e.type === 'on') this.sounding.set(e.midi, e.source);
    else if (this.sounding.get(e.midi) === e.source) this.sounding.delete(e.midi);
    this.listeners.forEach((fn) => fn(e));
    this.changed();
  }

  /** Teclado na tela / do computador: toca o som e emite o evento. */
  press(midi: number, source: InputSource = 'screen', velocity = 0.8) {
    void resumeAudio();
    noteOn(midi, velocity);
    this.emit({ type: 'on', midi, time: now(), source, velocity });
  }

  release(midi: number, source: InputSource = 'screen') {
    noteOff(midi);
    this.emit({ type: 'off', midi, time: now(), source, velocity: 0 });
  }

  /** Atualiza notas soando detectadas pelo microfone. */
  setMicActive(active: number[], time: number) {
    const set = new Set(active);
    let changed = false;
    for (const [m, src] of [...this.sounding]) {
      if (src === 'mic' && !set.has(m)) {
        this.sounding.delete(m);
        this.listeners.forEach((fn) => fn({ type: 'off', midi: m, time, source: 'mic', velocity: 0 }));
        changed = true;
      }
    }
    for (const m of set) {
      if (!this.sounding.has(m)) {
        this.sounding.set(m, 'mic');
        changed = true;
      }
    }
    if (changed) this.changed();
  }
}

export const input = new InputBus();

// microfone -> barramento
mic.onFrame((f) => {
  for (const o of f.onsets) input.emit({ type: 'on', midi: o.midi, time: o.time, source: 'mic', velocity: 0.7 });
  input.setMicActive(f.active, f.time);
});

// Teclado do computador (estilo DAW): A W S E D F T G Y H U J K O L P ;
const KEYMAP: Record<string, number> = {
  KeyA: 0,
  KeyW: 1,
  KeyS: 2,
  KeyE: 3,
  KeyD: 4,
  KeyF: 5,
  KeyT: 6,
  KeyG: 7,
  KeyY: 8,
  KeyH: 9,
  KeyU: 10,
  KeyJ: 11,
  KeyK: 12,
  KeyO: 13,
  KeyL: 14,
  KeyP: 15,
  Semicolon: 16,
  Quote: 17,
};
let kbOctave = 4;
const kbDown = new Map<string, number>();
let kbEnabled = true;

export function setComputerKeyboard(enabled: boolean) {
  kbEnabled = enabled;
}

export function computerKeyboardOctave(): number {
  return kbOctave;
}

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    if (!kbEnabled || e.repeat || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
    if (e.code === 'KeyZ') {
      kbOctave = Math.max(1, kbOctave - 1);
      return;
    }
    if (e.code === 'KeyX') {
      kbOctave = Math.min(7, kbOctave + 1);
      return;
    }
    const off = KEYMAP[e.code];
    if (off === undefined) return;
    const midi = (kbOctave + 1) * 12 + off;
    kbDown.set(e.code, midi);
    input.press(midi, 'keyboard');
  });
  window.addEventListener('keyup', (e) => {
    const midi = kbDown.get(e.code);
    if (midi === undefined) return;
    kbDown.delete(e.code);
    input.release(midi, 'keyboard');
  });
}

// Web MIDI (opcional: teclados USB / Bluetooth)
export async function initMidi(): Promise<boolean> {
  const nav = navigator as Navigator & { requestMIDIAccess?: () => Promise<MIDIAccess> };
  if (!nav.requestMIDIAccess) return false;
  try {
    const access = await nav.requestMIDIAccess();
    const bind = () => {
      input.midiNames = [];
      access.inputs.forEach((inp) => {
        input.midiNames.push(inp.name ?? 'MIDI');
        inp.onmidimessage = (msg: MIDIMessageEvent) => {
          const d = msg.data;
          if (!d || d.length < 3) return;
          const cmd = d[0] & 0xf0;
          const t = audioCtx().currentTime;
          if (cmd === 0x90 && d[2] > 0) input.emit({ type: 'on', midi: d[1], time: t, source: 'midi', velocity: d[2] / 127 });
          else if (cmd === 0x80 || (cmd === 0x90 && d[2] === 0))
            input.emit({ type: 'off', midi: d[1], time: t, source: 'midi', velocity: 0 });
        };
      });
      input.midiConnected = input.midiNames.length > 0;
    };
    bind();
    access.onstatechange = bind;
    return input.midiConnected;
  } catch {
    return false;
  }
}

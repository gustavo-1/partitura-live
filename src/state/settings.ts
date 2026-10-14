import { createStore } from '../lib/store';
import type { NamingStyle } from '../music/theory';

export interface Settings {
  naming: NamingStyle;
  /** mostra o nome das notas embaixo das cabeças de nota (ajuda para iniciantes) */
  showNoteNames: boolean;
  /** mostra nomes nas teclas do teclado virtual */
  keyLabels: 'none' | 'c' | 'all';
  /** destaca no teclado a tecla que deve ser tocada */
  showKeyHints: boolean;
  micSensitivity: number;
  latencyMs: number;
  /** tamanho do teclado físico: define a faixa mostrada */
  keyboardSize: 49 | 61 | 76 | 88;
  theme: 'system' | 'light' | 'dark';
  pianoVolume: number;
  metronomeVolume: number;
  dailyGoalMin: number;
  firebaseConfig: string;
  computerKeyboard: boolean;
  onboarded: boolean;
}

export const defaultSettings: Settings = {
  naming: 'solfege',
  showNoteNames: false,
  keyLabels: 'c',
  showKeyHints: true,
  micSensitivity: 0.5,
  latencyMs: 60,
  keyboardSize: 61,
  theme: 'system',
  pianoVolume: 0.8,
  metronomeVolume: 0.6,
  dailyGoalMin: 15,
  firebaseConfig: '',
  computerKeyboard: true,
  onboarded: false,
};

export const settings = createStore<Settings>('pl.settings', defaultSettings);

export function keyboardRange(size: Settings['keyboardSize']): [number, number] {
  switch (size) {
    case 49:
      return [36, 84];
    case 61:
      return [36, 96];
    case 76:
      return [28, 103];
    default:
      return [21, 108];
  }
}

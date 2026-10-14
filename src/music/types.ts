// Modelo interno de música usado por todo o app (partitura, cascata, prática).

export const PPQ = 480; // ticks por semínima

export type Step = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';

export interface Pitch {
  midi: number;
  step: Step;
  alter: number; // -2..2
  octave: number;
}

export type Clef = 'treble' | 'bass';

/** Um evento notado em uma pauta: nota, acorde ou pausa. */
export interface NoteEl {
  id: number;
  t: number; // início em ticks
  d: number; // duração notada em ticks
  staff: number; // 0 = pauta superior (mão direita), 1 = inferior (mão esquerda)
  voice: number;
  keys: Pitch[]; // vazio = pausa
  dur: string; // código de duração VexFlow: w h q 8 16 32
  dots: number;
  fingers?: (number | undefined)[];
  tieStart?: boolean[]; // por nota do acorde: ligada à próxima
  tieEnd?: boolean[]; // por nota do acorde: continuação (não é tocada de novo)
  tuplet?: { actual: number; normal: number };
  measure: number;
  fullRest?: boolean; // pausa de compasso inteiro
  hidden?: boolean; // pausa invisível (preenchimento de voz secundária)
}

export interface Measure {
  index: number;
  start: number;
  length: number;
  timeSig: [number, number];
  keySig: number; // quintas: -7..7
  timeSigChange?: boolean;
  keySigChange?: boolean;
}

export interface Song {
  id: string;
  title: string;
  composer?: string;
  description?: string;
  level: number; // 1..5
  tags?: string[];
  source: 'builtin' | 'import' | 'generated' | 'lesson';
  tempo: number; // semínimas por minuto
  timeSig: [number, number];
  keySig: number;
  staves: number; // 1 ou 2
  clefs: Clef[];
  measures: Measure[];
  notes: NoteEl[];
  /** mãos presentes: staff 0 => 'R', staff 1 => 'L' (padrão) */
  staffHands?: Hand[];
}

export type Hand = 'R' | 'L';

/** Evento sonoro para tocar/praticar (ligaduras já resolvidas). */
export interface PlayEvent {
  midi: number;
  t: number; // ticks
  d: number; // ticks (soando, incluindo ligaduras)
  hand: Hand;
  staff: number;
  elId: number;
  keyIndex: number;
  finger?: number;
  measure: number;
}

/** Um "passo" de prática: todas as notas que começam no mesmo instante. */
export interface PracticeStep {
  index: number;
  t: number;
  events: PlayEvent[];
  measure: number;
}

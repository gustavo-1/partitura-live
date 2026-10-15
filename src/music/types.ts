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
  /** intensidade de cada nota do acorde (0..1), quando a música importada traz essa informação */
  vel?: number[];
  /** duração que soa no arquivo original (ticks, a partir do ataque real); só no primeiro pedaço ligado */
  sdur?: number[];
  /** ataque real no arquivo menos o ataque escrito (ticks): o som segue a interpretação, a partitura fica legível */
  sofs?: number[];
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
  /** trechos com pedal de sustentação [início, fim] em ticks (só afeta o som) */
  pedal?: [number, number][];
  /** versão do importador que gerou a música (músicas importadas) */
  importVersion?: number;
  /** mudanças de andamento ao longo da música (ticks -> semínimas por minuto); o primeiro em t=0 */
  tempoMap?: { t: number; qpm: number }[];
  /** arquivo original importado (para ouvir, comparar e reconverter) */
  original?: SongOriginal;
  /** resumo da conversão (quão fiel ao arquivo ficou) */
  importReport?: ImportReport;
}

export interface SongOriginal {
  kind: 'midi' | 'musicxml';
  name: string;
  /** MIDI em base64; MusicXML em texto */
  data: string;
  /** trilhas usadas (MIDI) e para qual mão foi cada uma */
  tracks?: { index: number; hand: 'R' | 'L' | 'auto' }[];
}

export interface ImportReport {
  notes: number;
  /** notas que o app toca no mesmo instante do arquivo (até 10 ms) */
  exact: number;
  /** maior deslocamento do som de uma nota (ms) */
  maxShiftMs: number;
  /** notas escritas exatamente onde soam (o resto foi alinhado às figuras da partitura) */
  gridExact?: number;
  /** maior diferença entre onde a nota soa e onde está escrita (ms) */
  gridMaxMs?: number;
  /** o arquivo dizia um andamento, mas as notas seguiam outro: a grade foi refeita */
  tempoFix?: { file: number; real: number };
  /** colcheias com swing (escritas retas; o som mantém o balanço) */
  swing?: boolean;
  /** notas repetidas iguais juntadas (mesma tecla no mesmo instante) */
  merged: number;
  tempoChanges: number;
  timeSigChanges: number;
  tracksUsed: string[];
  tracksIgnored: string[];
}

/** Versão atual dos importadores de MIDI/MusicXML (sobe quando a conversão melhora). */
export const IMPORT_VERSION = 4;

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
  /** intensidade (0..1) */
  vel?: number;
  /** onde a nota soa de fato (ticks), quando difere da escrita (interpretação "ao vivo") */
  st?: number;
  /** quanto a nota soa de fato a partir de onde soa, com o pedal (ticks); só para o som */
  sd?: number;
  /** mesma tecla, mesmo instante de outra nota (uníssono entre vozes): não toca duas vezes */
  dup?: boolean;
}

/** Um "passo" de prática: todas as notas que começam no mesmo instante. */
export interface PracticeStep {
  index: number;
  t: number;
  events: PlayEvent[];
  measure: number;
}

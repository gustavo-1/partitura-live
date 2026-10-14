/**
 * Trilha de aprendizado.
 *
 * Princípios didáticos usados (inspirados em métodos como Faber, Alfred, Bastien e
 * em pesquisas sobre leitura musical):
 *  - Geografia do teclado pelos grupos de 2 e 3 teclas pretas (não contar teclas).
 *  - Notas-guia ("landmarks"): Dó central, Sol da clave de Sol, Fá da clave de Fá...
 *  - Leitura por intervalos (passo/salto, direção) em vez de decorar cada nota.
 *  - Ritmo trabalhado separadamente da altura, com pulsação e contagem.
 *  - Mãos separadas antes de juntas; prática lenta (modo espera) antes do tempo.
 *  - Feedback imediato e repetição espaçada nas notas que você erra mais.
 */

export interface StaffSpec {
  rh?: string;
  lh?: string;
  time?: string;
  key?: number;
  names?: boolean;
}

export interface KeysSpec {
  lo: number;
  hi: number;
  highlight?: number[];
  labels?: Record<number, string>;
  color?: string;
}

export type Activity =
  | { type: 'info'; title?: string; text: string; staff?: StaffSpec; keys?: KeysSpec }
  | { type: 'quiz'; question: string; options: string[]; answer: number; explain?: string; staff?: StaffSpec; keys?: KeysSpec }
  | {
      type: 'find';
      prompt?: string;
      /** classes de altura (0=Dó..11=Si) ou notas exatas (midi) */
      targets: { pc?: number; midi?: number; label: string }[];
      count: number;
      lo?: number;
      hi?: number;
    }
  | { type: 'read'; clef: 'treble' | 'bass' | 'grand'; pool: string[]; count: number; answer?: 'play' | 'name' | 'both'; key?: number }
  | { type: 'rhythm'; pattern: string; tempo: number; time?: string; intro?: string }
  | {
      type: 'play';
      intro?: string;
      songId?: string;
      spec?: { rh?: string; lh?: string; time?: string; key?: number; tempo?: number };
      loop?: [number, number];
      mode?: 'wait' | 'tempo';
      target?: number;
      hands?: 'R' | 'L' | 'RL';
    }
  | { type: 'sight'; level: number; intro?: string };

export interface Lesson {
  id: string;
  title: string;
  summary: string;
  activities: Activity[];
}

export interface Unit {
  id: string;
  title: string;
  description: string;
  color: string;
  lessons: Lesson[];
}

const C_POS_RH = { 60: '1', 62: '2', 64: '3', 65: '4', 67: '5' };
const C_POS_LH = { 48: '5', 50: '4', 52: '3', 53: '2', 55: '1' };
const G_POS_RH = { 67: '1', 69: '2', 71: '3', 72: '4', 74: '5' };

const WHITE = [
  { pc: 0, label: 'Dó' },
  { pc: 2, label: 'Ré' },
  { pc: 4, label: 'Mi' },
  { pc: 5, label: 'Fá' },
  { pc: 7, label: 'Sol' },
  { pc: 9, label: 'Lá' },
  { pc: 11, label: 'Si' },
];

export const CURRICULUM: Unit[] = [
  {
    id: 'u1',
    title: 'Conhecendo o teclado',
    description: 'Grupos de teclas pretas, os nomes das notas e a posição das mãos.',
    color: '#4f46e5',
    lessons: [
      {
        id: 'u1l1',
        title: 'Teclas brancas e pretas',
        summary: 'Os grupos de 2 e 3 teclas pretas são o seu mapa.',
        activities: [
          {
            type: 'info',
            title: 'Um padrão que se repete',
            text: 'Olhe para o teclado: as **teclas pretas** aparecem em **grupos de 2** e **grupos de 3**, alternando. Esse desenho se repete do começo ao fim.\n\nÉ por esses grupos que os pianistas se localizam — você nunca vai precisar contar teclas.',
            keys: { lo: 48, hi: 71, highlight: [49, 51, 61, 63], color: '#6366f1' },
          },
          {
            type: 'quiz',
            question: 'As teclas pretas aparecem em grupos de…',
            options: ['1 e 2', '2 e 3', '3 e 4'],
            answer: 1,
            explain: 'Grupos de 2 e de 3, sempre alternando.',
          },
          {
            type: 'info',
            title: 'Grave e agudo',
            text: 'Indo para a **esquerda**, o som fica mais **grave** (grosso). Indo para a **direita**, mais **agudo** (fino).\n\nSe tiver um teclado por perto, toque uma tecla bem à esquerda e outra bem à direita e compare.',
          },
          {
            type: 'quiz',
            question: 'Para tocar um som mais agudo, você vai para…',
            options: ['a esquerda', 'a direita'],
            answer: 1,
          },
          {
            type: 'find',
            prompt: 'Toque qualquer tecla preta de um GRUPO DE 2',
            targets: [
              { pc: 1, label: 'grupo de 2' },
              { pc: 3, label: 'grupo de 2' },
            ],
            count: 3,
          },
          {
            type: 'find',
            prompt: 'Agora qualquer tecla preta de um GRUPO DE 3',
            targets: [
              { pc: 6, label: 'grupo de 3' },
              { pc: 8, label: 'grupo de 3' },
              { pc: 10, label: 'grupo de 3' },
            ],
            count: 3,
          },
        ],
      },
      {
        id: 'u1l2',
        title: 'Encontrando o Dó',
        summary: 'O Dó mora à esquerda do grupo de 2 teclas pretas.',
        activities: [
          {
            type: 'info',
            title: 'O Dó',
            text: 'Todo **Dó** fica logo **à esquerda do grupo de 2 teclas pretas**.\n\nComo o padrão se repete, existem vários Dós. O que fica perto do meio do teclado (geralmente em frente à marca do teclado) é o **Dó central**, também chamado de **Dó4**. Ele é o ponto de partida de quase tudo que você vai aprender.',
            keys: { lo: 36, hi: 84, highlight: [36, 48, 60, 72, 84], labels: { 60: 'Dó4' }, color: '#22c55e' },
          },
          { type: 'find', prompt: 'Toque um Dó (qualquer um)', targets: [{ pc: 0, label: 'Dó' }], count: 4 },
          { type: 'find', prompt: 'Agora toque o Dó central', targets: [{ midi: 60, label: 'Dó central' }], count: 2 },
          {
            type: 'quiz',
            question: 'Onde fica o Dó?',
            options: ['À esquerda do grupo de 2 pretas', 'À direita do grupo de 3 pretas', 'Entre as duas pretas'],
            answer: 0,
          },
        ],
      },
      {
        id: 'u1l3',
        title: 'Ré e Mi',
        summary: 'As notas em volta do grupo de 2 teclas pretas.',
        activities: [
          {
            type: 'info',
            text: 'Seguindo para a direita depois do Dó vêm **Ré** e **Mi**:\n\n• **Ré** fica **entre** as duas teclas pretas.\n• **Mi** fica **à direita** do grupo de 2.\n\nDó, Ré e Mi "abraçam" o grupo de 2 teclas pretas.',
            keys: { lo: 48, hi: 71, highlight: [60, 62, 64], labels: { 60: 'Dó', 62: 'Ré', 64: 'Mi' }, color: '#22c55e' },
          },
          {
            type: 'quiz',
            question: 'Qual nota fica ENTRE as duas teclas pretas?',
            options: ['Dó', 'Ré', 'Mi'],
            answer: 1,
          },
          { type: 'find', targets: WHITE.slice(0, 3), count: 6 },
        ],
      },
      {
        id: 'u1l4',
        title: 'Fá, Sol, Lá e Si',
        summary: 'As notas em volta do grupo de 3 teclas pretas.',
        activities: [
          {
            type: 'info',
            text: 'Agora o grupo de 3 teclas pretas:\n\n• **Fá** fica **à esquerda** do grupo de 3.\n• **Sol** e **Lá** ficam **entre** as pretas.\n• **Si** fica **à direita** do grupo.\n\nDepois do Si vem um novo Dó, e tudo recomeça: **Dó Ré Mi Fá Sol Lá Si**.',
            keys: {
              lo: 60,
              hi: 83,
              highlight: [65, 67, 69, 71],
              labels: { 60: 'Dó', 62: 'Ré', 64: 'Mi', 65: 'Fá', 67: 'Sol', 69: 'Lá', 71: 'Si', 72: 'Dó' },
              color: '#22c55e',
            },
          },
          { type: 'find', targets: WHITE.slice(3), count: 6 },
          { type: 'quiz', question: 'Qual nota vem depois do Si?', options: ['Lá', 'Dó', 'Ré'], answer: 1 },
          { type: 'find', prompt: 'Revisão: todas as notas', targets: WHITE, count: 8 },
        ],
      },
      {
        id: 'u1l5',
        title: 'Postura e posição de Dó',
        summary: 'Números dos dedos e sua primeira posição.',
        activities: [
          {
            type: 'info',
            title: 'Postura',
            text: '• Sente-se de frente para o Dó central, com os **cotovelos na altura do teclado**.\n• Os dedos ficam **curvados**, como se segurassem uma bolinha.\n• Punhos retos, ombros relaxados. Toque com a ponta dos dedos.',
          },
          {
            type: 'info',
            title: 'Números dos dedos',
            text: 'Nas partituras para piano, os dedos são numerados — igual nas duas mãos:\n\n**1** polegar · **2** indicador · **3** médio · **4** anelar · **5** mínimo',
          },
          { type: 'quiz', question: 'Qual número é o polegar?', options: ['1', '3', '5'], answer: 0 },
          { type: 'quiz', question: 'Na mão ESQUERDA, o dedo mínimo é o…', options: ['1', '5'], answer: 1, explain: 'A numeração é igual nas duas mãos: polegar = 1, mínimo = 5.' },
          {
            type: 'info',
            title: 'Posição de Dó (mão direita)',
            text: 'Coloque o **polegar (1) no Dó central** e um dedo em cada tecla branca: 1-Dó, 2-Ré, 3-Mi, 4-Fá, 5-Sol.\n\nEssa é a **posição de Dó**. Muitas músicas iniciais usam só essas cinco notas!',
            keys: { lo: 55, hi: 72, highlight: [60, 62, 64, 65, 67], labels: C_POS_RH, color: '#3b82f6' },
          },
          {
            type: 'play',
            intro: 'Suba e desça devagar. A tecla certa aparece destacada no teclado, com o número do dedo.',
            spec: { rh: 'C4q@1 D4@2 E4@3 F4@4 | G4@5 F4@4 E4@3 D4@2 | C4w@1', tempo: 70 },
          },
        ],
      },
    ],
  },
  {
    id: 'u2',
    title: 'Ritmo e pulsação',
    description: 'Semínima, mínima, semibreve, pausas e compassos.',
    color: '#db2777',
    lessons: [
      {
        id: 'u2l1',
        title: 'Pulsação e semínima',
        summary: 'O "coração" da música.',
        activities: [
          {
            type: 'info',
            text: 'Toda música tem uma **pulsação** constante, como as batidas do coração. Cada batida é um **tempo**.\n\nA **semínima** (cabeça preta com haste) dura **1 tempo**.',
            staff: { rh: 'B4q B4 B4 B4 | B4 B4 B4 B4' },
          },
          {
            type: 'rhythm',
            intro: 'Escute a contagem (1 compasso) e depois bata junto com o metrônomo: toque na área, aperte espaço ou toque qualquer tecla do piano.',
            pattern: 'B4q B4 B4 B4 | B4 B4 B4 B4',
            tempo: 72,
          },
        ],
      },
      {
        id: 'u2l2',
        title: 'Mínima e semibreve',
        summary: 'Notas que duram 2 e 4 tempos.',
        activities: [
          {
            type: 'info',
            text: '• **Mínima**: cabeça **vazia** com haste — dura **2 tempos**.\n• **Semibreve**: cabeça vazia **sem** haste — dura **4 tempos**.\n\nAo tocar uma nota longa, **segure a tecla** enquanto conta os tempos.',
            staff: { rh: 'B4h B4 | B4w' },
          },
          { type: 'quiz', question: 'Quantos tempos dura uma mínima?', options: ['1', '2', '4'], answer: 1 },
          { type: 'quiz', question: 'E a semibreve?', options: ['2', '3', '4'], answer: 2 },
          { type: 'rhythm', pattern: 'B4h B4 | B4q B4 B4h | B4w | B4q B4 B4 B4', tempo: 72 },
        ],
      },
      {
        id: 'u2l3',
        title: 'Compasso 4/4',
        summary: 'Barras de compasso e a fórmula de compasso.',
        activities: [
          {
            type: 'info',
            text: 'As **barras de compasso** dividem a música em grupos iguais de tempos.\n\nA **fórmula de compasso 4/4** (no início da pauta) diz: **4 tempos por compasso**, e cada tempo vale uma semínima. Conte sempre "**1 2 3 4**".',
            staff: { rh: 'B4q B4 B4h | B4h B4q B4 | B4w' },
          },
          {
            type: 'quiz',
            question: 'Num compasso 4/4 com uma mínima e uma semínima, o que falta?',
            options: ['Uma semínima', 'Uma mínima', 'Uma semibreve'],
            answer: 0,
            explain: '2 + 1 = 3 tempos; falta 1 tempo = uma semínima.',
            staff: { rh: 'B4h B4q rq' },
          },
          { type: 'rhythm', pattern: 'B4q B4 B4h | B4h B4q B4 | B4q B4 B4 B4 | B4w', tempo: 76 },
        ],
      },
      {
        id: 'u2l4',
        title: 'Pausas',
        summary: 'O silêncio também tem duração.',
        activities: [
          {
            type: 'info',
            text: 'A **pausa** é um silêncio medido. Cada figura tem a sua:\n\n• pausa de **semínima** = 1 tempo\n• pausa de **mínima** = 2 tempos (um "chapéu" em cima da linha)\n• pausa de **semibreve** = 4 tempos (pendurada na linha)\n\nNas pausas, **solte a tecla e continue contando**.',
            staff: { rh: 'B4q rq B4 rq | B4h rh | rw' },
          },
          { type: 'quiz', question: 'Durante uma pausa você…', options: ['para de contar', 'continua contando em silêncio', 'segura a nota anterior'], answer: 1 },
          { type: 'rhythm', pattern: 'B4q rq B4 rq | B4h B4q rq | B4q B4 B4h | rh B4h', tempo: 72 },
        ],
      },
      {
        id: 'u2l5',
        title: 'Compasso 3/4 e o ponto',
        summary: 'Valsa e a mínima pontuada.',
        activities: [
          {
            type: 'info',
            text: 'No **3/4** cada compasso tem **3 tempos** (como numa valsa: **1**-2-3, **1**-2-3).\n\nO **ponto** depois de uma nota aumenta **metade** do valor dela. A **mínima pontuada** vale 2 + 1 = **3 tempos** — enche um compasso de 3/4.',
            staff: { rh: 'B4q B4 B4 | B4h B4q | B4h.', time: '3/4' },
          },
          { type: 'quiz', question: 'Quanto vale uma mínima pontuada?', options: ['2 tempos', '3 tempos', '4 tempos'], answer: 1 },
          { type: 'rhythm', pattern: 'B4q B4 B4 | B4h B4q | B4h. | B4q B4h | B4h.', tempo: 84, time: '3/4' },
        ],
      },
    ],
  },
  {
    id: 'u3',
    title: 'A pauta e a clave de Sol',
    description: 'Leia as notas da mão direita usando notas-guia e intervalos.',
    color: '#16a34a',
    lessons: [
      {
        id: 'u3l1',
        title: 'A pauta',
        summary: 'Cinco linhas, quatro espaços.',
        activities: [
          {
            type: 'info',
            text: 'As notas são escritas na **pauta**: **5 linhas** e **4 espaços**, contados **de baixo para cima**.\n\nQuanto mais **alta** a nota na pauta, mais **aguda** (mais para a direita no teclado). Notas podem ficar nas linhas ou nos espaços.',
            staff: { rh: 'E4q F4 G4 A4 | B4 C5 D5 E5 | F5w' },
          },
          { type: 'quiz', question: 'Quantas linhas tem a pauta?', options: ['4', '5', '6'], answer: 1 },
          {
            type: 'quiz',
            question: 'A segunda nota é mais aguda ou mais grave que a primeira?',
            options: ['Mais aguda', 'Mais grave', 'Igual'],
            answer: 1,
            staff: { rh: 'D5h G4h' },
          },
        ],
      },
      {
        id: 'u3l2',
        title: 'Clave de Sol e Dó central',
        summary: 'Suas duas primeiras notas-guia.',
        activities: [
          {
            type: 'info',
            text: 'A **clave de Sol** se enrola na **2ª linha**: a nota nessa linha é o **Sol** (Sol4).\n\nO **Dó central** fica numa pequena **linha suplementar** logo abaixo da pauta.\n\nEssas são **notas-guia**: você as reconhece de imediato e lê as outras a partir delas.',
            staff: { rh: 'C4h G4h', names: true },
            keys: { lo: 55, hi: 72, highlight: [60, 67], labels: { 60: 'Dó', 67: 'Sol' }, color: '#16a34a' },
          },
          { type: 'read', clef: 'treble', pool: ['C4', 'G4'], count: 6 },
        ],
      },
      {
        id: 'u3l3',
        title: 'Dó, Ré e Mi na pauta',
        summary: 'Linha, espaço, linha.',
        activities: [
          {
            type: 'info',
            text: 'Do Dó central para cima, as notas vizinhas alternam **linha → espaço → linha**:\n\n• **Dó**: linha suplementar\n• **Ré**: logo abaixo da 1ª linha (pendurado)\n• **Mi**: 1ª linha\n\nNota vizinha no teclado = nota vizinha na pauta.',
            staff: { rh: 'C4q D4 E4 D4 | C4w', names: true },
          },
          { type: 'read', clef: 'treble', pool: ['C4', 'D4', 'E4'], count: 8 },
          {
            type: 'play',
            intro: 'Leia e toque com a mão direita (polegar no Dó).',
            spec: { rh: 'C4q@1 D4@2 E4@3 D4@2 | C4@1 E4@3 C4h@1 | E4q@3 D4@2 C4@1 D4@2 | C4w@1', tempo: 72 },
          },
        ],
      },
      {
        id: 'u3l4',
        title: 'Fá e Sol: a posição de Dó',
        summary: 'Cinco notas, cinco dedos.',
        activities: [
          {
            type: 'info',
            text: 'Completando a posição de Dó:\n\n• **Fá**: 1º espaço\n• **Sol**: 2ª linha (a da clave!)\n\nAgora você lê Dó, Ré, Mi, Fá e Sol — uma nota para cada dedo.',
            staff: { rh: 'C4q D4 E4 F4 | G4w', names: true },
            keys: { lo: 55, hi: 72, highlight: [60, 62, 64, 65, 67], labels: C_POS_RH, color: '#3b82f6' },
          },
          { type: 'read', clef: 'treble', pool: ['C4', 'D4', 'E4', 'F4', 'G4'], count: 10 },
          { type: 'play', intro: 'O começo da Ode à Alegria!', songId: 'ode-alegria', loop: [0, 3] },
        ],
      },
      {
        id: 'u3l5',
        title: 'Passos e saltos',
        summary: 'Leia por intervalos, não nota por nota.',
        activities: [
          {
            type: 'info',
            title: 'O segredo da leitura',
            text: 'Leitores fluentes não "decifram" cada nota: eles olham a **direção** e o **tamanho** do movimento.\n\n• **Passo** (grau conjunto): linha → espaço vizinho. No teclado, a **tecla vizinha**, dedo vizinho.\n• **Salto** (terça): linha → linha ou espaço → espaço. No teclado, **pula uma tecla**.',
            staff: { rh: 'C4q D4 E4 F4 | C4 E4 G4h' },
          },
          { type: 'quiz', question: 'É um passo ou um salto?', options: ['Passo', 'Salto'], answer: 1, staff: { rh: 'E4h G4h' } },
          { type: 'quiz', question: 'E agora?', options: ['Passo', 'Salto'], answer: 0, staff: { rh: 'F4h E4h' } },
          { type: 'quiz', question: 'E agora?', options: ['Passo', 'Salto'], answer: 1, staff: { rh: 'D4h F4h' } },
          {
            type: 'play',
            intro: 'Saltos de terça: pense "pula uma tecla" a cada movimento.',
            spec: { rh: 'C4q@1 E4@3 D4@2 F4@4 | E4@3 G4@5 F4@4 D4@2 | C4@1 E4@3 G4h@5 | C4w@1', tempo: 72 },
          },
        ],
      },
      {
        id: 'u3l6',
        title: 'Primeira música',
        summary: 'Maria tinha um carneirinho.',
        activities: [
          {
            type: 'info',
            text: 'Hora da primeira música completa! Antes de tocar:\n\n1. Veja a fórmula de compasso (4/4).\n2. Encontre a primeira nota (Mi) e posicione a mão.\n3. Durante a música, **olhe para a partitura, não para as mãos**.',
          },
          { type: 'play', songId: 'maria-carneirinho' },
        ],
      },
    ],
  },
  {
    id: 'u4',
    title: 'Clave de Fá e mão esquerda',
    description: 'As notas graves e a posição de Dó para a mão esquerda.',
    color: '#ea580c',
    lessons: [
      {
        id: 'u4l1',
        title: 'A clave de Fá',
        summary: 'Os dois pontinhos marcam o Fá.',
        activities: [
          {
            type: 'info',
            text: 'A mão esquerda lê na **clave de Fá**. Os **dois pontinhos** abraçam a **4ª linha**: essa linha é o **Fá** (Fá3).\n\nNotas-guia da clave de Fá:\n• **Fá3**: 4ª linha (entre os pontos)\n• **Dó3**: 2º espaço\n• **Dó central**: linha suplementar **acima** da pauta',
            staff: { lh: 'C3q F3 C4h', names: true },
            keys: { lo: 43, hi: 62, highlight: [48, 53, 60], labels: { 48: 'Dó3', 53: 'Fá3', 60: 'Dó4' }, color: '#ea580c' },
          },
          { type: 'read', clef: 'bass', pool: ['F3', 'C3', 'C4'], count: 8 },
        ],
      },
      {
        id: 'u4l2',
        title: 'Posição de Dó (mão esquerda)',
        summary: 'Dedo 5 no Dó3.',
        activities: [
          {
            type: 'info',
            text: 'Na mão esquerda, a posição de Dó começa com o **dedo 5 (mínimo) no Dó3**, uma oitava abaixo do Dó central:\n\n5-Dó · 4-Ré · 3-Mi · 2-Fá · 1-Sol\n\nRepare: o **polegar** fica no **Sol**, perto do centro do teclado.',
            staff: { lh: 'C3q D3 E3 F3 | G3w', names: true },
            keys: { lo: 43, hi: 62, highlight: [48, 50, 52, 53, 55], labels: C_POS_LH, color: '#f97316' },
          },
          { type: 'read', clef: 'bass', pool: ['C3', 'D3', 'E3', 'F3', 'G3'], count: 10 },
          {
            type: 'play',
            intro: 'Suba e desça com a mão esquerda.',
            spec: { lh: 'C3q@5 D3@4 E3@3 F3@2 | G3@1 F3@2 E3@3 D3@4 | C3w@5', tempo: 70 },
          },
        ],
      },
      {
        id: 'u4l3',
        title: 'Música com a mão esquerda',
        summary: 'Uma melodia conhecida na clave de Fá.',
        activities: [{ type: 'play', songId: 'maria-mao-esquerda' }],
      },
    ],
  },
  {
    id: 'u5',
    title: 'Duas mãos',
    description: 'A pauta dupla e a coordenação entre as mãos.',
    color: '#7c3aed',
    lessons: [
      {
        id: 'u5l1',
        title: 'A pauta dupla',
        summary: 'Clave de Sol em cima, clave de Fá embaixo.',
        activities: [
          {
            type: 'info',
            text: 'Músicas para piano usam a **pauta dupla**, unida por uma **chave**:\n\n• Pauta de **cima** (clave de Sol) → **mão direita**\n• Pauta de **baixo** (clave de Fá) → **mão esquerda**\n\nNotas **alinhadas verticalmente** são tocadas **ao mesmo tempo**.',
            staff: { rh: 'E4q@3 F4 G4h | C4w', lh: 'C3h@5 G3 | C3w' },
          },
          {
            type: 'quiz',
            question: 'Na pauta dupla, a pauta de baixo é tocada pela…',
            options: ['Mão direita', 'Mão esquerda'],
            answer: 1,
          },
          { type: 'read', clef: 'grand', pool: ['C3', 'E3', 'G3', 'C4', 'E4', 'G4'], count: 10 },
        ],
      },
      {
        id: 'u5l2',
        title: 'Mãos alternadas',
        summary: 'Uma mão de cada vez.',
        activities: [
          {
            type: 'play',
            intro: 'As mãos se revezam: uma toca enquanto a outra descansa.',
            spec: {
              rh: 'C4q@1 E4@3 G4h@5 | R | E4q@3 D4@2 C4h@1 | R',
              lh: 'R | C3q@5 E3@3 G3h@1 | R | G3q@1 F3@2 E3h@3',
              tempo: 72,
            },
            hands: 'RL',
          },
        ],
      },
      {
        id: 'u5l3',
        title: 'Juntas pela primeira vez',
        summary: 'Notas longas na esquerda, melodia na direita.',
        activities: [
          {
            type: 'info',
            text: 'Dica de ouro: **pratique primeiro cada mão sozinha**, depois junte **bem devagar**.\n\nAqui a mão esquerda só toca notas longas — toque a nota da esquerda **junto** com a primeira nota da direita no compasso e segure.',
          },
          { type: 'play', songId: 'ode-alegria-maos', loop: [0, 3] },
          { type: 'play', songId: 'ode-alegria-maos' },
        ],
      },
      {
        id: 'u5l4',
        title: 'Brilha, brilha (duas mãos)',
        summary: 'Acompanhamento com Dó, Fá e Sol.',
        activities: [{ type: 'play', songId: 'brilha-maos' }],
      },
    ],
  },
  {
    id: 'u6',
    title: 'Colcheias e ponto',
    description: 'Notas de meio tempo e ritmos pontuados.',
    color: '#0d9488',
    lessons: [
      {
        id: 'u6l1',
        title: 'Colcheias',
        summary: 'Dois sons em um tempo.',
        activities: [
          {
            type: 'info',
            text: 'A **colcheia** dura **meio tempo**. Duas colcheias unidas por uma **barra** = 1 tempo.\n\nConte assim: "**1 e 2 e 3 e 4 e**" — as colcheias caem no número e no "e".',
            staff: { rh: 'B4q B4 B4e B4 B4q | B4e B4 B4 B4 B4h' },
          },
          { type: 'rhythm', pattern: 'B4q B4 B4e B4 B4q | B4e B4 B4 B4 B4h | B4q B4e B4 B4q B4 | B4w', tempo: 70 },
          { type: 'play', songId: 'paozinho-quente' },
        ],
      },
      {
        id: 'u6l2',
        title: 'Semínima pontuada',
        summary: 'Um tempo e meio.',
        activities: [
          {
            type: 'info',
            text: 'A **semínima pontuada** vale 1 + ½ = **1 tempo e meio**. Quase sempre vem seguida de uma **colcheia**, completando 2 tempos: "**1 - e 2**".',
            staff: { rh: 'B4q. B4e B4q B4 | B4q. B4e B4h' },
          },
          { type: 'rhythm', pattern: 'B4q. B4e B4q B4 | B4q. B4e B4h | B4q B4 B4q. B4e | B4w', tempo: 72 },
          { type: 'play', songId: 'ponte-londres' },
        ],
      },
      {
        id: 'u6l3',
        title: 'Irmão Jacó',
        summary: 'Colcheias numa canção conhecida.',
        activities: [{ type: 'play', songId: 'irmao-jaco' }],
      },
      {
        id: 'u6l4',
        title: 'Jingle Bells',
        summary: 'Notas repetidas e ritmo pontuado.',
        activities: [{ type: 'play', songId: 'jingle-bells' }],
      },
    ],
  },
  {
    id: 'u7',
    title: 'Sustenidos, bemóis e armaduras',
    description: 'As teclas pretas na partitura e novas posições.',
    color: '#dc2626',
    lessons: [
      {
        id: 'u7l1',
        title: 'Sustenido, bemol e bequadro',
        summary: 'Meio tom acima, meio tom abaixo.',
        activities: [
          {
            type: 'info',
            text: '• **Sustenido (♯)**: sobe **meio tom** → a tecla imediatamente à **direita** (quase sempre preta).\n• **Bemol (♭)**: desce **meio tom** → a tecla imediatamente à **esquerda**.\n• **Bequadro (♮)**: cancela o acidente.\n\nUm acidente vale **até o fim do compasso**.',
            staff: { rh: 'F4q F#4 G4 Bb4 | B4 Bb4 A4h' },
            keys: { lo: 60, hi: 76, highlight: [66, 70], labels: { 66: 'Fá♯', 70: 'Si♭' }, color: '#dc2626' },
          },
          { type: 'find', prompt: 'Toque um Fá♯ (Fá sustenido)', targets: [{ pc: 6, label: 'Fá♯' }], count: 3 },
          { type: 'find', prompt: 'Toque um Si♭ (Si bemol)', targets: [{ pc: 10, label: 'Si♭' }], count: 3 },
          { type: 'read', clef: 'treble', pool: ['F#4', 'Bb4', 'C#4', 'Eb4', 'G#4'], count: 6, answer: 'play' },
        ],
      },
      {
        id: 'u7l2',
        title: 'Posição de Sol',
        summary: 'Polegar no Sol e o Fá♯.',
        activities: [
          {
            type: 'info',
            text: 'Na **posição de Sol** (mão direita), o polegar vai no **Sol4**: 1-Sol, 2-Lá, 3-Si, 4-Dó, 5-Ré.\n\nNa tonalidade de **Sol maior**, todo **Fá é sustenido**. Em vez de escrever ♯ toda vez, ele aparece uma vez no início da linha: é a **armadura de clave**.',
            staff: { rh: 'G4q A4 B4 C5 | D5w', key: 1, names: true },
            keys: { lo: 64, hi: 79, highlight: [67, 69, 71, 72, 74], labels: G_POS_RH, color: '#3b82f6' },
          },
          { type: 'read', clef: 'treble', pool: ['G4', 'A4', 'B4', 'C5', 'D5'], count: 10 },
          {
            type: 'play',
            spec: { rh: 'G4q@1 A4@2 B4@3 C5@4 | D5@5 C5@4 B4@3 A4@2 | G4@1 B4@3 D5h@5 | G4w@1', key: 1, tempo: 76 },
          },
        ],
      },
      {
        id: 'u7l3',
        title: 'Armadura de clave',
        summary: 'Acidentes que valem para a música toda.',
        activities: [
          {
            type: 'info',
            text: 'A **armadura** fica logo depois da clave e vale para **todas** as notas com aquele nome, em **qualquer oitava**, na música inteira.\n\nAqui a armadura tem **Fá♯ e Dó♯**: é **Ré maior**.',
            staff: { rh: 'D5q C#5 B4 A4 | F#4w', key: 2 },
          },
          {
            type: 'quiz',
            question: 'Com esta armadura (um ♯ no Fá), qual nota você toca?',
            options: ['Fá', 'Fá♯', 'Sol'],
            answer: 1,
            staff: { rh: 'F4w', key: 1 },
          },
          { type: 'play', songId: 'canone-re', loop: [0, 3] },
        ],
      },
    ],
  },
  {
    id: 'u8',
    title: 'Acordes',
    description: 'Tríades e acompanhamento.',
    color: '#2563eb',
    lessons: [
      {
        id: 'u8l1',
        title: 'Tríades',
        summary: 'Três notas ao mesmo tempo.',
        activities: [
          {
            type: 'info',
            text: 'Um **acorde** são três ou mais notas tocadas juntas. A **tríade** empilha notas **pulando uma tecla** entre elas: **Dó - Mi - Sol** é a tríade de Dó.\n\nNa pauta, ela parece um "boneco de neve": linha-linha-linha ou espaço-espaço-espaço.',
            staff: { rh: '(C4 E4 G4)h (F4 A4 C5)h | (G4 B4 D5)w' },
            keys: { lo: 55, hi: 72, highlight: [60, 64, 67], labels: { 60: '1', 64: '3', 67: '5' }, color: '#2563eb' },
          },
          {
            type: 'play',
            intro: 'Toque as três notas juntas (dedos 1, 3 e 5).',
            spec: { rh: '(C4@1 E4@3 G4@5)w | (C4 E4 G4)h (C4 E4 G4)h | (C4 E4 G4)q (C4 E4 G4) (C4 E4 G4) (C4 E4 G4) | (C4 E4 G4)w', tempo: 66 },
          },
        ],
      },
      {
        id: 'u8l2',
        title: 'Dó, Fá e Sol',
        summary: 'Os três acordes principais.',
        activities: [
          {
            type: 'info',
            text: 'Os acordes mais usados em **Dó maior** são os de **Dó (I)**, **Fá (IV)** e **Sol (V)**. Na mão esquerda, dá para tocá-los quase sem mexer a mão:\n\n• Dó: Dó-Mi-Sol\n• Fá: Dó-Fá-Lá\n• Sol: Si-Fá-Sol (Sol com sétima)',
            staff: { lh: '(C3 E3 G3)w | (C3 F3 A3)w | (B2 F3 G3)w | (C3 E3 G3)w' },
          },
          {
            type: 'play',
            spec: { lh: '(C3@5 E3@3 G3@1)w | (C3@5 F3@2 A3@1)w | (B2@5 F3@2 G3@1)w | (C3@5 E3@3 G3@1)w', tempo: 66 },
          },
        ],
      },
      {
        id: 'u8l3',
        title: 'Melodia com acordes',
        summary: 'Ode à Alegria com acompanhamento.',
        activities: [
          {
            type: 'play',
            intro: 'Melodia na direita, acordes na esquerda.',
            spec: {
              rh: 'E4q@3 E4 F4@4 G4@5 | G4@5 F4@4 E4@3 D4@2 | C4@1 C4 D4@2 E4@3 | E4q.@3 D4e@2 D4h',
              lh: '(C3@5 E3@3 G3@1)w | (B2@5 F3@2 G3@1)w | (C3@5 E3@3 G3@1)w | (B2@5 F3@2 G3@1)w',
              tempo: 80,
            },
          },
        ],
      },
    ],
  },
  {
    id: 'u9',
    title: 'Expandindo a leitura',
    description: 'Novas notas-guia, leitura à primeira vista e repertório.',
    color: '#0f766e',
    lessons: [
      {
        id: 'u9l1',
        title: 'Notas-guia agudas e graves',
        summary: 'Dó5, Sol5, Sol2 e Dó2.',
        activities: [
          {
            type: 'info',
            text: 'Mais notas-guia para ler rápido:\n\n• Clave de Sol: **Dó5** (3º espaço) e **Sol5** (acima da 5ª linha)\n• Clave de Fá: **Sol2** (1ª linha) e **Dó2** (duas linhas suplementares abaixo)\n\nDe cada nota-guia, conte passos e saltos até a nota que você procura.',
            staff: { rh: 'C5h G5h', lh: 'G2h C2h', names: true },
          },
          { type: 'read', clef: 'treble', pool: ['A4', 'B4', 'C5', 'D5', 'E5', 'F5', 'G5'], count: 10 },
          { type: 'read', clef: 'bass', pool: ['G2', 'A2', 'B2', 'C3', 'D3', 'E3', 'F3'], count: 10 },
        ],
      },
      {
        id: 'u9l2',
        title: 'Leitura à primeira vista',
        summary: 'Tocar algo que você nunca viu.',
        activities: [
          {
            type: 'info',
            text: 'Antes de tocar uma partitura nova, faça um "raio-x" de 30 segundos:\n\n1. **Clave, armadura e compasso**.\n2. Qual é a **primeira nota** e a **posição da mão**?\n3. Procure **padrões**: repetições, escalas, saltos.\n\nDurante a leitura: **não pare** para corrigir e **olhe um pouco à frente**.',
          },
          { type: 'sight', level: 1, intro: 'Um exercício novo, gerado só para você.' },
          { type: 'sight', level: 2 },
        ],
      },
      {
        id: 'u9l3',
        title: 'Minueto em Sol',
        summary: 'Uma peça clássica de verdade.',
        activities: [
          { type: 'play', songId: 'minueto-sol', loop: [0, 3], hands: 'R' },
          { type: 'play', songId: 'minueto-sol', loop: [0, 3] },
          { type: 'play', songId: 'minueto-sol', loop: [0, 7] },
        ],
      },
    ],
  },
];

export function allLessons(): { unit: Unit; lesson: Lesson; index: number }[] {
  const out: { unit: Unit; lesson: Lesson; index: number }[] = [];
  let i = 0;
  for (const u of CURRICULUM) for (const l of u.lessons) out.push({ unit: u, lesson: l, index: i++ });
  return out;
}

export function findLesson(id: string) {
  return allLessons().find((x) => x.lesson.id === id);
}

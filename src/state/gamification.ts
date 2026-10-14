/**
 * Gamificação (níveis, meta diária, missões do dia, proteção de sequência, meta do grupo).
 *
 * Desenhada a partir da Teoria da Autodeterminação (competência, autonomia, vínculo) e de
 * pesquisas sobre metas próximas (Bandura & Schunk, 1981) e gamificação na educação
 * (Sailer & Homner, 2020): as recompensas reforçam a prática de qualidade (revisão,
 * leitura, trechos difíceis), a competição é semanal e recomeça para todos, e existe uma
 * meta colaborativa para o grupo de amigos.
 */
import { addEvent, addXp, bumpDay, dayCount, progress, setFlag, today, weekKey, weekStats, type Progress } from './progress';
import { settings } from './settings';
import { allLessons } from '../data/curriculum';
import type { SocialState } from '../lib/social';

// ---------- níveis ----------
export interface LevelInfo {
  level: number;
  title: string;
  /** XP dentro do nível atual e XP necessário para o próximo */
  into: number;
  need: number;
  pct: number;
}

const TITLES: [number, string][] = [
  [1, 'Iniciante'],
  [3, 'Aprendiz'],
  [5, 'Leitor(a) de pauta'],
  [8, 'Pianista'],
  [12, 'Intérprete'],
  [16, 'Virtuose'],
];

export function levelTitle(level: number): string {
  let t = TITLES[0][1];
  for (const [l, name] of TITLES) if (level >= l) t = name;
  return t;
}

/** Cada nível pede 50 XP a mais que o anterior (50, 100, 150…). */
export function levelFor(xp: number): LevelInfo {
  let level = 1;
  let start = 0;
  while (xp >= start + 50 * level) {
    start += 50 * level;
    level++;
  }
  const need = 50 * level;
  const into = xp - start;
  return { level, title: levelTitle(level), into, need, pct: into / need };
}

// ---------- comemorações ----------
export interface Celebration {
  kind: 'level' | 'quest' | 'chest' | 'goal';
  icon: string;
  title: string;
  desc: string;
  confetti?: boolean;
}
const celebrateListeners = new Set<(c: Celebration) => void>();
export function onCelebrate(fn: (c: Celebration) => void): () => void {
  celebrateListeners.add(fn);
  return () => celebrateListeners.delete(fn);
}
function celebrate(c: Celebration) {
  celebrateListeners.forEach((fn) => fn(c));
}

// ---------- missões do dia ----------
export type QuestGroup = 'review' | 'learn' | 'extra';

export interface QuestDef {
  id: string;
  icon: string;
  title: string;
  /** por que essa missão ajuda (aparece como dica) */
  why: string;
  target: number;
  group: QuestGroup;
  metric: (p: Progress) => number;
  href: (p: Progress) => string;
  needsFriends?: boolean;
}

export const QUEST_XP = 10;
export const CHEST_XP = 20;
export const MAX_FREEZES = 2;

const minutesOf = (p: Progress) => Math.floor((p.practice[today()] ?? 0) / 60);

function nextLessonHref(p: Progress): string {
  const n = allLessons().find((x) => !((p.lessons[x.lesson.id]?.stars ?? 0) > 0));
  return n ? `/licao/${n.lesson.id}` : '/trilha';
}

export const QUESTS: QuestDef[] = [
  {
    id: 'review',
    icon: '🧠',
    title: 'Fazer a revisão do dia',
    why: 'Relembrar em dias espaçados fixa muito mais do que repetir tudo de uma vez.',
    target: 1,
    group: 'review',
    metric: (p) => dayCount(p, 'reviews'),
    href: () => '/treino/revisao',
  },
  {
    id: 'notes',
    icon: '👀',
    title: 'Acertar 20 notas no treino de leitura',
    why: 'Ler rápido as notas libera a atenção para o ritmo e a música.',
    target: 20,
    group: 'review',
    metric: (p) => dayCount(p, 'notes'),
    href: () => '/treino/leitura',
  },
  {
    id: 'echo',
    icon: '👂',
    title: 'Tocar 3 melodias de ouvido',
    why: 'Ouvir antes de ler (som antes do símbolo) fortalece a leitura.',
    target: 3,
    group: 'review',
    metric: (p) => dayCount(p, 'echo'),
    href: () => '/treino/ouvido',
  },
  {
    id: 'lesson',
    icon: '📘',
    title: 'Concluir uma lição da trilha',
    why: 'Um passo novo por dia mantém o progresso constante.',
    target: 1,
    group: 'learn',
    metric: (p) => dayCount(p, 'lessons'),
    href: nextLessonHref,
  },
  {
    id: 'sight',
    icon: '✨',
    title: 'Ler uma melodia à primeira vista',
    why: 'Ler material novo todos os dias é o que mais desenvolve a leitura.',
    target: 1,
    group: 'learn',
    metric: (p) => dayCount(p, 'sight'),
    href: () => '/treino/leitura-primeira-vista',
  },
  {
    id: 'song',
    icon: '🎵',
    title: 'Tocar uma música ou trecho com 80% ou mais',
    why: 'Aplicar o que aprendeu em música de verdade dá sentido ao estudo.',
    target: 1,
    group: 'learn',
    metric: (p) => dayCount(p, 'songs80'),
    href: () => '/musicas',
  },
  {
    id: 'focus',
    icon: '🎯',
    title: 'Firmar um trecho difícil (3 rodadas seguidas sem erro)',
    why: 'Os melhores pianistas param no erro, isolam o trecho e repetem até ficar estável.',
    target: 1,
    group: 'extra',
    metric: (p) => dayCount(p, 'focus'),
    href: () => '/musicas',
  },
  {
    id: 'rhythm',
    icon: '🥁',
    title: 'Fazer um treino de ritmo',
    why: 'Ritmo firme é o que faz a música soar como música.',
    target: 1,
    group: 'extra',
    metric: (p) => dayCount(p, 'rhythm'),
    href: () => '/treino/ritmo',
  },
  {
    id: 'minutes',
    icon: '⏱️',
    title: 'Praticar 10 minutos',
    why: 'Pouco todo dia vale mais do que muito de vez em quando.',
    target: 10,
    group: 'extra',
    metric: minutesOf,
    href: () => '/',
  },
  {
    id: 'social',
    icon: '💬',
    title: 'Mandar um aplauso ou mensagem a um amigo',
    why: 'Estudar acompanhado ajuda a manter o hábito.',
    target: 1,
    group: 'extra',
    metric: (p) => dayCount(p, 'social'),
    href: () => '/amigos?aba=conversas',
    needsFriends: true,
  },
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Sorteia (de forma estável no dia) uma missão de cada grupo: revisar, aprender, extra. */
export function pickQuests(day: string, friends: number, p: Progress): string[] {
  const out: string[] = [];
  const allDone = allLessons().every((x) => (p.lessons[x.lesson.id]?.stars ?? 0) > 0);
  (['review', 'learn', 'extra'] as QuestGroup[]).forEach((g, i) => {
    const opts = QUESTS.filter((q) => q.group === g && (!q.needsFriends || friends > 0) && !(q.id === 'lesson' && allDone));
    out.push(opts[hash(day + ':' + i) % opts.length].id);
  });
  return out;
}

let friendsCount = 0;

function ensureQuests() {
  const d = today();
  const p = progress.get();
  if (p.quests?.d === d && p.quests.ids.length) return;
  progress.set((cur) => ({ ...cur, quests: { d, ids: pickQuests(d, friendsCount, cur), done: [] }, updatedAt: Date.now() }));
}

export interface QuestStatus {
  def: QuestDef;
  value: number;
  done: boolean;
}

export function todaysQuests(p: Progress): QuestStatus[] {
  const d = today();
  const ids = p.quests?.d === d ? p.quests.ids : pickQuests(d, friendsCount, p);
  const done = p.quests?.d === d ? p.quests.done : [];
  return ids
    .map((id) => QUESTS.find((q) => q.id === id))
    .filter((q): q is QuestDef => !!q)
    .map((def) => ({ def, value: Math.min(def.target, def.metric(p)), done: done.includes(def.id) }));
}

// ---------- meta diária (minutos) ----------
export function dailyGoal(p: Progress): { minutes: number; goal: number; pct: number; done: boolean } {
  const goal = Math.max(1, settings.get().dailyGoalMin);
  const minutes = minutesOf(p);
  return { minutes, goal, pct: Math.min(1, minutes / goal), done: minutes >= goal };
}

// ---------- meta do grupo (semana) ----------
export const GROUP_MIN_PER_PERSON = 60;

export function groupWeek(p: Progress, soc: Pick<SocialState, 'friendIds' | 'friends'>): { minutes: number; target: number; done: boolean; members: number } {
  const wk = weekKey();
  let minutes = weekStats(p).minutes;
  let members = 1;
  for (const id of soc.friendIds) {
    const f = soc.friends[id];
    if (!f) continue;
    members++;
    if (f.week === wk) minutes += f.weekMinutes;
  }
  const target = GROUP_MIN_PER_PERSON * members;
  return { minutes, target, done: members > 1 && minutes >= target, members };
}

// ---------- verificação contínua ----------
let lastLevel = 0;
let lastXp = 0;
let scheduled = false;
let started = false;

function check() {
  ensureQuests();
  let p = progress.get();
  // nível
  const lv = levelFor(p.xp);
  // saltos grandes de XP vêm da sincronização com a nuvem: não comemora
  if (lastLevel && lv.level > lastLevel && p.xp - lastXp < 150) {
    celebrate({ kind: 'level', icon: '🎉', title: `Nível ${lv.level}!`, desc: `Agora você é ${lv.title}.`, confetti: true });
    addEvent({ k: 'level', t: `Chegou ao nível ${lv.level} (${lv.title})` });
  }
  lastLevel = lv.level;
  lastXp = p.xp;
  // meta diária
  p = progress.get();
  const g = dailyGoal(p);
  if (g.done && dayCount(p, 'goalHit') === 0) {
    bumpDay('goalHit');
    celebrate({ kind: 'goal', icon: '✅', title: 'Meta do dia cumprida!', desc: `${g.goal} minutos de prática hoje. Até amanhã!`, confetti: true });
  }
  // missões
  p = progress.get();
  const qs = todaysQuests(p);
  const fresh = qs.filter((q) => !q.done && q.value >= q.def.target);
  if (fresh.length) {
    progress.set((cur) => (cur.quests ? { ...cur, quests: { ...cur.quests, done: [...cur.quests.done, ...fresh.map((q) => q.def.id)] }, updatedAt: Date.now() } : cur));
    fresh.forEach((q) => celebrate({ kind: 'quest', icon: q.def.icon, title: 'Missão cumprida!', desc: `${q.def.title} · +${QUEST_XP} XP` }));
    addXp(QUEST_XP * fresh.length);
  }
  p = progress.get();
  if (p.quests?.d === today() && p.quests.ids.length && p.quests.ids.every((id) => p.quests!.done.includes(id)) && !p.quests.chest) {
    const gotFreeze = (p.freezes ?? 0) < MAX_FREEZES;
    progress.set((cur) => ({
      ...cur,
      quests: { ...cur.quests!, chest: true },
      questDays: (cur.questDays ?? 0) + 1,
      freezes: Math.min(MAX_FREEZES, (cur.freezes ?? 0) + 1),
      updatedAt: Date.now(),
    }));
    addXp(CHEST_XP);
    addEvent({ k: 'quest', t: 'Cumpriu todas as missões do dia' });
    celebrate({
      kind: 'chest',
      icon: '🎁',
      title: 'Todas as missões do dia!',
      desc: gotFreeze ? `+${CHEST_XP} XP e uma proteção de sequência 🧊 (cobre um dia sem prática).` : `+${CHEST_XP} XP. Suas proteções de sequência já estão no máximo.`,
      confetti: true,
    });
  }
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    check();
  });
}

/** Liga a verificação de missões/níveis/metas. Chame uma vez ao iniciar o app. */
export function startGamification(soc?: { subscribe(fn: () => void): () => void; get(): SocialState }) {
  if (started) return;
  started = true;
  lastLevel = levelFor(progress.get().xp).level;
  lastXp = progress.get().xp;
  progress.subscribe(schedule);
  settings.subscribe(schedule);
  if (soc) {
    const onSoc = () => {
      const st = soc.get();
      friendsCount = st.friendIds.length;
      if (groupWeek(progress.get(), st).done) setFlag('group');
    };
    soc.subscribe(onSoc);
    onSoc();
  }
  // virou o dia com o app aberto
  setInterval(schedule, 60_000);
  schedule();
}

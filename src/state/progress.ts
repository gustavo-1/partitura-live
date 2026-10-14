import { createStore } from '../lib/store';
import { ACHIEVEMENTS } from '../data/achievements';
import { findLesson } from '../data/curriculum';

export interface LessonProgress {
  stars: number; // 0..3
  best: number; // 0..1
  attempts: number;
  completedAt?: number;
}

export interface SongProgress {
  best: number; // melhor precisão 0..1 (mãos juntas, tempo normal)
  plays: number;
  lastPlayed: number;
  /** etapas do plano de estudo concluídas: chave -> melhor precisão */
  steps: Record<string, number>;
  bestTempo?: number; // % do andamento original alcançado
}

export interface NoteStat {
  seen: number;
  correct: number;
  ms: number; // tempo médio de resposta
  box: number; // caixa de Leitner (0..4)
  last: number;
}

/** Acontecimento recente (aparece no seu perfil e no feed dos amigos). */
export interface ProgressEvent {
  k: 'lesson' | 'song' | 'badge' | 'streak' | 'friend' | 'level' | 'quest';
  t: string;
  at: number;
  ref?: string;
}

export interface Progress {
  lessons: Record<string, LessonProgress>;
  songs: Record<string, SongProgress>;
  /** título das músicas praticadas (para o perfil público) */
  songTitles?: Record<string, string>;
  noteStats: Record<string, NoteStat>; // "treble:60"
  practice: Record<string, number>; // "2026-10-14" -> segundos
  xp: number;
  xpDays?: Record<string, number>; // "2026-10-14" -> XP ganho no dia
  streak: { current: number; best: number; lastDay: string };
  events?: ProgressEvent[];
  badges?: Record<string, number>; // conquista -> quando foi obtida
  flags?: Record<string, boolean>;
  /** contadores do dia (para as missões diárias) */
  day?: { d: string; c: Record<string, number> };
  /** missões do dia: quais foram sorteadas e quais já foram cumpridas */
  quests?: { d: string; ids: string[]; done: string[]; chest?: boolean };
  /** dias em que cumpriu todas as missões */
  questDays?: number;
  /** totais acumulados dos contadores do dia (revisões, ouvido, trechos firmados…) */
  totals?: Record<string, number>;
  /** proteções de sequência guardadas (cobrem um dia sem prática cada) */
  freezes?: number;
  updatedAt: number;
}

export const emptyProgress: Progress = {
  lessons: {},
  songs: {},
  songTitles: {},
  noteStats: {},
  practice: {},
  xp: 0,
  xpDays: {},
  streak: { current: 0, best: 0, lastDay: '' },
  events: [],
  badges: {},
  flags: {},
  freezes: 0,
  updatedAt: 0,
};

export const progress = createStore<Progress>('pl.progress', emptyProgress);

export function today(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function daysBetween(a: string, b: string): number {
  const da = new Date(a + 'T12:00:00');
  const db = new Date(b + 'T12:00:00');
  return Math.round((db.getTime() - da.getTime()) / 86400000);
}

/** Registra tempo de prática e atualiza a sequência de dias. */
export function logPractice(seconds: number) {
  if (seconds <= 0) return;
  const d = today();
  progress.set((p) => {
    const practice = { ...p.practice, [d]: (p.practice[d] ?? 0) + seconds };
    let { current, best, lastDay } = p.streak;
    let events = p.events ?? [];
    let freezes = p.freezes ?? 0;
    if (lastDay !== d) {
      const gap = lastDay ? daysBetween(lastDay, d) : 999;
      const missed = gap - 1;
      if (gap === 1) current += 1;
      else if (lastDay && missed > 0 && missed <= freezes) {
        // a proteção cobre os dias perdidos e a sequência continua
        freezes -= missed;
        current += 1;
        events = pushEvent(events, { k: 'streak', t: `Usou ${missed === 1 ? 'uma proteção' : `${missed} proteções`} de sequência 🧊`, at: Date.now() });
      } else current = 1;
      best = Math.max(best, current);
      lastDay = d;
      if ([3, 7, 14, 30, 50, 100, 200, 365].includes(current)) events = pushEvent(events, { k: 'streak', t: `Chegou a ${current} dias seguidos de prática`, at: Date.now() });
    }
    return { ...p, practice, events, freezes, streak: { current, best, lastDay }, updatedAt: Date.now() };
  });
  checkBadges();
}

/** Sequência que vale agora: praticou hoje/ontem, ou as proteções cobrem os dias perdidos. */
export function streakNow(p: { streak: { current: number; lastDay: string }; freezes?: number }, d = today()): { days: number; protectedDays: number; doneToday: boolean } {
  const { current, lastDay } = p.streak;
  if (!lastDay) return { days: 0, protectedDays: 0, doneToday: false };
  const gap = daysBetween(lastDay, d);
  if (gap <= 0) return { days: current, protectedDays: 0, doneToday: true };
  if (gap === 1) return { days: current, protectedDays: 0, doneToday: false };
  const missed = gap - 1;
  if (missed <= (p.freezes ?? 0)) return { days: current, protectedDays: missed, doneToday: false };
  return { days: 0, protectedDays: 0, doneToday: false };
}

/** Soma em um contador do dia (missões diárias). */
export function bumpDay(key: string, n = 1) {
  const d = today();
  progress.set((p) => {
    const c = p.day?.d === d ? { ...p.day.c } : {};
    c[key] = (c[key] ?? 0) + n;
    const totals = { ...(p.totals ?? {}), [key]: ((p.totals ?? {})[key] ?? 0) + n };
    return { ...p, day: { d, c }, totals, updatedAt: Date.now() };
  });
}

export function dayCount(p: Progress, key: string, d = today()): number {
  return p.day?.d === d ? (p.day.c[key] ?? 0) : 0;
}

export function addXp(n: number) {
  const d = today();
  const v = Math.round(n);
  progress.set((p) => ({ ...p, xp: p.xp + v, xpDays: { ...(p.xpDays ?? {}), [d]: ((p.xpDays ?? {})[d] ?? 0) + v }, updatedAt: Date.now() }));
}

const MAX_EVENTS = 30;
function pushEvent(list: ProgressEvent[], e: ProgressEvent): ProgressEvent[] {
  return [e, ...list].slice(0, MAX_EVENTS);
}

export function addEvent(e: Omit<ProgressEvent, 'at'>) {
  progress.set((p) => ({ ...p, events: pushEvent(p.events ?? [], { ...e, at: Date.now() }), updatedAt: Date.now() }));
}

export function setFlag(name: string) {
  if (progress.get().flags?.[name]) return;
  progress.set((p) => ({ ...p, flags: { ...(p.flags ?? {}), [name]: true }, updatedAt: Date.now() }));
  checkBadges();
}

// ---- conquistas ----
const badgeListeners = new Set<(ids: string[]) => void>();
export function onBadges(fn: (ids: string[]) => void): () => void {
  badgeListeners.add(fn);
  return () => badgeListeners.delete(fn);
}

/** Verifica conquistas novas; registra e avisa quem estiver ouvindo. */
export function checkBadges(): string[] {
  const p = progress.get();
  const have = p.badges ?? {};
  const fresh = ACHIEVEMENTS.filter((a) => !have[a.id] && a.check(p)).map((a) => a.id);
  if (!fresh.length) return [];
  const now = Date.now();
  progress.set((cur) => {
    const badges = { ...(cur.badges ?? {}) };
    let events = cur.events ?? [];
    fresh.forEach((id, i) => {
      badges[id] = now;
      const a = ACHIEVEMENTS.find((x) => x.id === id)!;
      // instantes distintos: cada evento tem identidade própria no feed
      events = pushEvent(events, { k: 'badge', t: `Ganhou a medalha ${a.icon} ${a.title}`, at: now + i, ref: id });
    });
    return { ...cur, badges, events, updatedAt: now };
  });
  badgeListeners.forEach((fn) => fn(fresh));
  return fresh;
}

// ---- semana (para o ranking entre amigos) ----
/** Chave da semana ISO (segunda a domingo), ex.: "2026-W42". */
export function weekKey(d = new Date()): string {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const wk = Math.ceil(((t.getTime() - y0.getTime()) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(wk).padStart(2, '0')}`;
}

/** Dias (AAAA-MM-DD) da semana atual, de segunda até hoje. */
export function daysThisWeek(d = new Date()): string[] {
  const out: string[] = [];
  const dow = (d.getDay() + 6) % 7; // 0 = segunda
  for (let i = dow; i >= 0; i--) {
    const x = new Date(d);
    x.setDate(d.getDate() - i);
    out.push(today(x));
  }
  return out;
}

export function weekStats(p: Progress, d = new Date()): { xp: number; minutes: number } {
  const days = daysThisWeek(d);
  const xp = days.reduce((a, k) => a + ((p.xpDays ?? {})[k] ?? 0), 0);
  const minutes = Math.round(days.reduce((a, k) => a + (p.practice[k] ?? 0), 0) / 60);
  return { xp, minutes };
}

export function starsFor(acc: number): number {
  if (acc >= 0.95) return 3;
  if (acc >= 0.8) return 2;
  if (acc >= 0.6) return 1;
  return 0;
}

export function recordLesson(id: string, acc: number): { stars: number; improved: boolean } {
  const stars = starsFor(acc);
  let improved = false;
  progress.set((p) => {
    const prev = p.lessons[id];
    improved = !prev || stars > prev.stars;
    const next: LessonProgress = {
      stars: Math.max(prev?.stars ?? 0, stars),
      best: Math.max(prev?.best ?? 0, acc),
      attempts: (prev?.attempts ?? 0) + 1,
      completedAt: stars > 0 ? (prev?.completedAt ?? Date.now()) : prev?.completedAt,
    };
    let events = p.events ?? [];
    if (stars > 0 && improved) {
      const title = findLesson(id)?.lesson.title ?? id;
      events = pushEvent(events, { k: 'lesson', t: `Concluiu a lição “${title}” ${'★'.repeat(stars)}`, at: Date.now(), ref: id });
    }
    return { ...p, lessons: { ...p.lessons, [id]: next }, events, updatedAt: Date.now() };
  });
  addXp(10 + stars * 10);
  if (stars > 0) bumpDay('lessons');
  checkBadges();
  return { stars, improved };
}

export function recordSong(id: string, stepKey: string | null, acc: number, tempoPct: number, full: boolean, title?: string, opts: { listen?: boolean } = {}) {
  progress.set((p) => {
    const prev: SongProgress = p.songs[id] ?? { best: 0, plays: 0, lastPlayed: 0, steps: {} };
    const steps = { ...prev.steps };
    if (stepKey) steps[stepKey] = Math.max(steps[stepKey] ?? 0, acc);
    const next: SongProgress = {
      ...prev,
      plays: prev.plays + 1,
      lastPlayed: Date.now(),
      steps,
      best: full ? Math.max(prev.best, acc) : prev.best,
      bestTempo: full && acc >= 0.8 ? Math.max(prev.bestTempo ?? 0, tempoPct) : prev.bestTempo,
    };
    let events = p.events ?? [];
    if (full && acc >= 0.8 && acc > prev.best + 0.001) {
      events = pushEvent(events, { k: 'song', t: `Tocou “${title ?? id}” com ${Math.round(acc * 100)}%`, at: Date.now(), ref: id });
    }
    const songTitles = title ? { ...(p.songTitles ?? {}), [id]: title } : p.songTitles;
    return { ...p, songs: { ...p.songs, [id]: next }, songTitles, events, updatedAt: Date.now() };
  });
  if (opts.listen) addXp(3);
  else {
    addXp(5 + acc * 15);
    if (acc >= 0.8) bumpDay('songs80');
  }
  checkBadges();
}

/** Atualiza estatística de leitura de uma nota (sistema de Leitner). */
export function recordNoteRead(key: string, correct: boolean, ms: number) {
  progress.set((p) => {
    const prev: NoteStat = p.noteStats[key] ?? { seen: 0, correct: 0, ms: 0, box: 0, last: 0 };
    const seen = prev.seen + 1;
    const next: NoteStat = {
      seen,
      correct: prev.correct + (correct ? 1 : 0),
      ms: correct ? (prev.ms * Math.min(prev.correct, 9) + ms) / (Math.min(prev.correct, 9) + 1) : prev.ms,
      box: correct ? Math.min(4, prev.box + (ms < 2500 ? 1 : 0)) : 0,
      last: Date.now(),
    };
    return { ...p, noteStats: { ...p.noteStats, [key]: next }, updatedAt: Date.now() };
  });
  if (correct) bumpDay('notes');
  if (Math.random() < 0.2) checkBadges();
}

/** Atividade concluída fora da trilha (revisão, ouvido, ritmo, primeira vista, trecho firmado). */
export function recordActivity(key: 'reviews' | 'echo' | 'rhythm' | 'sight' | 'focus', xp: number) {
  bumpDay(key);
  if (xp > 0) addXp(xp);
  checkBadges();
}

export function minutesToday(p: Progress): number {
  return Math.round((p.practice[today()] ?? 0) / 60);
}

/** Mescla progresso de dois aparelhos sem perder nada (sempre fica com o melhor/maior). */
export function mergeProgress(a: Progress, b: Progress): Progress {
  const lessons: Progress['lessons'] = { ...a.lessons };
  for (const [k, v] of Object.entries(b.lessons ?? {})) {
    const x = lessons[k];
    lessons[k] = x
      ? {
          stars: Math.max(x.stars, v.stars),
          best: Math.max(x.best, v.best),
          attempts: Math.max(x.attempts, v.attempts),
          completedAt: Math.min(x.completedAt ?? Infinity, v.completedAt ?? Infinity) === Infinity ? undefined : Math.min(x.completedAt ?? Infinity, v.completedAt ?? Infinity),
        }
      : v;
  }
  const songs: Progress['songs'] = { ...a.songs };
  for (const [k, v] of Object.entries(b.songs ?? {})) {
    const x = songs[k];
    if (!x) {
      songs[k] = v;
      continue;
    }
    const steps = { ...x.steps };
    for (const [sk, sv] of Object.entries(v.steps ?? {})) steps[sk] = Math.max(steps[sk] ?? 0, sv);
    songs[k] = {
      best: Math.max(x.best, v.best),
      plays: Math.max(x.plays, v.plays),
      lastPlayed: Math.max(x.lastPlayed, v.lastPlayed),
      steps,
      bestTempo: Math.max(x.bestTempo ?? 0, v.bestTempo ?? 0) || undefined,
    };
  }
  const noteStats: Progress['noteStats'] = { ...a.noteStats };
  for (const [k, v] of Object.entries(b.noteStats ?? {})) {
    const x = noteStats[k];
    noteStats[k] = !x || v.seen > x.seen || (v.seen === x.seen && v.last > x.last) ? v : x;
  }
  const practice: Progress['practice'] = { ...a.practice };
  for (const [k, v] of Object.entries(b.practice ?? {})) practice[k] = Math.max(practice[k] ?? 0, v);
  const xpDays: Record<string, number> = { ...(a.xpDays ?? {}) };
  for (const [k, v] of Object.entries(b.xpDays ?? {})) xpDays[k] = Math.max(xpDays[k] ?? 0, v);
  const sa = a.streak;
  const sb = b.streak ?? sa;
  const streak = sa.lastDay >= sb.lastDay ? { ...sa, best: Math.max(sa.best, sb.best) } : { ...sb, best: Math.max(sa.best, sb.best) };
  const seen = new Set<string>();
  const events = [...(a.events ?? []), ...(b.events ?? [])]
    .sort((x, y) => y.at - x.at)
    .filter((e) => {
      const key = `${e.at}|${e.t}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_EVENTS);
  const badges: Record<string, number> = { ...(a.badges ?? {}) };
  for (const [k, v] of Object.entries(b.badges ?? {})) badges[k] = Math.min(badges[k] ?? Infinity, v);
  // contadores do dia: mesmo dia -> maior de cada; dias diferentes -> o mais recente
  let day = a.day ?? b.day;
  if (a.day && b.day) {
    if (a.day.d === b.day.d) {
      const c = { ...a.day.c };
      for (const [k, v] of Object.entries(b.day.c)) c[k] = Math.max(c[k] ?? 0, v);
      day = { d: a.day.d, c };
    } else day = a.day.d > b.day.d ? a.day : b.day;
  }
  let quests = a.quests ?? b.quests;
  if (a.quests && b.quests) {
    if (a.quests.d === b.quests.d) quests = { ...a.quests, done: [...new Set([...a.quests.done, ...b.quests.done])], chest: !!(a.quests.chest || b.quests.chest) };
    else quests = a.quests.d > b.quests.d ? a.quests : b.quests;
  }
  return {
    lessons,
    songs,
    songTitles: { ...(b.songTitles ?? {}), ...(a.songTitles ?? {}) },
    noteStats,
    practice,
    xp: Math.max(a.xp, b.xp ?? 0),
    xpDays,
    streak,
    events,
    badges,
    flags: { ...(b.flags ?? {}), ...(a.flags ?? {}) },
    day,
    quests,
    questDays: Math.max(a.questDays ?? 0, b.questDays ?? 0),
    totals: Object.fromEntries(
      [...new Set([...Object.keys(a.totals ?? {}), ...Object.keys(b.totals ?? {})])].map((k) => [k, Math.max((a.totals ?? {})[k] ?? 0, (b.totals ?? {})[k] ?? 0)]),
    ),
    freezes: sa.lastDay >= sb.lastDay ? (a.freezes ?? 0) : (b.freezes ?? 0),
    updatedAt: Math.max(a.updatedAt, b.updatedAt ?? 0),
  };
}

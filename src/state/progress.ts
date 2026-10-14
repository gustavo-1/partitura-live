import { createStore } from '../lib/store';

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

export interface Progress {
  lessons: Record<string, LessonProgress>;
  songs: Record<string, SongProgress>;
  noteStats: Record<string, NoteStat>; // "treble:60"
  practice: Record<string, number>; // "2026-10-14" -> segundos
  xp: number;
  streak: { current: number; best: number; lastDay: string };
  updatedAt: number;
}

export const emptyProgress: Progress = {
  lessons: {},
  songs: {},
  noteStats: {},
  practice: {},
  xp: 0,
  streak: { current: 0, best: 0, lastDay: '' },
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
    if (lastDay !== d) {
      const gap = lastDay ? daysBetween(lastDay, d) : 999;
      current = gap === 1 ? current + 1 : 1;
      best = Math.max(best, current);
      lastDay = d;
    }
    return { ...p, practice, streak: { current, best, lastDay }, updatedAt: Date.now() };
  });
}

export function addXp(n: number) {
  progress.set((p) => ({ ...p, xp: p.xp + Math.round(n), updatedAt: Date.now() }));
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
    return { ...p, lessons: { ...p.lessons, [id]: next }, updatedAt: Date.now() };
  });
  addXp(10 + stars * 10);
  return { stars, improved };
}

export function recordSong(id: string, stepKey: string | null, acc: number, tempoPct: number, full: boolean) {
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
    return { ...p, songs: { ...p.songs, [id]: next }, updatedAt: Date.now() };
  });
  addXp(5 + acc * 15);
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
  const sa = a.streak;
  const sb = b.streak ?? sa;
  const streak = sa.lastDay >= sb.lastDay ? { ...sa, best: Math.max(sa.best, sb.best) } : { ...sb, best: Math.max(sa.best, sb.best) };
  return {
    lessons,
    songs,
    noteStats,
    practice,
    xp: Math.max(a.xp, b.xp ?? 0),
    streak,
    updatedAt: Math.max(a.updatedAt, b.updatedAt ?? 0),
  };
}

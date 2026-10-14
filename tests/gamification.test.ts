// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { emptyProgress, logPractice, mergeProgress, progress, streakNow, today, bumpDay, dayCount, recordNoteRead } from '../src/state/progress';
import { levelFor, pickQuests, QUESTS, todaysQuests, groupWeek, GROUP_MIN_PER_PERSON } from '../src/state/gamification';
import { buildReview, buildWarmup, dueNotes, isDue, BOX_DAYS } from '../src/practice/review';
import { allLessons } from '../src/data/curriculum';
import { makeEchoPattern } from '../src/screens/lesson/activities';

const dayStr = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return today(d);
};

beforeEach(() => {
  progress.replace(structuredClone(emptyProgress));
});

describe('níveis', () => {
  it('cada nível pede 50 XP a mais', () => {
    expect(levelFor(0)).toMatchObject({ level: 1, into: 0, need: 50 });
    expect(levelFor(49).level).toBe(1);
    expect(levelFor(50)).toMatchObject({ level: 2, into: 0, need: 100 });
    expect(levelFor(150).level).toBe(3);
    expect(levelFor(500).level).toBe(5);
    expect(levelFor(2250).level).toBe(10);
    expect(levelFor(500).title).toBe('Leitor(a) de pauta');
  });
});

describe('sequência e proteções', () => {
  it('praticar dias seguidos aumenta a sequência', () => {
    progress.set({ streak: { current: 4, best: 4, lastDay: dayStr(-1) } });
    logPractice(60);
    expect(progress.get().streak.current).toBe(5);
  });
  it('um dia perdido zera a sequência sem proteção', () => {
    progress.set({ streak: { current: 4, best: 4, lastDay: dayStr(-2) } });
    expect(streakNow(progress.get()).days).toBe(0);
    logPractice(60);
    expect(progress.get().streak.current).toBe(1);
    expect(progress.get().streak.best).toBe(4);
  });
  it('a proteção cobre o dia perdido e é gasta', () => {
    progress.set({ streak: { current: 4, best: 4, lastDay: dayStr(-2) }, freezes: 1 });
    expect(streakNow(progress.get())).toMatchObject({ days: 4, protectedDays: 1 });
    logPractice(60);
    expect(progress.get().streak.current).toBe(5);
    expect(progress.get().freezes).toBe(0);
    expect(progress.get().events?.some((e) => /proteção/.test(e.t))).toBe(true);
  });
  it('proteções insuficientes não salvam a sequência', () => {
    progress.set({ streak: { current: 9, best: 9, lastDay: dayStr(-4) }, freezes: 2 });
    expect(streakNow(progress.get()).days).toBe(0);
    logPractice(60);
    expect(progress.get().streak.current).toBe(1);
    expect(progress.get().freezes).toBe(2);
  });
});

describe('missões do dia', () => {
  it('sorteia uma de cada grupo, sempre igual no mesmo dia', () => {
    const p = progress.get();
    const a = pickQuests('2026-10-14', 0, p);
    expect(a).toEqual(pickQuests('2026-10-14', 0, p));
    expect(a).toHaveLength(3);
    const groups = a.map((id) => QUESTS.find((q) => q.id === id)!.group);
    expect(groups).toEqual(['review', 'learn', 'extra']);
    // sem amigos, nunca a missão social
    for (let d = 1; d <= 28; d++) expect(pickQuests(`2026-02-${String(d).padStart(2, '0')}`, 0, p)).not.toContain('social');
  });
  it('contadores do dia alimentam o progresso das missões', () => {
    bumpDay('notes', 7);
    recordNoteRead('treble:60', true, 900);
    expect(dayCount(progress.get(), 'notes')).toBe(8);
    expect(progress.get().totals?.notes).toBe(8);
    const notes = todaysQuests({ ...progress.get(), quests: { d: today(), ids: ['notes', 'lesson', 'minutes'], done: [] } });
    expect(notes[0]).toMatchObject({ value: 8, done: false });
  });
  it('contadores de outro dia não contam hoje', () => {
    progress.set({ day: { d: '2000-01-01', c: { notes: 50 } } });
    expect(dayCount(progress.get(), 'notes')).toBe(0);
    bumpDay('notes');
    expect(progress.get().day).toEqual({ d: today(), c: { notes: 1 } });
  });
});

describe('meta do grupo', () => {
  it('sozinho não há meta de grupo', () => {
    progress.set({ practice: { [today()]: 90 * 60 } });
    expect(groupWeek(progress.get(), { friendIds: [], friends: {} })).toMatchObject({ members: 1, done: false });
  });
  it('meta batida com os amigos', async () => {
    const { weekKey } = await import('../src/state/progress');
    progress.set({ practice: { [today()]: 70 * 60 } });
    const friend = { week: weekKey(), weekMinutes: 55 } as never;
    const g = groupWeek(progress.get(), { friendIds: ['f'], friends: { f: friend } });
    expect(g.target).toBe(GROUP_MIN_PER_PERSON * 2);
    expect(g.minutes).toBe(125);
    expect(g.done).toBe(true);
  });
});

describe('mesclar progresso (campos novos)', () => {
  it('missões, contadores e proteções', () => {
    const d = today();
    const a = { ...emptyProgress, day: { d, c: { notes: 5, lessons: 1 } }, quests: { d, ids: ['notes', 'lesson', 'minutes'], done: ['lesson'] }, totals: { notes: 50 }, questDays: 2, freezes: 1, streak: { current: 3, best: 3, lastDay: d } };
    const b = { ...emptyProgress, day: { d, c: { notes: 9 } }, quests: { d, ids: ['notes', 'lesson', 'minutes'], done: ['notes'] }, totals: { notes: 40, echo: 3 }, questDays: 3, freezes: 2, streak: { current: 2, best: 5, lastDay: dayStr(-1) } };
    const m = mergeProgress(a, b);
    expect(m.day?.c).toEqual({ notes: 9, lessons: 1 });
    expect(m.quests?.done.sort()).toEqual(['lesson', 'notes']);
    expect(m.totals).toEqual({ notes: 50, echo: 3 });
    expect(m.questDays).toBe(3);
    expect(m.freezes).toBe(1); // vem de quem praticou por último
  });
});

describe('revisão espaçada', () => {
  it('intervalos de Leitner', () => {
    const now = Date.now();
    expect(isDue({ seen: 3, correct: 3, ms: 900, box: 0, last: now }, now)).toBe(true);
    expect(isDue({ seen: 3, correct: 3, ms: 900, box: 2, last: now - 86400000 }, now)).toBe(false);
    expect(isDue({ seen: 3, correct: 3, ms: 900, box: 2, last: now - BOX_DAYS[2] * 86400000 }, now)).toBe(true);
  });
  it('escolhe primeiro as notas vencidas', () => {
    const now = Date.now();
    progress.set({
      noteStats: {
        'treble:60': { seen: 5, correct: 5, ms: 800, box: 4, last: now },
        'treble:62': { seen: 5, correct: 2, ms: 3000, box: 0, last: now },
        'treble:64': { seen: 5, correct: 5, ms: 800, box: 1, last: now - 2 * 86400000 },
        'bass:48': { seen: 1, correct: 1, ms: 800, box: 1, last: now },
      },
    });
    const r = dueNotes(progress.get(), 'treble', 8);
    expect(r.due).toBe(2);
    expect(r.pool.slice(0, 2).sort()).toEqual(['D4', 'E4']);
    expect(r.pool).toContain('C4');
    expect(r.pool).not.toContain('C3');
  });
  it('revisão do dia mistura leitura, conceitos e ouvido', () => {
    const lessons: Record<string, { stars: number; best: number; attempts: number; completedAt: number }> = {};
    allLessons()
      .slice(0, 8)
      .forEach((x, i) => (lessons[x.lesson.id] = { stars: 2, best: 0.9, attempts: 1, completedAt: Date.now() - i * 86400000 }));
    progress.set({ lessons });
    const { acts, parts } = buildReview(progress.get());
    const types = acts.map((a) => a.type);
    expect(types[0]).toBe('read');
    expect(types).toContain('quiz');
    expect(types).toContain('echo');
    expect(parts).toContain('conceitos');
    // aquecimento: só de lições anteriores
    const idx = 6;
    const w = buildWarmup(allLessons()[idx].lesson.id, progress.get());
    expect(w[0].type).toBe('info');
    expect(w.slice(1).every((a) => a.type === 'quiz')).toBe(true);
    const earlier = new Set(allLessons().slice(0, idx).flatMap((x) => x.lesson.activities));
    expect(w.slice(1).every((a) => earlier.has(a))).toBe(true);
    // primeiras lições não têm aquecimento
    expect(buildWarmup(allLessons()[1].lesson.id, progress.get())).toEqual([]);
  });
});

describe('melodias de ouvido', () => {
  it('começam na referência e ficam dentro do conjunto', () => {
    const pool = [60, 62, 64, 65, 67];
    for (let i = 0; i < 50; i++) {
      const pat = makeEchoPattern(pool, 4, Math.random());
      expect(pat).toHaveLength(4);
      expect(pat[0]).toBe(60);
      pat.forEach((m) => expect(pool).toContain(m));
      for (let k = 1; k < pat.length; k++) expect(pat[k]).not.toBe(pat[k - 1]);
    }
  });
});

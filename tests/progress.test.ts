import { describe, expect, it } from 'vitest';
import { emptyProgress, mergeProgress } from '../src/state/progress';

describe('mergeProgress', () => {
  it('fica com o melhor de cada lado', () => {
    const a = { ...emptyProgress, xp: 50, lessons: { l1: { stars: 2, best: 0.85, attempts: 2 } }, practice: { '2026-10-01': 300 } };
    const b = {
      ...emptyProgress,
      xp: 80,
      lessons: { l1: { stars: 1, best: 0.7, attempts: 5 }, l2: { stars: 3, best: 1, attempts: 1 } },
      practice: { '2026-10-01': 100, '2026-10-02': 600 },
      songs: { s: { best: 0.9, plays: 3, lastPlayed: 10, steps: { a: 0.5 } } },
    };
    const m = mergeProgress(a, b);
    expect(m.xp).toBe(80);
    expect(m.lessons.l1).toMatchObject({ stars: 2, best: 0.85, attempts: 5 });
    expect(m.lessons.l2.stars).toBe(3);
    expect(m.practice).toEqual({ '2026-10-01': 300, '2026-10-02': 600 });
    expect(m.songs.s.steps.a).toBe(0.5);
  });
});

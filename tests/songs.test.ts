import { describe, expect, it } from 'vitest';
import { builtinSongs } from '../src/data/songs';
import { buildEvents } from '../src/music/timeline';

describe('músicas embutidas', () => {
  it('todas compilam e têm compassos completos', () => {
    const songs = builtinSongs();
    expect(songs.length).toBeGreaterThan(10);
    for (const s of songs) {
      expect(s.measures.length, s.id).toBeGreaterThan(3);
      expect(buildEvents(s).length, s.id).toBeGreaterThan(5);
    }
  });
});

import { generateExercise } from '../src/music/generator';
import { CURRICULUM } from '../src/data/curriculum';
import { buildSong } from '../src/music/notation';
import { builtinSong } from '../src/data/songs';

describe('gerador e currículo', () => {
  it('gera exercícios válidos em todos os níveis', () => {
    for (let lvl = 1; lvl <= 4; lvl++)
      for (let seed = 1; seed < 60; seed++) {
        const s = generateExercise(lvl, seed * 7919);
        expect(buildEvents(s).length).toBeGreaterThan(3);
      }
  });

  it('todas as partituras e músicas do currículo existem e compilam', () => {
    let n = 0;
    for (const u of CURRICULUM)
      for (const l of u.lessons)
        for (const a of l.activities) {
          if ((a.type === 'info' || a.type === 'quiz') && a.staff) {
            buildSong({ id: 'x', title: 'x', ...a.staff });
            n++;
          }
          if (a.type === 'rhythm') buildSong({ id: 'r', title: 'r', rh: a.pattern, time: a.time });
          if (a.type === 'play') {
            if (a.songId) expect(builtinSong(a.songId), a.songId).toBeTruthy();
            else buildSong({ id: 'p', title: 'p', ...a.spec });
          }
        }
    expect(n).toBeGreaterThan(10);
  });
});

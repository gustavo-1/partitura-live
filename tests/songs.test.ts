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

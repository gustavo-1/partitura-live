import { describe, expect, it } from 'vitest';
import { buildSong } from '../src/music/notation';
import { buildEvents, buildSteps } from '../src/music/timeline';
import { spellMidi, ticksToDurations, keySigAlters } from '../src/music/theory';
import { PPQ } from '../src/music/types';

describe('notation', () => {
  it('parses notes, chords, rests, ties and fills measures', () => {
    const s = buildSong({
      id: 't',
      title: 't',
      rh: 'C4q@1 D4 E4h~ | E4q (C4@1 E4@3 G4@5)h. | rq G4e A4 B4q rq',
      lh: 'C3w | (C3 G3)w',
    });
    expect(s.measures.length).toBe(3);
    expect(s.staves).toBe(2);
    const rh = s.notes.filter((n) => n.staff === 0);
    expect(rh[0].fingers).toEqual([1]);
    expect(rh[2].tieStart).toEqual([true]);
    expect(rh[3].tieEnd).toEqual([true]);
    // LH measure 3 is missing -> full rest
    const lh = s.notes.filter((n) => n.staff === 1);
    expect(lh[lh.length - 1].fullRest).toBe(true);
    const ev = buildEvents(s);
    const e4 = ev.find((e) => e.midi === 64 && e.staff === 0)!;
    expect(e4.d).toBe(PPQ * 3);
    const steps = buildSteps(ev, ['R']);
    expect(steps.map((x) => x.events.length)).toEqual([1, 1, 1, 3, 1, 1, 1]);
    const both = buildSteps(ev, ['R', 'L']);
    expect(both[0].events.map((e) => e.midi).sort()).toEqual([48, 60]);
  });

  it('rejects overfull measure', () => {
    expect(() => buildSong({ id: 'x', title: 'x', rh: 'C4w D4q' })).toThrow();
  });

  it('pickup measure', () => {
    const s = buildSong({ id: 'p', title: 'p', time: '3/4', pickup: true, rh: 'G4e G4 | A4q G4 C5 | B4h' });
    expect(s.measures[0].length).toBe(PPQ);
    expect(s.measures[1].start).toBe(PPQ);
  });
});

describe('theory', () => {
  it('spells in key', () => {
    expect(spellMidi(66, 1)).toMatchObject({ step: 'F', alter: 1 });
    expect(spellMidi(70, -1)).toMatchObject({ step: 'B', alter: -1 });
    expect(spellMidi(61, 0)).toMatchObject({ step: 'C', alter: 1, octave: 4 });
    expect(keySigAlters(2)).toMatchObject({ F: 1, C: 1, G: 0 });
  });
  it('splits durations', () => {
    expect(ticksToDurations(PPQ * 3).map((d) => d.dur + d.dots)).toEqual(['h1']);
    expect(ticksToDurations(PPQ * 2.5).map((d) => d.dur + d.dots)).toEqual(['h0', '80']);
  });
});

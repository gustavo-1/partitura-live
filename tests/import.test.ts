// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Midi } from '@tonejs/midi';
import { importMusicXml } from '../src/music/musicxml';
import { importMidi } from '../src/music/midiImport';
import { buildEvents, buildSteps } from '../src/music/timeline';
import { PPQ } from '../src/music/types';

describe('MusicXML', () => {
  it('lê duas pautas, acordes, ligaduras, dedilhado e andamento', () => {
    const xml = readFileSync(join(__dirname, 'fixtures/simple.musicxml'), 'utf8');
    const s = importMusicXml(xml, 'x.musicxml');
    expect(s.title).toBe('Teste Duas Pautas');
    expect(s.tempo).toBe(96);
    expect(s.keySig).toBe(1);
    expect(s.clefs).toEqual(['treble', 'bass']);
    expect(s.measures.length).toBe(2);
    const ev = buildEvents(s);
    const b4 = ev.find((e) => e.midi === 71)!;
    expect(b4.d).toBe(PPQ * 3); // ligada
    const steps = buildSteps(ev, ['R', 'L']);
    expect(steps[0].events.map((e) => e.midi).sort()).toEqual([43, 50, 67]);
    const g = s.notes.find((n) => n.keys[0]?.midi === 67)!;
    expect(g.fingers).toEqual([1]);
    expect(s.notes.some((n) => n.fullRest && n.staff === 1)).toBe(true);
    expect(ev.find((e) => e.midi === 66)).toBeTruthy();
  });
});

describe('MIDI', () => {
  it('quantiza e separa as mãos', () => {
    const m = new Midi();
    m.header.setTempo(120);
    const rh = m.addTrack();
    const lh = m.addTrack();
    const q = 0.5; // semínima a 120 bpm
    [60, 62, 64, 65, 67].forEach((n, i) => rh.addNote({ midi: n, time: i * q + 0.01, duration: q * 0.9 }));
    lh.addNote({ midi: 48, time: 0, duration: q * 4 });
    lh.addNote({ midi: 43, time: q * 4, duration: q * 2 });
    const s = importMidi(m.toArray().buffer as ArrayBuffer, 'teste.mid');
    expect(s.staves).toBe(2);
    const ev = buildEvents(s);
    expect(ev.filter((e) => e.hand === 'R').map((e) => e.midi)).toEqual([60, 62, 64, 65, 67]);
    expect(ev.find((e) => e.midi === 48)!.d).toBe(PPQ * 4);
    expect(s.measures.length).toBe(2);
  });
});

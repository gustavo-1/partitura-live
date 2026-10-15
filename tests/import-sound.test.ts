// @vitest-environment happy-dom
/**
 * Fidelidade das músicas importadas: o que se ouve deve corresponder ao arquivo original
 * (ritmo, durações, tercinas, pedal, intensidade, andamento e repetições).
 */
import { describe, expect, it } from 'vitest';
import { Midi } from '@tonejs/midi';
import { importMidi } from '../src/music/midiImport';
import { importMusicXml } from '../src/music/musicxml';
import { buildEvents } from '../src/music/timeline';
import { PPQ } from '../src/music/types';

function toBuffer(m: Midi): ArrayBuffer {
  const u8 = m.toArray();
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

/** 4 compassos: direita com tercinas e colcheias; esquerda com baixo longo + acordes quebrados e pedal. */
function popMidi(opts: { tempoMap?: [number, number][] } = {}): Midi {
  const m = new Midi();
  for (const [ticks, bpm] of opts.tempoMap ?? [[0, 130]]) m.header.tempos.push({ ticks, bpm });
  m.header.update();
  m.header.timeSignatures.push({ ticks: 0, timeSignature: [4, 4] });
  const q = m.header.ppq;
  const rh = m.addTrack();
  const lh = m.addTrack();
  for (let bar = 0; bar < 4; bar++) {
    const t0 = bar * 4 * q;
    lh.addNote({ midi: 48, ticks: t0, durationTicks: 4 * q, velocity: 0.5 });
    for (let i = 0; i < 8; i++) lh.addNote({ midi: [60, 64, 67][i % 3], ticks: t0 + (i * q) / 2, durationTicks: q / 2 - 10, velocity: 0.4 });
    lh.addCC({ number: 64, value: 1, ticks: t0 + 5 });
    lh.addCC({ number: 64, value: 0, ticks: t0 + 4 * q - 20 });
    if (bar % 2 === 0) {
      // tercinas de colcheia nos dois primeiros tempos (3 contra 2 com a esquerda)
      for (let i = 0; i < 6; i++) rh.addNote({ midi: 72 + i, ticks: t0 + (i * q) / 3, durationTicks: q / 3 - 5, velocity: 0.9 });
      rh.addNote({ midi: 79, ticks: t0 + 2 * q, durationTicks: 2 * q, velocity: 0.9 });
    } else {
      for (let i = 0; i < 8; i++) rh.addNote({ midi: 72 + (i % 5), ticks: t0 + (i * q) / 2, durationTicks: q / 2 - 8, velocity: 0.8 });
    }
  }
  return m;
}

describe('importação de MIDI soa como o original', () => {
  const orig = popMidi();
  const song = importMidi(toBuffer(orig), 'pop.mid');
  const ev = buildEvents(song);
  const origNotes = orig.tracks.flatMap((t) => t.notes);

  it('todos os ataques no lugar certo (inclusive tercinas sobre colcheias retas)', () => {
    expect(ev.length).toBe(origNotes.length);
    for (const n of origNotes) {
      const t = (n.ticks / orig.header.ppq) * PPQ;
      expect(
        ev.some((e) => e.midi === n.midi && Math.abs(e.t - t) < 1),
        `nota ${n.midi} em ${(n.ticks / orig.header.ppq).toFixed(3)} tempos`,
      ).toBe(true);
    }
    expect(song.notes.filter((n) => n.tuplet).length).toBeGreaterThan(0);
  });

  it('notas longas não são encurtadas pelas mais curtas que começam junto', () => {
    const bass = ev.filter((e) => e.midi === 48);
    expect(bass).toHaveLength(4);
    for (const b of bass) expect(b.d).toBe(PPQ * 4);
    // o baixo vai para uma segunda voz da mesma pauta
    expect(new Set(song.notes.filter((n) => n.staff === 1).map((n) => n.voice))).toEqual(new Set([0, 1]));
  });

  it('pedal e intensidade', () => {
    expect(song.pedal?.length).toBe(4);
    const c = ev.find((e) => e.midi === 60)!;
    expect(c.sd).toBeGreaterThan(c.d * 4); // soa até o pedal subir
    expect(ev.find((e) => e.midi === 72)!.vel).toBeCloseTo(0.9, 1);
    expect(ev.find((e) => e.midi === 64)!.vel).toBeCloseTo(0.4, 1);
  });

  it('usa o andamento que vale na maior parte da música', () => {
    const s = importMidi(toBuffer(popMidi({ tempoMap: [[0, 60], [480, 130]] })), 'x.mid');
    expect(s.tempo).toBe(130);
  });
});

const xml = (measures: string, extra = '') => `<?xml version="1.0"?>
<score-partwise version="3.1"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
<part id="P1">${measures}</part></score-partwise>${extra}`;
const note = (step: string, oct = 4, dur = 4, type = 'whole') => `<note><pitch><step>${step}</step><octave>${oct}</octave></pitch><duration>${dur}</duration><voice>1</voice><type>${type}</type></note>`;
const attrs = (time = '<beats>4</beats><beat-type>4</beat-type>') => `<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time>${time}</time><clef><sign>G</sign><line>2</line></clef></attributes>`;

describe('importação de MusicXML soa como o original', () => {
  it('toca ritornelos e casas de 1ª e 2ª vez', () => {
    const s = importMusicXml(
      xml(
        `<measure number="1">${attrs()}${note('C')}</measure>
         <measure number="2"><barline location="left"><repeat direction="forward"/></barline>${note('D')}</measure>
         <measure number="3"><barline location="left"><ending number="1" type="start"/></barline>${note('E')}<barline location="right"><ending number="1" type="stop"/><repeat direction="backward"/></barline></measure>
         <measure number="4"><barline location="left"><ending number="2" type="start"/></barline>${note('F')}<barline location="right"><ending number="2" type="stop"/></barline></measure>
         <measure number="5">${note('G')}</measure>`,
      ),
      'r.musicxml',
    );
    const order = buildEvents(s).map((e) => 'CDEFGAB'[[60, 62, 64, 65, 67].indexOf(e.midi)]);
    expect(order.join('')).toBe('CDEDFG');
  });

  it('converte o metrônomo em semínima pontuada (6/8) para semínimas por minuto', () => {
    const s = importMusicXml(
      xml(
        `<measure number="1">${attrs('<beats>6</beats><beat-type>8</beat-type>')}
          <direction><direction-type><metronome><beat-unit>quarter</beat-unit><beat-unit-dot/><per-minute>60</per-minute></metronome></direction-type></direction>
          <note><pitch><step>C</step><octave>4</octave></pitch><duration>3</duration><voice>1</voice><type>half</type><dot/></note></measure>`,
      ),
      'm.musicxml',
    );
    expect(s.tempo).toBe(90);
  });

  it('lê pedal e dinâmica', () => {
    const s = importMusicXml(
      xml(
        `<measure number="1">${attrs()}
          <direction><direction-type><dynamics><p/></dynamics></direction-type></direction>
          <direction><direction-type><pedal type="start"/></direction-type></direction>
          <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>
          <note><rest/><duration>3</duration><voice>1</voice></note></measure>
         <measure number="2"><direction><direction-type><dynamics><f/></dynamics></direction-type></direction>${note('E')}
          <direction><direction-type><pedal type="stop"/></direction-type></direction></measure>`,
      ),
      'p.musicxml',
    );
    const ev = buildEvents(s);
    const c = ev.find((e) => e.midi === 60)!;
    expect(c.vel).toBeCloseTo(0.38, 2);
    expect(ev.find((e) => e.midi === 64)!.vel).toBeCloseTo(0.72, 2);
    expect(c.sd).toBeGreaterThan(c.d); // segura com o pedal
  });
});

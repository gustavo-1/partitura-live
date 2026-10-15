// @vitest-environment happy-dom
/**
 * Fidelidade das músicas importadas: o que se ouve deve corresponder ao arquivo original
 * (ritmo, durações, tercinas, pedal, intensidade, andamento e repetições).
 */
import { describe, expect, it } from 'vitest';
import { Midi } from '@tonejs/midi';
import { importMidi, midiTracks, needsTrackChoice, suggestTracks } from '../src/music/midiImport';
import { importMusicXml } from '../src/music/musicxml';
import { buildEvents, tempoSegs, tickToSecs } from '../src/music/timeline';
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
    // com o pedal a nota continua soando depois de soltar a tecla… até a mesma tecla ser tocada de novo (1,5 tempo depois)
    expect(c.sd).toBeGreaterThan(c.d);
    expect(c.sd).toBe(PPQ * 1.5);
    expect(ev.find((e) => e.midi === 72)!.vel).toBeCloseTo(0.9, 1);
    expect(ev.find((e) => e.midi === 64)!.vel).toBeCloseTo(0.4, 1);
  });

  it('usa o andamento que vale na maior parte da música', () => {
    const s = importMidi(toBuffer(popMidi({ tempoMap: [[0, 60], [480, 130]] })), 'x.mid');
    expect(s.tempo).toBe(130);
  });

  it('relatório: todas as notas no instante exato do arquivo', () => {
    expect(song.importReport?.notes).toBe(origNotes.length);
    expect(song.importReport?.exact).toBe(origNotes.length);
    expect(song.importReport?.maxShiftMs).toBeLessThanOrEqual(10);
    expect(song.original?.kind).toBe('midi');
  });
});

/** segundos de cada evento tocado pelo app (andamento original, seguindo o mapa de andamento) */
function playedSecs(song: ReturnType<typeof importMidi>) {
  const segs = tempoSegs(song);
  return buildEvents(song)
    .filter((e) => !e.dup)
    .map((e) => ({ midi: e.midi, t: tickToSecs(segs, e.t), d: tickToSecs(segs, e.t + (e.sd ?? e.d)) - tickToSecs(segs, e.t) }));
}

describe('arquivos MIDI "de verdade" (trilha sonora, karaokê, sequenciador online)', () => {
  /** arranjo completo: piano, cordas, voz, baixo e bateria */
  function bandMidi(): Midi {
    const m = new Midi();
    m.header.tempos.push({ ticks: 0, bpm: 110 });
    m.header.update();
    const q = m.header.ppq;
    const mk = (name: string, program: number, channel = 0) => {
      const t = m.addTrack();
      t.name = name;
      t.channel = channel;
      t.instrument.number = program;
      return t;
    };
    const piano = mk('Piano', 0, 0);
    const strings = mk('Strings', 48, 1);
    const voice = mk('Vocal', 53, 2);
    const bass = mk('Bass', 33, 3);
    const drums = mk('Drums', 0, 9);
    for (let bar = 0; bar < 8; bar++) {
      const t0 = bar * 4 * q;
      for (let i = 0; i < 8; i++) piano.addNote({ midi: [60, 64, 67, 72][i % 4], ticks: t0 + (i * q) / 2, durationTicks: q / 2, velocity: 0.6 });
      piano.addNote({ midi: 48, ticks: t0, durationTicks: 4 * q, velocity: 0.6 });
      strings.addNote({ midi: 55, ticks: t0, durationTicks: 4 * q, velocity: 0.5 });
      strings.addNote({ midi: 59, ticks: t0, durationTicks: 4 * q, velocity: 0.5 });
      for (let i = 0; i < 4; i++) voice.addNote({ midi: 76 + (i % 3), ticks: t0 + i * q, durationTicks: q, velocity: 0.8 });
      bass.addNote({ midi: 36, ticks: t0, durationTicks: 2 * q, velocity: 0.7 });
      for (let i = 0; i < 8; i++) drums.addNote({ midi: 42, ticks: t0 + (i * q) / 2, durationTicks: 30, velocity: 0.7 });
    }
    return m;
  }

  it('lista as trilhas e sugere só o piano quando há piano', () => {
    const infos = midiTracks(bandMidi());
    expect(infos.map((t) => t.instrument)).toEqual(['Piano', 'Cordas (conjunto)', 'Coro/voz', 'Baixo', 'Bateria']);
    expect(needsTrackChoice(infos)).toBe(true);
    const sug = suggestTracks(infos);
    expect(sug).toEqual([{ index: 0, hand: 'auto' }]);
  });

  it('sem escolher, não mistura cordas, voz e baixo no piano (teclas se atropelando)', () => {
    const m = bandMidi();
    const s = importMidi(toBuffer(m), 'band.mid');
    const evs = playedSecs(s);
    expect(evs.length).toBe(m.tracks[0].notes.length);
    expect(s.importReport?.tracksIgnored).toEqual(['Strings', 'Vocal', 'Bass', 'Drums']);
  });

  it('escolha manual de trilhas e mãos', () => {
    const m = bandMidi();
    const s = importMidi(toBuffer(m), 'band.mid', {
      tracks: [
        { index: 2, hand: 'R' },
        { index: 3, hand: 'L' },
      ],
    });
    const evs = buildEvents(s);
    expect(evs.filter((e) => e.hand === 'R').every((e) => e.midi >= 76)).toBe(true);
    expect(evs.filter((e) => e.hand === 'L').every((e) => e.midi === 36)).toBe(true);
    expect(s.original?.tracks).toEqual([
      { index: 2, hand: 'R' },
      { index: 3, hand: 'L' },
    ]);
  });

  it('segue as mudanças de andamento do arquivo (cada nota no segundo exato)', () => {
    const m = new Midi();
    m.header.tempos.push({ ticks: 0, bpm: 120 }, { ticks: 4 * 480, bpm: 60 }, { ticks: 8 * 480, bpm: 150 });
    m.header.update();
    const t = m.addTrack();
    for (let i = 0; i < 12 * 2; i++) t.addNote({ midi: 60 + (i % 12), ticks: i * 240, durationTicks: 200 });
    const s = importMidi(toBuffer(m), 'rit.mid');
    expect(s.tempoMap?.map((x) => x.qpm)).toEqual([120, 60, 150]);
    const evs = playedSecs(s);
    for (const n of t.notes) {
      const e = evs.find((x) => x.midi === n.midi && Math.abs(x.t - n.time) < 0.002);
      expect(e, `nota em ${n.time.toFixed(3)} s`).toBeTruthy();
      expect(Math.abs(e!.d - n.duration)).toBeLessThan(0.002);
    }
    expect(s.importReport?.tempoChanges).toBe(2);
  });

  it('sem marca de andamento no arquivo vale 120 bpm (padrão do MIDI)', () => {
    const m = new Midi();
    m.addTrack().addNote({ midi: 60, ticks: 0, durationTicks: 480 });
    const s = importMidi(toBuffer(m), 'x.mid');
    expect(s.tempo).toBe(120);
  });

  it('mudanças de fórmula de compasso viram compassos do tamanho certo', () => {
    const m = new Midi();
    m.header.timeSignatures.push({ ticks: 0, timeSignature: [4, 4] }, { ticks: 4 * 480, timeSignature: [3, 4] }, { ticks: 7 * 480, timeSignature: [6, 8] });
    m.header.update();
    const t = m.addTrack();
    for (let i = 0; i < 13; i++) t.addNote({ midi: 72, ticks: i * 480, durationTicks: 400 });
    const s = importMidi(toBuffer(m), 'ts.mid');
    expect(s.measures.slice(0, 4).map((x) => x.timeSig.join('/'))).toEqual(['4/4', '3/4', '6/8', '6/8']);
    expect(s.measures.slice(0, 4).map((x) => x.length)).toEqual([1920, 1440, 1440, 1440]);
    expect(s.measures[1].timeSigChange).toBe(true);
    // cada nota no compasso certo
    const ev = buildEvents(s);
    expect(ev.find((e) => e.t === 4 * PPQ)!.measure).toBe(1);
    expect(ev.find((e) => e.t === 7 * PPQ)!.measure).toBe(2);
  });

  it('silêncio inicial em 3/4: corta compassos inteiros (as barras continuam no lugar)', () => {
    const m = new Midi();
    m.header.timeSignatures.push({ ticks: 0, timeSignature: [3, 4] });
    m.header.update();
    const t = m.addTrack();
    // começa no 4º compasso de 3/4 (tempo 9)
    for (let i = 0; i < 6; i++) t.addNote({ midi: 67, ticks: (9 + i) * 480, durationTicks: 480 });
    const s = importMidi(toBuffer(m), 'w.mid');
    const ev = buildEvents(s);
    expect(ev[0].t % (3 * PPQ)).toBe(0); // primeira nota no tempo 1 de um compasso
    expect(ev[3].t % (3 * PPQ)).toBe(0);
  });

  it('fusas de um arquivo já quantizado não são juntadas', () => {
    const m = new Midi();
    const t = m.addTrack();
    for (let i = 0; i < 8; i++) t.addNote({ midi: 72 + (i % 2), ticks: i * 60, durationTicks: 60 });
    t.addNote({ midi: 60, ticks: 480, durationTicks: 480 });
    const s = importMidi(toBuffer(m), 'f.mid');
    expect(s.importReport?.exact).toBe(9);
  });

  it('nota longa da melodia soa inteira mesmo quando a escrita é encurtada', () => {
    const m = new Midi();
    const t = m.addTrack();
    // mão direita: Mi longo (2 tempos) e, junto, um acompanhamento em colcheias na mesma trilha
    t.addNote({ midi: 76, ticks: 0, durationTicks: 900 });
    for (let i = 0; i < 4; i++) t.addNote({ midi: 67, ticks: i * 240, durationTicks: 200 });
    const s = importMidi(toBuffer(m), 'h.mid');
    const e = playedSecs(s).find((x) => x.midi === 76)!;
    expect(e.d).toBeCloseTo(900 / 480 / 2, 2); // 120 bpm: 1,875 tempo = 0,94 s
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

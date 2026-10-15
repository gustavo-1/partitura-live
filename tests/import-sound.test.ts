// @vitest-environment happy-dom
/**
 * Fidelidade das músicas importadas: o que se ouve deve corresponder ao arquivo original
 * (ritmo, durações, tercinas, pedal, intensidade, andamento e repetições).
 */
import { describe, expect, it } from 'vitest';
import { Midi } from '@tonejs/midi';
import { importMidi, midiTracks, needsTrackChoice, originalSounds, suggestTracks } from '../src/music/midiImport';
import { importMusicXml } from '../src/music/musicxml';
import { buildEvents, songSounds, tempoSegs, tickToSecs } from '../src/music/timeline';
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

/** gerador pseudoaleatório fixo (testes reproduzíveis) */
function rng(seed: number) {
  let x = seed;
  return () => {
    x = (x * 1664525 + 1013904223) % 4294967296;
    return x / 4294967296;
  };
}

describe('tocado "à mão" (como no Online Sequencer e em MIDIs gravados ao vivo)', () => {
  /**
   * Arquivo diz 130 bpm, mas a música foi tocada a 125 bpm, com colcheias "balançadas" (swing)
   * e a imprecisão de uma pessoa (±20 ms). Esquerda: Sol-Sib-Ré-Sol… como em City of Stars.
   */
  function handPlayed(opts: { real?: number; file?: number; swing?: number; bars?: number } = {}) {
    const { real = 125, file = 130, swing = 0.66, bars = 16 } = opts;
    const m = new Midi();
    m.header.tempos.push({ ticks: 0, bpm: file });
    m.header.update();
    const tr = m.addTrack();
    const r = rng(7);
    const q = m.header.ppq;
    const sec = (beat: number) => (beat * 60) / real + (r() - 0.5) * 0.04; // onde a pessoa tocou (s)
    const tick = (s: number) => Math.max(0, Math.round((s * file * q) / 60)); // como o arquivo guarda
    const pattern: [number, number, number][] = [
      [43, 0, 0.75],
      [46, swing, 0.5],
      [50, 1, 0.75],
      [55, 1 + swing, 0.5],
      [55, 2 + swing, 0.5],
      [53, 3, 0.75],
      [50, 3 + swing, 0.25],
    ];
    const played: { midi: number; beat: number }[] = [];
    for (let bar = 0; bar < bars; bar++) {
      for (const [midi, b, d] of pattern) {
        const s0 = sec(bar * 4 + b);
        tr.addNote({ midi, ticks: tick(s0), durationTicks: Math.round((d * 60 * file * q) / 60 / real), velocity: 0.4 });
        played.push({ midi, beat: bar * 4 + b });
      }
      // melodia: semínimas e uma colcheia balançada
      for (const [midi, b] of [
        [74, 0],
        [72, 1],
        [70, 2],
        [69, 2 + swing],
        [67, 3],
      ] as [number, number][]) {
        tr.addNote({ midi, ticks: tick(sec(bar * 4 + b)), durationTicks: Math.round(q * 0.9), velocity: 0.6 });
        played.push({ midi, beat: bar * 4 + b });
      }
    }
    return { m, tr, played };
  }

  it('acha o andamento de verdade e refaz os compassos', () => {
    const { m } = handPlayed();
    const s = importMidi(toBuffer(m), 'cos.mid');
    expect(s.importReport?.tempoFix?.file).toBe(130);
    expect(Math.abs(s.tempo - 125)).toBeLessThan(1);
    expect(s.measures.length).toBe(16);
  });

  it('o som fica idêntico ao arquivo (cada nota no mesmo instante e com a mesma duração)', () => {
    const { m, tr } = handPlayed();
    const s = importMidi(toBuffer(m), 'cos.mid');
    expect(s.importReport?.exact).toBe(tr.notes.length);
    const o = originalSounds(m, [0]);
    const c = songSounds(s);
    expect(c.length).toBe(o.length);
    for (const n of o) {
      const e = c.find((x) => x.midi === n.midi && Math.abs(x.time - c[0].time - (n.time - o[0].time)) < 0.002);
      expect(e, `nota ${n.midi} em ${n.time.toFixed(3)} s`).toBeTruthy();
      expect(Math.abs(e!.dur - n.dur)).toBeLessThan(0.002);
    }
  });

  it('partitura legível: swing escrito reto e o mesmo ritmo em todos os compassos', () => {
    const { m } = handPlayed();
    const s = importMidi(toBuffer(m), 'cos.mid');
    expect(s.importReport?.swing).toBe(true);
    const ev = buildEvents(s).filter((e) => e.hand === 'L');
    const bar = (i: number) =>
      ev
        .filter((e) => e.measure === i)
        .map((e) => `${e.midi}@${(e.t - s.measures[i].start) / PPQ}`)
        .join(' ');
    expect(bar(0)).toBe('43@0 46@0.5 50@1 55@1.5 55@2.5 53@3 50@3.5');
    for (let i = 1; i < 16; i++) expect(bar(i), `compasso ${i + 1}`).toBe(bar(0));
    expect(s.notes.some((n) => n.tuplet)).toBe(false);
  });

  it('tocado ao vivo sem swing: colcheias retas, sem tercinas inventadas', () => {
    const { m } = handPlayed({ swing: 0.5, real: 100, file: 100 });
    const s = importMidi(toBuffer(m), 'reto.mid');
    expect(s.importReport?.swing).toBeUndefined();
    expect(s.importReport?.tempoFix).toBeUndefined();
    expect(s.notes.some((n) => n.tuplet)).toBe(false);
    const l0 = buildEvents(s)
      .filter((e) => e.hand === 'L' && e.measure === 3)
      .map((e) => (e.t - s.measures[3].start) / PPQ);
    expect(l0).toEqual([0, 0.5, 1, 1.5, 2.5, 3, 3.5]);
  });

  it('trilha-guia quase muda não entra na sugestão (nem vira a mão direita)', () => {
    const m = new Midi();
    const piano = m.addTrack();
    const guide = m.addTrack();
    for (let i = 0; i < 32; i++) piano.addNote({ midi: 43 + (i % 12), ticks: i * 240, durationTicks: 200, velocity: 0.6 });
    for (let i = 0; i < 8; i++) for (const k of [62, 58, 55]) guide.addNote({ midi: k, ticks: i * 1920, durationTicks: 300, velocity: 2 / 127 });
    const infos = midiTracks(m);
    expect(infos[1].quiet).toBe(true);
    expect(suggestTracks(infos)).toEqual([{ index: 0, hand: 'auto' }]);
  });
});

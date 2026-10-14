import {
  Accidental,
  Barline,
  Beam,
  Dot,
  Formatter,
  GhostNote,
  Renderer,
  Stave,
  StaveConnector,
  StaveNote,
  StaveTie,
  Tuplet,
  Voice,
  VoiceMode,
} from 'vexflow/bravura';
import VexFlow from 'vexflow/bravura';
import type { Measure, NoteEl, Song } from '../../music/types';
import { keySigToVex, pitchName, pitchToVexKey, type NamingStyle } from '../../music/theory';

export interface ScoreOptions {
  width: number;
  scale?: number;
  showNames?: boolean;
  naming?: NamingStyle;
  showFingers?: boolean;
  measureFrom?: number;
  measureTo?: number; // inclusivo
  /** pautas visíveis (índices); padrão: todas */
  staves?: number[];
  /** uma única linha (para exercícios curtos) */
  singleLine?: boolean;
  title?: boolean;
}

export interface NoteBox {
  el: NoteEl;
  x: number; // centro da cabeça de nota (coordenadas do SVG, já escaladas)
  system: number;
  group?: SVGElement;
}

export interface SystemBox {
  index: number;
  y: number;
  height: number;
  staveYs: number[]; // y da linha superior de cada pauta
  staves: Stave[];
  measures: number[];
}

export interface MeasureBox {
  index: number;
  x: number;
  width: number;
  system: number;
}

export interface ScoreLayout {
  width: number;
  height: number;
  scale: number;
  notes: Map<number, NoteBox>;
  systems: SystemBox[];
  measures: Map<number, MeasureBox>;
  clefs: string[];
  staffIndices: number[];
  /** y (escalado) de uma nota MIDI numa pauta de um sistema, para "notas fantasma" */
  yForMidi(system: number, staffPos: number, midi: number, spelledKey?: string): number;
}

const STAVE_GAP = 100; // distância entre pautas do sistema (sem escala)
const SYSTEM_GAP = 50;
const TOP_PAD = 30;
const LEFT_PAD = 10;

function vexDuration(el: NoteEl): string {
  return el.dur + (el.keys.length === 0 ? 'r' : '');
}

function restKey(clef: string): string {
  return clef === 'bass' ? 'd/3' : 'b/4';
}

function minMeasureWidth(song: Song, m: Measure, staffIdx: number[], byMeasure: Map<number, NoteEl[]>): number {
  const els = byMeasure.get(m.index) ?? [];
  let maxCount = 1;
  let acc = 0;
  for (const s of staffIdx) {
    const starts = new Set(els.filter((e) => e.staff === s).map((e) => e.t));
    maxCount = Math.max(maxCount, starts.size);
    acc = Math.max(acc, els.filter((e) => e.staff === s && e.keys.some((k) => k.alter !== 0)).length);
  }
  void song;
  return 40 + maxCount * 34 + acc * 8;
}

export function renderScore(container: HTMLElement, song: Song, opts: ScoreOptions): ScoreLayout {
  container.innerHTML = '';
  const scale = opts.scale ?? 1;
  const width = opts.width;
  const innerW = width / scale - LEFT_PAD * 2;
  const staffIdx = opts.staves ?? song.clefs.map((_, i) => i);
  const clefs = staffIdx.map((s) => song.clefs[s] ?? 'treble');
  const from = opts.measureFrom ?? 0;
  const to = Math.min(opts.measureTo ?? song.measures.length - 1, song.measures.length - 1);
  const measures = song.measures.slice(from, to + 1);

  const byMeasure = new Map<number, NoteEl[]>();
  for (const n of song.notes) {
    if (n.measure < from || n.measure > to) continue;
    if (!byMeasure.has(n.measure)) byMeasure.set(n.measure, []);
    byMeasure.get(n.measure)!.push(n);
  }

  // largura extra do início de cada sistema (clave + armadura + compasso)
  const keyAcc = Math.abs(song.keySig);
  const headerW = (first: boolean) => 38 + keyAcc * 10 + (first ? 26 : 0);

  // quebra em sistemas
  const systemsM: Measure[][] = [];
  let cur: Measure[] = [];
  let curW = 0;
  measures.forEach((m) => {
    const w = minMeasureWidth(song, m, staffIdx, byMeasure) + (m.keySigChange && m.index !== from ? 30 : 0);
    const head = cur.length === 0 ? headerW(systemsM.length === 0) : 0;
    if (!opts.singleLine && cur.length > 0 && curW + w > innerW) {
      systemsM.push(cur);
      cur = [];
      curW = 0;
    }
    cur.push(m);
    curW += w + (cur.length === 1 ? (head || headerW(systemsM.length === 0)) : 0);
  });
  if (cur.length) systemsM.push(cur);

  const nStaves = staffIdx.length;
  const systemH = TOP_PAD + (nStaves - 1) * STAVE_GAP + 80 + (opts.showNames ? 18 : 0);
  const totalH = systemsM.length * (systemH + SYSTEM_GAP) + 10;
  const totalW = opts.singleLine
    ? Math.max(width / scale, curW + LEFT_PAD * 2 + 20)
    : width / scale;

  const renderer = new Renderer(container as HTMLDivElement, Renderer.Backends.SVG);
  renderer.resize(totalW * scale, totalH * scale);
  const ctx = renderer.getContext();
  ctx.scale(scale, scale);

  const layout: ScoreLayout = {
    width: totalW * scale,
    height: totalH * scale,
    scale,
    notes: new Map(),
    systems: [],
    measures: new Map(),
    clefs,
    staffIndices: staffIdx,
    yForMidi(system, staffPos, midi, spelled) {
      const sys = layout.systems[system];
      const stave = sys?.staves[staffPos];
      if (!stave) return 0;
      const key = spelled ?? midiKey(midi);
      const props = VexFlow.keyProperties(key, clefs[staffPos]) as { line: number };
      return stave.getYForNote(props.line) * scale;
    },
  };

  const pendingTies: { from: StaveNote; fromIdx: number[]; system: number }[] = [];
  const lastNoteByLane = new Map<string, { note: StaveNote; el: NoteEl; system: number }>();

  systemsM.forEach((sysMeasures, si) => {
    const y0 = si * (systemH + SYSTEM_GAP) + TOP_PAD;
    const isFirstSystem = si === 0;
    // larguras: distribui o espaço restante proporcionalmente
    const mins = sysMeasures.map((m) => minMeasureWidth(song, m, staffIdx, byMeasure));
    const head = headerW(isFirstSystem);
    const sumMin = mins.reduce((a, b) => a + b, 0) + head;
    const isLast = si === systemsM.length - 1;
    let stretch = opts.singleLine ? 1 : innerW / sumMin;
    if (isLast && !opts.singleLine) stretch = Math.min(stretch, 1.6);
    let x = LEFT_PAD;
    const sysBox: SystemBox = {
      index: si,
      y: (y0 - TOP_PAD + 5) * scale,
      height: systemH * scale,
      staveYs: [],
      staves: [],
      measures: sysMeasures.map((m) => m.index),
    };

    sysMeasures.forEach((m, mi) => {
      const first = mi === 0;
      const w = mins[mi] * stretch + (first ? head * stretch : 0);
      const staves: Stave[] = staffIdx.map((s, pos) => {
        const st = new Stave(x, y0 + pos * STAVE_GAP, w);
        if (first) {
          st.addClef(clefs[pos]);
          st.addKeySignature(keySigToVex(m.keySig));
          if (isFirstSystem || m.timeSigChange) st.addTimeSignature(`${m.timeSig[0]}/${m.timeSig[1]}`);
        } else {
          if (m.keySigChange) st.addKeySignature(keySigToVex(m.keySig));
          if (m.timeSigChange) st.addTimeSignature(`${m.timeSig[0]}/${m.timeSig[1]}`);
        }
        if (m.index === song.measures.length - 1) st.setEndBarType(Barline.type.END);
        if (first && pos === 0) st.setMeasure(m.index + 1);
        void s;
        return st;
      });
      // alinha o início das notas entre as pautas
      const startX = Math.max(...staves.map((st) => st.getNoteStartX()));
      staves.forEach((st) => st.setNoteStartX(startX));
      staves.forEach((st) => st.setContext(ctx).draw());
      if (first) {
        sysBox.staves = staves;
        sysBox.staveYs = staves.map((st) => st.getYForLine(0) * scale);
      }

      if (staves.length > 1) {
        if (first) {
          new StaveConnector(staves[0], staves[staves.length - 1]).setType('brace').setContext(ctx).draw();
          new StaveConnector(staves[0], staves[staves.length - 1]).setType('singleLeft').setContext(ctx).draw();
        }
        const endType = m.index === song.measures.length - 1 ? 'boldDoubleRight' : 'singleRight';
        new StaveConnector(staves[0], staves[staves.length - 1]).setType(endType).setContext(ctx).draw();
      }

      // vozes
      const els = byMeasure.get(m.index) ?? [];
      const voices: Voice[] = [];
      const voiceStave: Stave[] = [];
      const beams: Beam[] = [];
      const tuplets: Tuplet[] = [];
      const created: { note: StaveNote; el: NoteEl; pos: number }[] = [];
      staffIdx.forEach((s, pos) => {
        const staffEls = els.filter((e) => e.staff === s);
        const voiceIds = [...new Set(staffEls.map((e) => e.voice))].sort();
        if (!voiceIds.length) voiceIds.push(0);
        voiceIds.forEach((vid, vi) => {
          const vEls = staffEls.filter((e) => e.voice === vid).sort((a, b) => a.t - b.t);
          const notes: (StaveNote | GhostNote)[] = [];
          for (const el of vEls) {
            if (el.hidden) {
              notes.push(new GhostNote({ duration: el.dur, dots: el.dots }));
              continue;
            }
            const isRest = el.keys.length === 0;
            const keys = isRest ? [restKey(clefs[pos])] : el.keys.map(pitchToVexKey);
            const note = new StaveNote({
              keys,
              duration: el.fullRest ? 'wr' : vexDuration(el),
              dots: el.fullRest ? 0 : el.dots,
              clef: clefs[pos],
              autoStem: voiceIds.length === 1,
              stemDirection: voiceIds.length > 1 ? (vi === 0 ? 1 : -1) : undefined,
            });
            if (el.fullRest) note.setCenterAlignment(true);
            if (!el.fullRest && el.dots > 0) Dot.buildAndAttach([note], { all: true });
            note.addClass(`el-${el.id}`);
            notes.push(note);
            created.push({ note, el, pos });
          }
          // quiálteras
          let i = 0;
          while (i < vEls.length) {
            const tu = vEls[i].tuplet;
            if (!tu) {
              i++;
              continue;
            }
            const group: (StaveNote | GhostNote)[] = [];
            let ticks = 0;
            const target = vEls[i].d * tu.actual; // aproximação
            while (i < vEls.length && vEls[i].tuplet && ticks < target - 1) {
              group.push(notes[i]);
              ticks += vEls[i].d;
              i++;
            }
            if (group.length > 1) tuplets.push(new Tuplet(group, { numNotes: tu.actual, notesOccupied: tu.normal }));
          }
          const len = m.length;
          const voice = new Voice({ numBeats: (len / 480) * (m.timeSig[1] / 4), beatValue: m.timeSig[1] });
          voice.setMode(VoiceMode.SOFT);
          voice.addTickables(notes);
          voices.push(voice);
          voiceStave.push(staves[pos]);
          // barras de colcheia
          const staveNotes = notes.filter((n): n is StaveNote => n instanceof StaveNote);
          const beamable = staveNotes.filter((n) => !n.isRest());
          if (beamable.length > 1) {
            try {
              const groups = Beam.getDefaultBeamGroups(`${m.timeSig[0]}/${m.timeSig[1]}`);
              beams.push(
                ...Beam.generateBeams(staveNotes, {
                  groups,
                  stemDirection: voiceIds.length > 1 ? (vi === 0 ? 1 : -1) : undefined,
                  maintainStemDirections: voiceIds.length > 1,
                }),
              );
            } catch {
              /* sem barras */
            }
          }
        });
      });

      // acidentes conforme armadura e contexto do compasso
      staffIdx.forEach((_, pos) => {
        const vs = voices.filter((_, i) => voiceStave[i] === staves[pos]);
        try {
          Accidental.applyAccidentals(vs, keySigToVex(m.keySig));
        } catch {
          /* ignora */
        }
      });

      const fmt = new Formatter();
      staffIdx.forEach((_, pos) => {
        const vs = voices.filter((_, i) => voiceStave[i] === staves[pos]);
        vs.forEach((v) => v.getTickables().forEach((t) => t.setStave(staves[pos])));
        if (vs.length) fmt.joinVoices(vs);
      });
      const avail = staves[0].getNoteEndX() - staves[0].getNoteStartX() - 14;
      try {
        fmt.format(voices, Math.max(20, avail));
      } catch {
        /* compasso estranho */
      }
      voices.forEach((v, i) => v.draw(ctx, voiceStave[i]));
      beams.forEach((b) => b.setContext(ctx).draw());
      tuplets.forEach((t) => t.setContext(ctx).draw());

      // dedilhado (acima da pauta superior / abaixo da inferior) e nomes das notas
      for (const c of created) {
        if (!c.el.keys.length) continue;
        const st = staves[c.pos];
        const cx = c.note.getAbsoluteX() + c.note.getGlyphWidth() / 2;
        let top = st.getYForLine(0);
        let bottom = st.getYForLine(4);
        try {
          const bb = c.note.getBoundingBox();
          top = Math.min(top, bb.getY());
          bottom = Math.max(bottom, bb.getY() + bb.getH());
          if (c.note.hasStem()) {
            const ext = c.note.getStemExtents();
            top = Math.min(top, ext.topY - 4, ext.baseY - 4);
            bottom = Math.max(bottom, ext.topY + 4, ext.baseY + 4);
          }
        } catch {
          /* sem caixa */
        }
        const order = c.el.keys.map((k, i) => ({ k, i })).sort((a, b) => b.k.midi - a.k.midi);
        const fs =
          opts.showFingers !== false && c.el.fingers
            ? (order.map((o) => c.el.fingers![o.i]).filter((f) => f !== undefined) as number[])
            : [];
        const above = c.pos === 0;
        let belowY = Math.max(st.getYForLine(4) + 16, bottom + 12);
        if (fs.length) {
          ctx.save();
          ctx.setFont('Arial', 11, 'bold');
          ctx.setFillStyle('#1f2937');
          fs.forEach((f, j) => {
            const t = String(f);
            const w = ctx.measureText(t).width;
            const y = above ? Math.min(st.getYForLine(0) - 8, top - 5) - (fs.length - 1 - j) * 11 : belowY + j * 11;
            ctx.fillText(t, cx - w / 2, y);
          });
          if (!above) belowY += fs.length * 11 + 1;
          ctx.restore();
        }
        if (opts.showNames) {
          ctx.save();
          ctx.setFont('Arial', 10, 'normal');
          ctx.setFillStyle('#4b5563');
          const names = order.map((o) => pitchName(o.k, opts.naming ?? 'solfege'));
          names.forEach((nm, j) => {
            const w = ctx.measureText(nm).width;
            ctx.fillText(nm, cx - w / 2, belowY + j * 11);
          });
          ctx.restore();
        }
      }

      // registro das notas + ligaduras
      for (const c of created) {
        const box: NoteBox = {
          el: c.el,
          x: (c.note.getAbsoluteX() + c.note.getGlyphWidth() / 2) * scale,
          system: si,
          group: c.note.getSVGElement() as SVGElement | undefined,
        };
        layout.notes.set(c.el.id, box);
        const lane = `${c.el.staff}:${c.el.voice}`;
        const prev = lastNoteByLane.get(lane);
        if (prev && prev.el.tieStart && c.el.tieEnd && c.el.keys.length) {
          const fromIdx: number[] = [];
          const toIdx: number[] = [];
          prev.el.keys.forEach((k, ki) => {
            if (!prev.el.tieStart![ki]) return;
            const j = c.el.keys.findIndex((p) => p.midi === k.midi);
            if (j >= 0) {
              fromIdx.push(ki);
              toIdx.push(j);
            }
          });
          if (fromIdx.length) {
            if (prev.system === si) {
              new StaveTie({ firstNote: prev.note, lastNote: c.note, firstIndexes: fromIdx, lastIndexes: toIdx })
                .setContext(ctx)
                .draw();
            } else {
              new StaveTie({ firstNote: prev.note, lastNote: null, firstIndexes: fromIdx, lastIndexes: fromIdx })
                .setContext(ctx)
                .draw();
              new StaveTie({ firstNote: null, lastNote: c.note, firstIndexes: toIdx, lastIndexes: toIdx })
                .setContext(ctx)
                .draw();
            }
          }
        }
        if (c.el.keys.length) lastNoteByLane.set(lane, { note: c.note, el: c.el, system: si });
      }

      layout.measures.set(m.index, { index: m.index, x: x * scale, width: w * scale, system: si });
      x += w;
    });
    layout.systems.push(sysBox);
  });
  void pendingTies;

  const svg = container.querySelector('svg');
  if (svg) {
    svg.setAttribute('class', 'score-svg');
    svg.style.overflow = 'visible';
  }
  return layout;
}

function midiKey(midi: number): string {
  const names = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
  return `${names[midi % 12]}/${Math.floor(midi / 12) - 1}`;
}

/** Garante que a fonte musical (Bravura) foi carregada antes de desenhar. */
let fontsReady: Promise<void> | null = null;
export function ensureMusicFonts(): Promise<void> {
  if (!fontsReady) {
    fontsReady = (async () => {
      try {
        await document.fonts.load('30px Bravura');
        await document.fonts.load('12px Academico');
      } catch {
        /* segue mesmo assim */
      }
    })();
  }
  return fontsReady;
}

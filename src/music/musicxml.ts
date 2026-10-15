import { unzipSync, strFromU8 } from 'fflate';
import { resolveTies } from './notation';
import { estimateLevel } from './build';
import { slug } from './midiImport';
import { durTicks, makePitch, ticksToDurations } from './theory';
import { IMPORT_VERSION, PPQ, type Clef, type Hand, type Measure, type NoteEl, type Pitch, type Song, type Step } from './types';

const TYPE_TO_DUR: Record<string, string> = {
  whole: 'w',
  half: 'h',
  quarter: 'q',
  eighth: '8',
  '16th': '16',
  '32nd': '32',
  '64th': '32',
  breve: 'w',
};

/** Lê .musicxml/.xml ou .mxl (compactado) e devolve o texto XML. */
export function musicXmlText(data: ArrayBuffer, fileName: string): string {
  const bytes = new Uint8Array(data);
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (!isZip && !/\.mxl$/i.test(fileName)) return new TextDecoder().decode(bytes);
  const files = unzipSync(bytes);
  const container = files['META-INF/container.xml'];
  let root: string | undefined;
  if (container) {
    const m = /full-path="([^"]+)"/.exec(strFromU8(container));
    root = m?.[1];
  }
  const name = root && files[root] ? root : Object.keys(files).find((f) => /\.(xml|musicxml)$/i.test(f) && !f.startsWith('META-INF'));
  if (!name) throw new Error('Arquivo .mxl sem partitura dentro.');
  return strFromU8(files[name]);
}

function txt(el: Element | null | undefined, sel: string): string | null {
  const x = el?.querySelector(sel);
  return x ? (x.textContent ?? '').trim() : null;
}

function num(el: Element | null | undefined, sel: string, def = 0): number {
  const t = txt(el, sel);
  const n = t === null ? NaN : Number(t);
  return Number.isFinite(n) ? n : def;
}

function directChildren(el: Element, tag: string): Element[] {
  return Array.from(el.children).filter((c) => c.tagName === tag);
}

/** Dinâmicas escritas -> intensidade (0..1). */
const DYN: Record<string, number> = { ppp: 0.2, pp: 0.28, p: 0.38, mp: 0.5, mf: 0.6, f: 0.72, ff: 0.84, fff: 0.95, sf: 0.85, sfz: 0.85, fz: 0.85 };

/** Figura de referência do metrônomo -> semínimas. */
function beatUnitQuarters(unit: string | null, dotted: boolean): number {
  const base: Record<string, number> = { whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25 };
  const q = base[unit ?? 'quarter'] ?? 1;
  return dotted ? q * 1.5 : q;
}

/**
 * Ordem de execução dos compassos com ritornelos e casas de 1ª/2ª vez
 * (D.C., D.S. e coda não são seguidos).
 */
export function playOrder(measures: Element[]): number[] {
  const n = measures.length;
  const forward: boolean[] = [];
  const backward: number[] = []; // vezes (0 = sem ritornelo)
  const endings: (number[] | null)[] = [];
  let open: number[] | null = null;
  measures.forEach((m, i) => {
    let fwd = false;
    let back = 0;
    let startNums: number[] | null = null;
    let stop = false;
    for (const b of directChildren(m, 'barline')) {
      const r = b.querySelector('repeat');
      if (r?.getAttribute('direction') === 'forward') fwd = true;
      if (r?.getAttribute('direction') === 'backward') back = Math.max(2, Number(r.getAttribute('times')) || 2);
      const e = b.querySelector('ending');
      if (e) {
        const type = e.getAttribute('type');
        const nums = (e.getAttribute('number') ?? '1')
          .split(/[,\s]+/)
          .map(Number)
          .filter((x) => x > 0);
        if (type === 'start') startNums = nums.length ? nums : [1];
        if (type === 'stop' || type === 'discontinue') stop = true;
      }
    }
    if (startNums) open = startNums;
    endings[i] = open;
    if (stop) open = null;
    forward[i] = fwd;
    backward[i] = back;
  });
  const order: number[] = [];
  let i = 0;
  let start = 0;
  let pass = 1;
  let jumped = false;
  const done = new Map<number, number>();
  while (i < n && order.length < n * 8) {
    if (forward[i] && !(jumped && i === start)) {
      start = i;
      pass = 1;
    }
    jumped = false;
    const ends = endings[i];
    const plays = !ends || ends.includes(pass);
    if (plays) order.push(i);
    if (plays && backward[i]) {
      const d = done.get(i) ?? 1;
      if (d < backward[i]) {
        done.set(i, d + 1);
        pass = d + 1;
        i = start;
        jumped = true;
        continue;
      }
      done.delete(i);
      if (!ends) {
        start = i + 1;
        pass = 1;
      }
    }
    i++;
  }
  return order;
}

interface RawNote {
  staff: number;
  voice: string;
  start: number; // ticks absolutos
  dur: number; // ticks
  pitch: Pitch | null;
  type?: string;
  dots: number;
  tie: boolean;
  finger?: number;
  tuplet?: { actual: number; normal: number };
  chord: boolean;
  measure: number;
  fullRest: boolean;
  hidden: boolean;
  vel?: number;
}

/** Converte MusicXML (score-partwise) no modelo interno. */
export function importMusicXml(xml: string, fileName: string): Song {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('XML inválido.');
  const root = doc.documentElement;
  if (root.tagName === 'score-timewise') throw new Error('MusicXML "timewise" não é suportado; exporte como "partwise".');
  const parts = Array.from(root.querySelectorAll(':scope > part'));
  if (!parts.length) throw new Error('Nenhuma parte encontrada na partitura.');

  // escolhe a parte de piano (2 pautas) ou a primeira com notas
  const partInfo = parts.map((p) => {
    const staves = Math.max(1, ...Array.from(p.querySelectorAll('attributes > staves')).map((s) => Number(s.textContent) || 1));
    const notes = p.querySelectorAll('note > pitch').length;
    const id = p.getAttribute('id') ?? '';
    const name = txt(root.querySelector(`part-list > score-part[id="${id}"]`), 'part-name') ?? '';
    return { p, staves, notes, name };
  });
  const piano =
    partInfo.find((x) => x.staves >= 2 && x.notes > 0) ??
    partInfo.find((x) => /piano|teclado|keyboard/i.test(x.name) && x.notes > 0) ??
    partInfo.find((x) => x.notes > 0) ??
    partInfo[0];
  const part = piano.p;

  const title =
    txt(root, 'work > work-title') || txt(root, 'movement-title') || fileName.replace(/\.(musicxml|xml|mxl)$/i, '');
  const composer = txt(root, 'identification > creator[type="composer"]') ?? undefined;

  let divisions = 1;
  let fifths = 0;
  let timeSig: [number, number] = [4, 4];
  // marcas de andamento ao longo da música (semínimas por minuto), na ordem em que se toca
  const tempos: { t: number; qpm: number }[] = [];
  const setTempo = (t: number, qpm: number) => {
    if (!(qpm > 0)) return;
    const last = tempos[tempos.length - 1];
    if (last && last.t === t) last.qpm = qpm;
    else if (!last || Math.abs(last.qpm - qpm) > 0.005) tempos.push({ t, qpm });
  };
  const clefs: Clef[] = [];
  const raw: RawNote[] = [];
  const measures: Measure[] = [];
  let mStart = 0;
  let lastNote: RawNote | null = null;
  let vel: number | undefined;
  const pedal: [number, number][] = [];
  let pedalDown: number | null = null;
  const pedalAt = (t: number, type: string | null) => {
    if ((type === 'stop' || type === 'change') && pedalDown !== null) {
      if (t > pedalDown) pedal.push([pedalDown, t]);
      pedalDown = null;
    }
    if (type === 'start' || type === 'change') pedalDown = t;
  };

  // ritornelos e casas de 1ª/2ª vez: a música é "desdobrada" na ordem em que se toca
  const allMeasures = directChildren(part, 'measure');
  playOrder(allMeasures).forEach((srcIndex, mi) => {
    const m = allMeasures[srcIndex];
    let cursor = 0;
    let maxCursor = 0;
    let keyChange = mi === 0;
    let timeChange = mi === 0;
    for (const el of Array.from(m.children)) {
      switch (el.tagName) {
        case 'attributes': {
          const d = num(el, 'divisions', 0);
          if (d > 0) divisions = d;
          if (el.querySelector('key > fifths')) {
            const f = num(el, 'key > fifths', 0);
            if (f !== fifths) keyChange = true;
            fifths = f;
          }
          if (el.querySelector('time > beats')) {
            const b = parseInt(txt(el, 'time > beats') ?? '4', 10) || 4;
            const bt = num(el, 'time > beat-type', 4) || 4;
            if (b !== timeSig[0] || bt !== timeSig[1]) timeChange = true;
            timeSig = [b, bt];
          }
          for (const c of Array.from(el.querySelectorAll('clef'))) {
            const n = Number(c.getAttribute('number') ?? '1') - 1;
            const sign = txt(c, 'sign');
            if (clefs[n] === undefined) clefs[n] = sign === 'F' ? 'bass' : 'treble';
          }
          break;
        }
        case 'direction':
        case 'sound': {
          const s = el.tagName === 'sound' ? el : el.querySelector('sound');
          const t = Number(s?.getAttribute('tempo'));
          if (t > 0) setTempo(mStart + cursor, t);
          else {
            const pm = num(el, 'metronome > per-minute', 0);
            // o metrônomo pode ser em mínima, semínima pontuada etc.: converte para semínimas
            if (pm) setTempo(mStart + cursor, pm * beatUnitQuarters(txt(el, 'metronome > beat-unit'), !!el.querySelector('metronome > beat-unit-dot')));
          }
          const dynAttr = s?.getAttribute('dynamics');
          if (dynAttr && Number(dynAttr) > 0) vel = Math.max(0.15, Math.min(1, (Number(dynAttr) / 100) * 0.72));
          else {
            const dyn = el.querySelector('direction-type > dynamics > *');
            if (dyn && DYN[dyn.tagName]) vel = DYN[dyn.tagName];
          }
          const pd = el.querySelector('direction-type > pedal');
          if (pd) pedalAt(mStart + cursor, pd.getAttribute('type'));
          const damper = s?.getAttribute('damper-pedal');
          if (damper) pedalAt(mStart + cursor, damper === 'no' ? 'stop' : 'start');
          break;
        }
        case 'backup':
          cursor -= num(el, 'duration', 0) * (PPQ / divisions);
          if (cursor < 0) cursor = 0;
          break;
        case 'forward':
          cursor += num(el, 'duration', 0) * (PPQ / divisions);
          maxCursor = Math.max(maxCursor, cursor);
          break;
        case 'note': {
          if (el.querySelector('grace') || el.querySelector('cue')) break;
          const isChord = !!el.querySelector(':scope > chord');
          const dur = Math.round(num(el, ':scope > duration', 0) * (PPQ / divisions));
          const staff = num(el, ':scope > staff', 1) - 1;
          const voice = txt(el, ':scope > voice') ?? '1';
          const restEl = el.querySelector(':scope > rest');
          let pitch: Pitch | null = null;
          if (!restEl) {
            const step = (txt(el, 'pitch > step') ?? 'C') as Step;
            const alter = Math.round(num(el, 'pitch > alter', 0));
            const octave = num(el, 'pitch > octave', 4);
            pitch = makePitch(step, alter, octave);
          }
          const start = isChord && lastNote ? lastNote.start : cursor;
          const tm = el.querySelector('time-modification');
          const rn: RawNote = {
            staff: Math.max(0, staff),
            voice,
            start: mStart + start,
            dur: isChord && lastNote ? lastNote.dur : dur,
            pitch,
            type: txt(el, ':scope > type') ?? undefined,
            dots: el.querySelectorAll(':scope > dot').length,
            tie: Array.from(el.querySelectorAll(':scope > tie')).some((t) => t.getAttribute('type') === 'start'),
            finger: (() => {
              const f = txt(el, 'notations > technical > fingering');
              const n = f ? parseInt(f, 10) : NaN;
              return Number.isFinite(n) && n >= 1 && n <= 5 ? n : undefined;
            })(),
            tuplet: tm ? { actual: num(tm, 'actual-notes', 3), normal: num(tm, 'normal-notes', 2) } : undefined,
            chord: isChord,
            measure: mi,
            fullRest: !!restEl && restEl.getAttribute('measure') === 'yes',
            hidden: el.getAttribute('print-object') === 'no',
            vel: el.getAttribute('dynamics') ? Math.max(0.15, Math.min(1, (Number(el.getAttribute('dynamics')) / 100) * 0.72)) : vel,
          };
          raw.push(rn);
          if (!isChord) {
            lastNote = rn;
            cursor += dur;
            maxCursor = Math.max(maxCursor, cursor);
          }
          break;
        }
      }
    }
    const nominal = Math.round((timeSig[0] * PPQ * 4) / timeSig[1]);
    const implicit = m.getAttribute('implicit') === 'yes';
    const length = implicit && maxCursor > 0 ? maxCursor : Math.max(nominal, maxCursor);
    measures.push({ index: mi, start: mStart, length, timeSig, keySig: fifths, timeSigChange: timeChange, keySigChange: keyChange });
    mStart += length;
  });
  if (pedalDown !== null) pedal.push([pedalDown, mStart]);

  const nStaves = Math.max(1, clefs.length, ...raw.map((r) => r.staff + 1));
  for (let i = 0; i < nStaves; i++) if (!clefs[i]) clefs[i] = i === 0 ? 'treble' : 'bass';

  // agrupa em elementos (acordes) por pauta/voz
  const voiceIdx = new Map<string, number>();
  const voiceOf = (staff: number, v: string) => {
    const k = `${staff}:${v}`;
    if (!voiceIdx.has(k)) {
      const used = [...voiceIdx.keys()].filter((x) => x.startsWith(staff + ':')).length;
      voiceIdx.set(k, used);
    }
    return voiceIdx.get(k)!;
  };
  const notes: NoteEl[] = [];
  let id = 0;
  const byKey = new Map<string, NoteEl>();
  for (const r of raw) {
    const voice = voiceOf(r.staff, r.voice);
    const key = `${r.staff}:${voice}:${r.start}`;
    const existing = byKey.get(key);
    if (existing && r.pitch && existing.keys.length) {
      existing.keys.push(r.pitch);
      if (existing.vel) existing.vel.push(r.vel ?? existing.vel[0]);
      existing.fingers = existing.fingers ? [...existing.fingers, r.finger] : r.finger ? [...existing.keys.slice(0, -1).map(() => undefined), r.finger] : undefined;
      existing.tieStart = existing.tieStart || r.tie ? [...(existing.tieStart ?? existing.keys.slice(0, -1).map(() => false)), r.tie] : undefined;
      continue;
    }
    if (existing) continue;
    let dur = r.type ? TYPE_TO_DUR[r.type] : undefined;
    let dots = r.dots;
    if (r.fullRest || (!r.pitch && !dur)) {
      const meas = measures[r.measure];
      if (r.fullRest || r.dur >= meas.length) {
        dur = 'w';
        dots = 0;
      }
    }
    if (!dur) {
      const d = ticksToDurations(r.dur)[0] ?? { dur: 'q', dots: 0 };
      dur = d.dur;
      dots = d.dots;
    }
    const el: NoteEl = {
      id: id++,
      t: r.start,
      d: r.dur || durTicks(dur, dots),
      staff: r.staff,
      voice,
      keys: r.pitch ? [r.pitch] : [],
      dur,
      dots,
      fingers: r.finger ? [r.finger] : undefined,
      tieStart: r.tie ? [true] : undefined,
      tuplet: r.tuplet,
      vel: r.pitch && r.vel !== undefined ? [r.vel] : undefined,
      measure: r.measure,
      fullRest: !r.pitch && (r.fullRest || r.dur >= measures[r.measure].length) ? true : undefined,
      hidden: r.hidden && !r.pitch ? true : undefined,
    };
    byKey.set(key, el);
    notes.push(el);
  }
  // ordena as notas do acorde (grave -> agudo), mantendo dedos/ligaduras alinhados
  for (const n of notes) {
    if (n.keys.length < 2) continue;
    const idx = n.keys.map((_, i) => i).sort((a, b) => n.keys[a].midi - n.keys[b].midi);
    n.keys = idx.map((i) => n.keys[i]);
    if (n.fingers) n.fingers = idx.map((i) => n.fingers![i]);
    if (n.tieStart) n.tieStart = idx.map((i) => n.tieStart![i] ?? false);
    if (n.vel) n.vel = idx.map((i) => n.vel![i] ?? n.vel![0]);
  }
  fillVoiceGaps(notes, measures, () => id++);

  const staffHands: Hand[] = clefs.map((c, i) => (nStaves === 1 ? (c === 'bass' ? 'L' : 'R') : i === 0 ? 'R' : 'L'));
  // andamento: o primeiro vale desde o início; o "principal" é o que dura mais
  if (!tempos.length) tempos.push({ t: 0, qpm: 100 });
  else tempos[0].t = 0;
  const span = new Map<number, number>();
  tempos.forEach((x, i) => {
    const q = Math.round(x.qpm * 100) / 100;
    span.set(q, (span.get(q) ?? 0) + (tempos[i + 1]?.t ?? mStart) - x.t);
  });
  const tempo = [...span.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const song: Song = {
    id: 'imp-' + slug(title) + '-' + Date.now().toString(36),
    title,
    composer: composer ?? 'Importado (MusicXML)',
    level: 1,
    source: 'import',
    tempo,
    tempoMap: tempos.length > 1 ? tempos.map((x) => ({ t: x.t, qpm: Math.round(x.qpm * 1000) / 1000 })) : undefined,
    timeSig: measures[0]?.timeSig ?? [4, 4],
    keySig: measures[0]?.keySig ?? 0,
    staves: nStaves,
    clefs: clefs.slice(0, nStaves),
    measures,
    notes,
    staffHands,
    pedal: pedal.length ? pedal : undefined,
    importVersion: IMPORT_VERSION,
  };
  song.level = estimateLevel(notes, song.tempo, nStaves);
  resolveTies(song);
  return song;
}

/** Vozes secundárias com buracos recebem pausas invisíveis para o alinhamento. */
function fillVoiceGaps(notes: NoteEl[], measures: Measure[], nextId: () => number) {
  const lanes = new Map<string, NoteEl[]>();
  for (const n of notes) {
    const k = `${n.staff}:${n.voice}:${n.measure}`;
    if (!lanes.has(k)) lanes.set(k, []);
    lanes.get(k)!.push(n);
  }
  for (const [k, els] of lanes) {
    const [staff, voice, mi] = k.split(':').map(Number);
    const meas = measures[mi];
    els.sort((a, b) => a.t - b.t);
    let cursor = meas.start;
    const add: NoteEl[] = [];
    for (const e of els) {
      if (e.t > cursor + 1) add.push(...gapRests(cursor, e.t - cursor, staff, voice, mi, nextId, voice > 0));
      cursor = Math.max(cursor, e.t + e.d);
    }
    const end = meas.start + meas.length;
    if (end > cursor + 1 && voice > 0) add.push(...gapRests(cursor, end - cursor, staff, voice, mi, nextId, true));
    notes.push(...add);
  }
  notes.sort((a, b) => a.t - b.t || a.staff - b.staff || a.voice - b.voice);
}

function gapRests(start: number, len: number, staff: number, voice: number, measure: number, nextId: () => number, hidden: boolean): NoteEl[] {
  const out: NoteEl[] = [];
  let t = start;
  for (const p of ticksToDurations(len)) {
    out.push({ id: nextId(), t, d: p.ticks, staff, voice, keys: [], dur: p.dur, dots: p.dots, measure, hidden: hidden || undefined });
    t += p.ticks;
  }
  return out;
}

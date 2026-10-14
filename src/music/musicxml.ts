import { unzipSync, strFromU8 } from 'fflate';
import { resolveTies } from './notation';
import { estimateLevel } from './build';
import { slug } from './midiImport';
import { durTicks, makePitch, ticksToDurations } from './theory';
import { PPQ, type Clef, type Hand, type Measure, type NoteEl, type Pitch, type Song, type Step } from './types';

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
  let tempo = 0;
  const clefs: Clef[] = [];
  const raw: RawNote[] = [];
  const measures: Measure[] = [];
  let mStart = 0;
  let lastNote: RawNote | null = null;

  directChildren(part, 'measure').forEach((m, mi) => {
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
          const t = s?.getAttribute('tempo');
          if (t && !tempo) tempo = Math.round(Number(t));
          if (!tempo) {
            const pm = num(el, 'metronome > per-minute', 0);
            if (pm) tempo = Math.round(pm);
          }
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
  }
  fillVoiceGaps(notes, measures, () => id++);

  const staffHands: Hand[] = clefs.map((c, i) => (nStaves === 1 ? (c === 'bass' ? 'L' : 'R') : i === 0 ? 'R' : 'L'));
  const song: Song = {
    id: 'imp-' + slug(title) + '-' + Date.now().toString(36),
    title,
    composer: composer ?? 'Importado (MusicXML)',
    level: 1,
    source: 'import',
    tempo: tempo || 100,
    timeSig: measures[0]?.timeSig ?? [4, 4],
    keySig: measures[0]?.keySig ?? 0,
    staves: nStaves,
    clefs: clefs.slice(0, nStaves),
    measures,
    notes,
    staffHands,
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

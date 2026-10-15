import { PPQ, type Clef, type Hand, type Measure, type NoteEl, type Pitch, type Song } from './types';
import { durTicks, measureTicks, parsePitch, ticksToDurations } from './theory';

/**
 * Notação textual compacta usada nas músicas e exercícios embutidos.
 *
 *   "C4q E4 G4h | (C4 E4 G4)w"
 *
 * - Nota: altura + duração opcional (w h q e s t) + pontos "." + "@dedo" + "~" (ligadura)
 * - Se a duração for omitida, repete a anterior.
 * - Acorde: "(C4@1 E4@3 G4@5)h"
 * - Pausa: "rq", "rh.", "R" = compasso inteiro
 * - "|" separa compassos.
 */
export interface SongSpec {
  id: string;
  title: string;
  composer?: string;
  description?: string;
  level?: number;
  tags?: string[];
  tempo?: number;
  time?: string; // "4/4"
  key?: number; // quintas
  rh?: string;
  lh?: string;
  /** força uma pauta só (clave da mão presente) */
  clefs?: Clef[];
  source?: Song['source'];
  /** o primeiro compasso é anacruse (incompleto) */
  pickup?: boolean;
  /** coleção na biblioteca (músicas embutidas) */
  collection?: 'folclore' | 'classico' | 'pop';
}

const DUR_LETTER: Record<string, string> = { w: 'w', h: 'h', q: 'q', e: '8', s: '16', t: '32' };

interface RawEvent {
  keys: { pitch: Pitch; finger?: number; tie: boolean }[];
  dur: string;
  dots: number;
  fullRest?: boolean;
}

function tokenize(src: string): string[] {
  const out: string[] = [];
  const re = /\([^)]*\)\S*|\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push(m[0]);
  return out;
}

function parseKey(tok: string): { pitch: Pitch; finger?: number; tie: boolean } {
  const m = /^([A-Ga-g](?:##|bb|#|b|n)?-?\d)(?:@(\d))?(~)?$/.exec(tok);
  if (!m) throw new Error(`nota inválida: "${tok}"`);
  const pitch = parsePitch(m[1]);
  if (!pitch) throw new Error(`altura inválida: "${tok}"`);
  return { pitch, finger: m[2] ? parseInt(m[2], 10) : undefined, tie: !!m[3] };
}

/** Separa um texto de mão em compassos de eventos. */
export function parseHand(src: string): RawEvent[][] {
  const measures: RawEvent[][] = [[]];
  let lastDur = 'q';
  let lastDots = 0;
  for (const tok of tokenize(src)) {
    if (tok === '|' || tok === '||') {
      measures.push([]);
      continue;
    }
    const cur = measures[measures.length - 1];
    if (tok === 'R') {
      cur.push({ keys: [], dur: 'w', dots: 0, fullRest: true });
      continue;
    }
    // separa "corpo" e sufixo de duração
    let body: string;
    let suffix: string;
    if (tok.startsWith('(')) {
      const close = tok.indexOf(')');
      body = tok.slice(1, close);
      suffix = tok.slice(close + 1);
    } else if (tok[0] === 'r') {
      body = 'r';
      suffix = tok.slice(1);
    } else {
      const m = /^([A-Ga-g](?:##|bb|#|b|n)?-?\d)(.*)$/.exec(tok);
      if (!m) throw new Error(`token inválido: "${tok}"`);
      body = m[1];
      suffix = m[2];
    }
    // sufixo: [dur][.][@f][~]  (para notas simples @ e ~ podem vir no sufixo)
    const sm = /^([whqest])?(\.*)(?:@(\d))?(~)?$/.exec(suffix);
    if (!sm) throw new Error(`duração inválida em "${tok}"`);
    if (sm[1]) {
      lastDur = DUR_LETTER[sm[1]];
      lastDots = sm[2].length;
    } else if (sm[2]) {
      lastDots = sm[2].length;
    }
    const ev: RawEvent = { keys: [], dur: lastDur, dots: lastDots };
    if (body !== 'r') {
      const parts = tok.startsWith('(') ? body.trim().split(/\s+/) : [body];
      for (const p of parts) {
        const k = parseKey(p);
        if (!tok.startsWith('(')) {
          if (sm[3]) k.finger = parseInt(sm[3], 10);
          if (sm[4]) k.tie = true;
        } else if (sm[4]) {
          k.tie = true;
        }
        ev.keys.push(k);
      }
    }
    cur.push(ev);
  }
  // remove compasso vazio final (barra final)
  while (measures.length > 1 && measures[measures.length - 1].length === 0) measures.pop();
  return measures;
}

export function buildSong(spec: SongSpec): Song {
  const timeSig = (spec.time ?? '4/4').split('/').map((x) => parseInt(x, 10)) as [number, number];
  const keySig = spec.key ?? 0;
  const hands: { hand: Hand; src: string }[] = [];
  if (spec.rh) hands.push({ hand: 'R', src: spec.rh });
  if (spec.lh) hands.push({ hand: 'L', src: spec.lh });
  const parsed = hands.map((h) => parseHand(h.src));
  const nMeasures = Math.max(...parsed.map((p) => p.length));
  const fullLen = measureTicks(timeSig);

  const clefs: Clef[] = spec.clefs ?? hands.map((h) => (h.hand === 'R' ? 'treble' : 'bass'));
  const staffHands: Hand[] = hands.map((h) => h.hand);

  // comprimento de cada compasso
  const measures: Measure[] = [];
  let start = 0;
  for (let i = 0; i < nMeasures; i++) {
    let len = fullLen;
    if (i === 0 && spec.pickup) {
      len = Math.max(
        ...parsed.map((p) =>
          (p[0] ?? []).reduce((acc, ev) => acc + (ev.fullRest ? 0 : durTicks(ev.dur, ev.dots)), 0),
        ),
      );
    }
    measures.push({ index: i, start, length: len, timeSig, keySig, timeSigChange: i === 0, keySigChange: i === 0 });
    start += len;
  }

  const notes: NoteEl[] = [];
  let id = 0;
  parsed.forEach((hm, staff) => {
    for (let mi = 0; mi < nMeasures; mi++) {
      const meas = measures[mi];
      const evs = hm[mi] ?? [{ keys: [], dur: 'w', dots: 0, fullRest: true }];
      let t = meas.start;
      for (const ev of evs) {
        const d = ev.fullRest ? meas.length : durTicks(ev.dur, ev.dots);
        notes.push({
          id: id++,
          t,
          d,
          staff,
          voice: 0,
          keys: ev.keys.map((k) => k.pitch),
          dur: ev.dur,
          dots: ev.dots,
          fingers: ev.keys.some((k) => k.finger) ? ev.keys.map((k) => k.finger) : undefined,
          tieStart: ev.keys.some((k) => k.tie) ? ev.keys.map((k) => k.tie) : undefined,
          measure: mi,
          fullRest: ev.fullRest,
        });
        t += d;
      }
      const used = t - meas.start;
      if (used > meas.length) {
        throw new Error(
          `${spec.id}: compasso ${mi + 1} da mão ${hands[staff].hand} tem ${used / PPQ} tempos (esperado ${meas.length / PPQ})`,
        );
      }
      // completa com pausas
      if (used < meas.length) {
        for (const r of ticksToDurations(meas.length - used)) {
          notes.push({ id: id++, t, d: r.ticks, staff, voice: 0, keys: [], dur: r.dur, dots: r.dots, measure: mi });
          t += r.ticks;
        }
      }
    }
  });

  const song: Song = {
    id: spec.id,
    title: spec.title,
    composer: spec.composer,
    description: spec.description,
    level: spec.level ?? 1,
    tags: spec.tags,
    source: spec.source ?? 'builtin',
    tempo: spec.tempo ?? 90,
    timeSig,
    keySig,
    staves: hands.length,
    clefs,
    measures,
    notes,
    staffHands,
  };
  resolveTies(song);
  return song;
}

/** Marca as notas que são continuação de ligadura (não devem ser tocadas novamente). */
export function resolveTies(song: Song): void {
  const byLane = new Map<string, NoteEl[]>();
  for (const n of song.notes) {
    const k = `${n.staff}:${n.voice}`;
    if (!byLane.has(k)) byLane.set(k, []);
    byLane.get(k)!.push(n);
  }
  for (const lane of byLane.values()) {
    lane.sort((a, b) => a.t - b.t);
    for (let i = 1; i < lane.length; i++) {
      const prev = lane[i - 1];
      const cur = lane[i];
      if (!prev.tieStart || cur.keys.length === 0) continue;
      const ends = cur.keys.map((k) => prev.keys.some((pk, j) => prev.tieStart![j] && pk.midi === k.midi));
      if (ends.some(Boolean)) cur.tieEnd = ends;
    }
  }
}

/** Atalho para exercícios curtos: só mão direita ou esquerda */
export function quickSong(
  id: string,
  title: string,
  opts: Partial<SongSpec> & { rh?: string; lh?: string },
): Song {
  return buildSong({ id, title, source: 'lesson', ...opts });
}

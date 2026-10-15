import type { Hand, PlayEvent, PracticeStep, Song } from './types';
import { PPQ } from './types';

export function staffHand(song: Song, staff: number): Hand {
  return song.staffHands?.[staff] ?? (staff === 0 ? 'R' : 'L');
}

/** Converte as notas notadas em eventos sonoros (resolvendo ligaduras). */
export function buildEvents(song: Song): PlayEvent[] {
  const events: PlayEvent[] = [];
  const lanes = new Map<string, typeof song.notes>();
  for (const n of song.notes) {
    const k = `${n.staff}:${n.voice}`;
    if (!lanes.has(k)) lanes.set(k, []);
    lanes.get(k)!.push(n);
  }
  for (const lane of lanes.values()) {
    lane.sort((a, b) => a.t - b.t);
    lane.forEach((n, idx) => {
      n.keys.forEach((k, ki) => {
        if (n.tieEnd?.[ki]) return; // continuação
        let d = n.d;
        // estende através de ligaduras
        let cur = n;
        let curKi = ki;
        let j = idx;
        while (cur.tieStart?.[curKi]) {
          const next = lane[j + 1];
          if (!next) break;
          const nk = next.keys.findIndex((p) => p.midi === k.midi);
          if (nk < 0) break;
          d += next.d;
          cur = next;
          curKi = nk;
          j++;
        }
        // som: onde e quanto a nota soa no arquivo (quando a importação guardou) + pedal
        const base = n.sdur?.[ki] ?? d;
        const st = n.sofs?.[ki] ? n.t + n.sofs[ki] : undefined;
        const s0 = st ?? n.t;
        events.push({
          midi: k.midi,
          t: n.t,
          d,
          hand: staffHand(song, n.staff),
          staff: n.staff,
          elId: n.id,
          keyIndex: ki,
          finger: n.fingers?.[ki],
          measure: n.measure,
          vel: n.vel?.[ki],
          st,
          sd: song.pedal?.length ? pedalEnd(song.pedal, s0, s0 + base) - s0 : n.sdur ? base : undefined,
        });
      });
    });
  }
  events.sort((a, b) => a.t - b.t || a.midi - b.midi);
  restrike(events);
  return events;
}

/**
 * Tecla tocada de novo enquanto ainda soava (pedal, notas sobrepostas no arquivo, uníssono entre vozes):
 * no piano a corda é a mesma, então o som anterior acaba ali — em vez de empilhar cópias da mesma nota.
 */
function restrike(events: PlayEvent[]) {
  const last = new Map<number, PlayEvent>();
  const at = (e: PlayEvent) => e.st ?? e.t;
  for (const e of [...events].sort((a, b) => at(a) - at(b) || a.midi - b.midi)) {
    const prev = last.get(e.midi);
    if (prev) {
      if (prev.t === e.t || Math.abs(at(prev) - at(e)) < 1) e.dup = true;
      else {
        const end = at(prev) + (prev.sd ?? prev.d);
        if (end > at(e)) prev.sd = at(e) - at(prev);
      }
    }
    if (!e.dup) last.set(e.midi, e);
  }
}

/** Onde a nota soa (ticks): a interpretação do arquivo, se houver; senão onde está escrita. */
export function soundAt(e: PlayEvent): number {
  return e.st ?? e.t;
}

// ---- andamento variável ----

export interface TempoSeg {
  t: number; // tick onde começa
  qpm: number;
  s: number; // segundos desde o tick 0 (andamento original)
}

/** Trechos de andamento da música (um só quando não há mudanças). */
export function tempoSegs(song: Pick<Song, 'tempo' | 'tempoMap'>): TempoSeg[] {
  const map = song.tempoMap?.length ? [...song.tempoMap].sort((a, b) => a.t - b.t) : [{ t: 0, qpm: song.tempo }];
  if (map[0].t > 0) map.unshift({ t: 0, qpm: map[0].qpm });
  const segs: TempoSeg[] = [];
  let s = 0;
  map.forEach((m, i) => {
    if (i > 0) s += ((m.t - map[i - 1].t) / PPQ) * (60 / map[i - 1].qpm);
    if (m.qpm > 0) segs.push({ t: m.t, qpm: m.qpm, s });
  });
  return segs.length ? segs : [{ t: 0, qpm: 100, s: 0 }];
}

function segIndex(segs: TempoSeg[], key: 't' | 's', v: number): number {
  let lo = 0;
  let hi = segs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segs[mid][key] <= v) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Segundos (andamento original) do tick 0 até `tick`; antes do início usa o primeiro andamento. */
export function tickToSecs(segs: TempoSeg[], tick: number): number {
  const g = segs[segIndex(segs, 't', tick)];
  return g.s + ((tick - g.t) / PPQ) * (60 / g.qpm);
}

export function secsToTick(segs: TempoSeg[], sec: number): number {
  const g = segs[segIndex(segs, 's', sec)];
  return g.t + ((sec - g.s) * g.qpm * PPQ) / 60;
}

export function qpmAt(segs: TempoSeg[], tick: number): number {
  return segs[segIndex(segs, 't', tick)].qpm;
}

/** Faixa de andamentos da música (para mostrar quando ele varia). */
export function tempoRange(song: Pick<Song, 'tempo' | 'tempoMap'>): [number, number] {
  const qs = tempoSegs(song).map((g) => g.qpm);
  return [Math.min(...qs), Math.max(...qs)];
}

/** Com o pedal abaixado quando a tecla é solta, a nota continua soando até o pedal subir. */
export function pedalEnd(pedal: [number, number][], start: number, end: number): number {
  for (const [a, b] of pedal) if (a <= end && end < b && b > start) return b;
  return end;
}

export function buildSteps(events: PlayEvent[], hands: Hand[]): PracticeStep[] {
  const steps: PracticeStep[] = [];
  for (const e of events) {
    if (!hands.includes(e.hand)) continue;
    const last = steps[steps.length - 1];
    if (last && Math.abs(last.t - e.t) < 2) {
      if (!last.events.some((x) => x.midi === e.midi)) last.events.push(e);
    } else {
      steps.push({ index: steps.length, t: e.t, events: [e], measure: e.measure });
    }
  }
  return steps;
}

export function ticksToSeconds(ticks: number, qpm: number): number {
  return (ticks / PPQ) * (60 / qpm);
}

export function secondsToTicks(sec: number, qpm: number): number {
  return (sec * qpm * PPQ) / 60;
}

export function songEnd(song: Song): number {
  const last = song.measures[song.measures.length - 1];
  return last ? last.start + last.length : 0;
}

export function measureAt(song: Song, tick: number): number {
  let lo = 0;
  let hi = song.measures.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (song.measures[mid].start <= tick) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function songRange(song: Song): [number, number] {
  let lo = 127;
  let hi = 0;
  for (const n of song.notes)
    for (const k of n.keys) {
      lo = Math.min(lo, k.midi);
      hi = Math.max(hi, k.midi);
    }
  if (lo > hi) return [60, 72];
  return [lo, hi];
}

export function handsInSong(song: Song): Hand[] {
  const hs = new Set<Hand>();
  for (const n of song.notes) if (n.keys.length) hs.add(staffHand(song, n.staff));
  return (['R', 'L'] as Hand[]).filter((h) => hs.has(h));
}

/** Notas como o app as toca (segundos no andamento original): o mesmo cálculo do modo "Ouvir". */
export function songSounds(song: Song): { midi: number; time: number; dur: number; vel: number }[] {
  const segs = tempoSegs(song);
  return buildEvents(song)
    .filter((e) => !e.dup)
    .map((e) => {
      const s0 = e.st ?? e.t;
      const time = tickToSecs(segs, s0);
      return {
        midi: e.midi,
        time,
        dur: (tickToSecs(segs, s0 + (e.sd ?? e.d)) - time) * (e.sd ? 1 : 0.95),
        vel: e.vel !== undefined ? 0.25 + 0.75 * e.vel : 0.7,
      };
    });
}

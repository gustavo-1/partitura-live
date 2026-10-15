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
          sd: song.pedal?.length ? pedalEnd(song.pedal, n.t, n.t + d) - n.t : undefined,
        });
      });
    });
  }
  events.sort((a, b) => a.t - b.t || a.midi - b.midi);
  return events;
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

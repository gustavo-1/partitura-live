import { useEffect, useMemo, useRef, useState } from 'react';
import type { Activity, KeysSpec, StaffSpec } from '../../data/curriculum';
import { buildSong } from '../../music/notation';
import { builtinSong } from '../../data/songs';
import { generateExercise } from '../../music/generator';
import { buildEvents } from '../../music/timeline';
import { midiName, parsePitch, pitchClass, pitchToVexKey, SOLFEGE, spellMidi, STEPS, type NamingStyle } from '../../music/theory';
import { PPQ, type Hand, type Song } from '../../music/types';
import { input, type NoteEvent } from '../../audio/input';
import { audioCtx, now, resumeAudio } from '../../audio/context';
import { click } from '../../audio/metronome';
import { playNote, preloadPiano } from '../../audio/piano';
import { mic } from '../../audio/mic';
import { Score, type NoteMark } from '../../components/score/Score';
import { Keyboard, type KeyMark } from '../../components/Keyboard';
import { MiniPlayer } from '../../components/MiniPlayer';
import { RichText } from '../../components/RichText';
import { Icon } from '../../components/Icon';
import { useStore } from '../../lib/store';
import { settings } from '../../state/settings';
import { progress, recordNoteRead } from '../../state/progress';
import { isDue } from '../../practice/review';

export interface ActivityProps<T extends Activity = Activity> {
  activity: T;
  /** score 0..1 ou null (não avaliada) */
  onComplete: (score: number | null) => void;
}

let songSeq = 0;
function staffSong(spec: StaffSpec, title = ''): Song {
  return buildSong({ id: `lesson-staff-${++songSeq}`, title, source: 'lesson', rh: spec.rh, lh: spec.lh, time: spec.time, key: spec.key });
}

function StaffView({ spec }: { spec: StaffSpec }) {
  const st = useStore(settings);
  const song = useMemo(() => staffSong(spec), [spec]);
  return <Score song={song} options={{ showNames: spec.names ?? false, naming: st.naming, showFingers: true }} autoScroll={false} />;
}

function KeysView({ spec }: { spec: KeysSpec }) {
  const st = useStore(settings);
  const marks = new Map<number, KeyMark>();
  for (const m of spec.highlight ?? []) marks.set(m, { hint: spec.color ?? 'var(--accent)' });
  for (const [m, label] of Object.entries(spec.labels ?? {})) marks.set(Number(m), { ...marks.get(Number(m)), label });
  return (
    <Keyboard
      lo={spec.lo}
      hi={spec.hi}
      marks={marks}
      labels="none"
      naming={st.naming}
      onDown={(m) => input.press(m)}
      onUp={(m) => input.release(m)}
    />
  );
}

// ---------- Explicação ----------
export function InfoActivity({ activity, onComplete }: ActivityProps<Extract<Activity, { type: 'info' }>>) {
  useEffect(() => onComplete(null), [onComplete]);
  return (
    <div className="stack">
      {activity.title && <h2>{activity.title}</h2>}
      <RichText text={activity.text} />
      {activity.staff && <StaffView spec={activity.staff} />}
      {activity.keys && <KeysView spec={activity.keys} />}
    </div>
  );
}

// ---------- Quiz ----------
export function QuizActivity({ activity, onComplete }: ActivityProps<Extract<Activity, { type: 'quiz' }>>) {
  const [picked, setPicked] = useState<number | null>(null);
  const right = picked === activity.answer;
  return (
    <div className="stack">
      <div className="big-question">{activity.question}</div>
      {activity.staff && <StaffView spec={activity.staff} />}
      {activity.keys && <KeysView spec={activity.keys} />}
      <div className={'answer-grid' + (activity.options.some((o) => o.length > 14) ? ' long' : '')}>
        {activity.options.map((o, i) => (
          <button
            key={i}
            className={'btn' + (picked !== null && i === activity.answer ? ' right' : picked === i && !right ? ' wrong' : '')}
            disabled={picked !== null}
            onClick={() => {
              setPicked(i);
              onComplete(i === activity.answer ? 1 : 0);
            }}
          >
            {o}
          </button>
        ))}
      </div>
      {picked !== null && (
        <div className={'feedback-line ' + (right ? 'ok' : 'bad')}>
          {right ? 'Correto!' : 'Não exatamente.'} {activity.explain && <span className="muted" style={{ fontWeight: 500 }}>{activity.explain}</span>}
        </div>
      )}
    </div>
  );
}

// ---------- Encontre a tecla ----------
const PC_HINT: Record<number, string> = {
  0: 'O Dó fica à esquerda do grupo de 2 teclas pretas.',
  2: 'O Ré fica entre as 2 teclas pretas.',
  4: 'O Mi fica à direita do grupo de 2 teclas pretas.',
  5: 'O Fá fica à esquerda do grupo de 3 teclas pretas.',
  7: 'O Sol fica entre a 1ª e a 2ª tecla preta do grupo de 3.',
  9: 'O Lá fica entre a 2ª e a 3ª tecla preta do grupo de 3.',
  11: 'O Si fica à direita do grupo de 3 teclas pretas.',
  1: 'Procure o grupo de 2 teclas pretas.',
  3: 'Procure o grupo de 2 teclas pretas.',
  6: 'O Fá♯ é a tecla preta logo à direita do Fá (a 1ª do grupo de 3).',
  8: 'Procure o grupo de 3 teclas pretas.',
  10: 'O Si♭ é a tecla preta logo à esquerda do Si (a 3ª do grupo de 3).',
};

export function FindActivity({ activity, onComplete }: ActivityProps<Extract<Activity, { type: 'find' }>>) {
  const st = useStore(settings);
  const seq = useMemo(() => {
    const out: (typeof activity.targets)[number][] = [];
    for (let i = 0; i < activity.count; i++) {
      const pick = () => activity.targets[Math.floor(Math.random() * activity.targets.length)];
      let t = pick();
      // evita repetir o mesmo pedido em seguida (com limite de tentativas)
      for (let tries = 0; tries < 10 && out.length && t.label === out[out.length - 1].label; tries++) t = pick();
      out.push(t);
    }
    return out;
  }, [activity]);
  const [idx, setIdx] = useState(0);
  const [firstTry, setFirstTry] = useState(0);
  const [missed, setMissed] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [flash, setFlash] = useState<Map<number, KeyMark>>(new Map());
  const state = useRef({ idx, missed, firstTry });
  state.current = { idx, missed, firstTry };
  const done = idx >= seq.length;

  useEffect(() => {
    if (done) onComplete(firstTry / seq.length);
  }, [done, firstTry, seq.length, onComplete]);

  useEffect(
    () =>
      input.on((e: NoteEvent) => {
        if (e.type !== 'on') return;
        const { idx: i, missed: ms } = state.current;
        const target = seq[i];
        if (!target) return;
        const ok = target.midi !== undefined ? e.midi === target.midi : pitchClass(e.midi) === target.pc;
        setFlash(new Map([[e.midi, { fill: ok ? '#4ade80' : '#f87171' }]]));
        if (ok) {
          if (!ms) setFirstTry((f) => f + 1);
          setMsg({ ok: true, text: ['Isso!', 'Muito bem!', 'Certo!', 'Perfeito!'][i % 4] });
          setMissed(false);
          setTimeout(() => setIdx((x) => x + 1), 450);
        } else {
          setMissed(true);
          const name = midiName(e.midi, st.naming);
          const hint = target.midi === 60 && pitchClass(e.midi) === 0 ? 'É um Dó, mas não o central: procure o Dó mais perto do meio do teclado.' : PC_HINT[target.pc ?? pitchClass(target.midi ?? 0)];
          setMsg({ ok: false, text: `Essa é ${name}. ${hint}` });
        }
      }),
    [seq, st.naming],
  );

  const target = seq[Math.min(idx, seq.length - 1)];
  return (
    <div className="stack">
      <div className="center muted small">
        {Math.min(idx + 1, seq.length)} de {seq.length}
      </div>
      <div className="big-question">{done ? 'Concluído!' : activity.prompt && seq.length && idx === 0 ? activity.prompt : `Toque: ${target.label}`}</div>
      {!done && activity.prompt && idx > 0 && <div className="center muted">{activity.prompt}</div>}
      <div className={'feedback-line ' + (msg?.ok ? 'ok' : 'bad')}>{msg?.text}</div>
      <Keyboard
        lo={activity.lo ?? 48}
        hi={activity.hi ?? 76}
        marks={flash}
        labels="none"
        naming={st.naming}
        onDown={(m) => input.press(m)}
        onUp={(m) => input.release(m)}
      />
      <p className="small muted center">Toque no seu teclado (com o microfone ligado) ou aqui na tela.</p>
    </div>
  );
}

// ---------- Leitura de notas (cartões) ----------
function pickWeighted(pool: string[], clefKey: (p: string) => string, last: string | null): string {
  const stats = progress.get().noteStats;
  const weights = pool.map((p) => {
    if (p === last && pool.length > 1) return 0;
    const s = stats[clefKey(p)];
    if (!s) return 3; // novidade
    const err = 1 - s.correct / Math.max(1, s.seen);
    const slow = s.ms > 2500 ? 1 : 0;
    // repetição espaçada: a nota "vencida" volta com prioridade
    const due = isDue(s) ? 2.5 : 0;
    return 1 + (4 - s.box) * 0.6 + err * 4 + slow + due;
  });
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

export function noteNameButtons(naming: NamingStyle) {
  return STEPS.map((s) => ({ step: s, label: naming === 'solfege' ? SOLFEGE[s] : s }));
}

export function ReadCards({
  pool,
  clef,
  count,
  answer = 'both',
  keySig = 0,
  onComplete,
  endless,
}: {
  pool: string[];
  clef: 'treble' | 'bass' | 'grand';
  count: number;
  answer?: 'play' | 'name' | 'both';
  keySig?: number;
  onComplete: (score: number) => void;
  endless?: boolean;
}) {
  const st = useStore(settings);
  const clefOf = (p: string) => (clef === 'grand' ? ((parsePitch(p)?.midi ?? 60) < 60 ? 'bass' : 'treble') : clef);
  const statKey = (p: string) => `${clefOf(p)}:${parsePitch(p)?.midi}`;
  const [card, setCard] = useState(() => pickWeighted(pool, statKey, null));
  const [n, setN] = useState(0);
  const [score, setScore] = useState(0);
  const [answered, setAnswered] = useState<null | { ok: boolean; half?: boolean; text: string }>(null);
  const started = useRef(performance.now());
  const pitch = parsePitch(card)!;
  const hasAcc = pool.some((p) => (parsePitch(p)?.alter ?? 0) !== 0);
  const mode = hasAcc ? 'play' : answer;

  const song = useMemo(() => {
    const tok = `${card}w`;
    if (clef === 'grand') {
      const isBass = pitch.midi < 60;
      return buildSong({ id: 'card', title: '', source: 'lesson', rh: isBass ? 'R' : tok, lh: isBass ? tok : 'R', key: keySig });
    }
    return buildSong({ id: 'card', title: '', source: 'lesson', [clef === 'bass' ? 'lh' : 'rh']: tok, key: keySig });
  }, [card, clef, pitch.midi, keySig]);

  const done = !endless && n >= count;
  useEffect(() => {
    if (done) onComplete(score / count);
  }, [done, score, count, onComplete]);

  const next = (delay: number) => {
    setTimeout(() => {
      setAnswered(null);
      setN((x) => x + 1);
      setCard((c) => pickWeighted(pool, statKey, c));
      started.current = performance.now();
    }, delay);
  };

  const resolve = (ok: boolean, half: boolean, text: string) => {
    const ms = performance.now() - started.current;
    recordNoteRead(statKey(card), ok, ms);
    setScore((s) => s + (ok ? 1 : half ? 0.5 : 0));
    setAnswered({ ok, half, text });
    next(ok ? 550 : 1700);
  };

  const ansRef = useRef(answered);
  ansRef.current = answered;
  useEffect(
    () =>
      input.on((e) => {
        if (e.type !== 'on' || ansRef.current || mode === 'name') return;
        if (e.midi === pitch.midi) resolve(true, false, 'Certo!');
        else if (pitchClass(e.midi) === pitchClass(pitch.midi))
          resolve(false, true, `Nome certo, oitava errada: era ${midiName(pitch.midi, st.naming, true, keySig)}. Repare na posição na pauta.`);
        else resolve(false, false, `Era ${midiName(pitch.midi, st.naming, true, keySig)} — você tocou ${midiName(e.midi, st.naming, true, keySig)}.`);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [card, mode, st.naming],
  );

  const marks: Map<number, NoteMark> = new Map();
  if (answered) for (const el of song.notes) if (el.keys.length) marks.set(el.id, answered.ok ? 'ok' : 'bad');
  const keyMarks = new Map<number, KeyMark>();
  if (answered && !answered.ok) keyMarks.set(pitch.midi, { hint: '#22c55e', label: midiName(pitch.midi, st.naming) });

  if (done) return <div className="big-question">Concluído!</div>;
  const lo = clef === 'bass' ? 36 : clef === 'grand' ? 41 : 55;
  const hi = clef === 'bass' ? 64 : clef === 'grand' ? 79 : 84;
  return (
    <div className="stack">
      <div className="row between small muted">
        <span>{endless ? `${n} respondidas` : `${n + 1} de ${count}`}</span>
        <span>
          Acertos: {score % 1 ? score.toFixed(1) : score}
          {n > 0 ? ` (${Math.round((score / n) * 100)}%)` : ''}
        </span>
      </div>
      <div style={{ maxWidth: 240, margin: '0 auto', width: '100%' }}>
        <Score song={song} options={{ showFingers: false, scale: 1.3, singleLine: true, bare: true }} marks={marks} autoScroll={false} />
      </div>
      <div className={'feedback-line ' + (answered ? (answered.ok ? 'ok' : 'bad') : '')}>{answered?.text ?? (mode === 'name' ? 'Qual é esta nota?' : 'Toque esta nota')}</div>
      {mode !== 'play' && (
        <div className="answer-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(70px, 1fr))' }}>
          {noteNameButtons(st.naming).map((b) => (
            <button
              key={b.step}
              className={'btn' + (answered && b.step === pitch.step ? ' right' : '')}
              disabled={!!answered}
              onClick={() => (b.step === pitch.step ? resolve(true, false, 'Certo!') : resolve(false, false, `Era ${midiName(pitch.midi, st.naming, false, keySig)}.`))}
            >
              {b.label}
            </button>
          ))}
        </div>
      )}
      {mode !== 'name' && (
        <Keyboard lo={lo} hi={hi} marks={keyMarks} labels="none" naming={st.naming} onDown={(m) => input.press(m)} onUp={(m) => input.release(m)} />
      )}
    </div>
  );
}

export function ReadActivity({ activity, onComplete }: ActivityProps<Extract<Activity, { type: 'read' }>>) {
  return (
    <ReadCards
      pool={activity.pool}
      clef={activity.clef}
      count={activity.count}
      answer={activity.answer}
      keySig={activity.key}
      onComplete={onComplete}
    />
  );
}

// ---------- Ritmo ----------
export function RhythmExercise({ pattern, tempo, time, onComplete }: { pattern: string; tempo: number; time?: string; onComplete: (s: number) => void }) {
  const song = useMemo(() => buildSong({ id: 'rhythm', title: '', source: 'lesson', rh: pattern, time }), [pattern, time]);
  const events = useMemo(() => buildEvents(song), [song]);
  const [phase, setPhase] = useState<'idle' | 'count' | 'play' | 'done' | 'demo'>('idle');
  const [beat, setBeat] = useState(-1);
  const [marks, setMarks] = useState<Map<number, NoteMark>>(new Map());
  const [flash, setFlash] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const taps = useRef<number[]>([]);
  const t0 = useRef(0);
  const timers = useRef<number[]>([]);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const secPerTick = 60 / tempo / PPQ;
  const beatsPerBar = song.timeSig[0] * (4 / song.timeSig[1]);
  const total = song.measures.reduce((a, m) => a + m.length, 0);

  const clearTimers = () => {
    timers.current.forEach((t) => clearTimeout(t));
    timers.current = [];
  };
  useEffect(() => clearTimers, []);

  const tap = (time: number) => {
    if (phaseRef.current !== 'play' && phaseRef.current !== 'count') return;
    taps.current.push(time);
    setFlash(true);
    setTimeout(() => setFlash(false), 90);
  };

  useEffect(() => {
    const off = input.on((e) => {
      if (e.type === 'on') tap(e.time);
    });
    const key = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        if (!e.repeat) tap(now());
      }
    };
    window.addEventListener('keydown', key);
    return () => {
      off();
      window.removeEventListener('keydown', key);
    };
  }, []);

  const run = async (demo: boolean) => {
    await resumeAudio();
    clearTimers();
    taps.current = [];
    setMarks(new Map());
    setSummary(null);
    const ctx = audioCtx();
    const beatSec = 60 / tempo;
    const start = ctx.currentTime + 0.2;
    const countIn = beatsPerBar;
    t0.current = start + countIn * beatSec;
    const totalBeats = countIn + total / PPQ;
    for (let b = 0; b < totalBeats; b++) {
      click(start + b * beatSec, b % beatsPerBar === 0);
      const id = window.setTimeout(() => setBeat(b), (start + b * beatSec - ctx.currentTime) * 1000);
      timers.current.push(id);
    }
    if (demo) for (const e of events) playNote(e.midi, t0.current + e.t * secPerTick, Math.min(0.5, e.d * secPerTick * 0.9), 0.6);
    setPhase(demo ? 'demo' : 'count');
    timers.current.push(window.setTimeout(() => !demo && setPhase('play'), (t0.current - ctx.currentTime - 0.15) * 1000));
    const endAt = t0.current + total * secPerTick + 0.4;
    timers.current.push(
      window.setTimeout(() => {
        setBeat(-1);
        if (demo) {
          setPhase('idle');
          return;
        }
        evaluate();
      }, (endAt - ctx.currentTime) * 1000),
    );
  };

  const evaluate = () => {
    const beatSec = 60 / tempo;
    const win = Math.min(0.22, beatSec * 0.35);
    const used = new Set<number>();
    const devs: number[] = [];
    const mk = new Map<number, NoteMark>();
    let hits = 0;
    for (const e of events) {
      const te = t0.current + e.t * secPerTick;
      let best = -1;
      let bd = Infinity;
      taps.current.forEach((t, i) => {
        if (used.has(i)) return;
        const d = Math.abs(t - te);
        if (d < bd) {
          bd = d;
          best = i;
        }
      });
      if (best >= 0 && bd <= win) {
        used.add(best);
        hits++;
        devs.push(taps.current[best] - te);
        mk.set(e.elId, 'ok');
      } else mk.set(e.elId, 'bad');
    }
    const extras = taps.current.filter((t, i) => !used.has(i) && t >= t0.current - win).length;
    const score = Math.max(0, hits / events.length - extras * 0.08);
    setMarks(mk);
    const avg = devs.length ? devs.reduce((a, b) => a + b, 0) / devs.length : 0;
    setSummary(
      `${hits} de ${events.length} no tempo` +
        (extras ? `, ${extras} toque(s) a mais` : '') +
        (devs.length > 2 ? (Math.abs(avg) < 0.04 ? ' · ritmo firme!' : avg < 0 ? ' · você está se adiantando um pouco' : ' · você está atrasando um pouco') : ''),
    );
    setPhase('done');
    onComplete(score);
  };

  return (
    <div className="stack">
      <Score song={song} marks={marks} options={{ showFingers: false }} autoScroll={false} />
      <div className="beat-dots" aria-hidden>
        {Array.from({ length: beatsPerBar }, (_, i) => (
          <span key={i} className={beat >= 0 && beat % beatsPerBar === i ? 'on' : ''} />
        ))}
      </div>
      <div
        className={'tap-pad' + (flash ? ' flash' : '')}
        onPointerDown={(e) => {
          e.preventDefault();
          tap(now());
        }}
      >
        {phase === 'count' ? 'Prepare-se… (contagem)' : phase === 'play' ? 'Bata aqui no ritmo!' : phase === 'demo' ? 'Ouça o ritmo…' : 'Área de toque'}
      </div>
      {summary && <div className="feedback-line">{summary}</div>}
      <div className="row" style={{ justifyContent: 'center' }}>
        <button className="btn" disabled={phase === 'count' || phase === 'play' || phase === 'demo'} onClick={() => void run(true)}>
          <Icon name="ear" /> Ouvir
        </button>
        <button className="btn primary" disabled={phase === 'count' || phase === 'play' || phase === 'demo'} onClick={() => void run(false)}>
          <Icon name="play" /> {phase === 'done' ? 'Tentar de novo' : 'Começar'}
        </button>
      </div>
      <p className="small muted center">Bata na área, aperte espaço ou toque qualquer tecla do piano. A contagem dura 1 compasso.</p>
    </div>
  );
}

export function RhythmActivity({ activity, onComplete }: ActivityProps<Extract<Activity, { type: 'rhythm' }>>) {
  return (
    <div className="stack">
      {activity.intro && <p className="muted">{activity.intro}</p>}
      <RhythmExercise pattern={activity.pattern} tempo={activity.tempo} time={activity.time} onComplete={onComplete} />
    </div>
  );
}

// ---------- Tocar ----------
export function PlayActivity({ activity, onComplete }: ActivityProps<Extract<Activity, { type: 'play' }>>) {
  const song = useMemo(() => {
    if (activity.songId) return builtinSong(activity.songId)!;
    return buildSong({ id: `lesson-play-${++songSeq}`, title: 'Exercício', source: 'lesson', ...activity.spec });
  }, [activity]);
  const [res, setRes] = useState<number | null>(null);
  const hands: Hand[] | undefined = activity.hands ? (activity.hands === 'RL' ? ['R', 'L'] : [activity.hands]) : undefined;
  return (
    <div className="stack">
      {activity.intro && <p className="muted">{activity.intro}</p>}
      {activity.songId && <h3>{song.title}</h3>}
      <MiniPlayer
        song={song}
        hands={hands}
        loop={activity.loop ?? null}
        mode={activity.mode ?? 'wait'}
        onDone={(r) => {
          const acc = r.mode === 'listen' ? null : r.accuracy;
          setRes(acc);
          if (acc !== null) onComplete(acc);
        }}
      />
      {res !== null && (
        <div className={'feedback-line ' + (res >= 0.8 ? 'ok' : 'bad')}>
          {Math.round(res * 100)}% de acertos de primeira {res >= 0.8 ? '— muito bem!' : '— tente de novo devagar, ou continue.'}
        </div>
      )}
    </div>
  );
}

export function SightActivity({ activity, onComplete }: ActivityProps<Extract<Activity, { type: 'sight' }>>) {
  const [seed, setSeed] = useState(() => Date.now());
  const song = useMemo(() => generateExercise(activity.level, seed), [activity.level, seed]);
  return (
    <div className="stack">
      {activity.intro && <p className="muted">{activity.intro}</p>}
      <MiniPlayer key={seed} song={song} onDone={(r) => r.mode !== 'listen' && onComplete(r.accuracy)} />
      <button className="btn ghost" onClick={() => setSeed(Date.now())}>
        <Icon name="sparkle" /> Gerar outro exercício
      </button>
    </div>
  );
}

// ---------- Ouça e toque (de ouvido) ----------
function midiToken(m: number): string {
  const [n, o] = pitchToVexKey(spellMidi(m, 0)).split('/');
  return n[0].toUpperCase() + n.slice(1) + o;
}

/** Melodia curta que começa na nota de referência e anda mais por graus conjuntos. */
export function makeEchoPattern(pool: number[], length: number, seed = Math.random()): number[] {
  let r = seed * 9301 + 49297;
  const rnd = () => {
    r = (r * 9301 + 49297) % 233280;
    return r / 233280;
  };
  const out = [pool[0]];
  let i = 0;
  for (let k = 1; k < length; k++) {
    let next = i;
    for (let tries = 0; tries < 8 && (next === i || next < 0 || next >= pool.length); tries++) {
      const leap = rnd() < 0.3 ? 2 : 1;
      next = i + (rnd() < 0.5 ? -leap : leap);
    }
    if (next < 0 || next >= pool.length) next = Math.min(pool.length - 1, i + 1);
    i = next;
    out.push(pool[i]);
  }
  return out;
}

export function EchoTrainer({
  pool,
  length = 3,
  count = 3,
  tempo = 84,
  clef = 'treble',
  fixed,
  onComplete,
  onSolved,
}: {
  pool: number[];
  length?: number;
  count?: number;
  tempo?: number;
  clef?: 'treble' | 'bass';
  fixed?: number[][];
  onComplete: (score: number) => void;
  onSolved?: (firstTry: boolean) => void;
}) {
  const st = useStore(settings);
  const patterns = useMemo(
    () => fixed ?? Array.from({ length: count }, () => makeEchoPattern(pool, length)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pool.join(','), length, count, fixed],
  );
  const [round, setRound] = useState(0);
  const [pos, setPos] = useState(0);
  const [misses, setMisses] = useState(0);
  const [scores, setScores] = useState<number[]>([]);
  const [phase, setPhase] = useState<'playing' | 'answer' | 'solved' | 'revealed'>('playing');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [flash, setFlash] = useState<Map<number, KeyMark>>(new Map());
  const playingUntil = useRef(0);
  const timer = useRef<number | null>(null);
  const pat = patterns[Math.min(round, patterns.length - 1)];
  const done = round >= patterns.length;
  const lo = Math.min(...pool) - 5;
  const hi = Math.max(...pool) + 5;

  useEffect(() => {
    if (done) onComplete(scores.reduce((a, b) => a + b, 0) / Math.max(1, scores.length));
  }, [done, scores, onComplete]);

  const play = async (notes = pat) => {
    const ctx = await resumeAudio();
    await preloadPiano(lo, hi).catch(() => undefined);
    const beat = 60 / tempo;
    const t0 = ctx.currentTime + 0.15;
    notes.forEach((m, i) => playNote(m, t0 + i * beat, beat * 0.95));
    const end = t0 + notes.length * beat + 0.35;
    playingUntil.current = end;
    mic.suppress(end);
    setPhase((p) => (p === 'solved' || p === 'revealed' ? p : 'playing'));
    setPos(0);
    if (timer.current) clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setPhase((p) => (p === 'playing' ? 'answer' : p)), Math.max(0, (end - ctx.currentTime) * 1000));
  };
  useEffect(() => {
    if (done) return;
    setMisses(0);
    setMsg(null);
    setPhase('playing');
    void play(patterns[round]);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round]);

  const st8 = useRef({ phase, pos, misses, pat });
  st8.current = { phase, pos, misses, pat };
  useEffect(
    () =>
      input.on((e: NoteEvent) => {
        if (e.type !== 'on') return;
        const { phase: ph, pos: p, misses: ms, pat: cur } = st8.current;
        if (ph === 'solved' || ph === 'revealed') return;
        // o próprio app tocando: ignora o que o microfone ouvir
        if (e.source === 'mic' && e.time < playingUntil.current) return;
        if (ph === 'playing' && e.source === 'mic') return;
        if (e.midi === cur[p]) {
          setFlash(new Map([[e.midi, { fill: '#4ade80' }]]));
          if (p + 1 >= cur.length) {
            const sc = ms === 0 ? 1 : ms <= 2 ? 0.6 : 0.3;
            setScores((x) => [...x, sc]);
            setPhase('solved');
            setMsg({ ok: true, text: ms === 0 ? 'De primeira! 👏' : 'Conseguiu!' });
            onSolved?.(ms === 0);
          } else setPos(p + 1);
        } else {
          setFlash(new Map([[e.midi, { fill: '#f87171' }]]));
          setMisses(ms + 1);
          setPos(0);
          setMsg({
            ok: false,
            text: p === 0 ? `A melodia começa em ${midiName(cur[0], st.naming)}. Tente de novo.` : 'Quase! Recomece do início — ouça de novo se precisar.',
          });
        }
      }),
    [onSolved, st.naming],
  );

  if (done) return <div className="big-question">Concluído!</div>;

  const marks = new Map<number, KeyMark>(flash);
  // referência: a primeira nota fica marcada
  if (!marks.has(pat[0])) marks.set(pat[0], { hint: 'var(--accent)', label: '★' });
  if (phase === 'revealed') pat.forEach((m, i) => marks.set(m, { hint: '#22c55e', label: String(i + 1) }));
  const showStaff = phase === 'solved' || phase === 'revealed';
  const tokens = pat.map((m, i) => midiToken(m) + (i === pat.length - 1 ? 'h' : 'q')).join(' ');
  return (
    <div className="stack">
      <div className="row between small muted">
        <span>
          Melodia {round + 1} de {patterns.length}
        </span>
        <span className="echo-dots" aria-label={`${pos} de ${pat.length} notas`}>
          {pat.map((_, i) => (
            <i key={i} className={i < pos || phase === 'solved' ? 'on' : ''} />
          ))}
        </span>
      </div>
      <div className="big-question">{phase === 'playing' ? '🎧 Ouça…' : phase === 'answer' ? 'Agora toque de volta' : phase === 'solved' ? 'Isso! É assim que se escreve:' : 'Era assim:'}</div>
      {showStaff && (
        <div style={{ maxWidth: 360, margin: '0 auto', width: '100%' }}>
          <StaffView spec={{ [clef === 'bass' ? 'lh' : 'rh']: tokens, names: true }} />
        </div>
      )}
      <div className={'feedback-line ' + (msg ? (msg.ok ? 'ok' : 'bad') : 'muted')}>{msg?.text ?? `Começa na nota marcada com ★ (${midiName(pat[0], st.naming)}).`}</div>
      <Keyboard lo={lo} hi={hi} marks={marks} labels="c" naming={st.naming} onDown={(m) => input.press(m)} onUp={(m) => input.release(m)} />
      <div className="row" style={{ justifyContent: 'center' }}>
        {phase !== 'solved' && phase !== 'revealed' && (
          <button className="btn" onClick={() => void play()}>
            <Icon name="ear" /> Ouvir de novo
          </button>
        )}
        {misses >= 3 && phase === 'answer' && (
          <button
            className="btn ghost"
            onClick={() => {
              setScores((x) => [...x, 0]);
              setPhase('revealed');
              void play();
            }}
          >
            Mostrar a resposta
          </button>
        )}
        {(phase === 'solved' || phase === 'revealed') && (
          <>
            <button className="btn" onClick={() => void play()}>
              <Icon name="ear" /> Ouvir
            </button>
            <button className="btn primary" onClick={() => setRound((r) => r + 1)}>
              {round + 1 >= patterns.length ? 'Concluir' : 'Próxima melodia'} <Icon name="next" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function EchoActivity({ activity, onComplete }: ActivityProps<Extract<Activity, { type: 'echo' }>>) {
  return (
    <div className="stack">
      {activity.intro && <p className="muted">{activity.intro}</p>}
      <EchoTrainer
        pool={activity.pool}
        length={activity.length}
        count={activity.count}
        tempo={activity.tempo}
        clef={activity.clef}
        fixed={activity.fixed}
        onComplete={onComplete}
      />
    </div>
  );
}

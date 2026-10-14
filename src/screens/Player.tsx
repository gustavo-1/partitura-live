import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { getSong } from '../data/library';
import type { Hand, Song } from '../music/types';
import { handsInSong, songRange } from '../music/timeline';
import { PracticeEngine, type PassResult, type PracticeMode } from '../practice/engine';
import { studyPlan, stepUrl, handsKey } from '../practice/plan';
import { input } from '../audio/input';
import { mic } from '../audio/mic';
import { preloadPiano } from '../audio/piano';
import { resumeAudio } from '../audio/context';
import { Score } from '../components/score/Score';
import { Keyboard, type KeyMark } from '../components/Keyboard';
import { Waterfall, type FallingNote, type FallState } from '../components/Waterfall';
import { Icon, Stars } from '../components/Icon';
import { MicButton, MicHelp, Seg, Sheet, Toggle } from '../components/ui';
import { useStore } from '../lib/store';
import { back, navigate } from '../lib/router';
import { keyboardRange, settings } from '../state/settings';
import { logPractice, recordSong, starsFor } from '../state/progress';
import { normalizeRange } from '../components/keyboardLayout';

type View = 'sheet' | 'fall' | 'both';

export default function Player({ id, query }: { id: string; query: URLSearchParams }) {
  const [song, setSong] = useState<Song | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    getSong(id).then((s) => alive && setSong(s ?? null));
    return () => {
      alive = false;
    };
  }, [id]);
  if (song === undefined) return <div className="empty">Carregando…</div>;
  if (song === null)
    return (
      <div className="empty">
        <p>Música não encontrada.</p>
        <a className="btn" href="#/musicas">
          Ver músicas
        </a>
      </div>
    );
  return <PlayerInner key={id + query.toString()} song={song} query={query} />;
}

function parseHands(q: string | null, avail: Hand[]): Hand[] {
  if (!q) return avail;
  const hs = (q === 'RL' ? ['R', 'L'] : [q]) as Hand[];
  const ok = hs.filter((h) => avail.includes(h));
  return ok.length ? ok : avail;
}

function PlayerInner({ song, query }: { song: Song; query: URLSearchParams }) {
  const st = useStore(settings);
  const avail = useMemo(() => handsInSong(song), [song]);
  const stepKey = query.get('step');
  const lessonReturn = query.get('voltar');
  const loopQ = query.get('loop');
  const initialLoop: [number, number] | null = loopQ ? (loopQ.split('-').map(Number) as [number, number]) : null;

  const engine = useMemo(
    () =>
      new PracticeEngine(song, {
        hands: parseHands(query.get('hands'), avail),
        mode: (query.get('mode') as PracticeMode) || 'wait',
        tempoFactor: Number(query.get('tempo')) || (song.source === 'lesson' ? 0.8 : 1),
        loop: initialLoop,
        repeat: query.get('repeat') === '1',
        metronome: true,
        playOtherHand: false,
        autoSpeedUp: false,
        naming: st.naming,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [song],
  );
  useSyncExternalStore(engine.subscribe, engine.getVersion);
  useSyncExternalStore(input.subscribe, input.getVersion);

  const [view, setView] = useState<View>(() => (query.get('view') as View) || (localStorage.getItem('pl.view') as View) || 'sheet');
  const [showOpts, setShowOpts] = useState(false);
  const [result, setResult] = useState<PassResult | null>(null);
  const [selecting, setSelecting] = useState<number | null | 'start'>(null);
  const timeRef = useRef(0);
  const fallState = useRef(new Map<string, FallState>());

  useEffect(() => {
    try {
      localStorage.setItem('pl.view', view);
    } catch {
      /* ignora */
    }
  }, [view]);

  useEffect(() => {
    engine.opts.naming = st.naming;
  }, [engine, st.naming]);

  // entrada -> motor
  useEffect(() => input.on((e) => engine.handleInput(e)), [engine]);

  // microfone: liga automaticamente se a permissão já foi concedida
  useEffect(() => {
    const [lo, hi] = songRange(song);
    void preloadPiano(lo - 2, hi + 2);
    const perms = (navigator as Navigator & { permissions?: Permissions }).permissions;
    perms
      ?.query({ name: 'microphone' as PermissionName })
      .then((p) => {
        if (p.state === 'granted' && mic.state !== 'on') void mic.start();
      })
      .catch(() => undefined);
  }, [song]);

  // laço de animação
  useEffect(() => {
    let raf = 0;
    let lastLog = performance.now();
    let acc = 0;
    const loop = () => {
      engine.update();
      timeRef.current = engine.tickToSec(engine.tick);
      const t = performance.now();
      if (engine.status === 'playing') acc += (t - lastLog) / 1000;
      lastLog = t;
      if (acc > 15) {
        logPractice(Math.round(acc));
        acc = 0;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      if (acc > 1) logPractice(Math.round(acc));
    };
  }, [engine]);

  // fim da música
  useEffect(() => {
    engine.onFinish = (r) => {
      if (r.mode !== 'listen') recordSong(song.id, stepKey, r.accuracy, Math.round(r.tempoFactor * 100), r.full && r.hands.length === avail.length);
      else if (stepKey) recordSong(song.id, stepKey, 1, Math.round(r.tempoFactor * 100), false);
      setResult(r);
    };
    return () => {
      engine.onFinish = undefined;
    };
  }, [engine, song.id, stepKey, avail.length]);

  // estado das notas na cascata
  for (const ev of engine.events) {
    const s = engine.eventState(ev);
    const k = `${ev.elId}:${ev.keyIndex}`;
    if (s) fallState.current.set(k, s);
    else fallState.current.delete(k);
  }

  const [lo, hi] = useMemo(() => {
    const [a, b] = songRange(song);
    const [kl, kh] = keyboardRange(st.keyboardSize);
    const span = Math.max(b - a, 22);
    const mid = Math.round((a + b) / 2);
    let l = Math.min(a - 2, mid - Math.ceil(span / 2) - 2);
    let h = Math.max(b + 2, mid + Math.ceil(span / 2) + 2);
    l = Math.max(kl, l);
    h = Math.min(kh, h);
    return normalizeRange(l, h);
  }, [song, st.keyboardSize]);

  const fallingNotes: FallingNote[] = useMemo(() => {
    const [a, b] = engine.range;
    return engine.events
      .filter((e) => e.t >= a && e.t < b)
      .map((e) => ({
        id: `${e.elId}:${e.keyIndex}`,
        midi: e.midi,
        start: engine.tickToSec(e.t),
        dur: engine.tickToSec(e.d),
        hand: e.hand,
        finger: e.finger,
        active: engine.opts.mode === 'listen' || engine.opts.hands.includes(e.hand),
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, engine.opts.tempoFactor, engine.opts.hands, engine.opts.loop, engine.opts.mode]);

  const barTimes = useMemo(
    () => song.measures.map((m) => engine.tickToSec(m.start)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [song, engine.opts.tempoFactor],
  );

  // marcas no teclado
  const keyMarks = new Map<number, KeyMark>();
  const expected = engine.status === 'finished' ? [] : engine.expected();
  if (st.showKeyHints) {
    for (const e of expected) keyMarks.set(e.midi, { hint: e.hand === 'R' ? 'var(--rh)' : 'var(--lh)', label: e.finger ? String(e.finger) : undefined });
  }
  const expSet = new Set(expected.map((e) => e.midi));
  for (const [m] of input.sounding) {
    const okNow = expSet.has(m) || engine.events.some((e) => e.midi === m && engine.eventState(e) === 'ok' && Math.abs(engine.tick - e.t) < 960);
    keyMarks.set(m, { fill: okNow ? '#4ade80' : engine.opts.mode === 'listen' ? '#a5b4fc' : '#f87171', label: keyMarks.get(m)?.label });
  }

  const opts = engine.opts;
  const setMode = (m: PracticeMode) => {
    engine.setOptions({ mode: m });
    setResult(null);
  };
  const setHands = (h: Hand[]) => {
    engine.setOptions({ hands: h });
    setResult(null);
  };

  const playPause = async () => {
    await resumeAudio();
    if (engine.status === 'playing') engine.pause();
    else {
      setResult(null);
      engine.start();
    }
  };

  const onMeasureClick = useCallback(
    (m: number) => {
      if (selecting === null) return;
      if (selecting === 'start') setSelecting(m);
      else {
        const a = Math.min(selecting, m);
        const b = Math.max(selecting, m);
        engine.setOptions({ loop: [a, b], repeat: true });
        setSelecting(null);
      }
    },
    [selecting, engine],
  );

  const acc = engine.result().accuracy;
  const plan = stepKey ? studyPlan(song) : null;
  const planIdx = plan ? plan.steps.findIndex((s) => s.key === stepKey) : -1;
  const planStep = plan && planIdx >= 0 ? plan.steps[planIdx] : null;
  const nextStep = plan && planIdx >= 0 ? plan.steps[planIdx + 1] : null;
  const fb = engine.feedback;
  const scoreView = (
    <div className="player-score">
      <Score
        song={song}
        options={{ showNames: st.showNoteNames, naming: st.naming }}
        marks={engine.marks}
        cursorEls={engine.status === 'idle' && opts.mode !== 'wait' ? null : engine.cursorEls()}
        ghosts={engine.ghosts}
        loop={opts.loop}
        onMeasureClick={selecting !== null ? onMeasureClick : undefined}
      />
    </div>
  );

  return (
    <div className="player">
      <div className="player-top">
        <button className="btn ghost icon" onClick={() => (lessonReturn ? navigate(lessonReturn) : back('/musicas'))} aria-label="Voltar">
          <Icon name="back" />
        </button>
        <div className="player-title">
          {song.title}
          {planStep && <div className="tiny muted">Etapa: {planStep.title}</div>}
        </div>
        <Seg<PracticeMode>
          value={opts.mode}
          onChange={setMode}
          options={[
            { value: 'wait', label: 'Espera' },
            { value: 'tempo', label: 'No tempo' },
            { value: 'listen', label: 'Ouvir' },
          ]}
        />
        <Seg<View>
          value={view}
          onChange={setView}
          options={[
            { value: 'sheet', label: <Icon name="sheet" size={18} /> },
            { value: 'both', label: 'Ambos' },
            { value: 'fall', label: <Icon name="waterfall" size={18} /> },
          ]}
        />
        <MicButton compact />
        <button className="btn ghost icon" onClick={() => setShowOpts(true)} aria-label="Opções">
          <Icon name="sliders" />
        </button>
      </div>

      <div className="player-body">
        <div className="player-feedback" aria-live="polite">
          {fb && (
            <div key={fb.id} className={'toast ' + fb.kind}>
              {fb.text}
            </div>
          )}
        </div>
        {(view === 'sheet' || view === 'both') && scoreView}
        {(view === 'fall' || view === 'both') && (
          <div className="player-fall" style={view === 'both' ? { flex: '0 0 38%' } : undefined}>
            <Waterfall
              lo={lo}
              hi={hi}
              notes={fallingNotes}
              timeRef={timeRef}
              stateRef={fallState}
              lookahead={view === 'both' ? 2.2 : 3.2}
              showNames={st.showNoteNames}
              naming={st.naming}
              barTimes={barTimes}
            />
          </div>
        )}
      </div>

      <div className="player-bottom">
        <div style={{ padding: '0 12px' }}>
          <MicHelp />
        </div>
        {selecting !== null && (
          <div className="banner small" style={{ margin: '8px 12px' }}>
            <Icon name="loop" size={18} />
            <div>{selecting === 'start' ? 'Toque no compasso onde o trecho começa.' : 'Agora toque no compasso onde o trecho termina.'}</div>
            <button className="btn sm" onClick={() => setSelecting(null)}>
              Cancelar
            </button>
          </div>
        )}
        <Keyboard
          lo={lo}
          hi={hi}
          marks={keyMarks}
          labels={st.keyLabels}
          naming={st.naming}
          onDown={(m) => input.press(m, 'screen')}
          onUp={(m) => input.release(m, 'screen')}
        />
        <div className="player-controls">
          <button className="btn primary" onClick={playPause} aria-label={engine.status === 'playing' ? 'Pausar' : 'Tocar'}>
            <Icon name={engine.status === 'playing' ? 'pause' : 'play'} />
            {engine.status === 'playing' ? 'Pausar' : engine.status === 'paused' ? 'Continuar' : 'Começar'}
          </button>
          <button className="btn icon" onClick={() => engine.restart()} aria-label="Recomeçar">
            <Icon name="restart" />
          </button>
          {avail.length > 1 && (
            <Seg<string>
              value={handsKey(opts.hands)}
              onChange={(v) => setHands(v === 'RL' ? ['R', 'L'] : [v as Hand])}
              options={[
                { value: 'R', label: 'MD' },
                { value: 'L', label: 'ME' },
                { value: 'RL', label: 'Juntas' },
              ]}
            />
          )}
          <div className="row nowrap" style={{ gap: 4 }}>
            <button className="btn sm icon" aria-label="Mais devagar" onClick={() => engine.setOptions({ tempoFactor: Math.max(0.3, Math.round((opts.tempoFactor - 0.1) * 10) / 10) })}>
              −
            </button>
            <span className="chip" title="Andamento">
              <Icon name="metronome" size={14} /> {Math.round(song.tempo * opts.tempoFactor)} bpm
            </span>
            <button className="btn sm icon" aria-label="Mais rápido" onClick={() => engine.setOptions({ tempoFactor: Math.min(1.5, Math.round((opts.tempoFactor + 0.1) * 10) / 10) })}>
              +
            </button>
          </div>
          {opts.loop ? (
            <span className="chip accent">
              <Icon name="loop" size={14} /> Compassos {opts.loop[0] + 1}–{opts.loop[1] + 1}
              <button className="btn ghost sm icon" style={{ minHeight: 0, padding: 0, minWidth: 0 }} aria-label="Remover trecho" onClick={() => engine.setOptions({ loop: null, repeat: false })}>
                <Icon name="x" size={14} />
              </button>
            </span>
          ) : (
            <button className="btn sm" onClick={() => setSelecting('start')}>
              <Icon name="loop" /> Trecho
            </button>
          )}
          <div className="spacer" />
          {opts.mode !== 'listen' && (
            <>
              <div className="stat">
                <b>{engine.stats.steps ? Math.round(acc * 100) + '%' : '—'}</b>
                <span>precisão</span>
              </div>
              <div className="stat">
                <b>{engine.stats.streak}</b>
                <span>sequência</span>
              </div>
            </>
          )}
        </div>
      </div>

      <Sheet open={showOpts} onClose={() => setShowOpts(false)} title="Opções de prática">
        <div className="field">
          <span className="label">Andamento: {Math.round(opts.tempoFactor * 100)}% ({Math.round(song.tempo * opts.tempoFactor)} bpm)</span>
          <input
            type="range"
            min={0.3}
            max={1.5}
            step={0.05}
            value={opts.tempoFactor}
            onChange={(e) => engine.setOptions({ tempoFactor: Number(e.target.value) })}
          />
        </div>
        <Toggle label="Metrônomo" hint="Nos modos 'No tempo' e 'Ouvir'" checked={opts.metronome} onChange={(v) => engine.setOptions({ metronome: v })} />
        {avail.length > 1 && (
          <Toggle
            label="Tocar a outra mão"
            hint="O app toca a parte da mão que você não está praticando (use fones para o microfone não confundir)"
            checked={opts.playOtherHand}
            onChange={(v) => engine.setOptions({ playOtherHand: v })}
          />
        )}
        <Toggle label="Repetir o trecho" hint="Recomeça automaticamente ao chegar no fim do trecho" checked={opts.repeat} onChange={(v) => engine.setOptions({ repeat: v })} />
        <Toggle
          label="Acelerar aos poucos"
          hint="Ao repetir um trecho com 90% ou mais, aumenta o andamento em 5%"
          checked={opts.autoSpeedUp}
          onChange={(v) => engine.setOptions({ autoSpeedUp: v })}
        />
        <div className="divider" />
        <Toggle label="Nomes das notas na partitura" checked={st.showNoteNames} onChange={(v) => settings.set({ showNoteNames: v })} />
        <Toggle label="Mostrar a tecla certa no teclado" checked={st.showKeyHints} onChange={(v) => settings.set({ showKeyHints: v })} />
        <div className="field">
          <span className="label">Nomes no teclado</span>
          <Seg
            value={st.keyLabels}
            onChange={(v) => settings.set({ keyLabels: v })}
            options={[
              { value: 'none', label: 'Nenhum' },
              { value: 'c', label: 'Só os Dós' },
              { value: 'all', label: 'Todos' },
            ]}
          />
        </div>
        <p className="small muted">
          Dica: sem teclado por perto? Use o teclado na tela ou as teclas <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> <kbd>F</kbd>… do computador (
          <kbd>Z</kbd>/<kbd>X</kbd> mudam a oitava).
        </p>
      </Sheet>

      <Sheet open={!!result} onClose={() => setResult(null)}>
        {result && (
          <ResultView
            result={result}
            song={song}
            onRetry={() => {
              setResult(null);
              engine.restart();
            }}
            onPracticeMeasures={(ms) => {
              setResult(null);
              engine.setOptions({ loop: [ms[0], ms[ms.length - 1]], repeat: true, mode: 'wait' });
            }}
            next={
              nextStep && (result.mode === 'listen' || result.accuracy >= (planStep?.target ?? 0.8))
                ? { label: nextStep.title, href: stepUrl(song.id, nextStep) }
                : null
            }
            planHref={stepKey ? `/musica/${encodeURIComponent(song.id)}` : null}
            lessonReturn={lessonReturn}
          />
        )}
      </Sheet>
    </div>
  );
}

function ResultView({
  result,
  song,
  onRetry,
  onPracticeMeasures,
  next,
  planHref,
  lessonReturn,
}: {
  result: PassResult;
  song: Song;
  onRetry: () => void;
  onPracticeMeasures: (ms: number[]) => void;
  next: { label: string; href: string } | null;
  planHref: string | null;
  lessonReturn: string | null;
}) {
  const stars = result.mode === 'listen' ? 3 : starsFor(result.accuracy);
  const worst = Object.entries(result.measureErrors)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([m]) => Number(m))
    .sort((a, b) => a - b);
  const timing = result.stats.timing;
  const avgDev = timing.length ? timing.reduce((a, b) => a + b, 0) / timing.length : 0;
  const msg =
    result.mode === 'listen'
      ? 'Agora é sua vez!'
      : result.accuracy >= 0.95
        ? 'Excelente!'
        : result.accuracy >= 0.8
          ? 'Muito bem!'
          : result.accuracy >= 0.6
            ? 'Está chegando lá!'
            : 'Continue praticando — devagar se vai longe.';
  void song;
  return (
    <div className="result-hero">
      <Stars n={stars} />
      <div className="big">{result.mode === 'listen' ? '♪' : Math.round(result.accuracy * 100) + '%'}</div>
      <h2>{msg}</h2>
      {result.mode !== 'listen' && (
        <p className="muted">
          {result.mode === 'wait'
            ? `${result.stats.clean} de ${result.stats.steps} acertadas de primeira · ${result.stats.wrong} notas erradas`
            : `${result.stats.hits} notas certas · ${result.stats.missed} perdidas · ${result.stats.wrong} erradas`}
          {result.mode === 'tempo' && timing.length > 3 && (
            <>
              <br />
              {Math.abs(avgDev) < 0.04
                ? 'Seu ritmo está bem no tempo.'
                : avgDev < 0
                  ? `Você tende a se adiantar (~${Math.round(-avgDev * 1000)} ms).`
                  : `Você tende a se atrasar (~${Math.round(avgDev * 1000)} ms).`}
            </>
          )}
          <br />
          Melhor sequência: {result.stats.bestStreak}
        </p>
      )}
      {worst.length > 0 && result.accuracy < 0.95 && (
        <div className="banner small" style={{ textAlign: 'left', margin: '10px 0' }}>
          <Icon name="target" size={18} />
          <div style={{ flex: 1 }}>
            Compassos com mais erros: <b>{worst.map((m) => m + 1).join(', ')}</b>. Praticar só esses trechos devagar costuma resolver mais rápido
            do que repetir a música toda.
          </div>
          <button className="btn sm" onClick={() => onPracticeMeasures(worst)}>
            Praticar
          </button>
        </div>
      )}
      <div className="stack" style={{ marginTop: 16 }}>
        {next && (
          <button className="btn primary lg block" onClick={() => navigate(next.href)}>
            Próxima etapa: {next.label} <Icon name="next" />
          </button>
        )}
        {lessonReturn && (
          <button className="btn primary lg block" onClick={() => navigate(lessonReturn)}>
            Continuar a lição <Icon name="next" />
          </button>
        )}
        <button className={'btn block' + (next || lessonReturn ? '' : ' primary lg')} onClick={onRetry}>
          <Icon name="restart" /> Tocar de novo
        </button>
        {planHref && (
          <button className="btn ghost block" onClick={() => navigate(planHref)}>
            Ver plano de estudo
          </button>
        )}
      </div>
    </div>
  );
}

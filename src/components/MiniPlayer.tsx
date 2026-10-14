import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { Hand, Song } from '../music/types';
import { handsInSong, songRange } from '../music/timeline';
import { PracticeEngine, type PassResult, type PracticeMode } from '../practice/engine';
import { input } from '../audio/input';
import { preloadPiano } from '../audio/piano';
import { resumeAudio } from '../audio/context';
import { Score } from './score/Score';
import { Keyboard, type KeyMark } from './Keyboard';
import { normalizeRange } from './keyboardLayout';
import { Icon } from './Icon';
import { useStore } from '../lib/store';
import { settings } from '../state/settings';
import { Seg } from './ui';

interface Props {
  song: Song;
  hands?: Hand[];
  loop?: [number, number] | null;
  mode?: PracticeMode;
  tempoFactor?: number;
  onDone: (r: PassResult) => void;
}

/** Player compacto usado dentro das lições. */
export function MiniPlayer({ song, hands, loop = null, mode = 'wait', tempoFactor, onDone }: Props) {
  const st = useStore(settings);
  const avail = useMemo(() => handsInSong(song), [song]);
  const engine = useMemo(
    () =>
      new PracticeEngine(song, {
        hands: hands ?? avail,
        mode,
        tempoFactor: tempoFactor ?? (song.source === 'lesson' ? 1 : 0.8),
        loop,
        repeat: false,
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
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => input.on((e) => engine.handleInput(e)), [engine]);
  useEffect(() => {
    const [lo, hi] = songRange(song);
    void preloadPiano(lo - 2, hi + 2);
    engine.onFinish = (r) => doneRef.current(r);
    let raf = 0;
    const loopFn = () => {
      engine.update();
      raf = requestAnimationFrame(loopFn);
    };
    raf = requestAnimationFrame(loopFn);
    return () => {
      cancelAnimationFrame(raf);
      engine.onFinish = undefined;
    };
  }, [engine, song]);

  const [lo, hi] = useMemo(() => {
    const [a, b] = songRange(song);
    const mid = Math.round((a + b) / 2);
    return normalizeRange(Math.min(a - 2, mid - 10), Math.max(b + 2, mid + 10));
  }, [song]);

  const marks = new Map<number, KeyMark>();
  const expected = engine.status === 'finished' ? [] : engine.expected();
  if (st.showKeyHints) for (const e of expected) marks.set(e.midi, { hint: e.hand === 'R' ? 'var(--rh)' : 'var(--lh)', label: e.finger ? String(e.finger) : undefined });
  const expSet = new Set(expected.map((e) => e.midi));
  for (const [m] of input.sounding) marks.set(m, { fill: expSet.has(m) || engine.opts.mode === 'listen' ? '#4ade80' : '#f87171' });
  const fb = engine.feedback;

  return (
    <div className="stack">
      <div style={{ position: 'relative' }}>
        <div className="player-feedback" style={{ top: -6 }}>
          {fb && (
            <div key={fb.id} className={'toast ' + fb.kind}>
              {fb.text}
            </div>
          )}
        </div>
        <Score
          song={song}
          options={{ showNames: st.showNoteNames, naming: st.naming }}
          marks={engine.marks}
          cursorEls={engine.cursorEls()}
          ghosts={engine.ghosts}
          loop={loop}
          autoScroll={false}
        />
      </div>
      <Keyboard lo={lo} hi={hi} marks={marks} labels={st.keyLabels} naming={st.naming} onDown={(m) => input.press(m)} onUp={(m) => input.release(m)} />
      <div className="row">
        {engine.status !== 'playing' && (
          <button
            className="btn primary"
            onClick={async () => {
              await resumeAudio();
              engine.start();
            }}
          >
            <Icon name="play" /> {engine.status === 'paused' ? 'Continuar' : 'Começar'}
          </button>
        )}
        {engine.status === 'playing' && (
          <button className="btn" onClick={() => engine.restart()}>
            <Icon name="restart" /> Recomeçar
          </button>
        )}
        <Seg<PracticeMode>
          value={engine.opts.mode}
          onChange={(m) => engine.setOptions({ mode: m })}
          options={[
            { value: 'wait', label: 'Espera' },
            { value: 'tempo', label: 'No tempo' },
            { value: 'listen', label: 'Ouvir' },
          ]}
        />
        <div className="spacer" />
        {engine.opts.mode === 'wait' && engine.status === 'idle' && (
          <span className="small muted">Ou simplesmente toque a primeira nota.</span>
        )}
      </div>
    </div>
  );
}

import { useCallback, useState, type ReactNode } from 'react';
import type { Activity } from '../../data/curriculum';
import { Icon } from '../../components/Icon';
import { MicButton, MicHelp, ProgressBar } from '../../components/ui';
import {
  EchoActivity,
  FindActivity,
  InfoActivity,
  PlayActivity,
  QuizActivity,
  ReadActivity,
  RhythmActivity,
  SightActivity,
  type ActivityProps,
} from './activities';

export function ActivityView(props: ActivityProps) {
  const a = props.activity;
  switch (a.type) {
    case 'info':
      return <InfoActivity {...(props as ActivityProps<typeof a>)} />;
    case 'quiz':
      return <QuizActivity {...(props as ActivityProps<typeof a>)} />;
    case 'find':
      return <FindActivity {...(props as ActivityProps<typeof a>)} />;
    case 'read':
      return <ReadActivity {...(props as ActivityProps<typeof a>)} />;
    case 'rhythm':
      return <RhythmActivity {...(props as ActivityProps<typeof a>)} />;
    case 'play':
      return <PlayActivity {...(props as ActivityProps<typeof a>)} />;
    case 'sight':
      return <SightActivity {...(props as ActivityProps<typeof a>)} />;
    case 'echo':
      return <EchoActivity {...(props as ActivityProps<typeof a>)} />;
  }
}

export const NEEDS_INSTRUMENT: Activity['type'][] = ['find', 'read', 'play', 'sight', 'rhythm', 'echo'];

/**
 * Executa uma sequência de atividades (lição, revisão) com barra de progresso.
 * `unscored`: índices que não entram na nota final (ex.: aquecimento).
 */
export function ActivityRunner({
  acts,
  heading,
  unscored,
  onExit,
  onFinish,
  tag,
}: {
  acts: Activity[];
  heading: ReactNode;
  unscored?: Set<number>;
  onExit: () => void;
  onFinish: (acc: number) => void;
  /** rótulo pequeno sobre a atividade atual (ex.: "Aquecimento") */
  tag?: (index: number) => string | null;
}) {
  const [step, setStep] = useState(0);
  const [scores, setScores] = useState<(number | null)[]>([]);
  const [current, setCurrent] = useState<number | null | undefined>(undefined);
  const onComplete = useCallback((s: number | null) => setCurrent(s), []);
  const act = acts[step];

  const advance = (override?: number) => {
    const sc = [...scores];
    sc[step] = override !== undefined ? override : current === undefined ? null : current;
    setScores(sc);
    setCurrent(undefined);
    if (step + 1 >= acts.length) {
      const scored = sc.filter((x, i): x is number => x !== null && x !== undefined && !unscored?.has(i));
      onFinish(scored.length ? scored.reduce((a, b) => a + b, 0) / scored.length : 1);
    } else setStep(step + 1);
  };

  if (!act) return null;
  const canContinue = act.type === 'info' || current !== undefined;
  const skippable = act.type === 'play' || act.type === 'rhythm' || act.type === 'sight' || act.type === 'echo';
  const t = tag?.(step);
  return (
    <div className="lesson-shell">
      <div className="lesson-top">
        <button className="btn ghost icon" onClick={onExit} aria-label="Sair">
          <Icon name="x" />
        </button>
        <ProgressBar value={step / acts.length} />
        {NEEDS_INSTRUMENT.includes(act.type) && <MicButton compact />}
      </div>
      <div className="lesson-heading small">
        {heading}
        {t && <span className="chip warm-chip">{t}</span>}
      </div>
      {NEEDS_INSTRUMENT.includes(act.type) && <MicHelp />}
      <div className="lesson-body">
        <ActivityView key={step} activity={act} onComplete={onComplete} />
      </div>
      <div className="lesson-footer">
        {skippable && current === undefined && (
          <button className="btn ghost" onClick={() => advance(0)}>
            Pular
          </button>
        )}
        <button className="btn primary lg" disabled={!canContinue} onClick={() => advance()}>
          {step + 1 >= acts.length ? 'Concluir' : 'Continuar'}
        </button>
      </div>
    </div>
  );
}

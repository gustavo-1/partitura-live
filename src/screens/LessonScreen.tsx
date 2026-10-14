import { useCallback, useMemo, useState } from 'react';
import { allLessons, findLesson, type Activity } from '../data/curriculum';
import { navigate } from '../lib/router';
import { recordLesson, starsFor } from '../state/progress';
import { Icon, Stars } from '../components/Icon';
import { MicButton, MicHelp, ProgressBar } from '../components/ui';
import {
  FindActivity,
  InfoActivity,
  PlayActivity,
  QuizActivity,
  ReadActivity,
  RhythmActivity,
  SightActivity,
  type ActivityProps,
} from './lesson/activities';

function ActivityView(props: ActivityProps) {
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
  }
}

const NEEDS_INSTRUMENT: Activity['type'][] = ['find', 'read', 'play', 'sight', 'rhythm'];

export default function LessonScreen({ id }: { id?: string }) {
  const found = id ? findLesson(id) : undefined;
  const [step, setStep] = useState(0);
  const [scores, setScores] = useState<(number | null)[]>([]);
  const [current, setCurrent] = useState<number | null | undefined>(undefined);
  const [finished, setFinished] = useState<{ acc: number; stars: number } | null>(null);

  const onComplete = useCallback((s: number | null) => setCurrent(s), []);
  const nextLesson = useMemo(() => {
    if (!found) return null;
    const all = allLessons();
    return all[found.index + 1] ?? null;
  }, [found]);

  if (!found) return <div className="empty">Lição não encontrada.</div>;
  const { lesson, unit } = found;
  const acts = lesson.activities;
  const act = acts[step];

  const advance = (override?: number) => {
    const sc = [...scores];
    sc[step] = override !== undefined ? override : current === undefined ? null : current;
    setScores(sc);
    setCurrent(undefined);
    if (step + 1 >= acts.length) {
      const scored = sc.filter((x): x is number => x !== null && x !== undefined);
      const acc = scored.length ? scored.reduce((a, b) => a + b, 0) / scored.length : 1;
      recordLesson(lesson.id, acc);
      setFinished({ acc, stars: starsFor(acc) });
    } else setStep(step + 1);
  };

  if (finished) {
    return (
      <div className="lesson-shell">
        <div className="result-hero">
          <Stars n={finished.stars} />
          <div className="big">{Math.round(finished.acc * 100)}%</div>
          <h2>{finished.stars >= 2 ? 'Lição concluída!' : finished.stars === 1 ? 'Concluída — dá para melhorar!' : 'Vale a pena repetir esta lição'}</h2>
          <p className="muted">{lesson.title}</p>
          <div className="stack" style={{ maxWidth: 360, margin: '20px auto 0' }}>
            {nextLesson && finished.stars > 0 && (
              <button className="btn primary lg block" onClick={() => navigate('/licao/' + nextLesson.lesson.id)}>
                Próxima: {nextLesson.lesson.title} <Icon name="next" />
              </button>
            )}
            <button
              className={'btn block' + (finished.stars === 0 ? ' primary lg' : '')}
              onClick={() => {
                setFinished(null);
                setStep(0);
                setScores([]);
                setCurrent(undefined);
              }}
            >
              <Icon name="restart" /> Refazer lição
            </button>
            <button className="btn ghost block" onClick={() => navigate('/trilha')}>
              Voltar para a trilha
            </button>
          </div>
        </div>
      </div>
    );
  }

  const canContinue = act.type === 'info' || current !== undefined;
  const skippable = act.type === 'play' || act.type === 'rhythm' || act.type === 'sight';
  return (
    <div className="lesson-shell">
      <div className="lesson-top">
        <button className="btn ghost icon" onClick={() => navigate('/trilha')} aria-label="Sair da lição">
          <Icon name="x" />
        </button>
        <ProgressBar value={step / acts.length} />
        {NEEDS_INSTRUMENT.includes(act.type) && <MicButton compact />}
      </div>
      <div className="small muted" style={{ marginBottom: 6, fontWeight: 650, color: unit.color }}>
        {unit.title} · {lesson.title}
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

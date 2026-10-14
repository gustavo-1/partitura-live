import { useMemo, useState } from 'react';
import { allLessons, findLesson } from '../data/curriculum';
import { navigate } from '../lib/router';
import { useStore } from '../lib/store';
import { progress, recordLesson, starsFor } from '../state/progress';
import { Icon, Stars } from '../components/Icon';
import { usePracticeTime } from '../lib/usePracticeTime';
import { buildWarmup } from '../practice/review';
import { ActivityRunner } from './lesson/Runner';
import { Confetti } from '../components/Celebration';

export default function LessonScreen({ id }: { id?: string }) {
  const found = id ? findLesson(id) : undefined;
  usePracticeTime();
  const p = useStore(progress);
  const [finished, setFinished] = useState<{ acc: number; stars: number; improved: boolean } | null>(null);
  const [run, setRun] = useState(0);

  // aquecimento (recuperação espaçada): fixado ao abrir a lição
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const warmup = useMemo(() => (found ? buildWarmup(found.lesson.id, progress.get()) : []), [found?.lesson.id, run]);
  const nextLesson = useMemo(() => {
    if (!found) return null;
    return allLessons()[found.index + 1] ?? null;
  }, [found]);

  if (!found) return <div className="empty">Lição não encontrada.</div>;
  const { lesson, unit } = found;
  const acts = [...warmup, ...lesson.activities];
  const unscored = new Set(warmup.map((_, i) => i));

  if (finished) {
    const prevStars = p.lessons[lesson.id]?.stars ?? 0;
    return (
      <div className="lesson-shell">
        {finished.stars >= 2 && <Confetti />}
        <div className="result-hero">
          <Stars n={finished.stars} />
          <div className="big">{Math.round(finished.acc * 100)}%</div>
          <h2>{finished.stars >= 2 ? 'Lição concluída!' : finished.stars === 1 ? 'Concluída — dá para melhorar!' : 'Vale a pena repetir esta lição'}</h2>
          <p className="muted">
            {lesson.title}
            {prevStars > finished.stars && ` · seu recorde continua ${'★'.repeat(prevStars)}`}
          </p>
          {finished.stars < 3 && (
            <p className="small muted" style={{ maxWidth: 420, margin: '0 auto' }}>
              {finished.stars === 0
                ? 'Repetir agora, com calma, costuma resolver: erros no começo fazem parte do aprendizado.'
                : 'Você pode seguir em frente — esta lição volta na revisão do dia para você firmar.'}
            </p>
          )}
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
                setRun((r) => r + 1);
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

  return (
    <ActivityRunner
      key={run}
      acts={acts}
      unscored={unscored}
      heading={
        <span style={{ fontWeight: 650, color: unit.color }}>
          {unit.title} · {lesson.title}
        </span>
      }
      tag={(i) => (unscored.has(i) ? 'Aquecimento' : null)}
      onExit={() => navigate('/trilha')}
      onFinish={(acc) => {
        const r = recordLesson(lesson.id, acc);
        setFinished({ acc, stars: starsFor(acc), improved: r.improved });
      }}
    />
  );
}

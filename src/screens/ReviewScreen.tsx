import { useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import { navigate } from '../lib/router';
import { usePracticeTime } from '../lib/usePracticeTime';
import { buildReview, dueCount } from '../practice/review';
import { dayCount, progress, recordActivity, starsFor } from '../state/progress';
import { Icon, Stars } from '../components/Icon';
import { Confetti } from '../components/Celebration';
import { ActivityRunner } from './lesson/Runner';

/** Revisão do dia: sessão curta, espaçada e intercalada. */
export default function ReviewScreen() {
  usePracticeTime();
  const p = useStore(progress);
  const [run, setRun] = useState(0);
  const [started, setStarted] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const review = useMemo(() => buildReview(progress.get()), [run]);
  const due = dueCount(p);
  const doneToday = dayCount(p, 'reviews');

  if (done !== null) {
    const stars = starsFor(done);
    return (
      <div className="lesson-shell">
        <Confetti />
        <div className="result-hero">
          <Stars n={stars} />
          <div className="big">{Math.round(done * 100)}%</div>
          <h2>Revisão feita!</h2>
          <p className="muted" style={{ maxWidth: 440, margin: '0 auto' }}>
            O que você errou volta antes; o que acertou volta daqui a mais dias. Amanhã tem outra revisão curtinha — é a repetição espaçada que
            leva o conteúdo para a memória de longo prazo.
          </p>
          <div className="stack" style={{ maxWidth: 360, margin: '20px auto 0' }}>
            <button className="btn primary lg block" onClick={() => navigate('/')}>
              Voltar ao início <Icon name="next" />
            </button>
            <button
              className="btn block"
              onClick={() => {
                setDone(null);
                setRun((r) => r + 1);
                setStarted(true);
              }}
            >
              <Icon name="restart" /> Fazer outra rodada
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!started) {
    return (
      <div className="lesson-shell">
        <div className="lesson-top">
          <button className="btn ghost icon" onClick={() => navigate('/treino')} aria-label="Voltar">
            <Icon name="back" />
          </button>
        </div>
        <div className="review-intro">
          <div className="review-ic">🧠</div>
          <h1>Revisão do dia</h1>
          <p className="muted">
            Cerca de 3 minutos misturando o que você já aprendeu: {review.parts.join(', ')}.
            {due > 0 ? ` ${due} ${due === 1 ? 'nota está' : 'notas estão'} no ponto de revisar.` : ''}
          </p>
          <ul className="small muted review-why">
            <li>
              <b>Lembrar sem olhar</b> (prática de recuperação) fixa mais do que reler.
            </li>
            <li>
              <b>Espaçar</b> as revisões em dias diferentes faz a memória durar.
            </li>
            <li>
              <b>Misturar</b> assuntos (prática intercalada) parece mais difícil, mas rende mais no longo prazo.
            </li>
          </ul>
          {doneToday > 0 && <p className="small" style={{ color: 'var(--ok)' }}>✓ Você já revisou hoje. Uma rodada extra nunca é demais!</p>}
          <button className="btn primary lg" onClick={() => setStarted(true)}>
            <Icon name="play" /> Começar revisão
          </button>
        </div>
      </div>
    );
  }

  return (
    <ActivityRunner
      key={run}
      acts={review.acts}
      heading={<span style={{ fontWeight: 650, color: 'var(--accent)' }}>Revisão do dia</span>}
      onExit={() => navigate('/treino')}
      onFinish={(acc) => {
        recordActivity('reviews', 15);
        setDone(acc);
      }}
    />
  );
}

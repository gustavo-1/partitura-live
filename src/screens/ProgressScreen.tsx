import { useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import { progress, today } from '../state/progress';
import { settings } from '../state/settings';
import { allLessons } from '../data/curriculum';
import { builtinSongs } from '../data/songs';
import { listImported } from '../data/library';
import { Icon, Stars } from '../components/Icon';
import { ProgressBar } from '../components/ui';
import { navigate } from '../lib/router';
import type { Song } from '../music/types';

export function ProgressScreen() {
  const p = useStore(progress);
  const st = useStore(settings);
  const lessons = allLessons();
  const done = lessons.filter((x) => p.lessons[x.lesson.id]?.stars > 0);
  const stars = Object.values(p.lessons).reduce((a, l) => a + l.stars, 0);
  const [songs, setSongs] = useState<Song[]>(builtinSongs());
  useEffect(() => {
    listImported().then((imp) => setSongs([...builtinSongs(), ...imp.map((r) => r.song)]));
  }, []);

  const days: { d: string; label: string; min: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const dt = new Date();
    dt.setDate(dt.getDate() - i);
    const key = today(dt);
    days.push({ d: key, label: dt.toLocaleDateString('pt-BR', { weekday: 'narrow' }), min: Math.round((p.practice[key] ?? 0) / 60) });
  }
  const maxMin = Math.max(st.dailyGoalMin, ...days.map((d) => d.min));
  const totalMin = Math.round(Object.values(p.practice).reduce((a, b) => a + b, 0) / 60);
  const reading = Object.values(p.noteStats);
  const readAcc = reading.length ? reading.reduce((a, s) => a + s.correct, 0) / Math.max(1, reading.reduce((a, s) => a + s.seen, 0)) : null;
  const played = Object.entries(p.songs).sort((a, b) => b[1].lastPlayed - a[1].lastPlayed);

  return (
    <div>
      <div className="page-header">
        <h1>Progresso</h1>
      </div>
      <div className="grid cols-3">
        <div className="card flat kpi">
          <span>Experiência</span>
          <b>{p.xp} XP</b>
        </div>
        <div className="card flat kpi">
          <span>Sequência</span>
          <b>
            <Icon name="fire" size={20} /> {p.streak.current} dias
          </b>
          <span className="tiny">Recorde: {p.streak.best}</span>
        </div>
        <div className="card flat kpi">
          <span>Tempo total</span>
          <b>{totalMin >= 60 ? `${Math.floor(totalMin / 60)} h ${totalMin % 60} min` : `${totalMin} min`}</b>
        </div>
        <div className="card flat kpi">
          <span>Lições</span>
          <b>
            {done.length}/{lessons.length}
          </b>
          <span className="tiny">{stars} estrelas</span>
        </div>
        <div className="card flat kpi">
          <span>Leitura de notas</span>
          <b>{readAcc === null ? '—' : Math.round(readAcc * 100) + '%'}</b>
          <span className="tiny">{reading.reduce((a, s) => a + s.seen, 0)} cartões respondidos</span>
        </div>
      </div>

      <div className="section-title">
        <h2>Últimos 14 dias</h2>
        <span className="small muted">meta: {st.dailyGoalMin} min/dia</span>
      </div>
      <div className="card">
        <div className="bars">
          {days.map((d) => (
            <div className="bar" key={d.d} title={`${d.d}: ${d.min} min`}>
              <i style={{ height: `${(d.min / maxMin) * 100}%`, background: d.min >= st.dailyGoalMin ? 'var(--ok)' : 'var(--accent)' }} />
              <span>{d.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="section-title">
        <h2>Músicas</h2>
      </div>
      {played.length === 0 ? (
        <p className="muted small">Você ainda não praticou nenhuma música.</p>
      ) : (
        <div className="card">
          <table className="table">
            <thead>
              <tr>
                <th>Música</th>
                <th>Melhor</th>
                <th>Vezes</th>
              </tr>
            </thead>
            <tbody>
              {played.map(([id, sp]) => {
                const s = songs.find((x) => x.id === id);
                return (
                  <tr key={id} style={{ cursor: 'pointer' }} onClick={() => s && navigate(`/musica/${encodeURIComponent(id)}`)}>
                    <td>{s?.title ?? id}</td>
                    <td style={{ minWidth: 90 }}>
                      <ProgressBar value={sp.best} />
                      <span className="tiny muted">{Math.round(sp.best * 100)}%</span>
                    </td>
                    <td>{sp.plays}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="section-title">
        <h2>Lições concluídas</h2>
      </div>
      {done.length === 0 ? (
        <p className="muted small">Nenhuma ainda — comece pela trilha!</p>
      ) : (
        <div className="lesson-list">
          {done.map(({ lesson, unit }) => (
            <button key={lesson.id} className="lesson-item done" onClick={() => navigate('/licao/' + lesson.id)}>
              <span className="lesson-icon">
                <Icon name="check" />
              </span>
              <span style={{ flex: 1 }}>
                <b>{lesson.title}</b>
                <div className="small muted">{unit.title}</div>
              </span>
              <Stars n={p.lessons[lesson.id].stars} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import { progress, streakNow, today, weekStats } from '../state/progress';
import { levelFor, MAX_FREEZES } from '../state/gamification';
import { AccountCard } from '../components/AccountCard';
import { ACHIEVEMENTS } from '../data/achievements';
import { settings } from '../state/settings';
import { allLessons } from '../data/curriculum';
import { builtinSongs } from '../data/songs';
import { listImported } from '../data/library';
import { Icon, Stars } from '../components/Icon';
import { ProgressBar } from '../components/ui';
import { navigate } from '../lib/router';
import type { Song } from '../music/types';

export function ProfileScreen() {
  const p = useStore(progress);
  const st = useStore(settings);
  const lessons = allLessons();
  const done = lessons.filter((x) => p.lessons[x.lesson.id]?.stars > 0);
  const stars = Object.values(p.lessons).reduce((a, l) => a + l.stars, 0);
  const [songs, setSongs] = useState<Song[]>(builtinSongs());
  const [allBadges, setAllBadges] = useState(false);
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
  const week = weekStats(p);
  const got = p.badges ?? {};
  const lv = levelFor(p.xp);
  const sn = streakNow(p);
  const badges = [...ACHIEVEMENTS].sort((a, b) => (got[b.id] ? 1 : 0) - (got[a.id] ? 1 : 0) || (got[b.id] ?? 0) - (got[a.id] ?? 0));

  return (
    <div>
      <div className="page-header">
        <h1 style={{ flex: 1 }}>Perfil</h1>
        <a className="btn ghost sm" href="#/config">
          <Icon name="settings" /> Configurações
        </a>
      </div>
      <AccountCard />
      <div className="section-title">
        <h2>Seu progresso</h2>
      </div>
      <div className="card level-card">
        <div className="level-badge">{lv.level}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <b>
            Nível {lv.level} · {lv.title}
          </b>
          <ProgressBar value={lv.pct} />
          <span className="tiny muted">
            {p.xp} XP no total · faltam {lv.need - lv.into} XP para o nível {lv.level + 1}
          </span>
        </div>
      </div>
      <div className="stat-grid">
        <div className="card flat kpi">
          <span>Sequência</span>
          <b>
            <Icon name="fire" size={20} /> {sn.days} {sn.days === 1 ? 'dia' : 'dias'}
          </b>
          <span className="tiny">
            Recorde: {p.streak.best} · 🧊 {p.freezes ?? 0}/{MAX_FREEZES} proteções
          </span>
        </div>
        <div className="card flat kpi">
          <span>Missões</span>
          <b>{p.questDays ?? 0} dias completos</b>
          <span className="tiny">Cada dia completo dá uma proteção de sequência</span>
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
          <span>Esta semana</span>
          <b>{week.xp} XP</b>
          <span className="tiny">{week.minutes} min de prática</span>
        </div>
        <div className="card flat kpi">
          <span>Leitura de notas</span>
          <b>{readAcc === null ? '—' : Math.round(readAcc * 100) + '%'}</b>
          <span className="tiny">{reading.reduce((a, s) => a + s.seen, 0)} cartões respondidos</span>
        </div>
      </div>

      <div className="section-title">
        <h2>Medalhas</h2>
        <span className="small muted">
          {Object.keys(got).length}/{ACHIEVEMENTS.length}
        </span>
      </div>
      <div className="badge-grid">
        {(allBadges ? badges : badges.slice(0, Math.max(6, Object.keys(got).length + 4))).map((a) => (
          <div key={a.id} className={'badge-card' + (got[a.id] ? '' : ' locked')} title={a.desc}>
            <span className="ic">{a.icon}</span>
            <div>
              <b>{a.title}</b>
              <span>{a.desc}</span>
            </div>
          </div>
        ))}
      </div>
      {badges.length > Math.max(6, Object.keys(got).length + 4) && (
        <button className="btn ghost sm block" style={{ marginTop: 8 }} onClick={() => setAllBadges((v) => !v)}>
          {allBadges ? 'Mostrar menos' : `Ver todas as ${badges.length} medalhas`}
        </button>
      )}

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
                    <td>{s?.title ?? p.songTitles?.[id] ?? id}</td>
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

import { useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import { liveStreak, profileWeek, removeFriend, sendCheer, social } from '../lib/social';
import { account } from '../lib/account';
import { back, navigate } from '../lib/router';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { ACHIEVEMENTS } from '../data/achievements';
import { builtinSong } from '../data/songs';
import { getSong } from '../data/library';
import { levelFor } from '../state/gamification';
import { progress, weekStats } from '../state/progress';

export default function FriendProfile({ uid }: { uid: string }) {
  const soc = useStore(social);
  const acc = useStore(account);
  const p = useStore(progress);
  const f = soc.friends[uid];
  const [sent, setSent] = useState<string | null>(null);
  const [available, setAvailable] = useState<Set<string>>(new Set());
  // quais músicas do amigo eu também tenho (para "tentar superar")
  useEffect(() => {
    if (!f) return;
    void (async () => {
      const ids = Object.keys(f.best ?? {});
      const ok = new Set<string>();
      for (const id of ids) if (builtinSong(id) || (await getSong(id))) ok.add(id);
      setAvailable(ok);
    })();
  }, [f]);

  if (acc.status !== 'signed-in') return <div className="empty">Entre na sua conta para ver seus amigos.</div>;
  if (!soc.ready) return <div className="empty">Carregando…</div>;
  if (!soc.friendIds.includes(uid))
    return (
      <div className="empty">
        Esta pessoa não está na sua lista de amigos. <a href="#/amigos">Voltar</a>
      </div>
    );
  if (!f) return <div className="empty">Carregando perfil…</div>;

  const week = profileWeek(f);
  const flash = (t: string) => {
    setSent(t);
    setTimeout(() => setSent(null), 2500);
  };
  const best = Object.entries(f.best ?? {}).sort((a, b) => b[1].a - a[1].a);

  return (
    <div>
      <div className="page-header">
        <button className="btn ghost icon" onClick={() => back('/amigos')} aria-label="Voltar">
          <Icon name="back" />
        </button>
        <Avatar name={f.name} photo={f.photo} avatar={f.avatar} seed={uid} size={52} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ margin: 0 }}>{f.name}</h1>
          <div className="small muted">
            Nível {levelFor(f.xp).level} · {levelFor(f.xp).title}
            {f.current ? ` · estudando “${f.current}”` : ''}
          </div>
        </div>
      </div>

      <div className="stat-grid">
        <div className="card flat kpi">
          <span>Esta semana</span>
          <b>{week.xp} XP</b>
          <span className="tiny">
            {week.minutes} min · você: {weekStats(p).xp} XP
          </span>
        </div>
        <div className="card flat kpi">
          <span>Sequência</span>
          <b>
            🔥 {liveStreak(f)} {liveStreak(f) === 1 ? 'dia' : 'dias'}
          </b>
          <span className="tiny">Recorde: {f.streakBest}</span>
        </div>
        <div className="card flat kpi">
          <span>Total</span>
          <b>{f.xp} XP</b>
          <span className="tiny">
            {f.lessonsDone} lições · {f.stars} ★ · {f.songsMastered} músicas dominadas
          </span>
        </div>
      </div>

      <div className="row friend-actions">
        <button className="btn primary" onClick={() => navigate('/chat/' + uid)}>
          <Icon name="chat" /> Conversar
        </button>
        <button
          className="btn"
          disabled={!!sent}
          onClick={() => {
            void sendCheer(uid, `👏 ${acc.user?.name?.split(' ')[0] ?? 'Um amigo'} mandou um aplauso!`).catch(() => undefined);
            flash('Aplauso enviado! 👏');
          }}
        >
          👏 Aplaudir
        </button>
        {sent && <span className="small" style={{ color: 'var(--ok)' }}>{sent}</span>}
      </div>

      {best.length > 0 && (
        <div className="card">
          <h3>Recordes de {f.name.split(' ')[0]}</h3>
          <table className="table">
            <tbody>
              {best.map(([id, b]) => {
                const mine = p.songs[id]?.best;
                return (
                  <tr key={id}>
                    <td>{b.t}</td>
                    <td>
                      <b>{Math.round(b.a * 100)}%</b>
                    </td>
                    <td className="small muted">{mine !== undefined ? `você: ${Math.round(mine * 100)}%` : ''}</td>
                    <td style={{ textAlign: 'right' }}>
                      {available.has(id) && (
                        <button className="btn sm" onClick={() => navigate(`/musica/${encodeURIComponent(id)}`)}>
                          {mine !== undefined && mine >= b.a ? 'Abrir' : 'Tentar superar'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <h3>Medalhas ({f.badges?.length ?? 0})</h3>
        {f.badges?.length ? (
          <div className="row" style={{ gap: 6 }}>
            {f.badges.map((b) => {
              const a = ACHIEVEMENTS.find((x) => x.id === b);
              return a ? (
                <span key={b} className="chip" title={a.desc} style={{ fontSize: 13 }}>
                  {a.icon} {a.title}
                </span>
              ) : null;
            })}
          </div>
        ) : (
          <p className="small muted">Ainda nenhuma.</p>
        )}
      </div>

      {f.recent?.length > 0 && (
        <div className="card">
          <h3>Atividade recente</h3>
          {f.recent.map((e) => (
            <div key={`${e.at}|${e.t}`} className="feed-item">
              <div className="txt">{e.t}</div>
              <span className="tiny muted">{new Date(e.at).toLocaleDateString('pt-BR')}</span>
            </div>
          ))}
        </div>
      )}

      <button
        className="btn ghost danger"
        onClick={() => {
          if (confirm(`Remover ${f.name} dos seus amigos?`)) void removeFriend(uid).then(() => navigate('/amigos'));
        }}
      >
        Remover amizade
      </button>

    </div>
  );
}

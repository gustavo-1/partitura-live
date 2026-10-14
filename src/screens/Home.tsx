import { useEffect, useState } from 'react';
import { allLessons, findLesson } from '../data/curriculum';
import { builtinSongs } from '../data/songs';
import { useStore } from '../lib/store';
import { minutesToday, progress } from '../state/progress';
import { settings } from '../state/settings';
import { navigate } from '../lib/router';
import { Icon } from '../components/Icon';
import { ProgressBar } from '../components/ui';
import { nextLessonId } from './PathScreen';
import { SongCard } from './Library';
import { listImported } from '../data/library';
import type { Song } from '../music/types';
import { account } from '../lib/account';
import { friendFeed, profileWeek, social } from '../lib/social';
import { weekStats } from '../state/progress';
import { Avatar } from '../components/Avatar';

export function Home() {
  const p = useStore(progress);
  const st = useStore(settings);
  const nextId = nextLessonId(p);
  const next = nextId ? findLesson(nextId) : null;
  const total = allLessons().length;
  const done = Object.values(p.lessons).filter((l) => l.stars > 0).length;
  const mins = minutesToday(p);
  const goal = st.dailyGoalMin;
  const [recent, setRecent] = useState<Song[]>([]);
  const acc = useStore(account);
  const soc = useStore(social);
  const signedIn = acc.status === 'signed-in' && !!acc.user;
  const feed = friendFeed(soc).slice(0, 3);
  const myWeek = weekStats(p).xp;
  const rank = signedIn ? 1 + soc.friendIds.filter((id) => soc.friends[id] && profileWeek(soc.friends[id]).xp > myWeek).length : 0;

  useEffect(() => {
    const ids = Object.entries(p.songs)
      .sort((a, b) => b[1].lastPlayed - a[1].lastPlayed)
      .slice(0, 4)
      .map(([id]) => id);
    listImported().then((imp) => {
      const all = [...builtinSongs(), ...imp.map((r) => r.song)];
      setRecent(ids.map((id) => all.find((s) => s.id === id)).filter((s): s is Song => !!s));
    });
  }, [p.songs]);

  const suggestions = builtinSongs()
    .filter((s) => !p.songs[s.id])
    .slice(0, 4);
  const firstTime = done === 0 && Object.keys(p.songs).length === 0;

  return (
    <div>
      <div className="row between nowrap" style={{ marginBottom: 12 }}>
        <div className="small muted" style={{ fontWeight: 650 }}>
          {signedIn ? `Olá, ${(soc.me?.name ?? acc.user!.name).split(' ')[0]}!` : 'Partitura Live'}
        </div>
        <a href="#/perfil" className="row nowrap" style={{ gap: 8, color: 'var(--ink)' }} aria-label="Perfil">
          {signedIn ? (
            <>
              <span className="chip">
                <Icon name="fire" size={14} /> {p.streak.current}
              </span>
              <Avatar name={acc.user!.name} photo={acc.user!.photo} avatar={st.avatar} seed={acc.user!.uid} size={34} />
            </>
          ) : acc.status === 'signed-out' ? (
            <span className="btn sm">Entrar</span>
          ) : (
            <Icon name="user" size={26} />
          )}
        </a>
      </div>
      <div className="hero">
        <div className="hero-notes" aria-hidden>
          ♫
        </div>
        <div className="row between" style={{ alignItems: 'flex-start' }}>
          <div>
            <div className="small" style={{ opacity: 0.85, fontWeight: 700 }}>
              {firstTime ? 'Bem-vindo(a)!' : 'Bom te ver de novo!'}
            </div>
            <h1 style={{ margin: '4px 0 8px' }}>{next ? next.lesson.title : 'Trilha concluída!'}</h1>
            <p className="muted" style={{ maxWidth: 520 }}>
              {next
                ? firstTime
                  ? 'Comece pela trilha: em poucos minutos você já vai encontrar notas no teclado e ler suas primeiras notas na pauta.'
                  : `${next.unit.title} · ${next.lesson.summary}`
                : 'Você completou todas as lições. Continue com as músicas e os treinos de leitura!'}
            </p>
          </div>
        </div>
        <div className="row" style={{ marginTop: 6 }}>
          {next ? (
            <button className="btn lg" onClick={() => navigate('/licao/' + next.lesson.id)}>
              <Icon name="play" /> {firstTime ? 'Começar' : 'Continuar'}
            </button>
          ) : (
            <button className="btn lg" onClick={() => navigate('/musicas')}>
              <Icon name="music" /> Ver músicas
            </button>
          )}
        </div>
      </div>

      <div className="kpis">
        <div className="card flat kpi">
          <span>Hoje</span>
          <b>
            {mins} / {goal} min
          </b>
          <ProgressBar value={mins / Math.max(1, goal)} />
        </div>
        <div className="card flat kpi">
          <span>Sequência</span>
          <b>
            <Icon name="fire" size={20} /> {p.streak.current} {p.streak.current === 1 ? 'dia' : 'dias'}
          </b>
          <span className="tiny">Recorde: {p.streak.best}</span>
        </div>
        <div className="card flat kpi">
          <span>Trilha</span>
          <b>
            {done}/{total} lições
          </b>
          <ProgressBar value={done / total} />
        </div>
      </div>

      {signedIn && soc.friendIds.length > 0 && (
        <>
          <div className="section-title">
            <h2>Amigos</h2>
            <a href="#/amigos" className="small">
              Ver tudo
            </a>
          </div>
          <div className="card">
            <div className="row between">
              <b>
                <Icon name="trophy" size={18} /> Você está em {rank}º no ranking da semana
              </b>
              <span className="small muted">{myWeek} XP</span>
            </div>
            {feed.map((f) => (
              <div key={`${f.uid}|${f.at}|${f.t}`} className="feed-item">
                <Avatar name={f.name} photo={f.photo} avatar={f.avatar} seed={f.uid} size={30} />
                <div className="txt">
                  <b>{f.name}</b> {f.t.charAt(0).toLowerCase() + f.t.slice(1)}
                </div>
              </div>
            ))}
            {soc.unread + soc.incoming.length > 0 && (
              <a className="btn sm" href="#/amigos?aba=msgs" style={{ marginTop: 8 }}>
                {soc.unread + soc.incoming.length} novidade(s) para você
              </a>
            )}
          </div>
        </>
      )}
      {acc.status === 'signed-out' && done + Object.keys(p.songs).length > 0 && (
        <div className="banner" style={{ marginTop: 16 }}>
          <Icon name="cloud" size={22} />
          <div style={{ flex: 1 }}>
            <b>Seu progresso está só neste aparelho.</b>
            <div className="small">Entre na sua conta para salvá-lo na nuvem, usar em outros aparelhos e praticar com amigos.</div>
          </div>
          <a className="btn sm primary" href="#/perfil">
            Entrar
          </a>
        </div>
      )}

      <div className="section-title">
        <h2>Treino rápido</h2>
        <a href="#/treino" className="small">
          Ver todos
        </a>
      </div>
      <div className="grid cols-3">
        <button className="card song-card" onClick={() => navigate('/treino/leitura')}>
          <Icon name="eye" size={26} />
          <h3>Leitura de notas</h3>
          <div className="small muted">Cartões que focam nas notas que você mais erra.</div>
        </button>
        <button className="card song-card" onClick={() => navigate('/treino/leitura-primeira-vista')}>
          <Icon name="sparkle" size={26} />
          <h3>Primeira vista</h3>
          <div className="small muted">Exercícios novos gerados no seu nível.</div>
        </button>
        <button className="card song-card" onClick={() => navigate('/treino/ritmo')}>
          <Icon name="metronome" size={26} />
          <h3>Ritmo</h3>
          <div className="small muted">Bata ritmos junto com o metrônomo.</div>
        </button>
      </div>

      {recent.length > 0 && (
        <>
          <div className="section-title">
            <h2>Continuar praticando</h2>
          </div>
          <div className="grid cols-2">
            {recent.map((s) => (
              <SongCard key={s.id} song={s} best={p.songs[s.id]?.best} />
            ))}
          </div>
        </>
      )}

      <div className="section-title">
        <h2>Músicas para começar</h2>
        <a href="#/musicas" className="small">
          Ver todas
        </a>
      </div>
      <div className="grid cols-2">
        {suggestions.map((s) => (
          <SongCard key={s.id} song={s} />
        ))}
      </div>

      {firstTime && (
        <div className="card" style={{ marginTop: 20 }}>
          <h3>Como o app ouve você</h3>
          <p className="small muted" style={{ marginBottom: 6 }}>
            Coloque o celular ou computador perto do teclado e permita o uso do <b>microfone</b> quando pedido. O app reconhece as notas que você
            toca (inclusive acordes) e mostra na hora se estão certas. Ambientes silenciosos funcionam melhor.
          </p>
          <p className="small muted" style={{ marginBottom: 0 }}>
            Tem um teclado com USB/MIDI? Conecte no computador ou celular (Chrome/Edge) e ele é reconhecido automaticamente. Sem teclado por
            perto, use o teclado na tela ou as teclas do computador.
          </p>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn" onClick={() => navigate('/treino/detector')}>
              <Icon name="mic" /> Testar o microfone
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { allLessons, findLesson } from '../data/curriculum';
import { builtinSongs, songCollection } from '../data/songs';
import { useStore } from '../lib/store';
import { progress, streakNow } from '../state/progress';
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
import { chats } from '../lib/chat';
import { weekStats } from '../state/progress';
import { Avatar } from '../components/Avatar';
import { CHEST_XP, dailyGoal, groupWeek, levelFor, MAX_FREEZES, QUEST_XP, todaysQuests } from '../state/gamification';
import { dueCount } from '../practice/review';

export function Ring({ value, size = 76, stroke = 8, children }: { value: number; size?: number; stroke?: number; children?: React.ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--bg-2)" strokeWidth={stroke} />
        {v > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={v >= 1 ? 'var(--ok)' : 'var(--accent)'}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${c * v} ${c}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            style={{ transition: 'stroke-dasharray 0.6s ease' }}
          />
        )}
      </svg>
      <div className="ring-in">{children}</div>
    </div>
  );
}

export function Home() {
  const p = useStore(progress);
  const st = useStore(settings);
  const nextId = nextLessonId(p);
  const next = nextId ? findLesson(nextId) : null;
  const total = allLessons().length;
  const done = Object.values(p.lessons).filter((l) => l.stars > 0).length;
  const [recent, setRecent] = useState<Song[]>([]);
  const acc = useStore(account);
  const soc = useStore(social);
  const ch = useStore(chats);
  const signedIn = acc.status === 'signed-in' && !!acc.user;
  const feed = friendFeed(soc).slice(0, 2);
  const myWeek = weekStats(p).xp;
  const rank = signedIn ? 1 + soc.friendIds.filter((id) => soc.friends[id] && profileWeek(soc.friends[id]).xp > myWeek).length : 0;
  const goal = dailyGoal(p);
  const lv = levelFor(p.xp);
  const streak = streakNow(p);
  const quests = todaysQuests(p);
  const questsDone = quests.filter((q) => q.done).length;
  const due = dueCount(p);
  const group = groupWeek(p, soc);
  const unread = ch.unreadTotal + soc.unread;

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

  // sugestões: as mais fáceis ainda não tocadas, com pelo menos uma de cada coleção
  const unplayed = builtinSongs()
    .filter((s) => !p.songs[s.id])
    .sort((a, b) => a.level - b.level);
  const suggestions = [
    ...(['folclore', 'pop', 'classico'] as const).map((c) => unplayed.find((s) => songCollection(s.id) === c)).filter((s): s is Song => !!s),
    ...unplayed,
  ]
    .filter((s, i, arr) => arr.indexOf(s) === i)
    .slice(0, 4);
  const firstTime = done === 0 && Object.keys(p.songs).length === 0;
  const name = signedIn ? (soc.me?.name ?? acc.user!.name).split(' ')[0] : '';
  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
  const heroBlock = (
    <div className="hero">
      <div className="hero-notes" aria-hidden>
        ♫
      </div>
      <div className="small" style={{ opacity: 0.85, fontWeight: 700 }}>
        {firstTime ? 'Comece por aqui' : next ? `Trilha · ${done}/${total} lições` : 'Trilha concluída!'}
      </div>
      <h1 style={{ margin: '4px 0 8px' }}>{next ? next.lesson.title : 'Você completou a trilha!'}</h1>
      <p className="muted" style={{ maxWidth: 520 }}>
        {next
          ? firstTime
            ? 'Em poucos minutos você já vai encontrar notas no teclado e ler suas primeiras notas na pauta.'
            : `${next.unit.title} · ${next.lesson.summary}`
          : 'Continue com as músicas, a revisão do dia e a leitura à primeira vista.'}
      </p>
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
        <ProgressBar value={done / total} />
      </div>
    </div>
  );

  return (
    <div className="home">
      <div className="home-top">
        <div>
          <div className="small muted" style={{ fontWeight: 650 }}>
            {hello}
            {name ? `, ${name}` : ''}!
          </div>
          <div className="level-line">
            <b>Nível {lv.level}</b> <span className="muted">· {lv.title}</span>
          </div>
        </div>
        <div className="row nowrap" style={{ gap: 8 }}>
          <span
            className={'streak-chip' + (streak.doneToday ? ' lit' : '')}
            title={streak.doneToday ? 'Você já praticou hoje' : 'Pratique hoje para manter a sequência'}
          >
            🔥 {streak.days}
            {(p.freezes ?? 0) > 0 && <span className="freeze">🧊{p.freezes}</span>}
          </span>
          <a href="#/perfil" aria-label="Perfil" className="row nowrap" style={{ color: 'var(--ink)' }}>
            {signedIn ? (
              <Avatar name={acc.user!.name} photo={acc.user!.photo} avatar={st.avatar} seed={acc.user!.uid} size={36} />
            ) : acc.status === 'signed-out' ? (
              <span className="btn sm">Entrar</span>
            ) : (
              <Icon name="user" size={26} />
            )}
          </a>
        </div>
      </div>

      {firstTime && heroBlock}

      <div className="home-dash">
      <div className="today-card card">
        <Ring value={goal.pct}>
          <b>{goal.minutes}</b>
          <span className="tiny muted">/{goal.goal} min</span>
        </Ring>
        <div className="today-info">
          <b>
            {goal.done
              ? 'Meta de hoje cumprida! ✅'
              : goal.minutes > 0
                ? `Faltam ${goal.goal - goal.minutes} min para a meta`
                : `Meta de hoje: ${goal.goal} minutos`}
          </b>
          <div className="small muted">
            {streak.protectedDays > 0
              ? `🧊 Sua sequência de ${streak.days} dias está protegida. Pratique hoje para continuar.`
              : streak.doneToday
                ? `Sequência de ${streak.days} ${streak.days === 1 ? 'dia' : 'dias'}. Volte amanhã!`
                : streak.days > 0
                  ? `Pratique hoje para manter seus ${streak.days} ${streak.days === 1 ? 'dia' : 'dias'} seguidos.`
                  : 'Qualquer prática hoje começa uma nova sequência.'}
          </div>
          <div className="xp-line">
            <ProgressBar value={lv.pct} />
            <span className="tiny muted">
              {lv.into}/{lv.need} XP para o nível {lv.level + 1}
            </span>
          </div>
        </div>
      </div>

      <div className="card quests">
        <div className="row between nowrap">
          <h3 style={{ margin: 0 }}>Missões do dia</h3>
          <span className="tiny muted">{questsDone}/3</span>
        </div>
        {quests.map((q) => (
          <button key={q.def.id} className={'quest' + (q.done ? ' done' : '')} onClick={() => navigate(q.def.href(p))} title={q.def.why}>
            <span className="q-ic">{q.done ? '✅' : q.def.icon}</span>
            <span className="q-body">
              <span className="q-title">{q.def.title}</span>
              {q.def.target > 1 && !q.done ? (
                <span className="q-bar">
                  <ProgressBar value={q.value / q.def.target} />
                  <span className="tiny muted">
                    {q.value}/{q.def.target}
                  </span>
                </span>
              ) : (
                <span className="tiny muted">{q.done ? `+${QUEST_XP} XP` : q.def.why}</span>
              )}
            </span>
            {!q.done && <Icon name="next" size={18} />}
          </button>
        ))}
        <div className={'chest' + (p.quests?.chest ? ' open' : '')}>
          <span>{p.quests?.chest ? '🎉' : '🎁'}</span>
          <span className="small">
            {p.quests?.chest
              ? 'Todas cumpridas hoje! Amanhã tem missões novas.'
              : `Cumpra as 3: +${CHEST_XP} XP${(p.freezes ?? 0) < MAX_FREEZES ? ' e uma proteção de sequência 🧊' : ''}.`}
          </span>
        </div>
      </div>
      </div>

      {!firstTime && heroBlock}

      {!firstTime && (
        <button className="card review-cta" onClick={() => navigate('/treino/revisao')}>
          <span className="review-ic-sm">🧠</span>
          <span style={{ flex: 1, textAlign: 'left' }}>
            <b>Revisão do dia</b>
            <span className="small muted" style={{ display: 'block' }}>
              {due > 0 ? `${due} ${due === 1 ? 'nota pronta' : 'notas prontas'} para revisar · ~3 min` : 'Notas, conceitos, ritmo e ouvido · ~3 min'}
            </span>
          </span>
          <Icon name="next" />
        </button>
      )}

      {signedIn && soc.friendIds.length > 0 && (
        <>
          <div className="section-title">
            <h2>Amigos</h2>
            <a href="#/amigos" className="small">
              Ver tudo
            </a>
          </div>
          <div className="card friends-mini">
            <button className="row between nowrap link-row" onClick={() => navigate('/amigos?aba=liga')}>
              <b>
                <Icon name="trophy" size={18} /> {rank}º na liga da semana
              </b>
              <span className="small muted">{myWeek} XP</span>
            </button>
            <div className="group-mini">
              <div className="row between small nowrap">
                <span>Meta do grupo</span>
                <span className="muted">
                  {Math.min(group.minutes, group.target)}/{group.target} min
                </span>
              </div>
              <ProgressBar value={group.minutes / group.target} />
            </div>
            {feed.map((f) => (
              <div key={`${f.uid}|${f.at}|${f.t}`} className="feed-item">
                <Avatar name={f.name} photo={f.photo} avatar={f.avatar} seed={f.uid} size={30} />
                <div className="txt">
                  <b>{f.name}</b> {f.t.charAt(0).toLowerCase() + f.t.slice(1)}
                </div>
              </div>
            ))}
            {(unread > 0 || soc.incoming.length > 0) && (
              <a className="btn sm primary" href={unread ? '#/amigos?aba=conversas' : '#/amigos'} style={{ marginTop: 8 }}>
                <Icon name="chat" size={16} />
                {unread > 0 ? ` ${unread} ${unread === 1 ? 'mensagem nova' : 'mensagens novas'}` : ` ${soc.incoming.length} pedido(s) de amizade`}
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
      <div className="quick-grid">
        <button className="card quick" onClick={() => navigate('/treino/leitura')}>
          <span className="quick-ic">👀</span>
          <b>Leitura de notas</b>
          <span className="tiny muted">Cartões que repetem o que você erra</span>
        </button>
        <button className="card quick" onClick={() => navigate('/treino/leitura-primeira-vista')}>
          <span className="quick-ic">✨</span>
          <b>Primeira vista</b>
          <span className="tiny muted">Melodias novas no seu nível</span>
        </button>
        <button className="card quick" onClick={() => navigate('/treino/ouvido')}>
          <span className="quick-ic">👂</span>
          <b>De ouvido</b>
          <span className="tiny muted">Ouça e toque de volta</span>
        </button>
        <button className="card quick" onClick={() => navigate('/treino/ritmo')}>
          <span className="quick-ic">🥁</span>
          <b>Ritmo</b>
          <span className="tiny muted">Bata junto com o metrônomo</span>
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

      {suggestions.length > 0 && (
        <>
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
        </>
      )}

      {firstTime && (
        <div className="card" style={{ marginTop: 20 }}>
          <h3>Como o app ouve você</h3>
          <p className="small muted" style={{ marginBottom: 6 }}>
            Coloque o celular ou computador perto do teclado e permita o uso do <b>microfone</b> quando pedido. O app reconhece as notas que você toca
            (inclusive acordes) e mostra na hora se estão certas. Ambientes silenciosos funcionam melhor.
          </p>
          <p className="small muted" style={{ marginBottom: 0 }}>
            Tem um teclado com USB/MIDI? Conecte no computador ou celular (Chrome/Edge) e ele é reconhecido automaticamente. Sem teclado por perto,
            use o teclado na tela ou as teclas do computador.
          </p>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn" onClick={() => navigate('/treino/detector')}>
              <Icon name="mic" /> Testar o microfone
            </button>
          </div>
        </div>
      )}

      <a className="method-link card flat" href="#/metodo">
        <Icon name="brain" size={22} />
        <span style={{ flex: 1 }}>
          <b>Como o app ensina</b>
          <span className="small muted" style={{ display: 'block' }}>
            Revisão espaçada, prática deliberada, som antes do símbolo — e as pesquisas por trás.
          </span>
        </span>
        <Icon name="next" />
      </a>
    </div>
  );
}

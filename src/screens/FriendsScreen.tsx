import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import { account } from '../lib/account';
import {
  acceptRequest,
  addFriendByCode,
  declineRequest,
  deleteMessage,
  friendFeed,
  inviteLink,
  liveStreak,
  markRead,
  profileWeek,
  sendCheer,
  social,
  songFromMessage,
  type InboxMsg,
} from '../lib/social';
import { navigate } from '../lib/router';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { SignInBox } from '../components/AccountCard';
import { builtinSong } from '../data/songs';
import { getSong, saveImported } from '../data/library';
import { weekStats, progress } from '../state/progress';

type Tab = 'ranking' | 'feed' | 'msgs' | 'friends';

function timeAgo(ms: number): string {
  const s = Math.max(1, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return 'agora';
  const m = Math.round(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? 'ontem' : `há ${d} dias`;
}

const CHEERED_KEY = 'pl.cheered';
function cheeredSet(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(CHEERED_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}
function markCheered(k: string) {
  const s = cheeredSet();
  s.add(k);
  try {
    localStorage.setItem(CHEERED_KEY, JSON.stringify([...s].slice(-300)));
  } catch {
    /* ignora */
  }
}

/** Abre a música de um desafio (salva na biblioteca se veio junto na mensagem). */
export async function openChallenge(m: InboxMsg) {
  if (!m.songId) return;
  const have = builtinSong(m.songId) ?? (await getSong(m.songId));
  if (!have) {
    const song = await songFromMessage(m);
    if (!song) {
      alert('Esta música não está na sua biblioteca. Peça para seu amigo enviá-la.');
      return;
    }
    await saveImported(song, `${song.title}.json`);
  }
  try {
    sessionStorage.setItem('pl.challenge', JSON.stringify({ songId: m.songId, from: m.from, fromName: m.fromName, score: m.score ?? 0 }));
  } catch {
    /* ignora */
  }
  navigate(`/tocar/${encodeURIComponent(m.songId)}?mode=wait&desafio=1`);
}

export default function FriendsScreen({ query }: { query: URLSearchParams }) {
  const acc = useStore(account);
  const soc = useStore(social);
  const p = useStore(progress);
  const [tab, setTab] = useState<Tab>((query.get('aba') as Tab) || 'ranking');
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [cheered, setCheered] = useState(cheeredSet);
  const signedIn = acc.status === 'signed-in';
  const addParam = query.get('add');
  const abaParam = query.get('aba') as Tab | null;
  useEffect(() => {
    if (abaParam) setTab(abaParam);
  }, [abaParam]);

  // convite por link: #/amigos?add=CODIGO
  useEffect(() => {
    if (!addParam) return;
    if (!signedIn) {
      try {
        sessionStorage.setItem('pl.pendingAdd', addParam);
      } catch {
        /* ignora */
      }
      return;
    }
    if (!soc.ready) return;
    void addFriendByCode(addParam).then((r) => setMsg({ ok: r.ok, text: r.message }));
    navigate('/amigos', true);
  }, [addParam, signedIn, soc.ready]);
  useEffect(() => {
    if (!signedIn || !soc.ready) return;
    let pending: string | null = null;
    try {
      pending = sessionStorage.getItem('pl.pendingAdd');
      sessionStorage.removeItem('pl.pendingAdd');
    } catch {
      /* ignora */
    }
    if (pending) void addFriendByCode(pending).then((r) => setMsg({ ok: r.ok, text: r.message }));
  }, [signedIn, soc.ready]);

  // ao abrir as mensagens, marca como lidas
  useEffect(() => {
    if (tab !== 'msgs') return;
    const ids = soc.inbox.filter((m) => !m.read).map((m) => m.id);
    if (ids.length) {
      const t = setTimeout(() => void markRead(ids), 1500);
      return () => clearTimeout(t);
    }
  }, [tab, soc.inbox]);

  const feed = useMemo(() => friendFeed(soc), [soc]);

  if (!signedIn) {
    return (
      <div>
        <div className="page-header">
          <h1>Amigos</h1>
        </div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Pratique junto com amigos</h2>
          <ul className="muted" style={{ paddingLeft: 18 }}>
            <li>Ranking semanal de XP entre vocês</li>
            <li>Veja o que seus amigos estão aprendendo e mande aplausos 👏</li>
            <li>Desafie um amigo a superar sua nota numa música ⚔️</li>
            <li>Envie as músicas que você importou</li>
          </ul>
          {addParam && <div className="banner small" style={{ marginBottom: 10 }}>Entre na sua conta para adicionar o amigo com código <b>{addParam}</b>.</div>}
          <SignInBox />
        </div>
      </div>
    );
  }

  const meWeek = weekStats(p);
  const ranking = [
    { uid: acc.user!.uid, name: soc.me?.name ?? acc.user!.name, photo: soc.me?.photo, avatar: soc.me?.avatar, xp: meWeek.xp, minutes: meWeek.minutes, streak: p.streak.current, me: true },
    ...soc.friendIds
      .map((uid) => soc.friends[uid])
      .filter(Boolean)
      .map((f) => ({ uid: f.uid, name: f.name, photo: f.photo, avatar: f.avatar, ...profileWeek(f), streak: liveStreak(f), me: false })),
  ].sort((a, b) => b.xp - a.xp || b.minutes - a.minutes);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await addFriendByCode(code);
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) setCode('');
    } catch (err) {
      setMsg({ ok: false, text: String((err as Error).message ?? err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1>Amigos</h1>
      </div>

      <div className="card">
        <form className="row" onSubmit={submit}>
          <input
            placeholder="Código do amigo (6 letras)"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={8}
            style={{ flex: '1 1 160px', textTransform: 'uppercase', letterSpacing: '0.1em' }}
            aria-label="Código do amigo"
          />
          <button className="btn primary" disabled={busy || code.trim().length < 6}>
            <Icon name="plus" /> Adicionar
          </button>
        </form>
        {msg && <p className="small" style={{ color: msg.ok ? 'var(--ok)' : 'var(--bad)', marginBottom: 0 }}>{msg.text}</p>}
        {soc.me?.code && (
          <div className="row small muted" style={{ marginTop: 10 }}>
            Seu código: <b style={{ letterSpacing: '0.12em', color: 'var(--accent)' }}>{soc.me.code}</b>
            <button
              className="btn sm ghost"
              onClick={async () => {
                const link = inviteLink(soc.me!.code);
                const text = `Vamos aprender teclado juntos no Partitura Live! Meu código: ${soc.me!.code}`;
                try {
                  if (navigator.share) await navigator.share({ title: 'Partitura Live', text, url: link });
                  else {
                    await navigator.clipboard.writeText(`${text}\n${link}`);
                    setMsg({ ok: true, text: 'Convite copiado! Cole numa conversa com seu amigo.' });
                  }
                } catch {
                  /* cancelado */
                }
              }}
            >
              <Icon name="upload" /> Convidar
            </button>
          </div>
        )}
      </div>

      {soc.incoming.length > 0 && (
        <div className="card">
          <h3>Pedidos de amizade</h3>
          {soc.incoming.map((r) => (
            <div key={r.id} className="person-row">
              <Avatar name={r.fromName} photo={r.fromPhoto} avatar={r.fromAvatar} seed={r.from} size={40} />
              <div className="who">
                <b>{r.fromName}</b>
                <span className="small muted">quer ser seu amigo · {timeAgo(r.createdAt)}</span>
              </div>
              <button className="btn sm primary" onClick={() => void acceptRequest(r)}>
                Aceitar
              </button>
              <button className="btn sm ghost" onClick={() => void declineRequest(r)}>
                Recusar
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="tabs" role="tablist">
        {(
          [
            ['ranking', 'Ranking da semana'],
            ['feed', 'Atividade'],
            ['msgs', `Mensagens${soc.unread ? ` (${soc.unread})` : ''}`],
            ['friends', `Amigos (${soc.friendIds.length})`],
          ] as [Tab, string][]
        ).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
      </div>

      {tab === 'ranking' && (
        <div className="card">
          {ranking.length === 1 && <p className="small muted">Adicione amigos para competir no ranking semanal. Ele zera toda segunda-feira.</p>}
          {ranking.map((r, i) => (
            <div key={r.uid} className={'person-row' + (r.me ? ' me-row' : '')} style={{ cursor: r.me ? 'default' : 'pointer' }} onClick={() => !r.me && navigate('/amigo/' + r.uid)}>
              <span className={'rank-num' + (i < 3 && r.xp > 0 ? ' top' : '')}>{i === 0 && r.xp > 0 ? '🥇' : i === 1 && r.xp > 0 ? '🥈' : i === 2 && r.xp > 0 ? '🥉' : i + 1}</span>
              <Avatar name={r.name} photo={r.photo} avatar={r.avatar} seed={r.uid} size={38} />
              <div className="who">
                <b>
                  {r.name}
                  {r.me ? ' (você)' : ''}
                </b>
                <span className="small muted">
                  {r.minutes} min esta semana{r.streak > 0 ? ` · 🔥 ${r.streak} ${r.streak === 1 ? 'dia' : 'dias'}` : ''}
                </span>
              </div>
              <b>{r.xp} XP</b>
            </div>
          ))}
        </div>
      )}

      {tab === 'feed' && (
        <div className="card">
          {feed.length === 0 ? (
            <p className="small muted">Quando seus amigos concluírem lições, tocarem músicas ou ganharem medalhas, aparece aqui.</p>
          ) : (
            feed.map((f) => {
              const key = `${f.uid}|${f.at}|${f.t}`;
              const done = cheered.has(key);
              return (
                <div key={key} className="feed-item">
                  <Avatar name={f.name} photo={f.photo} avatar={f.avatar} seed={f.uid} size={36} />
                  <div className="txt">
                    <a href={'#/amigo/' + f.uid}>
                      <b>{f.name}</b>
                    </a>{' '}
                    {f.t.charAt(0).toLowerCase() + f.t.slice(1)}
                    <div className="tiny muted">{timeAgo(f.at)}</div>
                  </div>
                  <button
                    className={'btn sm' + (done ? ' active' : '')}
                    disabled={done}
                    title="Mandar um aplauso"
                    onClick={() => {
                      void sendCheer(f.uid, `👏 Parabéns! ${f.t}`);
                      markCheered(key);
                      setCheered(cheeredSet());
                    }}
                  >
                    {done ? '👏 Enviado' : '👏'}
                  </button>
                </div>
              );
            })
          )}
        </div>
      )}

      {tab === 'msgs' && (
        <div className="stack">
          {soc.inbox.length === 0 && <p className="small muted">Nenhuma mensagem ainda.</p>}
          {soc.inbox.map((m) => (
            <MessageCard key={m.id} m={m} />
          ))}
        </div>
      )}

      {tab === 'friends' && (
        <div className="card">
          {soc.friendIds.length === 0 && <p className="small muted">Você ainda não adicionou ninguém. Compartilhe seu código ou peça o código de um amigo.</p>}
          {soc.friendIds.map((uid) => {
            const f = soc.friends[uid];
            return (
              <div key={uid} className="person-row" style={{ cursor: 'pointer' }} onClick={() => navigate('/amigo/' + uid)}>
                <Avatar name={f?.name ?? '…'} photo={f?.photo} avatar={f?.avatar} seed={uid} size={40} />
                <div className="who">
                  <b>{f?.name ?? 'Carregando…'}</b>
                  <span className="small muted">{f ? `${f.lessonsDone} lições · ${f.xp} XP${f.current ? ` · estudando “${f.current}”` : ''}` : ''}</span>
                </div>
                <Icon name="next" size={18} />
              </div>
            );
          })}
          {soc.outgoing.length > 0 && (
            <>
              <h3 style={{ marginTop: 16 }}>Pedidos enviados</h3>
              {soc.outgoing.map((r) => (
                <div key={r.id} className="person-row">
                  <div className="who">
                    <b>{r.toName ?? 'Aguardando resposta'}</b>
                    <span className="small muted">enviado {timeAgo(r.createdAt)}</span>
                  </div>
                  <button className="btn sm ghost" onClick={() => void declineRequest(r)}>
                    Cancelar
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MessageCard({ m }: { m: InboxMsg }) {
  const [added, setAdded] = useState(false);
  return (
    <div className={'msg-card' + (m.read ? '' : ' unread')}>
      <Avatar name={m.fromName} photo={m.fromPhoto} avatar={m.fromAvatar} seed={m.from} size={38} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="small">
          <b>{m.fromName}</b> <span className="muted">· {timeAgo(m.createdAt)}</span>
        </div>
        {m.type === 'challenge' ? (
          <>
            <div style={{ marginTop: 4 }}>
              ⚔️ te desafiou em <b>{m.songTitle}</b>: consegue passar de <b>{Math.round((m.score ?? 0) * 100)}%</b>?
            </div>
            {m.text && <div className="small muted">“{m.text}”</div>}
            <button className="btn sm primary" style={{ marginTop: 8 }} onClick={() => void openChallenge(m)}>
              Aceitar desafio
            </button>
          </>
        ) : m.type === 'song' ? (
          <>
            <div style={{ marginTop: 4 }}>
              🎼 te enviou a música <b>{m.songTitle}</b>
            </div>
            {m.text && <div className="small muted">“{m.text}”</div>}
            <button
              className="btn sm primary"
              style={{ marginTop: 8 }}
              disabled={added}
              onClick={async () => {
                const song = await songFromMessage(m);
                if (!song) return alert('Não foi possível abrir a música.');
                await saveImported(song, `${song.title}.json`);
                setAdded(true);
              }}
            >
              {added ? 'Adicionada às suas músicas ✓' : 'Adicionar às minhas músicas'}
            </button>
          </>
        ) : (
          <div style={{ marginTop: 4 }}>{m.text}</div>
        )}
      </div>
      <button className="btn ghost sm icon" aria-label="Apagar mensagem" onClick={() => void deleteMessage(m.id)}>
        <Icon name="x" size={16} />
      </button>
    </div>
  );
}

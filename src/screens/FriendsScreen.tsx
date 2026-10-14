import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import { account } from '../lib/account';
import { acceptRequest, addFriendByCode, declineRequest, friendFeed, inviteLink, liveStreak, profileWeek, sendCheer, social } from '../lib/social';
import { chats } from '../lib/chat';
import { navigate } from '../lib/router';
import { shortWhen, timeAgo } from '../lib/time';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { SignInBox } from '../components/AccountCard';
import { ProgressBar } from '../components/ui';
import { weekStats, progress } from '../state/progress';
import { GROUP_MIN_PER_PERSON, groupWeek } from '../state/gamification';

type Tab = 'conversas' | 'liga' | 'feed' | 'friends';

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

/** Dias que faltam para a liga semanal zerar (segunda-feira). */
function daysLeftInWeek(): number {
  const dow = (new Date().getDay() + 6) % 7; // 0 = segunda
  return 7 - dow;
}

function parseTab(q: string | null): Tab | null {
  if (q === 'msgs') return 'conversas';
  if (q === 'ranking') return 'liga';
  return q === 'conversas' || q === 'liga' || q === 'feed' || q === 'friends' ? q : null;
}

export default function FriendsScreen({ query }: { query: URLSearchParams }) {
  const acc = useStore(account);
  const soc = useStore(social);
  const ch = useStore(chats);
  const p = useStore(progress);
  const abaParam = parseTab(query.get('aba'));
  const [tab, setTab] = useState<Tab>(() => abaParam ?? (ch.unreadTotal || soc.unread ? 'conversas' : 'liga'));
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [cheered, setCheered] = useState(cheeredSet);
  const [notif, setNotif] = useState(() => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission));
  const signedIn = acc.status === 'signed-in';
  const addParam = query.get('add');
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
            <li>Converse em tempo real e combinem a prática do dia 💬</li>
            <li>Liga semanal de XP e uma meta coletiva de minutos 🏆</li>
            <li>Veja o que seus amigos estão aprendendo e mande aplausos 👏</li>
            <li>Desafie um amigo a superar sua nota numa música ⚔️</li>
          </ul>
          {addParam && (
            <div className="banner small" style={{ marginBottom: 10 }}>
              Entre na sua conta para adicionar o amigo com código <b>{addParam}</b>.
            </div>
          )}
          <SignInBox />
        </div>
      </div>
    );
  }

  const myUid = acc.user!.uid;
  const meWeek = weekStats(p);
  const ranking = [
    { uid: myUid, name: soc.me?.name ?? acc.user!.name, photo: soc.me?.photo, avatar: soc.me?.avatar, xp: meWeek.xp, minutes: meWeek.minutes, streak: p.streak.current, me: true },
    ...soc.friendIds
      .map((uid) => soc.friends[uid])
      .filter(Boolean)
      .map((f) => ({ uid: f.uid, name: f.name, photo: f.photo, avatar: f.avatar, ...profileWeek(f), streak: liveStreak(f), me: false })),
  ].sort((a, b) => b.xp - a.xp || b.minutes - a.minutes);
  const group = groupWeek(p, soc);

  // conversas: com mensagens primeiro (mais recentes), depois amigos sem conversa
  const legacyLast = new Map<string, { at: number; text: string; unread: number }>();
  for (const m of soc.inbox) {
    const cur = legacyLast.get(m.from);
    const unread = (cur?.unread ?? 0) + (m.read ? 0 : 1);
    if (!cur || m.createdAt > cur.at) legacyLast.set(m.from, { at: m.createdAt, text: m.text ?? m.songTitle ?? '', unread });
    else cur.unread = unread;
  }
  const now = Date.now();
  const convs = soc.friendIds
    .map((uid) => {
      const meta = ch.chats[uid];
      const lg = legacyLast.get(uid);
      const last =
        meta?.last && (!lg || meta.last.at >= lg.at)
          ? { at: meta.last.at, text: (meta.last.from === myUid ? 'Você: ' : '') + meta.last.text }
          : lg
            ? { at: lg.at, text: lg.text }
            : null;
      return { uid, f: soc.friends[uid], last, unread: (ch.unread[uid] ?? 0) + (lg?.unread ?? 0), typing: (ch.typingUntil[uid] ?? 0) > now, here: (ch.hereUntil[uid] ?? 0) > now };
    })
    .sort((a, b) => (b.last?.at ?? 0) - (a.last?.at ?? 0));
  const unreadTotal = ch.unreadTotal + soc.unread;

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

  const invite = async () => {
    if (!soc.me?.code) return;
    const link = inviteLink(soc.me.code);
    const text = `Vamos aprender teclado juntos no Partitura Live! Meu código: ${soc.me.code}`;
    try {
      if (navigator.share) await navigator.share({ title: 'Partitura Live', text, url: link });
      else {
        await navigator.clipboard.writeText(`${text}\n${link}`);
        setMsg({ ok: true, text: 'Convite copiado! Cole numa conversa com seu amigo.' });
        setTab('friends');
      }
    } catch {
      /* cancelado */
    }
  };

  const cheer = (uid: string, key: string, text: string) => {
    void sendCheer(uid, text).catch(() => undefined);
    markCheered(key);
    setCheered(cheeredSet());
  };

  return (
    <div>
      <div className="page-header">
        <h1 style={{ flex: 1 }}>Amigos</h1>
        {soc.me?.code && (
          <button className="btn sm" onClick={() => void invite()}>
            <Icon name="upload" /> Convidar
          </button>
        )}
      </div>

      {soc.incoming.length > 0 && (
        <div className="card accent-card">
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
            ['conversas', 'Conversas', unreadTotal],
            ['liga', 'Liga da semana', 0],
            ['feed', 'Atividade', 0],
            ['friends', `Amigos (${soc.friendIds.length})`, 0],
          ] as [Tab, string, number][]
        ).map(([k, l, n]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {l}
            {n > 0 && <span className="tab-badge">{n}</span>}
          </button>
        ))}
      </div>

      {tab === 'conversas' && (
        <div className="card conv-list">
          {soc.friendIds.length === 0 && <EmptyFriends onInvite={() => void invite()} />}
          {convs.map((c) => (
            <button key={c.uid} className={'conv-row' + (c.unread ? ' unread' : '')} onClick={() => navigate('/chat/' + c.uid)}>
              <span className="avatar-wrap">
                <Avatar name={c.f?.name ?? '…'} photo={c.f?.photo} avatar={c.f?.avatar} seed={c.uid} size={46} />
                {c.here && <span className="presence-dot" />}
              </span>
              <span className="who">
                <span className="conv-line">
                  <b>{c.f?.name ?? 'Carregando…'}</b>
                  <span className={'tiny ' + (c.unread ? 'accent-text' : 'muted')}>{c.last ? shortWhen(c.last.at) : ''}</span>
                </span>
                <span className="conv-line">
                  <span className={'small conv-preview' + (c.typing ? ' typing-text' : '')}>{c.typing ? 'digitando…' : (c.last?.text ?? 'Toque para começar uma conversa')}</span>
                  {c.unread > 0 && <span className="count-badge">{c.unread}</span>}
                </span>
              </span>
            </button>
          ))}
          {notif === 'default' && soc.friendIds.length > 0 && (
            <div className="banner small" style={{ marginTop: 12 }}>
              <Icon name="bell" size={18} />
              <div style={{ flex: 1 }}>Quer um aviso quando chegar mensagem com o app em segundo plano?</div>
              <button className="btn sm" onClick={() => void Notification.requestPermission().then(setNotif)}>
                Ativar avisos
              </button>
            </div>
          )}
        </div>
      )}

      {tab === 'liga' && (
        <>
          <div className="card league-head">
            <div className="row between nowrap">
              <div>
                <div className="tiny muted upper">Liga da semana</div>
                <b>
                  Termina em {daysLeftInWeek()} {daysLeftInWeek() === 1 ? 'dia' : 'dias'}
                </b>
              </div>
              <span style={{ fontSize: 32 }}>🏆</span>
            </div>
            {ranking.length > 1 && (
              <div className="group-goal">
                <div className="row between small nowrap">
                  <span>
                    <b>Meta do grupo:</b> {group.target} min juntos
                  </span>
                  <b>
                    {Math.min(group.minutes, group.target)}/{group.target}
                  </b>
                </div>
                <ProgressBar value={group.minutes / group.target} />
                <div className="tiny muted">
                  {group.done
                    ? 'Meta batida! Todo mundo do grupo ganha a medalha “Banda unida”. 🎉'
                    : `Cada pessoa soma ${GROUP_MIN_PER_PERSON} min na meta. Se o grupo bater junto, todos ganham uma medalha.`}
                </div>
              </div>
            )}
          </div>
          <div className="card">
            {ranking.length === 1 && <p className="small muted">Adicione amigos para competir na liga semanal. Ela zera toda segunda-feira.</p>}
            {ranking.map((r, i) => {
              const key = `${r.uid}|liga|${r.xp}`;
              return (
                <div key={r.uid} className={'person-row' + (r.me ? ' me-row' : '')} style={{ cursor: r.me ? 'default' : 'pointer' }} onClick={() => !r.me && navigate('/amigo/' + r.uid)}>
                  <span className={'rank-num' + (i < 3 && r.xp > 0 ? ' top' : '')}>{i === 0 && r.xp > 0 ? '🥇' : i === 1 && r.xp > 0 ? '🥈' : i === 2 && r.xp > 0 ? '🥉' : i + 1}</span>
                  <Avatar name={r.name} photo={r.photo} avatar={r.avatar} seed={r.uid} size={38} />
                  <div className="who">
                    <b>
                      {r.name}
                      {r.me ? ' (você)' : ''}
                    </b>
                    <span className="small muted">
                      {r.minutes} min{r.streak > 0 ? ` · 🔥 ${r.streak}` : ''}
                    </span>
                  </div>
                  <b className="xp-num">{r.xp} XP</b>
                  {!r.me && (
                    <button
                      className={'btn sm icon ghost' + (cheered.has(key) ? ' active' : '')}
                      disabled={cheered.has(key) || r.xp === 0}
                      aria-label={`Aplaudir ${r.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        cheer(r.uid, key, `👏 Bora! Você já fez ${r.xp} XP na liga desta semana!`);
                      }}
                    >
                      👏
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <p className="tiny muted" style={{ textAlign: 'center' }}>
            A liga compara só esta semana: todo mundo recomeça do zero na segunda. Conta a constância, não quem começou antes.
          </p>
        </>
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
                  <button className={'btn sm' + (done ? ' active' : '')} disabled={done} title="Mandar um aplauso" onClick={() => cheer(f.uid, key, `👏 Parabéns! ${f.t}`)}>
                    {done ? '👏 Enviado' : '👏'}
                  </button>
                </div>
              );
            })
          )}
        </div>
      )}

      {tab === 'friends' && (
        <>
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
              </div>
            )}
          </div>
          <div className="card">
            {soc.friendIds.length === 0 && <EmptyFriends onInvite={() => void invite()} />}
            {soc.friendIds.map((uid) => {
              const f = soc.friends[uid];
              return (
                <div key={uid} className="person-row" style={{ cursor: 'pointer' }} onClick={() => navigate('/amigo/' + uid)}>
                  <Avatar name={f?.name ?? '…'} photo={f?.photo} avatar={f?.avatar} seed={uid} size={40} />
                  <div className="who">
                    <b>{f?.name ?? 'Carregando…'}</b>
                    <span className="small muted">{f ? `${f.lessonsDone} lições · ${f.xp} XP${f.current ? ` · estudando “${f.current}”` : ''}` : ''}</span>
                  </div>
                  <button
                    className="btn sm icon ghost"
                    aria-label={`Conversar com ${f?.name ?? 'amigo'}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate('/chat/' + uid);
                    }}
                  >
                    <Icon name="chat" />
                  </button>
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
        </>
      )}
    </div>
  );
}

function EmptyFriends({ onInvite }: { onInvite: () => void }) {
  return (
    <div className="empty-mini">
      <div style={{ fontSize: 36 }}>🎹🤝</div>
      <p className="small muted">Aprender com alguém ajuda a manter a constância. Convide um amigo ou peça o código dele na aba “Amigos”.</p>
      <button className="btn primary sm" onClick={onInvite}>
        <Icon name="upload" /> Convidar um amigo
      </button>
    </div>
  );
}

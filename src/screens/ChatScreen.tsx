import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../lib/store';
import { account } from '../lib/account';
import { liveStreak, markRead, social } from '../lib/social';
import {
  chats,
  deleteChatMessage,
  deleteConversation,
  heartbeat,
  HEARTBEAT_MS,
  markSeen,
  notifyTyping,
  react,
  sendChatChallenge,
  sendChatCheer,
  sendChatSong,
  sendChatText,
  setOpenChat,
  stopTyping,
  subscribeMessages,
  TEXT_MAX,
  type ChatMsg,
} from '../lib/chat';
import { addSongFromMessage, haveSong, openChallenge } from '../lib/challenges';
import { back, navigate } from '../lib/router';
import { clock, dayLabel, sameDay } from '../lib/time';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { Sheet } from '../components/ui';
import { progress, today } from '../state/progress';
import { getSong, listImported, type ImportedRecord } from '../data/library';
import { builtinSong } from '../data/songs';

const REACTIONS = ['❤️', '👏', '🔥', '😂', '😮', '👍'];
const QUICK = ['👏 Mandou bem!', 'Bora praticar hoje? 🎹', 'Já fiz minha prática de hoje ✅', 'Te desafio! ⚔️'];
const PAGE = 40;

// rascunhos por conversa (sobrevivem à troca de tela)
const drafts = new Map<string, string>();

const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

export default function ChatScreen({ uid }: { uid: string }) {
  const acc = useStore(account);
  const soc = useStore(social);
  const ch = useStore(chats);
  const p = useStore(progress);
  const me = acc.user?.uid ?? '';
  const f = soc.friends[uid];
  const meta = ch.chats[uid];
  const isFriend = soc.friendIds.includes(uid);

  const [limit, setLimit] = useState(PAGE);
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [text, setText] = useState(() => drafts.get(uid) ?? '');
  const [sel, setSel] = useState<string | null>(null);
  const [sheet, setSheet] = useState<null | 'challenge' | 'song' | 'menu'>(null);
  const [err, setErr] = useState<string | null>(null);
  const [newBelow, setNewBelow] = useState(0);
  const [, setTick] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const atBottom = useRef(true);
  const keepScroll = useRef<{ h: number; top: number } | null>(null);
  const lastCount = useRef(0);

  // conversa aberta (não notifica mensagens desta conversa)
  useEffect(() => {
    setOpenChat(uid);
    return () => setOpenChat(undefined);
  }, [uid]);

  // mensagens em tempo real
  useEffect(() => {
    if (!ch.uid) return;
    return subscribeMessages(
      uid,
      limit,
      (m, more) => {
        setMsgs(m);
        setHasMore(more);
        setLoaded(true);
      },
      () => setLoaded(true),
    );
  }, [uid, limit, ch.uid]);

  // presença: "na conversa" enquanto a tela está visível
  useEffect(() => {
    if (!ch.uid || !isFriend) return;
    const beat = () => document.visibilityState === 'visible' && heartbeat(uid, true);
    beat();
    const t = setInterval(beat, HEARTBEAT_MS);
    const vis = () => (document.visibilityState === 'visible' ? beat() : heartbeat(uid, false));
    document.addEventListener('visibilitychange', vis);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', vis);
      heartbeat(uid, false);
      stopTyping(uid);
    };
  }, [uid, ch.uid, isFriend]);

  // mensagens antigas (caixa de entrada de antes do chat) entram na conversa
  const legacy = useMemo<ChatMsg[]>(
    () =>
      soc.inbox
        .filter((m) => m.from === uid)
        .map((m) => ({
          id: 'legacy-' + m.id,
          from: m.from,
          type: m.type,
          text: m.text,
          songId: m.songId,
          songTitle: m.songTitle,
          score: m.score,
          data: m.data,
          at: m.createdAt,
          pending: false,
          legacy: true,
        })),
    [soc.inbox, uid],
  );
  const all = useMemo(() => {
    if (!legacy.length) return msgs;
    const oldest = msgs.length && hasMore ? msgs[0].at : 0;
    return [...legacy.filter((m) => m.at >= oldest), ...msgs].sort((a, b) => a.at - b.at);
  }, [legacy, msgs, hasMore]);

  // marca como vistas (só com a tela visível)
  useEffect(() => {
    const run = () => {
      if (document.visibilityState !== 'visible') return;
      markSeen(uid);
      const ids = soc.inbox.filter((m) => m.from === uid && !m.read).map((m) => m.id);
      if (ids.length) void markRead(ids);
    };
    run();
    document.addEventListener('visibilitychange', run);
    return () => document.removeEventListener('visibilitychange', run);
  }, [uid, meta?.sent?.[uid], soc.inbox, all.length]);

  // "digitando…" some sozinho
  const typingUntil = ch.typingUntil[uid] ?? 0;
  const hereUntil = ch.hereUntil[uid] ?? 0;
  useEffect(() => {
    const until = Math.max(typingUntil, hereUntil);
    if (until <= Date.now()) return;
    const t = setTimeout(() => setTick((x) => x + 1), Math.min(until - Date.now() + 50, 60_000));
    return () => clearTimeout(t);
  }, [typingUntil, hereUntil]);
  const typing = typingUntil > Date.now();
  const here = hereUntil > Date.now();

  // rolagem: gruda no fim, mantém posição ao carregar anteriores
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    if (keepScroll.current) {
      el.scrollTop = el.scrollHeight - keepScroll.current.h + keepScroll.current.top;
      keepScroll.current = null;
    } else {
      const last = all[all.length - 1];
      const grew = all.length > lastCount.current;
      if (atBottom.current || (last && last.from === me && last.pending) || lastCount.current === 0) {
        el.scrollTop = el.scrollHeight;
        setNewBelow(0);
      } else if (grew && last && last.from !== me) setNewBelow((n) => n + (all.length - lastCount.current));
    }
    lastCount.current = all.length;
  }, [all, me]);
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [typing]);

  const onScroll = () => {
    const el = bodyRef.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (atBottom.current && newBelow) setNewBelow(0);
    if (el.scrollTop < 40 && hasMore && !keepScroll.current) {
      keepScroll.current = { h: el.scrollHeight, top: el.scrollTop };
      setLimit((l) => l + PAGE);
    }
  };
  const toBottom = () => {
    const el = bodyRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    setNewBelow(0);
  };

  const sendText = (t: string) => {
    const v = t.trim();
    if (!v) return;
    setErr(null);
    atBottom.current = true;
    sendChatText(uid, v).catch(() => setErr('Não foi possível enviar. Verifique sua conexão e se vocês ainda são amigos.'));
  };
  const submit = () => {
    if (!text.trim()) return;
    sendText(text);
    setText('');
    drafts.delete(uid);
    inputRef.current?.focus();
  };

  // ajusta a altura da caixa de texto
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 140) + 'px';
  }, [text]);

  if (acc.status !== 'signed-in') return <div className="empty">Entre na sua conta para conversar com seus amigos.</div>;
  const name = f?.name ?? 'Amigo';
  const first = name.split(' ')[0];
  const seenAt = meta?.seenAt?.[uid] ?? 0;
  const lastMine = [...all].reverse().find((m) => m.from === me);

  const status = typing ? (
    <span className="typing-text">digitando…</span>
  ) : here ? (
    <span className="online-text">● na conversa agora</span>
  ) : f ? (
    <span>
      {liveStreak(f) > 0 ? `🔥 ${liveStreak(f)} ${liveStreak(f) === 1 ? 'dia' : 'dias'} · ` : ''}
      {f.lastDay === today() ? 'praticou hoje' : f.current ? `estudando “${f.current}”` : `${f.xp} XP`}
    </span>
  ) : null;

  return (
    <div className="chat">
      <header className="chat-head">
        <button className="btn ghost icon" onClick={() => back('/amigos?aba=conversas')} aria-label="Voltar">
          <Icon name="back" />
        </button>
        <button className="chat-who" onClick={() => navigate('/amigo/' + uid)} aria-label={`Ver perfil de ${name}`}>
          <span className="avatar-wrap">
            <Avatar name={name} photo={f?.photo} avatar={f?.avatar} seed={uid} size={40} />
            {here && <span className="presence-dot" />}
          </span>
          <span className="who">
            <b>{name}</b>
            <span className="tiny muted">{status}</span>
          </span>
        </button>
        <button className="btn ghost icon" onClick={() => setSheet('menu')} aria-label="Mais opções">
          <Icon name="more" />
        </button>
      </header>

      <div className="chat-body" ref={bodyRef} onScroll={onScroll} onClick={() => setSel(null)}>
        {hasMore && <div className="chat-older tiny muted">Carregando mensagens anteriores…</div>}
        {loaded && all.length === 0 && (
          <div className="chat-empty">
            <Avatar name={name} photo={f?.photo} avatar={f?.avatar} seed={uid} size={64} />
            <h3>Diga oi para {first}! 👋</h3>
            <p className="small muted">Combinem um horário de prática, mandem desafios e comemorem as conquistas um do outro.</p>
          </div>
        )}
        {!loaded && <div className="chat-older tiny muted">Carregando…</div>}
        {all.map((m, i) => {
          const prev = all[i - 1];
          const next = all[i + 1];
          const mine = m.from === me;
          const newDay = !prev || !sameDay(prev.at, m.at);
          const groupStart = newDay || !prev || prev.from !== m.from || m.at - prev.at > 5 * 60_000;
          const groupEnd = !next || next.from !== m.from || next.at - m.at > 5 * 60_000 || !sameDay(next.at, m.at);
          const seen = mine && !m.pending && !m.legacy && seenAt >= m.at;
          return (
            <Fragment key={m.id}>
              {newDay && <div className="chat-day">{dayLabel(m.at)}</div>}
              <Bubble
                m={m}
                mine={mine}
                me={me}
                friendName={name}
                groupStart={groupStart}
                groupEnd={groupEnd}
                selected={sel === m.id}
                onSelect={() => setSel(sel === m.id ? null : m.id)}
                onReact={(e) => {
                  setSel(null);
                  if (!m.legacy) void react(uid, m.id, m.reactions?.[me] === e ? null : e).catch(() => undefined);
                }}
                onDelete={() => {
                  setSel(null);
                  if (!m.legacy) void deleteChatMessage(uid, m.id);
                }}
                status={mine ? (m.pending ? 'pending' : seen ? 'seen' : 'sent') : undefined}
              />
              {lastMine && m.id === lastMine.id && seen && (!next || next.from === me) && <div className="chat-seen tiny muted">Visto {clock(seenAt)}</div>}
            </Fragment>
          );
        })}
        {typing && (
          <div className="bubble-row theirs group-start group-end">
            <div className="bubble typing-bubble" aria-label={`${first} está digitando`}>
              <span />
              <span />
              <span />
            </div>
          </div>
        )}
      </div>

      {newBelow > 0 && (
        <button className="chat-new-pill" onClick={toBottom}>
          ↓ {newBelow} {newBelow === 1 ? 'mensagem nova' : 'mensagens novas'}
        </button>
      )}

      {!isFriend ? (
        <div className="chat-closed small muted">Vocês não são mais amigos — não dá para enviar mensagens nesta conversa.</div>
      ) : (
        <div className="chat-foot">
          {err && (
            <div className="chat-err small" role="alert">
              {err}
            </div>
          )}
          {!text && (
            <div className="chat-quick" role="toolbar" aria-label="Atalhos">
              <button className="chip-btn" onClick={() => void sendChatCheer(uid, `👏 ${acc.user?.name?.split(' ')[0] ?? 'Seu amigo'} mandou um aplauso!`).catch(() => undefined)}>
                👏 Aplaudir
              </button>
              <button className="chip-btn" onClick={() => setSheet('challenge')}>
                ⚔️ Desafiar
              </button>
              <button className="chip-btn" onClick={() => setSheet('song')}>
                🎵 Enviar música
              </button>
              {QUICK.map((q) => (
                <button key={q} className="chip-btn" onClick={() => sendText(q)}>
                  {q}
                </button>
              ))}
            </div>
          )}
          <form
            className="chat-composer"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <textarea
              ref={inputRef}
              rows={1}
              value={text}
              maxLength={TEXT_MAX}
              placeholder={`Mensagem para ${first}`}
              aria-label="Mensagem"
              onChange={(e) => {
                setText(e.target.value);
                drafts.set(uid, e.target.value);
                if (e.target.value.trim()) notifyTyping(uid);
                else stopTyping(uid);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !coarse && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submit();
                }
              }}
              onBlur={() => stopTyping(uid)}
            />
            <button className="btn primary icon send-btn" disabled={!text.trim()} aria-label="Enviar">
              <Icon name="send" />
            </button>
          </form>
        </div>
      )}

      <Sheet open={sheet === 'menu'} onClose={() => setSheet(null)} title={name}>
        <div className="stack">
          <button className="btn block" onClick={() => navigate('/amigo/' + uid)}>
            <Icon name="user" /> Ver perfil e recordes
          </button>
          <button
            className="btn block ghost danger"
            onClick={() => {
              if (!confirm(`Apagar toda a conversa com ${name}? Ela some para os dois.`)) return;
              setSheet(null);
              void deleteConversation(uid).catch(() => setErr('Não foi possível apagar agora.'));
            }}
          >
            <Icon name="trash" /> Apagar conversa
          </button>
        </div>
      </Sheet>

      <ChallengeSheet
        open={sheet === 'challenge'}
        onClose={() => setSheet(null)}
        best={p.songs}
        titles={p.songTitles ?? {}}
        friendBest={f?.best ?? {}}
        friendName={first}
        onPick={async (id, score) => {
          setSheet(null);
          const song = await getSong(id);
          if (!song) return setErr('Música não encontrada.');
          atBottom.current = true;
          sendChatChallenge(uid, song, score).catch(() => setErr('Não foi possível enviar o desafio.'));
        }}
      />
      <SongSheet
        open={sheet === 'song'}
        onClose={() => setSheet(null)}
        onPick={(r) => {
          setSheet(null);
          atBottom.current = true;
          sendChatSong(uid, r.song).catch((e) => setErr(String((e as Error).message ?? 'Não foi possível enviar a música.')));
        }}
      />
    </div>
  );
}

function Bubble({
  m,
  mine,
  me,
  friendName,
  groupStart,
  groupEnd,
  selected,
  onSelect,
  onReact,
  onDelete,
  status,
}: {
  m: ChatMsg;
  mine: boolean;
  me: string;
  friendName: string;
  groupStart: boolean;
  groupEnd: boolean;
  selected: boolean;
  onSelect: () => void;
  onReact: (e: string) => void;
  onDelete: () => void;
  status?: 'pending' | 'sent' | 'seen';
}) {
  const reactions = Object.entries(m.reactions ?? {});
  const counts = new Map<string, number>();
  reactions.forEach(([, e]) => counts.set(e, (counts.get(e) ?? 0) + 1));
  const special = m.type !== 'text';
  const meta = (
    <span className="bubble-meta">
      {clock(m.at)}
      {status === 'pending' && <span title="Enviando"> 🕓</span>}
      {status === 'sent' && <span className="tick" title="Enviada"> ✓</span>}
      {status === 'seen' && <span className="tick seen" title="Vista"> ✓✓</span>}
    </span>
  );
  return (
    <div className={'bubble-row ' + (mine ? 'mine' : 'theirs') + (groupStart ? ' group-start' : '') + (groupEnd ? ' group-end' : '') + (reactions.length ? ' has-react' : '')}>
      <div
        className={'bubble' + (special ? ' special ' + m.type : '') + (selected ? ' selected' : '') + (m.type === 'text' && /^\p{Extended_Pictographic}{1,3}$/u.test(m.text ?? '') ? ' emoji-only' : '')}
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onReact('❤️');
        }}
      >
        <MessageBody m={m} mine={mine} friendName={friendName} />
        {meta}
        {reactions.length > 0 && (
          <span className="bubble-reacts">
            {[...counts].map(([e, n]) => (
              <span key={e} className={m.reactions?.[me] === e ? 'mine' : ''}>
                {e}
                {n > 1 ? n : ''}
              </span>
            ))}
          </span>
        )}
      </div>
      {selected && !m.legacy && (
        <div className="react-bar" onClick={(e) => e.stopPropagation()}>
          {REACTIONS.map((e) => (
            <button key={e} className={m.reactions?.[me] === e ? 'on' : ''} onClick={() => onReact(e)} aria-label={`Reagir com ${e}`}>
              {e}
            </button>
          ))}
          {m.type === 'text' && (
            <button
              aria-label="Copiar"
              onClick={() => {
                void navigator.clipboard?.writeText(m.text ?? '').catch(() => undefined);
                onSelect();
              }}
              className="txt"
            >
              Copiar
            </button>
          )}
          {mine && (
            <button aria-label="Apagar mensagem" className="txt danger" onClick={onDelete}>
              Apagar
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function MessageBody({ m, mine, friendName }: { m: ChatMsg; mine: boolean; friendName: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'have'>('idle');
  useEffect(() => {
    if (m.type === 'song' && m.songId) void haveSong(m.songId).then((h) => h && setState((s) => (s === 'idle' ? 'have' : s)));
  }, [m.type, m.songId]);
  const first = friendName.split(' ')[0];
  switch (m.type) {
    case 'cheer':
      return <div className="cheer-body">{m.text || '👏'}</div>;
    case 'challenge':
      return (
        <div className="card-body">
          <div className="card-kicker">⚔️ Desafio</div>
          <b>{m.songTitle}</b>
          <div className="small">
            {mine ? (
              <>
                Você desafiou {first} a passar de <b>{Math.round((m.score ?? 0) * 100)}%</b>.
              </>
            ) : (
              <>
                Consegue passar de <b>{Math.round((m.score ?? 0) * 100)}%</b>?
              </>
            )}
          </div>
          {m.text && <div className="small quote">“{m.text}”</div>}
          {!mine && (
            <button
              className="btn sm primary"
              onClick={(e) => {
                e.stopPropagation();
                void openChallenge({ ...m, fromName: friendName });
              }}
            >
              Aceitar desafio
            </button>
          )}
        </div>
      );
    case 'song':
      return (
        <div className="card-body">
          <div className="card-kicker">🎵 Música</div>
          <b>{m.songTitle}</b>
          {m.text && <div className="small quote">“{m.text}”</div>}
          {!mine &&
            (state === 'have' || state === 'done' ? (
              <button
                className="btn sm"
                onClick={(e) => {
                  e.stopPropagation();
                  navigate('/musica/' + encodeURIComponent(m.songId ?? ''));
                }}
              >
                {state === 'done' ? 'Adicionada ✓ Abrir' : 'Abrir'}
              </button>
            ) : (
              <button
                className="btn sm primary"
                disabled={state === 'busy'}
                onClick={async (e) => {
                  e.stopPropagation();
                  setState('busy');
                  const ok = await addSongFromMessage(m);
                  setState(ok ? 'done' : 'idle');
                  if (!ok) alert('Não foi possível abrir a música.');
                }}
              >
                Adicionar às minhas músicas
              </button>
            ))}
        </div>
      );
    case 'result':
      return (
        <div className="card-body">
          <div className="card-kicker">🏁 Resultado</div>
          <div>{m.text}</div>
          {!mine && m.songId && (
            <button
              className="btn sm"
              onClick={(e) => {
                e.stopPropagation();
                navigate('/musica/' + encodeURIComponent(m.songId ?? ''));
              }}
            >
              Ver a música
            </button>
          )}
        </div>
      );
    default:
      return <div className="text-body">{linkify(m.text ?? '')}</div>;
  }
}

function linkify(t: string) {
  const parts = t.split(/(https?:\/\/[^\s]+)/g);
  return parts.map((s, i) =>
    /^https?:\/\//.test(s) ? (
      <a key={i} href={s} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
        {s}
      </a>
    ) : (
      <Fragment key={i}>{s}</Fragment>
    ),
  );
}

function ChallengeSheet({
  open,
  onClose,
  best,
  titles,
  friendBest,
  friendName,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  best: Record<string, { best: number; lastPlayed: number }>;
  titles: Record<string, string>;
  friendBest: Record<string, { t: string; a: number }>;
  friendName: string;
  onPick: (id: string, score: number) => void;
}) {
  const list = Object.entries(best)
    .filter(([, v]) => v.best > 0)
    .sort((a, b) => b[1].lastPlayed - a[1].lastPlayed)
    .slice(0, 30);
  return (
    <Sheet open={open} onClose={onClose} title="Desafiar com qual música?">
      {list.length === 0 ? (
        <p className="muted">
          Toque uma música inteira (com as duas mãos) para ter uma nota para desafiar. <a href="#/musicas">Ver músicas</a>
        </p>
      ) : (
        <>
          <p className="small muted">{friendName} precisa superar a sua melhor nota tocando a música inteira.</p>
          {list.map(([id, v]) => (
            <button key={id} className="person-row btn ghost pick-row" onClick={() => onPick(id, v.best)}>
              <Icon name="music" />
              <span className="who">
                <b>{titles[id] ?? builtinSong(id)?.title ?? id}</b>
                <span className="small muted">
                  sua nota: {Math.round(v.best * 100)}%{friendBest[id] ? ` · ${friendName}: ${Math.round(friendBest[id].a * 100)}%` : ''}
                </span>
              </span>
              <span>⚔️</span>
            </button>
          ))}
        </>
      )}
    </Sheet>
  );
}

function SongSheet({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (r: ImportedRecord) => void }) {
  const [imported, setImported] = useState<ImportedRecord[] | null>(null);
  useEffect(() => {
    if (open) void listImported().then(setImported);
  }, [open]);
  return (
    <Sheet open={open} onClose={onClose} title="Enviar uma música">
      {imported === null ? (
        <p className="muted">Carregando…</p>
      ) : imported.length === 0 ? (
        <p className="muted">
          Você ainda não importou músicas (MusicXML ou MIDI). As que já vêm no app seus amigos também têm. <a href="#/musicas">Importar</a>
        </p>
      ) : (
        imported.map((r) => (
          <button key={r.id} className="person-row btn ghost pick-row" onClick={() => onPick(r)}>
            <Icon name="music" />
            <span className="who">
              <b>{r.song.title}</b>
              <span className="small muted">{r.song.composer}</span>
            </span>
          </button>
        ))
      )}
    </Sheet>
  );
}

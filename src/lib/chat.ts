/**
 * Conversas em tempo real entre amigos (Firestore):
 *  chats/{a_b}                 resumo da conversa (uids em ordem alfabética)
 *    members                   [a, b]
 *    last                      última mensagem {from, type, text, at}
 *    sent.{uid}                quantas mensagens cada um já enviou
 *    seen.{uid}                quantas mensagens do outro cada um já viu
 *    seenAt.{uid}              quando viu pela última vez (recibo de leitura)
 *    typing.{uid}              digitando (marca de tempo do aparelho)
 *    here.{uid}                com a conversa aberta (marca de tempo do aparelho)
 *  chats/{a_b}/messages/{id}   mensagens: texto, aplauso, desafio, música, resultado
 * As regras de segurança estão em firestore.rules.
 */
import type { DocumentData, Unsubscribe } from 'firebase/firestore';
import type { FB } from './firebase';
import { createStore } from './store';
import { builtinSong } from '../data/songs';
import { bumpDay } from '../state/progress';
import type { Song } from '../music/types';

export type ChatType = 'text' | 'cheer' | 'challenge' | 'song' | 'result';

export interface ChatMsg {
  id: string;
  from: string;
  type: ChatType;
  text?: string;
  songId?: string;
  songTitle?: string;
  score?: number;
  data?: { toUint8Array(): Uint8Array };
  at: number;
  pending: boolean;
  reactions?: Record<string, string>;
  /** veio da caixa de mensagens antiga (antes do chat) */
  legacy?: boolean;
}

export interface ChatMeta {
  id: string;
  other: string;
  last?: { from: string; type: ChatType; text: string; at: number };
  updatedAt: number;
  sent: Record<string, number>;
  seen: Record<string, number>;
  seenAt: Record<string, number>;
  typing: Record<string, number>;
  here: Record<string, number>;
}

export interface ChatState {
  ready: boolean;
  uid?: string;
  /** conversas, pela pessoa do outro lado */
  chats: Record<string, ChatMeta>;
  unread: Record<string, number>;
  unreadTotal: number;
  /** até quando mostrar "digitando…" (relógio deste aparelho) */
  typingUntil: Record<string, number>;
  /** até quando mostrar "na conversa" (relógio deste aparelho) */
  hereUntil: Record<string, number>;
  /** conversa aberta na tela agora */
  open?: string;
}

const initial: ChatState = { ready: false, chats: {}, unread: {}, unreadTotal: 0, typingUntil: {}, hereUntil: {} };
export const chats = createStore<ChatState>(null, initial);

export const TEXT_MAX = 1000;
const TYPING_EVERY = 3500;
const TYPING_SHOW = 6500;
const HERE_EVERY = 40_000;
const HERE_SHOW = 60_000;

let fb: FB | null = null;
let uid = '';
let unsub: Unsubscribe | null = null;
const incoming = new Set<(other: string, m: NonNullable<ChatMeta['last']>) => void>();

export function chatId(a: string, b: string): string {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

/** Avisa quando chega mensagem nova de alguém (para notificações). */
export function onIncomingMessage(fn: (other: string, m: NonNullable<ChatMeta['last']>) => void): () => void {
  incoming.add(fn);
  return () => incoming.delete(fn);
}

function ms(v: unknown): number {
  if (typeof v === 'number') return v;
  if (v && typeof (v as { toMillis?: () => number }).toMillis === 'function') return (v as { toMillis(): number }).toMillis();
  return 0;
}

function numMap(v: unknown, conv: (x: unknown) => number = (x) => Number(x) || 0): Record<string, number> {
  const out: Record<string, number> = {};
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = conv(x);
  return out;
}

function toMeta(id: string, other: string, d: DocumentData): ChatMeta {
  return {
    id,
    other,
    last: d.last ? { from: d.last.from, type: d.last.type, text: d.last.text ?? '', at: ms(d.last.at) } : undefined,
    updatedAt: ms(d.updatedAt),
    sent: numMap(d.sent),
    seen: numMap(d.seen),
    seenAt: numMap(d.seenAt, ms),
    typing: numMap(d.typing),
    here: numMap(d.here),
  };
}

export function unreadOf(m: ChatMeta | undefined, me: string): number {
  if (!m) return 0;
  return Math.max(0, (m.sent[m.other] ?? 0) - (m.seen[me] ?? 0));
}

// ---------- ciclo de vida ----------

export function startChats(f: FB, myUid: string) {
  stopChats();
  fb = f;
  uid = myUid;
  chats.replace({ ...initial, uid: myUid });
  const { fs, db } = f;
  unsub = fs.onSnapshot(
    fs.query(fs.collection(db, 'chats'), fs.where('members', 'array-contains', myUid)),
    (snap) => {
      const st = chats.get();
      const now = Date.now();
      const next: Record<string, ChatMeta> = {};
      const unread: Record<string, number> = {};
      const typingUntil = { ...st.typingUntil };
      const hereUntil = { ...st.hereUntil };
      for (const d of snap.docs) {
        const data = d.data({ serverTimestamps: 'estimate' });
        const other = ((data.members as string[]) ?? []).find((m) => m !== myUid);
        if (!other) continue;
        const meta = toMeta(d.id, other, data);
        const prev = st.chats[other];
        next[other] = meta;
        unread[other] = unreadOf(meta, myUid);
        // "digitando" e "na conversa": detecta pela mudança (não depende do relógio do outro aparelho)
        const ty = meta.typing[other] ?? 0;
        if (ty && (prev ? ty > (prev.typing[other] ?? 0) : now - ty < TYPING_SHOW)) typingUntil[other] = now + TYPING_SHOW;
        if (!ty) delete typingUntil[other];
        const hr = meta.here[other] ?? 0;
        if (hr && (prev ? hr > (prev.here[other] ?? 0) : now - hr < HERE_SHOW)) hereUntil[other] = now + HERE_SHOW;
        if (!hr) delete hereUntil[other];
        // mensagem nova do outro: para de mostrar "digitando" e avisa
        if (meta.last && meta.last.from === other && (!prev?.last || meta.last.at > prev.last.at)) {
          delete typingUntil[other];
          if (st.ready) incoming.forEach((fn) => fn(other, meta.last!));
        }
      }
      chats.set({
        ready: true,
        chats: next,
        unread,
        unreadTotal: Object.values(unread).reduce((a, b) => a + b, 0),
        typingUntil,
        hereUntil,
      });
    },
    () => chats.set({ ready: true }),
  );
}

export function stopChats() {
  unsub?.();
  unsub = null;
  fb = null;
  uid = '';
  chats.replace({ ...initial });
}

export function setOpenChat(other: string | undefined) {
  chats.set({ open: other });
}

// ---------- mensagens de uma conversa ----------

/** Assina as últimas `limit` mensagens de uma conversa (em ordem cronológica). */
export function subscribeMessages(other: string, limit: number, cb: (msgs: ChatMsg[], hasMore: boolean) => void, onError?: (e: Error) => void): Unsubscribe {
  if (!fb || !uid) return () => undefined;
  const { fs, db } = fb;
  return fs.onSnapshot(
    fs.query(fs.collection(db, 'chats', chatId(uid, other), 'messages'), fs.orderBy('at', 'desc'), fs.limit(limit)),
    { includeMetadataChanges: true },
    (snap) => {
      const msgs = snap.docs
        .map((d) => {
          const x = d.data({ serverTimestamps: 'estimate' });
          return {
            id: d.id,
            from: x.from,
            type: x.type,
            text: x.text,
            songId: x.songId,
            songTitle: x.songTitle,
            score: x.score,
            data: x.data,
            at: ms(x.at),
            pending: d.metadata.hasPendingWrites,
            reactions: x.reactions,
          } as ChatMsg;
        })
        .reverse();
      cb(msgs, snap.docs.length >= limit);
    },
    (e) => onError?.(e),
  );
}

type Payload = Pick<ChatMsg, 'type' | 'text' | 'songId' | 'songTitle' | 'score'> & { data?: unknown };

export function previewOf(m: Pick<ChatMsg, 'type' | 'text' | 'songTitle' | 'score'>): string {
  switch (m.type) {
    case 'cheer':
      return m.text || '👏 Aplauso';
    case 'challenge':
      return `⚔️ Desafio: “${m.songTitle ?? 'música'}” (${Math.round((m.score ?? 0) * 100)}%)`;
    case 'song':
      return `🎵 Música: “${m.songTitle ?? ''}”`;
    case 'result':
      return `🏁 ${m.text ?? `Resultado em “${m.songTitle ?? ''}”`}`;
    default:
      return m.text ?? '';
  }
}

/** Envia uma mensagem. Aparece na hora (escrita local) e sincroniza em segundo plano. */
export function sendChat(other: string, payload: Payload): Promise<void> {
  if (!fb || !uid) return Promise.reject(new Error('Entre na sua conta primeiro.'));
  const { fs, db } = fb;
  const cid = chatId(uid, other);
  const chatRef = fs.doc(db, 'chats', cid);
  const msgRef = fs.doc(fs.collection(chatRef, 'messages'));
  const clean = Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== undefined && v !== ''));
  if (typeof clean.text === 'string') clean.text = (clean.text as string).slice(0, TEXT_MAX);
  const batch = fs.writeBatch(db);
  batch.set(msgRef, { ...clean, from: uid, at: fs.serverTimestamp() });
  batch.set(
    chatRef,
    {
      members: [uid, other].sort(),
      updatedAt: fs.serverTimestamp(),
      last: { from: uid, type: payload.type, text: previewOf(payload).slice(0, 140), at: fs.serverTimestamp() },
      sent: { [uid]: fs.increment(1) },
      typing: { [uid]: 0 },
    },
    { merge: true },
  );
  lastTyping = 0;
  bumpDay('social');
  return batch.commit();
}

export function sendChatText(other: string, text: string) {
  const t = text.trim();
  if (!t) return Promise.resolve();
  return sendChat(other, { type: 'text', text: t });
}

export function sendChatCheer(other: string, text = '👏 Mandou um aplauso!') {
  return sendChat(other, { type: 'cheer', text });
}

export function sendChatResult(other: string, song: Pick<Song, 'id' | 'title'>, score: number, text: string) {
  return sendChat(other, { type: 'result', songId: song.id, songTitle: song.title.slice(0, 120), score: Math.round(score * 1000) / 1000, text: text.slice(0, 300) });
}

export async function sendChatChallenge(other: string, song: Song, score: number, text?: string) {
  if (!fb) throw new Error('Entre na sua conta primeiro.');
  let data: unknown;
  if (!builtinSong(song.id)) {
    const { packSong } = await import('./cloudSongs');
    const bytes = packSong(song);
    if (bytes.length < 900_000) data = fb.fs.Bytes.fromUint8Array(bytes);
  }
  return sendChat(other, { type: 'challenge', songId: song.id, songTitle: song.title.slice(0, 120), score: Math.round(score * 1000) / 1000, text: text?.slice(0, 300), data });
}

export async function sendChatSong(other: string, song: Song, text?: string) {
  if (!fb) throw new Error('Entre na sua conta primeiro.');
  const { packSong } = await import('./cloudSongs');
  const bytes = packSong(song);
  if (bytes.length > 900_000) throw new Error('Esta música é grande demais para enviar.');
  return sendChat(other, { type: 'song', songId: song.id, songTitle: song.title.slice(0, 120), text: text?.slice(0, 300), data: fb.fs.Bytes.fromUint8Array(bytes) });
}

// ---------- presença, digitação e leitura ----------

let lastTyping = 0;
/** Chame enquanto a pessoa digita; grava no máximo a cada poucos segundos. */
export function notifyTyping(other: string) {
  if (!fb || !uid) return;
  const now = Date.now();
  if (now - lastTyping < TYPING_EVERY) return;
  lastTyping = now;
  const { fs, db } = fb;
  void fs
    .setDoc(fs.doc(db, 'chats', chatId(uid, other)), { members: [uid, other].sort(), typing: { [uid]: now } }, { merge: true })
    .catch(() => undefined);
}

export function stopTyping(other: string) {
  if (!fb || !uid || !lastTyping) return;
  lastTyping = 0;
  const { fs, db } = fb;
  const meta = chats.get().chats[other];
  if (!meta) return;
  void fs.updateDoc(fs.doc(db, 'chats', chatId(uid, other)), { [`typing.${uid}`]: 0 }).catch(() => undefined);
}

/** Marca "estou com a conversa aberta" (repete enquanto a tela estiver visível). */
export function heartbeat(other: string, on: boolean) {
  if (!fb || !uid) return;
  const meta = chats.get().chats[other];
  if (!meta && !on) return;
  const { fs, db } = fb;
  const ref = fs.doc(db, 'chats', chatId(uid, other));
  const p = meta
    ? fs.updateDoc(ref, { [`here.${uid}`]: on ? Date.now() : 0 })
    : fs.setDoc(ref, { members: [uid, other].sort(), here: { [uid]: Date.now() } }, { merge: true });
  void p.catch(() => undefined);
}
export const HEARTBEAT_MS = HERE_EVERY;

/** Marca como vistas as mensagens recebidas nesta conversa. */
export function markSeen(other: string) {
  if (!fb || !uid) return;
  const meta = chats.get().chats[other];
  if (!meta) return;
  const total = meta.sent[other] ?? 0;
  if ((meta.seen[uid] ?? 0) >= total) return;
  const { fs, db } = fb;
  // otimista: zera o contador já
  const unread = { ...chats.get().unread, [other]: 0 };
  chats.set({
    chats: { ...chats.get().chats, [other]: { ...meta, seen: { ...meta.seen, [uid]: total } } },
    unread,
    unreadTotal: Object.values(unread).reduce((a, b) => a + b, 0),
  });
  void fs
    .updateDoc(fs.doc(db, 'chats', meta.id), { [`seen.${uid}`]: total, [`seenAt.${uid}`]: fs.serverTimestamp() })
    .catch(() => undefined);
}

export async function react(other: string, msgId: string, emoji: string | null) {
  if (!fb || !uid) return;
  const { fs, db } = fb;
  await fs.updateDoc(fs.doc(db, 'chats', chatId(uid, other), 'messages', msgId), { [`reactions.${uid}`]: emoji ?? fs.deleteField() });
}

export async function deleteChatMessage(other: string, msgId: string) {
  if (!fb || !uid) return;
  await fb.fs.deleteDoc(fb.fs.doc(fb.db, 'chats', chatId(uid, other), 'messages', msgId));
}

/** Apaga a conversa inteira (para os dois). */
export async function deleteConversation(other: string) {
  if (!fb || !uid) return;
  await deleteChatDocs(fb, chatId(uid, other));
}

async function deleteChatDocs(f: FB, cid: string) {
  const { fs, db } = f;
  for (;;) {
    const page = await fs.getDocs(fs.query(fs.collection(db, 'chats', cid, 'messages'), fs.limit(300)));
    if (page.empty) break;
    const batch = fs.writeBatch(db);
    page.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    if (page.size < 300) break;
  }
  await fs.deleteDoc(fs.doc(db, 'chats', cid)).catch(() => undefined);
}

/** Exclusão de conta: apaga todas as conversas desta pessoa. */
export async function deleteAllChats(f: FB, myUid: string) {
  const { fs, db } = f;
  const snap = await fs.getDocs(fs.query(fs.collection(db, 'chats'), fs.where('members', 'array-contains', myUid))).catch(() => null);
  for (const d of snap?.docs ?? []) await deleteChatDocs(f, d.id).catch(() => undefined);
}

/** Música que veio numa mensagem (desafio ou envio). */
export async function songFromChat(m: Pick<ChatMsg, 'data'>): Promise<Song | null> {
  if (!m.data) return null;
  const { unpackSong } = await import('./cloudSongs');
  try {
    return unpackSong(m.data.toUint8Array());
  } catch {
    return null;
  }
}

/**
 * Recursos sociais (Firestore):
 *  profiles/{uid}          perfil público resumido (só usuários logados leem, um a um)
 *  friendCodes/{CODE}      código de amigo -> uid
 *  friendRequests/{a_b}    pedido de amizade de a para b
 *  friendships/{a_b}       amizade (uids em ordem), campo members
 *  users/{uid}/inbox/{id}  caixa antiga de mensagens (só leitura; as conversas novas ficam em chats/, ver chat.ts)
 * As regras de segurança estão em firestore.rules.
 */
import type { Unsubscribe } from 'firebase/firestore';
import type { FB } from './firebase';
import { createStore } from './store';
import { progress, weekKey, weekStats, setFlag, addEvent, bumpDay, streakNow, type ProgressEvent } from '../state/progress';
import { settings } from '../state/settings';
import { allLessons } from '../data/curriculum';
import { builtinSong } from '../data/songs';
import type { Song } from '../music/types';
import { deleteAllChats, sendChatCheer, sendChatChallenge, sendChatSong, sendChatText, startChats, stopChats } from './chat';

export interface PublicProfile {
  uid: string;
  name: string;
  photo?: string;
  avatar?: string;
  code: string;
  xp: number;
  streak: number;
  streakBest: number;
  lastDay: string;
  /** proteções de sequência guardadas */
  freezes?: number;
  lessonsDone: number;
  stars: number;
  songsPlayed: number;
  songsMastered: number;
  week: string;
  weekXp: number;
  weekMinutes: number;
  current?: string;
  best: Record<string, { t: string; a: number }>;
  recent: ProgressEvent[];
  badges: string[];
  updatedAt: number;
}

export interface FriendRequest {
  id: string;
  from: string;
  to: string;
  fromName: string;
  fromPhoto?: string;
  fromAvatar?: string;
  toName?: string;
  createdAt: number;
}

export type MsgType = 'cheer' | 'challenge' | 'song' | 'text';

export interface InboxMsg {
  id: string;
  from: string;
  fromName: string;
  fromPhoto?: string;
  fromAvatar?: string;
  type: MsgType;
  text?: string;
  songId?: string;
  songTitle?: string;
  score?: number;
  data?: { toUint8Array(): Uint8Array };
  createdAt: number;
  read?: boolean;
}

export interface SocialState {
  ready: boolean;
  uid?: string;
  me?: PublicProfile;
  friendIds: string[];
  friends: Record<string, PublicProfile>;
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
  inbox: InboxMsg[];
  unread: number;
}

const initial: SocialState = { ready: false, friendIds: [], friends: {}, incoming: [], outgoing: [], inbox: [], unread: 0 };
export const social = createStore<SocialState>(null, initial);

let fb: FB | null = null;
let me: { uid: string; name: string; photo?: string } | null = null;
let unsubs: Unsubscribe[] = [];
let friendUnsubs = new Map<string, Unsubscribe>();
let publishTimer: number | null = null;
let lastPublished = '';

export function pairId(a: string, b: string): string {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function randomCode(): string {
  const a = new Uint32Array(6);
  crypto.getRandomValues(a);
  return Array.from(a, (x) => CODE_ALPHABET[x % CODE_ALPHABET.length]).join('');
}

export function normalizeCode(c: string): string {
  return c
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);
}

export function inviteLink(code: string): string {
  return `${location.origin}${location.pathname}#/amigos?add=${code}`;
}

// ---------- ciclo de vida ----------

let pendingIdentity: { name: string; photo?: string } | null = null;

export function startSocial(f: FB, user: { uid: string; name: string; photo?: string }) {
  stopSocial();
  fb = f;
  me = pendingIdentity ? { ...user, ...pendingIdentity } : user;
  pendingIdentity = null;
  social.replace({ ...initial, uid: user.uid });
  startChats(f, user.uid);
  void (async () => {
    try {
      await ensureProfile();
    } catch (e) {
      console.warn('perfil', e);
    }
    listen();
  })();
}

export function stopSocial() {
  unsubs.forEach((u) => u());
  unsubs = [];
  friendUnsubs.forEach((u) => u());
  friendUnsubs = new Map();
  if (publishTimer) clearTimeout(publishTimer);
  publishTimer = null;
  lastPublished = '';
  fb = null;
  me = null;
  stopChats();
  social.replace({ ...initial });
}

async function ensureProfile() {
  if (!fb || !me) return;
  const { fs, db } = fb;
  const ref = fs.doc(db, 'profiles', me.uid);
  const snap = await fs.getDoc(ref).catch(() => null);
  let code = snap?.exists() ? (snap.data() as PublicProfile).code : '';
  if (code) {
    const c = await fs.getDoc(fs.doc(db, 'friendCodes', code)).catch(() => null);
    if (!c?.exists()) code = '';
  }
  for (let i = 0; !code && i < 6; i++) {
    const cand = randomCode();
    try {
      await fs.setDoc(fs.doc(db, 'friendCodes', cand), { uid: me.uid, createdAt: Date.now() });
      code = cand;
    } catch {
      /* já existe: tenta outro */
    }
  }
  await publishProfile(code);
}

/** Monta o perfil público a partir do progresso local. */
export function buildProfile(code: string): PublicProfile {
  const p = progress.get();
  const s = settings.get();
  const lessons = allLessons();
  const done = lessons.filter((x) => (p.lessons[x.lesson.id]?.stars ?? 0) > 0);
  const next = lessons.find((x) => !((p.lessons[x.lesson.id]?.stars ?? 0) > 0));
  const titles = p.songTitles ?? {};
  const best: PublicProfile['best'] = {};
  Object.entries(p.songs)
    .filter(([, v]) => v.best > 0)
    .sort((a, b) => b[1].lastPlayed - a[1].lastPlayed)
    .slice(0, 40)
    .forEach(([id, v]) => {
      best[id] = { t: (titles[id] ?? builtinSong(id)?.title ?? id).slice(0, 80), a: Math.round(v.best * 1000) / 1000 };
    });
  const w = weekStats(p);
  return {
    uid: me!.uid,
    name: (me!.name || 'Pianista').slice(0, 40),
    photo: me!.photo,
    avatar: s.avatar || undefined,
    code,
    xp: p.xp,
    streak: p.streak.current,
    streakBest: p.streak.best,
    lastDay: p.streak.lastDay,
    freezes: p.freezes ?? 0,
    lessonsDone: done.length,
    stars: Object.values(p.lessons).reduce((a, l) => a + l.stars, 0),
    songsPlayed: Object.keys(p.songs).length,
    songsMastered: Object.values(p.songs).filter((x) => x.best >= 0.9).length,
    week: weekKey(),
    weekXp: w.xp,
    weekMinutes: w.minutes,
    current: next?.lesson.title,
    best,
    recent: (p.events ?? []).slice(0, 12),
    badges: Object.keys(p.badges ?? {}),
    updatedAt: Date.now(),
  };
}

async function publishProfile(code?: string) {
  if (!fb || !me) return;
  const c = code ?? social.get().me?.code ?? '';
  if (!c) return;
  const prof = buildProfile(c);
  const { updatedAt: _u, ...cmp } = prof;
  void _u;
  const key = JSON.stringify(cmp);
  social.set({ me: prof });
  if (key === lastPublished) return;
  lastPublished = key;
  await fb.fs.setDoc(fb.fs.doc(fb.db, 'profiles', me.uid), JSON.parse(JSON.stringify(prof)));
}

/** Atualiza o perfil público em breve (ou já). */
export function publishProfileSoon(now = false) {
  if (!fb || !me) return;
  if (publishTimer) clearTimeout(publishTimer);
  publishTimer = window.setTimeout(
    () => {
      publishTimer = null;
      void publishProfile().catch(() => undefined);
    },
    now ? 50 : 4000,
  );
}

/** O nome/foto mudaram (ex.: o usuário editou o nome): republica o perfil. */
export function setSocialIdentity(name: string, photo?: string) {
  if (!me) {
    pendingIdentity = { name, photo };
    return;
  }
  me = { ...me, name, photo };
  publishProfileSoon(true);
}

function listen() {
  if (!fb || !me) return;
  const { fs, db } = fb;
  const uid = me.uid;
  unsubs.push(
    fs.onSnapshot(fs.query(fs.collection(db, 'friendships'), fs.where('members', 'array-contains', uid)), (snap) => {
      const ids = snap.docs.map((d) => (d.data().members as string[]).find((m) => m !== uid)!).filter(Boolean);
      social.set({ friendIds: ids, ready: true });
      if (ids.length) setFlag('friend');
      // assina perfis dos amigos
      for (const [fid, un] of friendUnsubs) {
        if (!ids.includes(fid)) {
          un();
          friendUnsubs.delete(fid);
          const fr = { ...social.get().friends };
          delete fr[fid];
          social.set({ friends: fr });
        }
      }
      for (const fid of ids) {
        if (friendUnsubs.has(fid)) continue;
        friendUnsubs.set(
          fid,
          fs.onSnapshot(
            fs.doc(db, 'profiles', fid),
            (p) => {
              if (!p.exists()) return;
              social.set({ friends: { ...social.get().friends, [fid]: p.data() as PublicProfile } });
            },
            () => undefined,
          ),
        );
      }
    }, () => social.set({ ready: true })),
  );
  unsubs.push(
    fs.onSnapshot(fs.query(fs.collection(db, 'friendRequests'), fs.where('to', '==', uid)), (snap) => {
      social.set({ incoming: snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<FriendRequest, 'id'>) })) });
    }, () => undefined),
  );
  unsubs.push(
    fs.onSnapshot(fs.query(fs.collection(db, 'friendRequests'), fs.where('from', '==', uid)), (snap) => {
      social.set({ outgoing: snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<FriendRequest, 'id'>) })) });
    }, () => undefined),
  );
  unsubs.push(
    fs.onSnapshot(fs.query(fs.collection(db, 'users', uid, 'inbox'), fs.orderBy('createdAt', 'desc'), fs.limit(60)), (snap) => {
      const inbox = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<InboxMsg, 'id'>) }));
      social.set({ inbox, unread: inbox.filter((m) => !m.read).length });
    }, () => undefined),
  );
}

// ---------- amizade ----------

export async function addFriendByCode(raw: string): Promise<{ ok: boolean; message: string }> {
  if (!fb || !me) return { ok: false, message: 'Entre na sua conta primeiro.' };
  const code = normalizeCode(raw);
  if (code.length !== 6) return { ok: false, message: 'O código tem 6 letras/números.' };
  const { fs, db } = fb;
  const c = await fs.getDoc(fs.doc(db, 'friendCodes', code));
  if (!c.exists()) return { ok: false, message: 'Código não encontrado. Confira com seu amigo.' };
  const other = (c.data() as { uid: string }).uid;
  if (other === me.uid) return { ok: false, message: 'Esse é o seu próprio código 🙂' };
  const st = social.get();
  if (st.friendIds.includes(other)) return { ok: true, message: 'Vocês já são amigos!' };
  const incoming = st.incoming.find((r) => r.from === other);
  if (incoming) {
    await acceptRequest(incoming);
    return { ok: true, message: 'Pedido aceito — agora vocês são amigos!' };
  }
  const other_profile = await fs.getDoc(fs.doc(db, 'profiles', other)).catch(() => null);
  await fs.setDoc(fs.doc(db, 'friendRequests', `${me.uid}_${other}`), {
    from: me.uid,
    to: other,
    fromName: me.name.slice(0, 40),
    fromPhoto: me.photo,
    fromAvatar: settings.get().avatar || undefined,
    toName: other_profile?.exists() ? (other_profile.data() as PublicProfile).name : undefined,
    createdAt: Date.now(),
  });
  return { ok: true, message: 'Pedido enviado! Assim que for aceito, vocês aparecem um para o outro.' };
}

export async function acceptRequest(r: FriendRequest) {
  if (!fb || !me) return;
  const { fs, db } = fb;
  const members = [r.from, r.to].sort();
  await fs.setDoc(fs.doc(db, 'friendships', pairId(r.from, r.to)), { members, createdAt: Date.now() });
  await fs.deleteDoc(fs.doc(db, 'friendRequests', r.id)).catch(() => undefined);
  addEvent({ k: 'friend', t: `Agora é amigo(a) de ${r.fromName}` });
  setFlag('friend');
}

export async function declineRequest(r: FriendRequest) {
  if (!fb) return;
  await fb.fs.deleteDoc(fb.fs.doc(fb.db, 'friendRequests', r.id));
}

export async function removeFriend(uid: string) {
  if (!fb || !me) return;
  await fb.fs.deleteDoc(fb.fs.doc(fb.db, 'friendships', pairId(me.uid, uid)));
}

// ---------- mensagens ----------

export function sendCheer(to: string, text: string) {
  return sendChatCheer(to, text.slice(0, 200));
}

export function sendText(to: string, text: string) {
  return sendChatText(to, text);
}

export async function sendChallenge(to: string, song: Song, score: number, text?: string) {
  setFlag('challenge');
  bumpDay('social');
  await sendChatChallenge(to, song, score, text);
}

export function sendSong(to: string, song: Song, text?: string) {
  return sendChatSong(to, song, text);
}

/** Música que veio numa mensagem (desafio ou envio). */
export async function songFromMessage(m: InboxMsg): Promise<Song | null> {
  if (!m.data) return null;
  const { unpackSong } = await import('./cloudSongs');
  try {
    return unpackSong(m.data.toUint8Array());
  } catch {
    return null;
  }
}

export async function markRead(ids: string[]) {
  if (!fb || !me || !ids.length) return;
  const { fs, db } = fb;
  const batch = fs.writeBatch(db);
  for (const id of ids) batch.update(fs.doc(db, 'users', me.uid, 'inbox', id), { read: true });
  await batch.commit().catch(() => undefined);
}

export async function deleteMessage(id: string) {
  if (!fb || !me) return;
  await fb.fs.deleteDoc(fb.fs.doc(fb.db, 'users', me.uid, 'inbox', id));
}

/** Apaga tudo o que é social desta conta (exclusão de conta). */
export async function deleteSocialData(f: FB, uid: string) {
  const { fs, db } = f;
  const prof = await fs.getDoc(fs.doc(db, 'profiles', uid)).catch(() => null);
  const code = prof?.exists() ? (prof.data() as PublicProfile).code : '';
  const tasks: Promise<unknown>[] = [];
  const fr = await fs.getDocs(fs.query(fs.collection(db, 'friendships'), fs.where('members', 'array-contains', uid))).catch(() => null);
  fr?.docs.forEach((d) => tasks.push(fs.deleteDoc(d.ref)));
  for (const field of ['from', 'to']) {
    const rq = await fs.getDocs(fs.query(fs.collection(db, 'friendRequests'), fs.where(field, '==', uid))).catch(() => null);
    rq?.docs.forEach((d) => tasks.push(fs.deleteDoc(d.ref)));
  }
  const inbox = await fs.getDocs(fs.collection(db, 'users', uid, 'inbox')).catch(() => null);
  inbox?.docs.forEach((d) => tasks.push(fs.deleteDoc(d.ref)));
  tasks.push(deleteAllChats(f, uid));
  await Promise.all(tasks);
  if (code) await fs.deleteDoc(fs.doc(db, 'friendCodes', code)).catch(() => undefined);
  await fs.deleteDoc(fs.doc(db, 'profiles', uid)).catch(() => undefined);
}

// ---------- utilidades para as telas ----------

export function profileWeek(p: PublicProfile): { xp: number; minutes: number } {
  return p.week === weekKey() ? { xp: p.weekXp, minutes: p.weekMinutes } : { xp: 0, minutes: 0 };
}

/** Sequência que ainda vale: praticou hoje/ontem ou tem proteções que cobrem os dias perdidos. */
export function liveStreak(p: { streak: number; lastDay: string; freezes?: number }): number {
  return streakNow({ streak: { current: p.streak, lastDay: p.lastDay }, freezes: p.freezes }).days;
}

export interface FeedItem extends ProgressEvent {
  uid: string;
  name: string;
  photo?: string;
  avatar?: string;
}

export function friendFeed(st: SocialState): FeedItem[] {
  const items: FeedItem[] = [];
  for (const uid of st.friendIds) {
    const f = st.friends[uid];
    if (!f) continue;
    for (const e of f.recent ?? []) items.push({ ...e, uid, name: f.name, photo: f.photo, avatar: f.avatar });
  }
  return items.sort((a, b) => b.at - a.at).slice(0, 40);
}

/**
 * Recursos sociais (Firestore):
 *  profiles/{uid}          perfil público resumido (só usuários logados leem, um a um)
 *  friendCodes/{CODE}      código de amigo -> uid
 *  friendRequests/{a_b}    pedido de amizade de a para b
 *  friendships/{a_b}       amizade (uids em ordem), campo members
 *  users/{uid}/inbox/{id}  mensagens recebidas de amigos (aplausos, desafios, músicas)
 * As regras de segurança estão em firestore.rules.
 */
import type { Unsubscribe } from 'firebase/firestore';
import type { FB } from './firebase';
import { createStore } from './store';
import { progress, weekKey, weekStats, setFlag, addEvent, type ProgressEvent } from '../state/progress';
import { settings } from '../state/settings';
import { allLessons } from '../data/curriculum';
import { builtinSong } from '../data/songs';
import type { Song } from '../music/types';

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

type OutMsg = Omit<InboxMsg, 'id' | 'from' | 'fromName' | 'fromPhoto' | 'fromAvatar' | 'createdAt' | 'read' | 'data'> & { data?: unknown };
async function send(to: string, msg: OutMsg) {
  if (!fb || !me) throw new Error('Entre na sua conta primeiro.');
  const { fs, db } = fb;
  await fs.addDoc(fs.collection(db, 'users', to, 'inbox'), {
    from: me.uid,
    fromName: me.name.slice(0, 40),
    fromPhoto: me.photo,
    fromAvatar: settings.get().avatar || undefined,
    createdAt: Date.now(),
    read: false,
    ...msg,
  });
}

export function sendCheer(to: string, text: string) {
  return send(to, { type: 'cheer', text: text.slice(0, 200) });
}

export function sendText(to: string, text: string) {
  return send(to, { type: 'text', text: text.slice(0, 200) });
}

export async function sendChallenge(to: string, song: Song, score: number, text?: string) {
  if (!fb) return;
  const builtin = !!builtinSong(song.id);
  let data: unknown;
  if (!builtin) {
    const { packSong } = await import('./cloudSongs');
    const bytes = packSong(song);
    if (bytes.length < 900_000) data = fb.fs.Bytes.fromUint8Array(bytes);
  }
  await send(to, { type: 'challenge', songId: song.id, songTitle: song.title.slice(0, 120), score: Math.round(score * 1000) / 1000, text: text?.slice(0, 200), data });
  setFlag('challenge');
}

export async function sendSong(to: string, song: Song, text?: string) {
  if (!fb) return;
  const { packSong } = await import('./cloudSongs');
  const bytes = packSong(song);
  if (bytes.length > 900_000) throw new Error('Esta música é grande demais para enviar.');
  await send(to, { type: 'song', songId: song.id, songTitle: song.title.slice(0, 120), text: text?.slice(0, 200), data: fb.fs.Bytes.fromUint8Array(bytes) });
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
  await Promise.all(tasks);
  if (code) await fs.deleteDoc(fs.doc(db, 'friendCodes', code)).catch(() => undefined);
  await fs.deleteDoc(fs.doc(db, 'profiles', uid)).catch(() => undefined);
}

// ---------- utilidades para as telas ----------

export function profileWeek(p: PublicProfile): { xp: number; minutes: number } {
  return p.week === weekKey() ? { xp: p.weekXp, minutes: p.weekMinutes } : { xp: 0, minutes: 0 };
}

/** Sequência ainda vale se praticou hoje ou ontem. */
export function liveStreak(p: { streak: number; lastDay: string }): number {
  if (!p.lastDay) return 0;
  const d = new Date();
  const t = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  const todayK = t(d);
  d.setDate(d.getDate() - 1);
  return p.lastDay === todayK || p.lastDay === t(d) ? p.streak : 0;
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

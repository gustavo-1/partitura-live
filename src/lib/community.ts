/**
 * Biblioteca compartilhada: músicas importadas por qualquer pessoa ficam disponíveis
 * para todos que entram com conta.
 *  library/{id}       resumo (título, compositor, nível, mãos, quem enviou) — leve, para listar
 *  libraryData/{id}   partitura compactada (gzip) — baixada só quando alguém abre a música
 * Só quem enviou pode alterar ou remover. Regras em firestore.rules.
 */
import type { Unsubscribe } from 'firebase/firestore';
import type { FB } from './firebase';
import { createStore } from './store';
import { packForCloud, unpackSong } from './cloudSongs';
import { setRemoteResolver } from '../data/library';
import { handsInSong } from '../music/timeline';
import type { Song } from '../music/types';

export interface CommunitySong {
  id: string;
  title: string;
  composer?: string;
  level: number;
  hands: 'R' | 'L' | 'RL';
  measures: number;
  ownerUid: string;
  ownerName: string;
  createdAt: number;
}

export interface CommunityState {
  ready: boolean;
  uid?: string;
  songs: CommunitySong[];
}

export const community = createStore<CommunityState>(null, { ready: false, songs: [] });

const MAX_BYTES = 900_000;
let fb: FB | null = null;
let me: { uid: string; name: string } | null = null;
let unsub: Unsubscribe | null = null;
const cache = new Map<string, Song>();

export function startCommunity(f: FB, user: { uid: string; name: string }) {
  stopCommunity();
  fb = f;
  me = user;
  community.replace({ ready: false, uid: user.uid, songs: [] });
  const { fs, db } = f;
  unsub = fs.onSnapshot(
    fs.query(fs.collection(db, 'library'), fs.orderBy('createdAt', 'desc'), fs.limit(500)),
    (snap) => {
      const songs = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CommunitySong, 'id'>) }));
      community.set({ ready: true, songs });
    },
    () => community.set({ ready: true }),
  );
  setRemoteResolver(loadCommunitySong);
}

export function stopCommunity() {
  unsub?.();
  unsub = null;
  fb = null;
  me = null;
  setRemoteResolver(null);
  community.replace({ ready: false, songs: [] });
}

/** Nome exibido como "enviada por". */
export function setCommunityName(name: string) {
  if (me) me = { ...me, name };
}

export function isShared(id: string): boolean {
  return community.get().songs.some((s) => s.id === id);
}

/** Baixa a partitura de uma música da comunidade (com cache). */
export async function loadCommunitySong(id: string): Promise<Song | undefined> {
  if (cache.has(id)) return cache.get(id);
  if (!fb) return undefined;
  try {
    const snap = await fb.fs.getDoc(fb.fs.doc(fb.db, 'libraryData', id));
    if (!snap.exists()) return undefined;
    const song = unpackSong((snap.data() as { data: { toUint8Array(): Uint8Array } }).data.toUint8Array());
    cache.set(id, song);
    return song;
  } catch {
    return undefined;
  }
}

export type ShareResult = 'ok' | 'already' | 'too-big' | 'signed-out' | 'error';

/** Publica uma música importada na biblioteca de todos. */
export async function shareSong(song: Song, fileName = ''): Promise<ShareResult> {
  if (!fb || !me) return 'signed-out';
  if (isShared(song.id)) return 'already';
  const bytes = packForCloud(song, MAX_BYTES);
  if (!bytes) return 'too-big';
  const batch = writeShared(song, bytes, fileName, Date.now());
  try {
    await batch.commit();
    cache.set(song.id, song);
    return 'ok';
  } catch {
    // outra pessoa já publicou a mesma música (mesmo id)
    const { fs, db } = fb;
    const exists = await fs.getDoc(fs.doc(db, 'library', song.id)).catch(() => null);
    return exists?.exists() ? 'already' : 'error';
  }
}

function writeShared(song: Song, bytes: Uint8Array, fileName: string, createdAt: number) {
  const { fs, db } = fb!;
  const hands = handsInSong(song);
  const batch = fs.writeBatch(db);
  batch.set(fs.doc(db, 'libraryData', song.id), { ownerUid: me!.uid, data: fs.Bytes.fromUint8Array(bytes), createdAt });
  batch.set(fs.doc(db, 'library', song.id), {
    title: (song.title || 'Sem título').slice(0, 120),
    composer: song.composer ? song.composer.slice(0, 120) : null,
    level: Math.max(1, Math.min(5, Math.round(song.level || 2))),
    hands: hands.length === 2 ? 'RL' : hands[0] ?? 'R',
    measures: song.measures.length,
    fileName: fileName.slice(0, 200),
    ownerUid: me!.uid,
    ownerName: (me!.name || 'Alguém').slice(0, 40),
    createdAt,
  });
  return batch;
}

/** Música reconvertida: atualiza a cópia da comunidade, se for sua. */
export async function updateSharedSong(song: Song, fileName = ''): Promise<boolean> {
  if (!fb || !me) return false;
  const meta = community.get().songs.find((s) => s.id === song.id);
  if (!meta || meta.ownerUid !== me.uid) return false;
  const bytes = packForCloud(song, MAX_BYTES);
  if (!bytes) return false;
  try {
    await writeShared(song, bytes, fileName, meta.createdAt).commit();
    cache.set(song.id, song);
    return true;
  } catch {
    return false;
  }
}

/** Tira uma música sua da biblioteca de todos. */
export async function unshareSong(id: string) {
  if (!fb) return;
  const { fs, db } = fb;
  const batch = fs.writeBatch(db);
  batch.delete(fs.doc(db, 'library', id));
  batch.delete(fs.doc(db, 'libraryData', id));
  await batch.commit();
  cache.delete(id);
}

/** Exclusão de conta: remove tudo o que a pessoa publicou. */
export async function deleteMyCommunitySongs(f: FB, uid: string) {
  const { fs, db } = f;
  const snap = await fs.getDocs(fs.query(fs.collection(db, 'library'), fs.where('ownerUid', '==', uid))).catch(() => null);
  for (const d of snap?.docs ?? []) {
    const batch = fs.writeBatch(db);
    batch.delete(d.ref);
    batch.delete(fs.doc(db, 'libraryData', d.id));
    await batch.commit().catch(() => undefined);
  }
}

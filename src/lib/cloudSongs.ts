/**
 * Músicas importadas na conta: users/{uid}/songs/{id}, com a partitura compactada
 * (gzip) para caber no limite de 1 MB por documento do Firestore.
 */
import { gzipSync, gunzipSync, strFromU8, strToU8 } from 'fflate';
import type { FB } from './firebase';
import type { Song } from '../music/types';
import { deleteImported, listImported, saveImported, setLibraryHooks, type ImportedRecord } from '../data/library';

const MAX_BYTES = 900_000;
let stop: (() => void) | null = null;
const inCloud = new Set<string>();

export function packSong(song: Song): Uint8Array {
  return gzipSync(strToU8(JSON.stringify(song)), { level: 9 });
}

export function unpackSong(data: Uint8Array): Song {
  return JSON.parse(strFromU8(gunzipSync(data))) as Song;
}

async function upload(fb: FB, uid: string, r: ImportedRecord): Promise<boolean> {
  const bytes = packSong(r.song);
  if (bytes.length > MAX_BYTES) return false;
  await fb.fs.setDoc(fb.fs.doc(fb.db, 'users', uid, 'songs', r.id), {
    title: r.song.title.slice(0, 120),
    fileName: r.fileName.slice(0, 200),
    addedAt: r.addedAt,
    size: bytes.length,
    data: fb.fs.Bytes.fromUint8Array(bytes),
  });
  inCloud.add(r.id);
  return true;
}

export function startCloudSongs(fb: FB, uid: string) {
  stopCloudSongs();
  let alive = true;
  setLibraryHooks({
    onSave: (r) => void upload(fb, uid, r).catch(() => undefined),
    onDelete: (id) => {
      inCloud.delete(id);
      void fb.fs.deleteDoc(fb.fs.doc(fb.db, 'users', uid, 'songs', id)).catch(() => undefined);
    },
  });
  void (async () => {
    try {
      const snap = await fb.fs.getDocs(fb.fs.collection(fb.db, 'users', uid, 'songs'));
      if (!alive) return;
      const local = await listImported();
      const localIds = new Set(local.map((r) => r.id));
      for (const d of snap.docs) {
        inCloud.add(d.id);
        if (localIds.has(d.id)) continue;
        const v = d.data() as { data: { toUint8Array(): Uint8Array }; fileName?: string; addedAt?: number };
        try {
          await saveImported(unpackSong(v.data.toUint8Array()), v.fileName ?? '', { fromCloud: true, addedAt: v.addedAt });
        } catch {
          /* documento corrompido: ignora */
        }
      }
      for (const r of local) if (!inCloud.has(r.id)) await upload(fb, uid, r).catch(() => undefined);
    } catch {
      /* offline: tenta na próxima vez */
    }
  })();
  stop = () => {
    alive = false;
    setLibraryHooks({});
  };
}

export function stopCloudSongs() {
  stop?.();
  stop = null;
}

/** Ao sair da conta: remove do aparelho as músicas que estão salvas na nuvem. */
export async function clearLocalSongs() {
  const local = await listImported();
  for (const r of local) if (inCloud.has(r.id)) await deleteImported(r.id, { local: true });
  inCloud.clear();
}

export async function deleteCloudSongs(fb: FB, uid: string) {
  const snap = await fb.fs.getDocs(fb.fs.collection(fb.db, 'users', uid, 'songs'));
  for (const d of snap.docs) await fb.fs.deleteDoc(d.ref);
}

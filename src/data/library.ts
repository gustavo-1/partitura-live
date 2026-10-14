import { idb } from '../lib/db';
import type { Song } from '../music/types';
import { builtinSong, builtinSongs } from './songs';

/** Músicas temporárias (exercícios gerados, trechos de lições). */
const temp = new Map<string, Song>();

export function registerTempSong(song: Song) {
  temp.set(song.id, song);
  try {
    sessionStorage.setItem('pl.temp.' + song.id, JSON.stringify(song));
  } catch {
    /* ignora */
  }
}

export async function getSong(id: string): Promise<Song | undefined> {
  const b = builtinSong(id);
  if (b) return b;
  if (temp.has(id)) return temp.get(id);
  try {
    const raw = sessionStorage.getItem('pl.temp.' + id);
    if (raw) {
      const s = JSON.parse(raw) as Song;
      temp.set(id, s);
      return s;
    }
  } catch {
    /* ignora */
  }
  try {
    const rec = await idb.get<{ id: string; song: Song }>('songs', id);
    return rec?.song;
  } catch {
    return undefined;
  }
}

export interface ImportedRecord {
  id: string;
  song: Song;
  addedAt: number;
  fileName: string;
}

/** Ganchos para a nuvem (a conta registra quando há login). */
interface LibraryHooks {
  onSave?: (r: ImportedRecord) => void;
  onDelete?: (id: string) => void;
}
let hooks: LibraryHooks = {};
export function setLibraryHooks(h: LibraryHooks) {
  hooks = h;
}

const listeners = new Set<() => void>();
/** Avisa quando a lista de músicas importadas muda (ex.: chegou uma da nuvem). */
export function onLibraryChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function notifyLibraryChange() {
  listeners.forEach((fn) => fn());
}

export async function listImported(): Promise<ImportedRecord[]> {
  try {
    const all = await idb.all<ImportedRecord>('songs');
    return all.sort((a, b) => b.addedAt - a.addedAt);
  } catch {
    return [];
  }
}

export async function saveImported(song: Song, fileName: string, opts: { fromCloud?: boolean; addedAt?: number } = {}): Promise<void> {
  const rec: ImportedRecord = { id: song.id, song, addedAt: opts.addedAt ?? Date.now(), fileName };
  await idb.put<ImportedRecord>('songs', rec);
  if (!opts.fromCloud) hooks.onSave?.(rec);
  notifyLibraryChange();
}

export async function deleteImported(id: string, opts: { local?: boolean } = {}): Promise<void> {
  await idb.del('songs', id);
  if (!opts.local) hooks.onDelete?.(id);
  notifyLibraryChange();
}

export { builtinSongs };

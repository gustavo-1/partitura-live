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

export async function listImported(): Promise<ImportedRecord[]> {
  try {
    const all = await idb.all<ImportedRecord>('songs');
    return all.sort((a, b) => b.addedAt - a.addedAt);
  } catch {
    return [];
  }
}

export async function saveImported(song: Song, fileName: string): Promise<void> {
  await idb.put<ImportedRecord>('songs', { id: song.id, song, addedAt: Date.now(), fileName });
}

export async function deleteImported(id: string): Promise<void> {
  await idb.del('songs', id);
}

export { builtinSongs };

import { builtinSong } from '../data/songs';
import { getSong, saveImported } from '../data/library';
import { navigate } from './router';
import { songFromChat } from './chat';

export interface ChallengeLike {
  songId?: string;
  from: string;
  fromName: string;
  score?: number;
  data?: { toUint8Array(): Uint8Array };
}

/** Abre a música de um desafio (salva na biblioteca se veio junto na mensagem). */
export async function openChallenge(m: ChallengeLike) {
  if (!m.songId) return;
  const have = builtinSong(m.songId) ?? (await getSong(m.songId));
  if (!have) {
    const song = await songFromChat(m);
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

/** Salva na biblioteca a música que veio numa mensagem. */
export async function addSongFromMessage(m: { data?: { toUint8Array(): Uint8Array } }): Promise<boolean> {
  const song = await songFromChat(m);
  if (!song) return false;
  await saveImported(song, `${song.title}.json`);
  return true;
}

/** Já tenho esta música (embutida ou importada)? */
export async function haveSong(id?: string): Promise<boolean> {
  if (!id) return false;
  return !!(builtinSong(id) ?? (await getSong(id)));
}

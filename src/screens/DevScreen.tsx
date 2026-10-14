import { useState } from 'react';
import { Score } from '../components/score/Score';
import { Keyboard } from '../components/Keyboard';
import { builtinSongs } from '../data/songs';

export default function DevScreen() {
  const songs = builtinSongs();
  const [idx, setIdx] = useState(0);
  const song = songs[idx];
  return (
    <div className="stack">
      <select value={idx} onChange={(e) => setIdx(+e.target.value)}>
        {songs.map((s, i) => (
          <option key={s.id} value={i}>
            {s.title}
          </option>
        ))}
      </select>
      <Score song={song} options={{ showNames: idx % 2 === 1 }} cursorEls={[song.notes[2].id]} />
      <Keyboard lo={48} hi={84} labels="c" />
    </div>
  );
}

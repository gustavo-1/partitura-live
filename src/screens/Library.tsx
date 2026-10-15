import { useEffect, useRef, useState } from 'react';
import { builtinSongs, songCollection, type SongCollection } from '../data/songs';
import { deleteImported, listImported, onLibraryChange, saveImported, type ImportedRecord } from '../data/library';
import type { Song } from '../music/types';
import { useStore } from '../lib/store';
import { progress } from '../state/progress';
import { navigate } from '../lib/router';
import { Icon, LevelDots } from '../components/Icon';
import { Seg } from '../components/ui';
import { handsInSong } from '../music/timeline';

type Filter = 'all' | '1' | '2' | '3' | '4';
type Coll = 'all' | SongCollection;

const COLLECTIONS: { value: Coll; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'pop', label: '🎧 Pop e cinema' },
  { value: 'classico', label: '🎻 Clássicos famosos' },
  { value: 'folclore', label: '🧸 Infantis e folclóricas' },
];

/** Buscas prontas para quem quer tocar músicas atuais (com direitos autorais: a pessoa importa o arranjo). */
const FAVORITES: { artist: string; songs: string[] }[] = [
  { artist: 'La La Land', songs: ['City of Stars', "Mia and Sebastian's Theme", 'Another Day of Sun'] },
  { artist: 'Billie Eilish', songs: ['lovely', 'What Was I Made For', 'ocean eyes'] },
  { artist: 'Phineas e Ferb', songs: ['Phineas and Ferb theme', 'Gitchee Gitchee Goo'] },
  { artist: 'Olivia Rodrigo', songs: ['drivers license', 'traitor', 'vampire'] },
];
const searchUrl = (q: string) => `https://musescore.com/sheetmusic?text=${encodeURIComponent(q + ' easy piano')}`;

export function Library() {
  const p = useStore(progress);
  const [imported, setImported] = useState<ImportedRecord[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [coll, setColl] = useState<Coll>('all');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = () => listImported().then(setImported);
  useEffect(() => {
    void refresh();
    return onLibraryChange(() => void refresh());
  }, []);

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    try {
      let last: Song | null = null;
      for (const f of Array.from(files)) {
        const buf = await f.arrayBuffer();
        let song: Song;
        if (/\.(mid|midi)$/i.test(f.name)) {
          const { importMidi } = await import('../music/midiImport');
          song = importMidi(buf, f.name);
        } else if (/\.(xml|musicxml|mxl)$/i.test(f.name)) {
          const { importMusicXml, musicXmlText } = await import('../music/musicxml');
          song = importMusicXml(musicXmlText(buf, f.name), f.name);
        } else {
          throw new Error(`Formato não suportado: ${f.name}. Use MusicXML (.musicxml, .xml, .mxl) ou MIDI (.mid).`);
        }
        if (!song.notes.some((n) => n.keys.length)) throw new Error(`${f.name}: nenhuma nota encontrada.`);
        await saveImported(song, f.name);
        last = song;
      }
      if (last && files.length === 1) navigate(`/musica/${encodeURIComponent(last.id)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const q = query.trim().toLowerCase();
  const songs = builtinSongs().filter(
    (s) =>
      (filter === 'all' || String(Math.min(4, s.level)) === filter) &&
      (coll === 'all' || songCollection(s.id) === coll) &&
      (!q || s.title.toLowerCase().includes(q) || (s.composer ?? '').toLowerCase().includes(q)),
  );
  // quem procura uma música pop que não vem no app vê como importá-la
  const lookingForPop = !!q && songs.length === 0;

  return (
    <div>
      <div className="page-header">
        <h1>Músicas</h1>
      </div>
      <p className="muted">
        Escolha uma música para aprender. Cada uma tem um <b>plano de estudo</b> que divide a peça em trechos e guia você das mãos separadas até
        o andamento original.
      </p>

      <div className="chip-choices" role="radiogroup" aria-label="Coleção" style={{ marginTop: 14 }}>
        {COLLECTIONS.map((c) => (
          <button key={c.value} role="radio" aria-checked={coll === c.value} className={'chip-btn' + (coll === c.value ? ' on' : '')} onClick={() => setColl(c.value)}>
            {c.label}
          </button>
        ))}
      </div>

      <div className="row" style={{ margin: '12px 0 14px' }}>
        <input placeholder="Buscar…" value={query} onChange={(e) => setQuery(e.target.value)} style={{ flex: '1 1 180px' }} aria-label="Buscar música" />
        <Seg<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'Todas' },
            { value: '1', label: 'Nível 1' },
            { value: '2', label: '2' },
            { value: '3', label: '3' },
            { value: '4', label: '4+' },
          ]}
        />
      </div>

      {songs.length === 0 && <p className="small muted">Nenhuma música embutida com esse filtro.</p>}
      <div className="grid cols-2">
        {songs.map((s) => (
          <SongCard key={s.id} song={s} best={p.songs[s.id]?.best} />
        ))}
      </div>

      {(coll === 'pop' || coll === 'all' || lookingForPop) && (
        <div className="card favorites-card">
          <h3 style={{ marginTop: 0 }}>🎬 Quer tocar La La Land, Billie Eilish, Olivia Rodrigo…?</h3>
          <p className="small muted">
            Músicas atuais de artistas, filmes e séries têm direitos autorais, por isso não vêm no app. Mas você pode tocá-las aqui: baixe um
            arranjo em <b>MusicXML</b> ou <b>MIDI</b> (no MuseScore, por exemplo — procure “easy piano”) e importe. Ele ganha plano de estudo, modo
            espera, cascata e fica salvo só na sua conta.
          </p>
          {lookingForPop && (
            <a className="btn sm primary" href={searchUrl(query.trim())} target="_blank" rel="noopener noreferrer" style={{ marginBottom: 10 }}>
              Procurar “{query.trim()}” no MuseScore ↗
            </a>
          )}
          <div className="fav-groups">
            {FAVORITES.map((g) => (
              <div key={g.artist} className="fav-group">
                <b className="small">{g.artist}</b>
                <div className="chip-choices">
                  {g.songs.map((t) => (
                    <a key={t} className="chip-btn" href={searchUrl(t)} target="_blank" rel="noopener noreferrer">
                      {t} ↗
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn primary sm" onClick={() => fileRef.current?.click()}>
              <Icon name="upload" /> Importar arquivo baixado
            </button>
            <span className="tiny muted">Enquanto isso, experimente as peças originais “no clima” do pop e do cinema acima.</span>
          </div>
        </div>
      )}

      <div className="section-title">
        <h2>Suas músicas</h2>
      </div>
      <div
        className={'dropzone' + (drag ? ' drag' : '')}
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          void onFiles(e.dataTransfer.files);
        }}
        role="button"
        tabIndex={0}
      >
        <Icon name="upload" size={28} />
        <p style={{ margin: '8px 0 4px', fontWeight: 700 }}>{busy ? 'Importando…' : 'Importar partitura (MusicXML ou MIDI)'}</p>
        <p className="small muted" style={{ margin: 0 }}>
          Toque para escolher ou arraste o arquivo aqui. Arquivos .musicxml/.mxl preservam a notação original; arquivos .mid são convertidos em
          partitura automaticamente.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".xml,.musicxml,.mxl,.mid,.midi,application/vnd.recordare.musicxml,audio/midi"
          multiple
          hidden
          onChange={(e) => void onFiles(e.target.files)}
        />
      </div>
      {error && (
        <div className="banner bad small" style={{ marginTop: 10 }}>
          <Icon name="info" size={18} /> <div>{error}</div>
        </div>
      )}
      <details style={{ margin: '12px 0' }}>
        <summary className="small" style={{ cursor: 'pointer', fontWeight: 650 }}>
          Onde encontrar partituras gratuitas?
        </summary>
        <ul className="small muted">
          <li>
            <b>MuseScore</b> (musescore.com / MuseScore Studio, gratuito): abra qualquer partitura e use <i>Exportar → MusicXML</i>.
          </li>
          <li>
            <b>IMSLP</b> e <b>Mutopia Project</b>: obras de domínio público, muitas com arquivos MIDI ou MusicXML.
          </li>
          <li>
            <b>OpenScore</b>: partituras clássicas digitadas em MusicXML, licença livre.
          </li>
          <li>Prefira arranjos "para piano fácil" ou "beginner" para começar.</li>
        </ul>
      </details>
      {imported.length === 0 ? (
        <p className="small muted">Nenhuma música importada ainda.</p>
      ) : (
        <div className="grid cols-2">
          {imported.map((r) => (
            <div key={r.id} style={{ position: 'relative' }}>
              <SongCard song={r.song} best={p.songs[r.id]?.best} />
              <button
                className="btn ghost icon danger"
                style={{ position: 'absolute', top: 8, right: 8 }}
                aria-label="Remover música"
                onClick={async () => {
                  if (!confirm(`Remover "${r.song.title}"?`)) return;
                  await deleteImported(r.id);
                }}
              >
                <Icon name="trash" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function SongCard({ song, best }: { song: Song; best?: number }) {
  const hands = handsInSong(song);
  return (
    <button className="card song-card" onClick={() => navigate(`/musica/${encodeURIComponent(song.id)}`)}>
      <div className="row between nowrap">
        <LevelDots level={song.level} />
        {best !== undefined && <span className={'chip ' + (best >= 0.9 ? 'ok' : '')}>{Math.round(best * 100)}%</span>}
      </div>
      <h3>{song.title}</h3>
      <div className="small muted">{song.composer}</div>
      {song.description && <div className="small">{song.description}</div>}
      <div className="row" style={{ gap: 6 }}>
        <span className="chip">{hands.length === 2 ? 'Duas mãos' : hands[0] === 'R' ? 'Mão direita' : 'Mão esquerda'}</span>
        {song.tags?.filter((t) => !/mão|mãos/.test(t)).slice(0, 2).map((t) => (
          <span key={t} className="chip">
            {t}
          </span>
        ))}
      </div>
    </button>
  );
}

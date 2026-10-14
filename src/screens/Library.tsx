import { useEffect, useRef, useState } from 'react';
import { builtinSongs } from '../data/songs';
import { deleteImported, listImported, saveImported, type ImportedRecord } from '../data/library';
import type { Song } from '../music/types';
import { useStore } from '../lib/store';
import { progress } from '../state/progress';
import { navigate } from '../lib/router';
import { Icon, LevelDots } from '../components/Icon';
import { Seg } from '../components/ui';
import { handsInSong } from '../music/timeline';

type Filter = 'all' | '1' | '2' | '3' | '4';

export function Library() {
  const p = useStore(progress);
  const [imported, setImported] = useState<ImportedRecord[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = () => listImported().then(setImported);
  useEffect(() => {
    void refresh();
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
      await refresh();
      if (last && files.length === 1) navigate(`/musica/${encodeURIComponent(last.id)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const songs = builtinSongs().filter(
    (s) => (filter === 'all' || String(Math.min(4, s.level)) === filter) && (!query || s.title.toLowerCase().includes(query.toLowerCase())),
  );

  return (
    <div>
      <div className="page-header">
        <h1>Músicas</h1>
      </div>
      <p className="muted">
        Escolha uma música para aprender. Cada uma tem um <b>plano de estudo</b> que divide a peça em trechos e guia você das mãos separadas até
        o andamento original.
      </p>

      <div className="row" style={{ margin: '14px 0' }}>
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

      <div className="grid cols-2">
        {songs.map((s) => (
          <SongCard key={s.id} song={s} best={p.songs[s.id]?.best} />
        ))}
      </div>

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
                  void refresh();
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

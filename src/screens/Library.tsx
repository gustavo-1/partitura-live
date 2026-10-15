import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { builtinSongs, songCollection, type SongCollection } from '../data/songs';
import { deleteImported, listImported, onLibraryChange, saveImported, type ImportedRecord } from '../data/library';
import { IMPORT_VERSION, type Song } from '../music/types';
import { useStore } from '../lib/store';
import { progress } from '../state/progress';
import { settings } from '../state/settings';
import { account } from '../lib/account';
import { community, shareSong, unshareSong, updateSharedSong, type CommunitySong, type ShareResult } from '../lib/community';
import { navigate } from '../lib/router';
import { Icon, LevelDots } from '../components/Icon';
import { Seg, Toggle } from '../components/ui';
import { handsInSong } from '../music/timeline';

const TrackPicker = lazy(() => import('../components/TrackPicker'));

type Filter = 'all' | '1' | '2' | '3' | '4';
type Coll = 'all' | 'comunidade' | SongCollection;

const COLLECTIONS: { value: Coll; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'comunidade', label: '🌐 Da comunidade' },
  { value: 'pop', label: '🎧 Pop e cinema' },
  { value: 'classico', label: '🎻 Clássicos famosos' },
  { value: 'folclore', label: '🧸 Infantis e folclóricas' },
];

const SHARE_MSG: Record<ShareResult, string> = {
  ok: 'agora está disponível para todos na seção “Da comunidade”.',
  already: 'já estava na biblioteca da comunidade.',
  'too-big': 'é grande demais para compartilhar (limite de ~900 KB compactado).',
  'signed-out': 'ficou só neste aparelho (entre na conta para compartilhar).',
  error: 'não pôde ser compartilhada agora (sem conexão?). Tente pelo botão “Compartilhar” abaixo.',
};

export function Library() {
  const p = useStore(progress);
  const st = useStore(settings);
  const acc = useStore(account);
  const com = useStore(community);
  const signedIn = acc.status === 'signed-in';
  const myUid = acc.user?.uid;
  const [imported, setImported] = useState<ImportedRecord[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [coll, setColl] = useState<Coll>('all');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  /** MIDI com vários instrumentos esperando a escolha de trilhas */
  const [picking, setPicking] = useState<{ name: string; data: ArrayBuffer; resolve: (t: import('../music/midiImport').TrackChoice[] | null) => void } | null>(
    null,
  );
  const fileRef = useRef<HTMLInputElement>(null);
  const askTracks = (name: string, data: ArrayBuffer) =>
    new Promise<import('../music/midiImport').TrackChoice[] | null>((resolve) => setPicking({ name, data, resolve }));

  const refresh = () => listImported().then(setImported);
  useEffect(() => {
    void refresh();
    return onLibraryChange(() => void refresh());
  }, []);

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const notes: string[] = [];
    try {
      let last: Song | null = null;
      for (const f of Array.from(files)) {
        const buf = await f.arrayBuffer();
        let song: Song;
        if (/\.(mid|midi)$/i.test(f.name)) {
          const { importMidi, midiTracks, needsTrackChoice } = await import('../music/midiImport');
          const { Midi } = await import('@tonejs/midi');
          let infos;
          try {
            infos = midiTracks(new Midi(buf));
          } catch {
            throw new Error(`${f.name}: arquivo MIDI inválido ou corrompido.`);
          }
          // vários instrumentos: a pessoa escolhe o que vira partitura (e ouve antes)
          let tracks: import('../music/midiImport').TrackChoice[] | undefined;
          if (needsTrackChoice(infos)) {
            const picked = await askTracks(f.name, buf);
            if (!picked) continue;
            tracks = picked;
          }
          song = importMidi(buf, f.name, { tracks });
        } else if (/\.(xml|musicxml|mxl)$/i.test(f.name)) {
          const { importMusicXml, musicXmlText } = await import('../music/musicxml');
          song = importMusicXml(musicXmlText(buf, f.name), f.name);
        } else {
          throw new Error(`Formato não suportado: ${f.name}. Use MusicXML (.musicxml, .xml, .mxl) ou MIDI (.mid).`);
        }
        if (!song.notes.some((n) => n.keys.length)) throw new Error(`${f.name}: nenhuma nota encontrada.`);
        // o mesmo arquivo importado com o conversor antigo: substitui (mesmo id, o progresso continua)
        const prev = imported.find((r) => r.fileName === f.name && r.song.source === 'import' && (r.song.importVersion ?? 1) < IMPORT_VERSION);
        if (prev) {
          song = { ...song, id: prev.id, title: prev.song.title };
          await saveImported(song, f.name);
          const shared = await updateSharedSong(song, f.name);
          notes.push(`“${song.title}” foi refeita com o conversor novo${shared ? ' (também na comunidade)' : ''} — seu progresso continua.`);
        } else {
          await saveImported(song, f.name);
          if (signedIn && settings.get().shareImports) notes.push(`“${song.title}” ${SHARE_MSG[await shareSong(song, f.name)]}`);
        }
        last = song;
      }
      if (notes.length) setNotice(notes.join(' '));
      if (last && files.length === 1) navigate(`/musica/${encodeURIComponent(last.id)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const q = query.trim().toLowerCase();
  const levelOk = (lv: number) => filter === 'all' || String(Math.min(4, lv)) === filter;
  const textOk = (...xs: (string | undefined)[]) => !q || xs.some((x) => (x ?? '').toLowerCase().includes(q));
  const songs =
    coll === 'comunidade'
      ? []
      : builtinSongs().filter((s) => levelOk(s.level) && (coll === 'all' || songCollection(s.id) === coll) && textOk(s.title, s.composer));
  const showCommunity = coll === 'all' || coll === 'comunidade';
  const shared = com.songs.filter((s) => levelOk(s.level) && textOk(s.title, s.composer, s.ownerName));
  const sharedIds = new Set(com.songs.map((s) => s.id));

  return (
    <div>
      {picking && (
        <Suspense fallback={null}>
          <TrackPicker
            fileName={picking.name}
            data={picking.data}
            onCancel={() => {
              picking.resolve(null);
              setPicking(null);
            }}
            onConfirm={(t) => {
              picking.resolve(t);
              setPicking(null);
            }}
          />
        </Suspense>
      )}
      <div className="page-header">
        <h1>Músicas</h1>
      </div>
      <p className="muted">
        Escolha uma música para aprender. Cada uma tem um <b>plano de estudo</b> que divide a peça em trechos e guia você das mãos separadas até
        o andamento original. As músicas que alguém importa ficam disponíveis para todos na seção <b>Da comunidade</b>.
      </p>

      <div className="chip-choices" role="radiogroup" aria-label="Coleção" style={{ marginTop: 14 }}>
        {COLLECTIONS.map((c) => (
          <button key={c.value} role="radio" aria-checked={coll === c.value} className={'chip-btn' + (coll === c.value ? ' on' : '')} onClick={() => setColl(c.value)}>
            {c.label}
            {c.value === 'comunidade' && com.songs.length > 0 ? ` (${com.songs.length})` : ''}
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

      {coll !== 'comunidade' && (
        <>
          {songs.length === 0 && <p className="small muted">Nenhuma música do app com esse filtro.</p>}
          <div className="grid cols-2">
            {songs.map((s) => (
              <SongCard key={s.id} song={s} best={p.songs[s.id]?.best} />
            ))}
          </div>
        </>
      )}

      {showCommunity && (
        <>
          <div className="section-title">
            <h2>🌐 Da comunidade</h2>
            {signedIn && com.ready && <span className="small muted">{com.songs.length} músicas</span>}
          </div>
          {!signedIn ? (
            <div className="banner small">
              <Icon name="users" size={18} />
              <div style={{ flex: 1 }}>Entre na sua conta para ver e tocar as músicas que as pessoas adicionaram ao app.</div>
              <a className="btn sm primary" href="#/perfil">
                Entrar
              </a>
            </div>
          ) : !com.ready ? (
            <p className="small muted">Carregando…</p>
          ) : com.songs.length === 0 ? (
            <p className="small muted">Ainda não há músicas aqui. Importe uma partitura abaixo e ela aparece para todos.</p>
          ) : shared.length === 0 ? (
            <p className="small muted">Nenhuma música da comunidade com esse filtro.</p>
          ) : (
            <div className="grid cols-2">
              {shared.map((s) => (
                <CommunityCard
                  key={s.id}
                  s={s}
                  best={p.songs[s.id]?.best}
                  mine={s.ownerUid === myUid}
                  onRemove={() => {
                    if (confirm(`Tirar “${s.title}” da biblioteca de todos? Ela continua nas suas músicas importadas.`)) void unshareSong(s.id).catch((e) => setError(String(e)));
                  }}
                />
              ))}
            </div>
          )}
        </>
      )}

      <div className="section-title">
        <h2>Adicionar uma música</h2>
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
      {signedIn && (
        <div style={{ marginTop: 6 }}>
          <Toggle
            label="Compartilhar com todos"
            hint="As músicas que você importar entram na seção “Da comunidade”, com o seu nome. Você pode tirar qualquer uma depois."
            checked={st.shareImports}
            onChange={(v) => settings.set({ shareImports: v })}
          />
        </div>
      )}
      {notice && (
        <div className="banner small" style={{ marginTop: 10 }}>
          <Icon name="users" size={18} /> <div>{notice}</div>
        </div>
      )}
      {error && (
        <div className="banner bad small" style={{ marginTop: 10 }}>
          <Icon name="info" size={18} /> <div>{error}</div>
        </div>
      )}
      <details style={{ margin: '12px 0' }}>
        <summary className="small" style={{ cursor: 'pointer', fontWeight: 650 }}>
          Onde conseguir arquivos de partitura?
        </summary>
        <ul className="small muted">
          <li>
            <b>Arquivos MIDI</b> (.mid) de qualquer música funcionam: o app converte em partitura. Prefira MIDIs de piano com poucas notas.
          </li>
          <li>
            <b>IMSLP</b>, <b>Mutopia Project</b> e <b>OpenScore</b>: obras de domínio público, gratuitas, muitas com MIDI ou MusicXML.
          </li>
          <li>
            <b>MuseScore Studio</b> (programa gratuito para computador): digite ou edite uma partitura e use <i>Exportar → MusicXML</i>.
          </li>
        </ul>
      </details>

      {imported.length > 0 && (
        <>
          <div className="section-title">
            <h2>Suas músicas importadas</h2>
          </div>
          <div className="grid cols-2">
            {imported.map((r) => (
              <ImportedItem
                key={r.id}
                r={r}
                best={p.songs[r.id]?.best}
                shared={sharedIds.has(r.id)}
                canShare={signedIn && com.ready}
                onShare={async () => setNotice(`“${r.song.title}” ${SHARE_MSG[await shareSong(r.song, r.fileName)]}`)}
                onDelete={async () => {
                  if (!confirm(`Remover "${r.song.title}" das suas músicas?${sharedIds.has(r.id) ? ' (Ela continua na biblioteca da comunidade até você tirá-la de lá.)' : ''}`)) return;
                  await deleteImported(r.id);
                }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const HANDS_LABEL: Record<CommunitySong['hands'], string> = { RL: 'Duas mãos', R: 'Mão direita', L: 'Mão esquerda' };

function CommunityCard({ s, best, mine, onRemove }: { s: CommunitySong; best?: number; mine: boolean; onRemove: () => void }) {
  return (
    <div className="lib-item">
      <button className="card song-card" onClick={() => navigate(`/musica/${encodeURIComponent(s.id)}`)}>
        <div className="row between nowrap">
          <LevelDots level={s.level} />
          {best !== undefined && <span className={'chip ' + (best >= 0.9 ? 'ok' : '')}>{Math.round(best * 100)}%</span>}
        </div>
        <h3>{s.title}</h3>
        {s.composer && <div className="small muted">{s.composer}</div>}
        <div className="small">
          Adicionada por <b>{mine ? 'você' : s.ownerName}</b>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <span className="chip">{HANDS_LABEL[s.hands]}</span>
          <span className="chip">{s.measures} compassos</span>
        </div>
      </button>
      {mine && (
        <button className="btn ghost icon danger lib-action" aria-label="Tirar da biblioteca de todos" title="Tirar da biblioteca de todos" onClick={onRemove}>
          <Icon name="trash" />
        </button>
      )}
    </div>
  );
}

function ImportedItem({
  r,
  best,
  shared,
  canShare,
  onShare,
  onDelete,
}: {
  r: ImportedRecord;
  best?: number;
  shared: boolean;
  canShare: boolean;
  onShare: () => Promise<void>;
  onDelete: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="lib-item">
      <SongCard song={r.song} best={best} />
      <button className="btn ghost icon danger lib-action" aria-label="Remover música" onClick={onDelete}>
        <Icon name="trash" />
      </button>
      <div className="lib-status small">
        {shared ? (
          <span className="chip ok">🌐 Disponível para todos</span>
        ) : canShare ? (
          <button
            className="btn sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await onShare();
              setBusy(false);
            }}
          >
            <Icon name="users" /> {busy ? 'Compartilhando…' : 'Compartilhar com todos'}
          </button>
        ) : (
          <span className="muted tiny">Só neste aparelho/conta</span>
        )}
      </div>
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

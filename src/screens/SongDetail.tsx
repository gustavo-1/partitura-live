import { lazy, Suspense, useEffect, useState } from 'react';
import { getSong, listImported, saveImported } from '../data/library';
import { IMPORT_VERSION, type Song } from '../music/types';
import { studyPlan, stepUrl } from '../practice/plan';
import { useStore } from '../lib/store';
import { progress } from '../state/progress';
import { settings } from '../state/settings';
import { Score } from '../components/score/Score';
import { Icon, LevelDots } from '../components/Icon';
import { ProgressBar } from '../components/ui';
import { back, navigate } from '../lib/router';
import { handsInSong, tempoRange } from '../music/timeline';
import { CompareButtons, FidelityLine } from '../components/Fidelity';
import { b64ToBuffer } from '../lib/b64';
import { updateSharedSong } from '../lib/community';
import type { TrackChoice } from '../music/midiImport';

const TrackPicker = lazy(() => import('../components/TrackPicker'));
import { keySigName } from '../music/theory';
import { account } from '../lib/account';
import { sendChallenge, sendSong, social } from '../lib/social';
import { builtinSong } from '../data/songs';
import { Avatar } from '../components/Avatar';
import { FriendPicker } from '../components/FriendPicker';

export default function SongDetail({ id }: { id: string }) {
  const [song, setSong] = useState<Song | null | undefined>(undefined);
  useEffect(() => {
    getSong(id).then((s) => setSong(s ?? null));
  }, [id]);
  if (song === undefined) return <div className="empty">Carregando…</div>;
  if (!song) return <div className="empty">Música não encontrada.</div>;
  return <SongDetailInner song={song} onReplace={setSong} />;
}

function SongDetailInner({ song, onReplace }: { song: Song; onReplace: (s: Song) => void }) {
  const acc = useStore(account);
  const soc = useStore(social);
  const [picker, setPicker] = useState<null | 'challenge' | 'send'>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const p = useStore(progress);
  const st = useStore(settings);
  const sp = p.songs[song.id];
  const plan = studyPlan(song);
  const doneKeys = new Set(
    Object.entries(sp?.steps ?? {})
      .filter(([k, v]) => v >= (plan.steps.find((s) => s.key === k)?.target ?? 0.8))
      .map(([k]) => k),
  );
  const nextIdx = plan.steps.findIndex((s) => !doneKeys.has(s.key));
  const hands = handsInSong(song);
  const pct = doneKeys.size / plan.steps.length;
  const [tLo, tHi] = tempoRange(song);
  // músicas importadas por você (no aparelho/conta) podem ser reconvertidas a partir do arquivo original
  const [mine, setMine] = useState<{ fileName: string } | null>(null);
  const [retrack, setRetrack] = useState<false | 'saved' | 'fresh'>(false);
  const [convNotice, setConvNotice] = useState<string | null>(null);
  useEffect(() => {
    if (song.source !== 'import') return;
    listImported().then((rs) => {
      const r = rs.find((x) => x.id === song.id);
      setMine(r ? { fileName: r.fileName } : null);
    });
  }, [song.id, song.source]);
  const reconvert = async (tracks?: TrackChoice[]) => {
    setRetrack(false);
    const o = song.original!;
    const { importMidi } = await import('../music/midiImport');
    let fresh: Song;
    try {
      fresh = importMidi(b64ToBuffer(o.data), o.name, { tracks: tracks?.length ? tracks : undefined });
    } catch (e) {
      setConvNotice(e instanceof Error ? e.message : String(e));
      return;
    }
    // mesma música (mesmo id): o progresso e os links continuam valendo
    const next: Song = { ...fresh, id: song.id, title: song.title };
    await saveImported(next, mine?.fileName ?? o.name);
    const shared = await updateSharedSong(next, mine?.fileName ?? o.name);
    setConvNotice(shared ? 'Partitura refeita (também na biblioteca da comunidade).' : 'Partitura refeita.');
    onReplace(next);
  };

  return (
    <div>
      <div className="page-header">
        <button className="btn ghost icon" onClick={() => back('/musicas')} aria-label="Voltar">
          <Icon name="back" />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1>{song.title}</h1>
          <div className="muted small">{song.composer}</div>
        </div>
      </div>

      {song.source === 'import' && mine && (song.importVersion ?? 1) < IMPORT_VERSION && (
        <div className="banner warn small" style={{ marginBottom: 14 }}>
          <Icon name="info" size={18} />
          {song.original?.kind === 'midi' ? (
            <div>
              O conversor melhorou: o som segue o arquivo nota por nota, a grade é refeita quando o arquivo não segue o próprio andamento e o
              swing fica escrito de forma consistente.
              <div style={{ marginTop: 8 }}>
                <button className="btn sm primary" onClick={async () => {
                    // vários instrumentos: confirma as trilhas (a sugestão nova ignora trilhas-guia mudas)
                    const [{ Midi }, { midiTracks, needsTrackChoice }] = await Promise.all([import('@tonejs/midi'), import('../music/midiImport')]);
                    if (needsTrackChoice(midiTracks(new Midi(b64ToBuffer(song.original!.data))))) setRetrack('fresh');
                    else void reconvert(undefined);
                  }}>
                  Refazer com o conversor novo
                </button>
              </div>
            </div>
          ) : (
            <div>
              Esta música foi importada com uma versão anterior do conversor. Importe o mesmo arquivo de novo em <b>Músicas</b> para ganhar a
              escolha de trilhas, as mudanças de andamento e de compasso, o som nota por nota como no arquivo e a grade corrigida — a versão
              antiga é substituída e o seu progresso continua.
            </div>
          )}
        </div>
      )}

      <div className="card">
        <div className="row" style={{ marginBottom: 10 }}>
          <LevelDots level={song.level} />
          <span className="chip">{hands.length === 2 ? 'Duas mãos' : hands[0] === 'R' ? 'Mão direita' : 'Mão esquerda'}</span>
          <span className="chip">
            {song.timeSig[0]}/{song.timeSig[1]}
          </span>
          <span className="chip">{keySigName(song.keySig, st.naming)}</span>
          <span className="chip">{Math.round(tHi) - Math.round(tLo) >= 1 ? `${Math.round(tLo)}–${Math.round(tHi)} bpm` : `${Math.round(song.tempo)} bpm`}</span>
          <span className="chip">{song.measures.length} compassos</span>
        </div>
        {song.description && <p className="muted">{song.description}</p>}
        <div className="row">
          <button className="btn primary" onClick={() => navigate(nextIdx >= 0 ? stepUrl(song.id, plan.steps[nextIdx]) : `/tocar/${encodeURIComponent(song.id)}`)}>
            <Icon name="play" /> {nextIdx > 0 ? 'Continuar plano' : nextIdx === 0 ? 'Começar plano de estudo' : 'Tocar'}
          </button>
          <button className="btn" onClick={() => navigate(`/tocar/${encodeURIComponent(song.id)}?mode=listen`)}>
            <Icon name="ear" /> Ouvir
          </button>
          <button className="btn" onClick={() => navigate(`/tocar/${encodeURIComponent(song.id)}`)}>
            <Icon name="sliders" /> Prática livre
          </button>
        </div>
        {sp && (
          <p className="small muted" style={{ marginTop: 10, marginBottom: 0 }}>
            Melhor resultado: {Math.round(sp.best * 100)}% · tocada {sp.plays} {sp.plays === 1 ? 'vez' : 'vezes'}
            {sp.bestTempo ? ` · andamento alcançado: ${sp.bestTempo}%` : ''}
          </p>
        )}
      </div>

      {song.source === 'import' && (
        <>
          <div className="section-title">
            <h2>Conversão do arquivo</h2>
          </div>
          <div className="card stack" style={{ gap: 10 }}>
            {song.importReport ? (
              <FidelityLine report={song.importReport} />
            ) : (
              <p className="small muted" style={{ margin: 0 }}>
                Sem relatório de conversão (importada com uma versão anterior ou a partir de MusicXML).
              </p>
            )}
            <p className="small muted" style={{ margin: 0 }}>
              Compare: {song.original?.kind === 'midi' ? 'o arquivo original tocado nota por nota e ' : ''}a partitura como o app toca, ambos no
              andamento original e com o mesmo piano.
            </p>
            <CompareButtons song={song} />
            {mine && song.original?.kind === 'midi' && (
              <div>
                <button className="btn sm ghost" onClick={() => setRetrack('saved')}>
                  <Icon name="sliders" /> Trilhas e mãos…
                </button>
              </div>
            )}
            {convNotice && <p className="small" style={{ color: 'var(--ok)', margin: 0 }}>{convNotice}</p>}
          </div>
          {retrack && song.original && (
            <Suspense fallback={null}>
              <TrackPicker
                fileName={song.original.name}
                data={b64ToBuffer(song.original.data)}
                initial={retrack === 'saved' ? song.original.tracks : undefined}
                confirmLabel="Refazer partitura"
                onCancel={() => setRetrack(false)}
                onConfirm={(t) => void reconvert(t)}
              />
            </Suspense>
          )}
        </>
      )}

      <div className="section-title">
        <h2>Plano de estudo</h2>
        <span className="muted small">{Math.round(pct * 100)}%</span>
      </div>
      <ProgressBar value={pct} />
      <p className="small muted" style={{ marginTop: 8 }}>
        Dividimos a música em {plan.sections.length > 1 ? `${plan.sections.length} trechos` : 'um trecho'}. Em cada um: ouvir, mãos separadas sem
        pressa, mãos juntas e só depois no tempo. Repetições curtas e lentas fixam melhor do que tocar tudo rápido.
      </p>
      <div className="stack">
        {plan.steps.map((s, i) => {
          const done = doneKeys.has(s.key);
          const best = sp?.steps[s.key];
          const header = s.section !== undefined && plan.sections.length > 1 && (i === 0 || plan.steps[i - 1].section !== s.section);
          return (
            <div key={s.key}>
              {header && (
                <div className="small muted" style={{ fontWeight: 700, margin: '8px 0 6px' }}>
                  Trecho {s.section! + 1} — compassos {plan.sections[s.section!][0] + 1} a {plan.sections[s.section!][1] + 1}
                </div>
              )}
              {!header && s.section === undefined && plan.steps[i - 1]?.section !== undefined && (
                <div className="small muted" style={{ fontWeight: 700, margin: '8px 0 6px' }}>
                  Música inteira
                </div>
              )}
              <button className={'plan-step' + (done ? ' done' : '') + (i === nextIdx ? ' current' : '')} onClick={() => navigate(stepUrl(song.id, s))}>
                <span className="num">{done ? <Icon name="check" size={16} /> : i + 1}</span>
                <span style={{ flex: 1 }}>
                  <b>{s.title}</b>
                  <div className="small muted">{s.desc}</div>
                </span>
                {best !== undefined && s.mode !== 'listen' && <span className={'chip ' + (done ? 'ok' : '')}>{Math.round(best * 100)}%</span>}
                <Icon name="next" size={18} />
              </button>
            </div>
          );
        })}
      </div>

      {acc.status === 'signed-in' && (
        <FriendsOnSong
          song={song}
          myBest={sp?.best}
          onChallenge={() => setPicker('challenge')}
          onSend={builtinSong(song.id) ? undefined : () => setPicker('send')}
          notice={notice}
        />
      )}
      <FriendPicker
        open={picker !== null}
        title={picker === 'send' ? 'Enviar esta música para…' : 'Desafiar qual amigo?'}
        onClose={() => setPicker(null)}
        onPick={async (uid) => {
          const kind = picker;
          setPicker(null);
          const name = soc.friends[uid]?.name ?? 'seu amigo';
          try {
            if (kind === 'send') {
              await sendSong(uid, song);
              setNotice(`Música enviada para ${name}!`);
            } else {
              await sendChallenge(uid, song, sp?.best ?? 0);
              setNotice(`Desafio enviado para ${name}! ⚔️`);
            }
          } catch (e) {
            setNotice(String((e as Error).message ?? e));
          }
        }}
      />

      <div className="section-title">
        <h2>Partitura</h2>
      </div>
      <Score song={song} options={{ showNames: st.showNoteNames, naming: st.naming }} autoScroll={false} />
    </div>
  );
}

function FriendsOnSong({
  song,
  myBest,
  onChallenge,
  onSend,
  notice,
}: {
  song: Song;
  myBest?: number;
  onChallenge: () => void;
  onSend?: () => void;
  notice: string | null;
}) {
  const soc = useStore(social);
  const rows = soc.friendIds
    .map((uid) => soc.friends[uid])
    .filter((f) => f?.best?.[song.id])
    .map((f) => ({ uid: f.uid, name: f.name, photo: f.photo, avatar: f.avatar, a: f.best[song.id].a }))
    .sort((a, b) => b.a - a.a);
  return (
    <>
      <div className="section-title">
        <h2>Com amigos</h2>
      </div>
      <div className="card">
        {rows.length === 0 ? (
          <p className="small muted" style={{ marginTop: 0 }}>
            Nenhum amigo tocou esta música ainda{soc.friendIds.length ? '' : ' — adicione amigos na aba Amigos'}.
          </p>
        ) : (
          rows.map((r, i) => (
            <div key={r.uid} className="person-row" style={{ cursor: 'pointer' }} onClick={() => navigate('/amigo/' + r.uid)}>
              <span className="rank-num">{i + 1}</span>
              <Avatar name={r.name} photo={r.photo} avatar={r.avatar} seed={r.uid} size={32} />
              <div className="who">
                <b>{r.name}</b>
              </div>
              <b>{Math.round(r.a * 100)}%</b>
              {myBest !== undefined && <span className="small muted">{myBest >= r.a ? 'você está na frente' : `faltam ${Math.ceil((r.a - myBest) * 100)}%`}</span>}
            </div>
          ))
        )}
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn sm" onClick={onChallenge} disabled={!soc.friendIds.length}>
            ⚔️ Desafiar um amigo{myBest ? ` (seu recorde: ${Math.round(myBest * 100)}%)` : ''}
          </button>
          {onSend && (
            <button className="btn sm ghost" onClick={onSend} disabled={!soc.friendIds.length}>
              <Icon name="upload" /> Enviar esta música
            </button>
          )}
        </div>
        {notice && <p className="small" style={{ color: 'var(--ok)', marginBottom: 0 }}>{notice}</p>}
      </div>
    </>
  );
}

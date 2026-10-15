import { useEffect, useState } from 'react';
import type { ImportReport, Song } from '../music/types';
import { songSounds } from '../music/timeline';
import { playSequence, stopSequence } from '../audio/sequence';
import { b64ToBuffer } from '../lib/b64';
import { Icon } from './Icon';

const n = (x: number) => x.toLocaleString('pt-BR');

/** Resumo honesto da conversão: o som segue o arquivo? e a partitura, quanto precisou arredondar? */
export function FidelityLine({ report: r }: { report: ImportReport }) {
  const pct = r.notes ? r.exact / r.notes : 1;
  const grid = r.gridExact !== undefined && r.notes ? r.gridExact / r.notes : 1;
  const parts: string[] = [];
  if (r.tempoChanges) parts.push(`${r.tempoChanges} ${r.tempoChanges === 1 ? 'mudança' : 'mudanças'} de andamento`);
  if (r.timeSigChanges) parts.push(`${r.timeSigChanges} de compasso`);
  if (r.merged) parts.push(`${n(r.merged)} ${r.merged === 1 ? 'nota repetida juntada' : 'notas repetidas juntadas'} (mesma tecla, mesmo instante)`);
  return (
    <div className={'fidelity ' + (pct >= 0.98 ? 'good' : pct >= 0.85 ? 'mid' : 'low')}>
      <b>
        {n(r.notes)} notas · {pct >= 0.995 ? 'o som segue o arquivo nota por nota' : `${Math.floor(pct * 100)}% no instante exato do arquivo`}
      </b>
      {pct < 0.995 && <span className="tiny">Maior deslocamento do som: {r.maxShiftMs} ms.</span>}
      {r.tempoFix && (
        <span className="tiny">
          O arquivo diz {r.tempoFix.file} bpm, mas a música foi tocada a ~{r.tempoFix.real} bpm: os tempos e compassos da partitura foram refeitos
          para seguir a música.
        </span>
      )}
      {r.swing && <span className="tiny">Colcheias com swing: escritas retas e tocadas “balançadas”, como no original.</span>}
      {grid < 0.98 && r.gridMaxMs !== undefined && (
        <span className="tiny">
          Tocado “ao vivo”: na partitura, cada nota foi escrita na figura mais próxima (até {r.gridMaxMs} ms de diferença) — o som não muda.
        </span>
      )}
      {parts.length > 0 && <span className="tiny">Seguindo {parts.join(', ')}.</span>}
      {r.tracksIgnored.length > 0 && <span className="tiny muted">Fora da partitura: {r.tracksIgnored.join(', ')}.</span>}
    </div>
  );
}

/** Ouvir o arquivo original e a partitura convertida, um depois do outro, para comparar. */
export function CompareButtons({ song }: { song: Song }) {
  const [playing, setPlaying] = useState<'orig' | 'conv' | null>(null);
  useEffect(() => () => stopSequence(), []);
  const play = async (which: 'orig' | 'conv') => {
    if (playing === which) {
      stopSequence();
      setPlaying(null);
      return;
    }
    let notes: ReturnType<typeof songSounds>;
    if (which === 'conv') notes = songSounds(song);
    else {
      const o = song.original!;
      const [{ Midi }, { originalSounds }] = await Promise.all([import('@tonejs/midi'), import('../music/midiImport')]);
      const midi = new Midi(b64ToBuffer(o.data));
      notes = originalSounds(
        midi,
        (o.tracks ?? []).map((t) => t.index),
      );
    }
    setPlaying(which);
    await playSequence(notes, { onEnd: () => setPlaying((p) => (p === which ? null : p)) });
  };
  return (
    <div className="row">
      {song.original?.kind === 'midi' && (
        <button className="btn sm" onClick={() => play('orig')}>
          <Icon name={playing === 'orig' ? 'pause' : 'play'} size={14} /> Arquivo original
        </button>
      )}
      <button className="btn sm" onClick={() => play('conv')}>
        <Icon name={playing === 'conv' ? 'pause' : 'play'} size={14} /> Partitura convertida
      </button>
    </div>
  );
}

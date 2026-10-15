import { useEffect, useMemo, useState } from 'react';
import { Midi } from '@tonejs/midi';
import { importMidi, midiTracks, originalSounds, suggestTracks, type HandChoice, type TrackChoice } from '../music/midiImport';
import { songSounds } from '../music/timeline';
import { midiName } from '../music/theory';
import { playSequence, stopSequence } from '../audio/sequence';
import { useStore } from '../lib/store';
import { settings } from '../state/settings';
import { Icon } from './Icon';
import { Seg, Sheet } from './ui';
import { FidelityLine } from './Fidelity';

interface Props {
  fileName: string;
  data: ArrayBuffer;
  initial?: TrackChoice[];
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: (tracks: TrackChoice[]) => void;
}

/**
 * Escolha das trilhas de um MIDI com vários instrumentos: quais viram partitura e de que mão.
 * Dá para ouvir cada trilha, o original (seleção) e como a conversão vai soar.
 */
export default function TrackPicker({ fileName, data, initial, confirmLabel = 'Importar', onCancel, onConfirm }: Props) {
  const st = useStore(settings);
  const midi = useMemo(() => new Midi(data), [data]);
  const infos = useMemo(() => midiTracks(midi), [midi]);
  const [choice, setChoice] = useState<TrackChoice[]>(() => initial ?? suggestTracks(infos));
  const [playing, setPlaying] = useState<string | null>(null);
  useEffect(() => () => stopSequence(), []);

  const preview = useMemo(() => {
    if (!choice.length) return null;
    try {
      return importMidi(data, fileName, { tracks: choice, keepOriginal: false });
    } catch {
      return null;
    }
  }, [data, fileName, choice]);

  const toggle = (index: number, on: boolean) => {
    stopSequence();
    setPlaying(null);
    setChoice((c) => (on ? [...c, { index, hand: 'auto' as HandChoice }].sort((a, b) => a.index - b.index) : c.filter((x) => x.index !== index)));
  };
  const setHand = (index: number, hand: HandChoice) => setChoice((c) => c.map((x) => (x.index === index ? { ...x, hand } : x)));

  const play = async (key: string, notes: { midi: number; time: number; dur: number; vel: number }[]) => {
    if (playing === key) {
      stopSequence();
      setPlaying(null);
      return;
    }
    setPlaying(key);
    await playSequence(notes, { onEnd: () => setPlaying((p) => (p === key ? null : p)) });
  };

  const usable = infos.filter((t) => t.notes > 0);
  return (
    <Sheet open onClose={onCancel} title="Quais partes viram partitura?">
      <p className="small muted" style={{ marginTop: 0 }}>
        Este arquivo tem {usable.length} trilhas (instrumentos). Escolha as que você quer tocar no piano e de que mão é cada uma — juntar todas
        (cordas, voz, baixo…) no piano faz as notas se atropelarem. Toque em <Icon name="play" size={12} /> para ouvir uma trilha.
      </p>
      <div className="track-list">
        {usable.map((t) => {
          const c = choice.find((x) => x.index === t.index);
          const key = 'track' + t.index;
          return (
            <div key={t.index} className={'track-row' + (c ? ' on' : '') + (t.percussion ? ' off' : '')}>
              <label className="track-main">
                <input type="checkbox" checked={!!c} disabled={t.percussion} onChange={(e) => toggle(t.index, e.target.checked)} />
                <span>
                  <b>{t.name || t.instrument}</b>
                  <span className="tiny muted">
                    {t.name ? `${t.instrument} · ` : ''}
                    {t.notes} notas
                    {t.percussion ? ' · bateria não vira partitura' : ` · ${midiName(t.lo, st.naming, true)}–${midiName(t.hi, st.naming, true)}`}
                    {t.quiet && ' · quase sem som (trilha-guia)'}
                  </span>
                </span>
              </label>
              {!t.percussion && (
                <button
                  className="btn sm icon ghost"
                  aria-label={playing === key ? 'Parar' : `Ouvir a trilha ${t.name || t.instrument}`}
                  onClick={() => play(key, originalSounds(midi, [t.index]))}
                >
                  <Icon name={playing === key ? 'pause' : 'play'} size={16} />
                </button>
              )}
              {c && (
                <Seg<HandChoice>
                  value={c.hand}
                  onChange={(h) => setHand(t.index, h)}
                  options={[
                    { value: 'auto', label: 'Auto' },
                    { value: 'R', label: 'MD' },
                    { value: 'L', label: 'ME' },
                  ]}
                />
              )}
            </div>
          );
        })}
      </div>
      <p className="tiny muted">
        <b>Auto</b> divide pela altura (do Dó central para cima na direita). MD = mão direita, ME = mão esquerda.
      </p>

      {preview?.importReport && <FidelityLine report={preview.importReport} />}

      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn sm" disabled={!choice.length} onClick={() => play('orig', originalSounds(midi, choice.map((c) => c.index)))}>
          <Icon name={playing === 'orig' ? 'pause' : 'play'} size={14} /> Original
        </button>
        <button className="btn sm" disabled={!preview} onClick={() => preview && play('conv', songSounds(preview))}>
          <Icon name={playing === 'conv' ? 'pause' : 'play'} size={14} /> Como vai ficar
        </button>
        <div className="spacer" />
        <button className="btn ghost" onClick={onCancel}>
          Cancelar
        </button>
        <button
          className="btn primary"
          disabled={!choice.length || !preview}
          onClick={() => {
            stopSequence();
            onConfirm(choice);
          }}
        >
          {confirmLabel}
        </button>
      </div>
    </Sheet>
  );
}

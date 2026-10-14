import { useMemo, useState } from 'react';
import { generateExercise } from '../music/generator';
import { MiniPlayer } from '../components/MiniPlayer';
import { Icon } from '../components/Icon';
import { MicButton, MicHelp, Seg } from '../components/ui';
import { back, navigate } from '../lib/router';
import { registerTempSong } from '../data/library';
import { recordActivity } from '../state/progress';
import { usePracticeTime } from '../lib/usePracticeTime';

export default function SightReading() {
  usePracticeTime();
  const [level, setLevel] = useState(() => Number(localStorage.getItem('pl.sightLevel') ?? '1') || 1);
  const [seed, setSeed] = useState(() => Date.now());
  const [results, setResults] = useState<number[]>([]);
  const song = useMemo(() => generateExercise(level, seed), [level, seed]);
  const avg = results.length ? results.reduce((a, b) => a + b, 0) / results.length : null;

  return (
    <div>
      <div className="page-header">
        <button className="btn ghost icon" onClick={() => back('/treino')} aria-label="Voltar">
          <Icon name="back" />
        </button>
        <h1 style={{ flex: 1 }}>Leitura à primeira vista</h1>
        <MicButton compact />
      </div>
      <MicHelp />
      <div className="row" style={{ marginBottom: 12 }}>
        <Seg<string>
          value={String(level)}
          onChange={(v) => {
            setLevel(Number(v));
            localStorage.setItem('pl.sightLevel', v);
            setSeed(Date.now());
          }}
          options={[
            { value: '1', label: 'Nível 1' },
            { value: '2', label: 'Nível 2' },
            { value: '3', label: 'Nível 3' },
            { value: '4', label: 'Nível 4' },
          ]}
        />
        <span className="small muted">
          {level === 1
            ? 'Mão direita, posição de Dó, passos e saltos'
            : level === 2
              ? 'Duas mãos (esquerda com notas longas), posições de Dó e Sol'
              : level === 3
                ? 'Colcheias, mais posições e acidentes'
                : 'Ritmos pontuados e acordes na esquerda'}
        </span>
      </div>
      <div className="card">
        <p className="small muted" style={{ marginTop: 0 }}>
          Antes de começar: observe a armadura, o compasso e a primeira nota. Depois toque sem parar — se errar, siga em frente.
        </p>
        <MiniPlayer
          key={seed}
          song={song}
          onDone={(r) => {
            if (r.mode === 'listen') return;
            setResults((x) => [...x, r.accuracy]);
            recordActivity('sight', 5 + r.accuracy * 10);
          }}
        />
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn primary" onClick={() => setSeed(Date.now())}>
            <Icon name="sparkle" /> Novo exercício
          </button>
          <button
            className="btn ghost"
            onClick={() => {
              registerTempSong(song);
              navigate(`/tocar/${encodeURIComponent(song.id)}`);
            }}
          >
            Abrir no modo completo
          </button>
          <div className="spacer" />
          {avg !== null && (
            <span className="chip accent">
              Média da sessão: {Math.round(avg * 100)}% em {results.length}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

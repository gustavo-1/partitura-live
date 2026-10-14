import { useCallback, useState } from 'react';
import { back } from '../lib/router';
import { useStore } from '../lib/store';
import { usePracticeTime } from '../lib/usePracticeTime';
import { dayCount, progress, recordActivity } from '../state/progress';
import { Icon } from '../components/Icon';
import { MicButton, MicHelp } from '../components/ui';
import { EchoTrainer } from './lesson/activities';

type Level = 'l1' | 'l2' | 'l3' | 'l4' | 'l5';

const LEVELS: Record<Level, { label: string; desc: string; pool: number[]; length: number; clef: 'treble' | 'bass'; tempo: number }> = {
  l1: { label: 'Dó–Ré–Mi', desc: '3 notas, começando no Dó central.', pool: [60, 62, 64], length: 3, clef: 'treble', tempo: 80 },
  l2: { label: 'Posição de Dó', desc: 'Dó a Sol, mão direita.', pool: [60, 62, 64, 65, 67], length: 4, clef: 'treble', tempo: 84 },
  l3: { label: 'Mão esquerda', desc: 'Dó3 a Sol3, clave de Fá.', pool: [48, 50, 52, 53, 55], length: 4, clef: 'bass', tempo: 84 },
  l4: { label: 'Posição de Sol', desc: 'Sol a Ré, com saltos.', pool: [67, 69, 71, 72, 74], length: 5, clef: 'treble', tempo: 90 },
  l5: { label: 'Escala de Dó', desc: 'Dó a Dó, melodias de 5 notas.', pool: [60, 62, 64, 65, 67, 69, 71, 72], length: 5, clef: 'treble', tempo: 96 },
};

/** Tocar de ouvido: ouça uma melodia curta e toque de volta. */
export default function EarTraining() {
  usePracticeTime();
  const p = useStore(progress);
  const [level, setLevel] = useState<Level>('l1');
  const [run, setRun] = useState(0);
  const [last, setLast] = useState<number | null>(null);
  const L = LEVELS[level];
  const onSolved = useCallback(() => recordActivity('echo', 3), []);
  const onComplete = useCallback((s: number) => setLast(s), []);
  return (
    <div>
      <div className="page-header">
        <button className="btn ghost icon" onClick={() => back('/treino')} aria-label="Voltar">
          <Icon name="back" />
        </button>
        <h1 style={{ flex: 1 }}>Tocar de ouvido</h1>
        <MicButton compact />
      </div>
      <MicHelp />
      <p className="muted">
        Ouça uma melodia curta e toque de volta, começando na nota marcada com ★. Depois de acertar, veja como ela se escreve na pauta. Ligar o
        som ao símbolo deixa a leitura mais rápida e musical. Hoje: <b>{dayCount(p, 'echo')}</b> {dayCount(p, 'echo') === 1 ? 'melodia' : 'melodias'}.
      </p>
      <div className="card">
        <div className="field">
          <span className="label">Nível</span>
          <div className="chip-choices" role="radiogroup" aria-label="Nível">
            {(Object.keys(LEVELS) as Level[]).map((k) => (
              <button
                key={k}
                role="radio"
                aria-checked={level === k}
                className={'chip-btn' + (level === k ? ' on' : '')}
                onClick={() => {
                  setLevel(k);
                  setRun((r) => r + 1);
                }}
              >
                {LEVELS[k].label}
              </button>
            ))}
          </div>
          <span className="small muted">{L.desc}</span>
        </div>
      </div>
      <div className="card">
        <EchoTrainer
          key={level + run}
          pool={L.pool}
          length={L.length}
          count={5}
          tempo={L.tempo}
          clef={L.clef}
          onSolved={onSolved}
          onComplete={onComplete}
        />
        {last !== null && (
          <div className="row" style={{ justifyContent: 'center', marginTop: 10 }}>
            <span className="chip accent">Última rodada: {Math.round(last * 100)}%</span>
            <button
              className="btn primary"
              onClick={() => {
                setLast(null);
                setRun((r) => r + 1);
              }}
            >
              <Icon name="restart" /> Nova rodada
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

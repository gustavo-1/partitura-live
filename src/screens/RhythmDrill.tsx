import { useState } from 'react';
import { RhythmExercise } from './lesson/activities';
import { Icon } from '../components/Icon';
import { Seg } from '../components/ui';
import { back } from '../lib/router';
import { recordActivity } from '../state/progress';
import { usePracticeTime } from '../lib/usePracticeTime';

const CELLS: Record<number, string[][]> = {
  1: [['q', 'q', 'q', 'q'], ['h', 'h'], ['h', 'q', 'q'], ['q', 'q', 'h'], ['w']],
  2: [['q', 'rq', 'q', 'q'], ['h', 'rh'], ['q', 'q', 'rq', 'q'], ['rq', 'q', 'h'], ['h.', 'q'], ['q', 'h.']],
  3: [['e', 'e', 'q', 'q', 'q'], ['q', 'e', 'e', 'h'], ['e', 'e', 'e', 'e', 'h'], ['q', 'q', 'e', 'e', 'q'], ['h', 'e', 'e', 'q']],
  4: [['q.', 'e', 'q', 'q'], ['q', 'q.', 'e', 'q'], ['q.', 'e', 'h'], ['e', 'e', 'q.', 'e', 'q'], ['rq', 'e', 'e', 'q.', 'e']],
};

function makePattern(level: number): string {
  const pool = [...CELLS[1], ...(level >= 2 ? CELLS[2] : []), ...(level >= 3 ? CELLS[3] : []), ...(level >= 4 ? CELLS[4] : [])];
  const preferred = CELLS[level];
  const bars: string[] = [];
  for (let i = 0; i < 4; i++) {
    const src = Math.random() < 0.6 ? preferred : pool;
    const cell = i === 3 && level <= 2 ? ['w'] : src[Math.floor(Math.random() * src.length)];
    bars.push(cell.map((d) => (d.startsWith('r') ? 'r' + d.slice(1) : 'B4' + d)).join(' '));
  }
  return bars.join(' | ');
}

export default function RhythmDrill() {
  usePracticeTime();
  const [level, setLevel] = useState(1);
  const [tempo, setTempo] = useState(72);
  const [pattern, setPattern] = useState(() => makePattern(1));
  const [last, setLast] = useState<number | null>(null);

  return (
    <div>
      <div className="page-header">
        <button className="btn ghost icon" onClick={() => back('/treino')} aria-label="Voltar">
          <Icon name="back" />
        </button>
        <h1>Ritmo</h1>
      </div>
      <div className="card">
        <div className="row">
          <Seg<string>
            value={String(level)}
            onChange={(v) => {
              setLevel(Number(v));
              setPattern(makePattern(Number(v)));
            }}
            options={[
              { value: '1', label: 'Básico' },
              { value: '2', label: '+ Pausas' },
              { value: '3', label: '+ Colcheias' },
              { value: '4', label: '+ Pontuadas' },
            ]}
          />
          <label className="row small" style={{ gap: 6 }}>
            {tempo} bpm
            <input type="range" min={50} max={120} value={tempo} onChange={(e) => setTempo(Number(e.target.value))} style={{ width: 120 }} />
          </label>
        </div>
      </div>
      <div className="card">
        <RhythmExercise
          key={pattern + tempo}
          pattern={pattern}
          tempo={tempo}
          onComplete={(s) => {
            setLast(s);
            recordActivity('rhythm', 3 + s * 5);
          }}
        />
        <div className="row" style={{ justifyContent: 'center', marginTop: 10 }}>
          <button className="btn ghost" onClick={() => setPattern(makePattern(level))}>
            <Icon name="sparkle" /> Novo ritmo
          </button>
        </div>
        {last !== null && <p className="center small muted">Último resultado: {Math.round(last * 100)}%</p>}
      </div>
      <div className="card flat">
        <h3>Como contar</h3>
        <p className="small muted" style={{ margin: 0 }}>
          Conte em voz alta: semínimas "1, 2, 3, 4"; colcheias "1 e 2 e"; na semínima pontuada, segure pelo "1 e 2" e toque a colcheia no "e".
          Contar em voz alta é uma das técnicas mais eficazes para firmar o ritmo.
        </p>
      </div>
    </div>
  );
}

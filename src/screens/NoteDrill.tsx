import { useState } from 'react';
import { ReadCards } from './lesson/activities';
import { Icon } from '../components/Icon';
import { MicButton, MicHelp, Seg, Toggle } from '../components/ui';
import { back } from '../lib/router';
import { useStore } from '../lib/store';
import { progress } from '../state/progress';
import { settings } from '../state/settings';
import { midiName, spellMidi, isBlackKey, pitchToVexKey } from '../music/theory';
import { addXp } from '../state/progress';
import { usePracticeTime } from '../lib/usePracticeTime';

type Clef = 'treble' | 'bass' | 'grand';
type Range = 'pos' | 'staff' | 'ledger';

const RANGES: Record<Exclude<Clef, 'grand'>, Record<Range, [number, number]>> = {
  treble: { pos: [60, 67], staff: [60, 77], ledger: [55, 84] },
  bass: { pos: [48, 55], staff: [43, 60], ledger: [36, 64] },
};

function poolFor(clef: Clef, range: Range, acc: boolean): string[] {
  const ranges = clef === 'grand' ? [RANGES.treble[range], RANGES.bass[range]] : [RANGES[clef][range]];
  const out: string[] = [];
  for (const [lo, hi] of ranges)
    for (let m = lo; m <= hi; m++) {
      if (isBlackKey(m) && !acc) continue;
      const p = spellMidi(m, 0);
      const name = pitchToVexKey(p); // "c#/4"
      const [n, o] = name.split('/');
      out.push(n[0].toUpperCase() + n.slice(1) + o);
      if (acc && isBlackKey(m)) {
        const f = spellMidi(m, -1);
        const fn = pitchToVexKey(f).split('/');
        out.push(fn[0][0].toUpperCase() + fn[0].slice(1) + fn[1]);
      }
    }
  return [...new Set(out)];
}

export default function NoteDrill({ query }: { query?: URLSearchParams }) {
  usePracticeTime();
  const st = useStore(settings);
  const p = useStore(progress);
  const [clef, setClef] = useState<Clef>((query?.get('clave') as Clef) || 'treble');
  const [range, setRange] = useState<Range>('pos');
  const [answer, setAnswer] = useState<'both' | 'play' | 'name'>('both');
  const [acc, setAcc] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<number | null>(null);
  const [runId, setRunId] = useState(0);

  const pool = poolFor(clef, range, acc);

  return (
    <div>
      <div className="page-header">
        <button className="btn ghost icon" onClick={() => back('/treino')} aria-label="Voltar">
          <Icon name="back" />
        </button>
        <h1 style={{ flex: 1 }}>Leitura de notas</h1>
        <MicButton compact />
      </div>
      <MicHelp />
      {!running ? (
        <div className="card">
          <div className="field">
            <span className="label">Clave</span>
            <Seg<Clef>
              value={clef}
              onChange={setClef}
              options={[
                { value: 'treble', label: 'Sol' },
                { value: 'bass', label: 'Fá' },
                { value: 'grand', label: 'As duas' },
              ]}
            />
          </div>
          <div className="field">
            <span className="label">Notas</span>
            <Seg<Range>
              value={range}
              onChange={setRange}
              options={[
                { value: 'pos', label: 'Posição de Dó' },
                { value: 'staff', label: 'Pauta toda' },
                { value: 'ledger', label: '+ Suplementares' },
              ]}
            />
          </div>
          <div className="field">
            <span className="label">Responder</span>
            <Seg
              value={answer}
              onChange={setAnswer}
              options={[
                { value: 'both', label: 'Tocando ou pelo nome' },
                { value: 'play', label: 'Só tocando' },
                { value: 'name', label: 'Só pelo nome' },
              ]}
            />
          </div>
          <Toggle label="Incluir sustenidos e bemóis" hint="Respostas só tocando" checked={acc} onChange={setAcc} />
          <p className="small muted">
            {pool.length} notas no sorteio. As notas que você erra ou demora mais aparecem com mais frequência.
          </p>
          <button
            className="btn primary lg"
            onClick={() => {
              setResult(null);
              setRunning(true);
              setRunId((x) => x + 1);
            }}
          >
            <Icon name="play" /> Começar (20 cartões)
          </button>
          {result !== null && <p className="feedback-line ok">Última rodada: {Math.round(result * 100)}%</p>}
        </div>
      ) : (
        <div className="card">
          <ReadCards
            key={runId}
            pool={pool}
            clef={clef}
            count={20}
            answer={acc ? 'play' : answer}
            onComplete={(s) => {
              addXp(5 + s * 10);
              setResult(s);
              setRunning(false);
            }}
          />
          <button className="btn ghost" style={{ marginTop: 10 }} onClick={() => setRunning(false)}>
            Parar
          </button>
        </div>
      )}

      <div className="section-title">
        <h2>Seu mapa de leitura</h2>
      </div>
      <p className="small muted">Verde = você lê bem; vermelho = precisa de atenção; cinza = ainda não praticada.</p>
      {(['treble', 'bass'] as const).map((c) => (
        <div key={c} className="card flat" style={{ marginBottom: 10 }}>
          <b className="small">{c === 'treble' ? 'Clave de Sol' : 'Clave de Fá'}</b>
          <div className="row" style={{ gap: 4, marginTop: 8 }}>
            {Array.from({ length: RANGES[c].ledger[1] - RANGES[c].ledger[0] + 1 }, (_, i) => RANGES[c].ledger[0] + i)
              .filter((m) => !isBlackKey(m))
              .map((m) => {
                const s = p.noteStats[`${c}:${m}`];
                const rate = s ? s.correct / Math.max(1, s.seen) : -1;
                const bg = rate < 0 ? 'var(--bg-2)' : `hsl(${Math.round(rate * 120)}, 65%, ${st.theme === 'dark' ? 35 : 55}%)`;
                return (
                  <span
                    key={m}
                    className="chip heat-key"
                    title={s ? `${s.correct}/${s.seen} certas, ~${(s.ms / 1000).toFixed(1)} s` : 'sem dados'}
                    style={{ background: bg, color: rate < 0 ? 'var(--muted)' : 'white', border: 0 }}
                  >
                    {midiName(m, st.naming, true)}
                  </span>
                );
              })}
          </div>
        </div>
      ))}
    </div>
  );
}

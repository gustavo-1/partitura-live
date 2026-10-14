import { useEffect, useRef, useState } from 'react';
import { navigate } from '../lib/router';
import { useStore } from '../lib/store';
import { Icon } from '../components/Icon';
import { Metronome } from '../audio/metronome';
import { resumeAudio } from '../audio/context';
import { dayCount, progress } from '../state/progress';
import { dueCount } from '../practice/review';

const TOOLS: { href: string; icon: string; title: string; desc: string; counter?: string }[] = [
  {
    href: '/treino/leitura',
    icon: '👀',
    title: 'Leitura de notas',
    desc: 'Cartões com notas na pauta. As que você erra ou demora para ler voltam mais vezes; as que domina voltam depois de alguns dias.',
    counter: 'notes',
  },
  {
    href: '/treino/leitura-primeira-vista',
    icon: '✨',
    title: 'Leitura à primeira vista',
    desc: 'Melodias novas geradas no seu nível. Ler material novo todo dia é o que mais desenvolve a leitura.',
    counter: 'sight',
  },
  {
    href: '/treino/ouvido',
    icon: '👂',
    title: 'Tocar de ouvido',
    desc: 'Ouça uma melodia curta e toque de volta; depois veja como se escreve. Som antes do símbolo.',
    counter: 'echo',
  },
  { href: '/treino/ritmo', icon: '🥁', title: 'Ritmo', desc: 'Leia e bata ritmos com o metrônomo, do simples ao pontuado.', counter: 'rhythm' },
  {
    href: '/treino/detector',
    icon: '🎙️',
    title: 'Microfone e afinação',
    desc: 'Veja quais notas o app está ouvindo, ajuste a sensibilidade e teste seu teclado.',
  },
];

export function PracticeHub() {
  const p = useStore(progress);
  const due = dueCount(p);
  const reviewed = dayCount(p, 'reviews') > 0;
  return (
    <div>
      <div className="page-header">
        <h1>Treino</h1>
      </div>
      <p className="muted">Exercícios curtos para fazer todos os dias. Dez minutos de leitura diária valem mais do que uma hora por semana.</p>

      <button className={'card review-cta big' + (reviewed ? ' done' : '')} onClick={() => navigate('/treino/revisao')}>
        <span className="review-ic-sm">{reviewed ? '✅' : '🧠'}</span>
        <span style={{ flex: 1, textAlign: 'left' }}>
          <b>Revisão do dia</b>
          <span className="small muted" style={{ display: 'block' }}>
            {reviewed
              ? 'Feita hoje. Quer outra rodada?'
              : due > 0
                ? `${due} ${due === 1 ? 'nota pronta' : 'notas prontas'} para revisar + conceitos, ritmo e ouvido, misturados. ~3 min.`
                : 'Notas, conceitos, ritmo e ouvido, misturados. ~3 min.'}
          </span>
        </span>
        <Icon name="next" />
      </button>

      <div className="grid cols-2">
        {TOOLS.map((t) => {
          const n = t.counter ? dayCount(p, t.counter) : 0;
          return (
            <button key={t.href} className="card song-card tool-card" onClick={() => navigate(t.href)}>
              <span className="quick-ic">{t.icon}</span>
              <h3>{t.title}</h3>
              <div className="small muted">{t.desc}</div>
              {n > 0 && <span className="chip ok-chip">hoje: {n}</span>}
            </button>
          );
        })}
      </div>
      <div className="section-title">
        <h2>Metrônomo</h2>
      </div>
      <MetronomeWidget />
      <a className="method-link card flat" href="#/metodo" style={{ marginTop: 16 }}>
        <Icon name="brain" size={22} />
        <span style={{ flex: 1 }}>
          <b>Por que esses treinos?</b>
          <span className="small muted" style={{ display: 'block' }}>
            Veja as pesquisas por trás da revisão espaçada, da prática intercalada e do treino de ouvido.
          </span>
        </span>
        <Icon name="next" />
      </a>
    </div>
  );
}

function MetronomeWidget() {
  const met = useRef<Metronome | null>(null);
  const [bpm, setBpm] = useState(80);
  const [beats, setBeats] = useState(4);
  const [on, setOn] = useState(false);
  const [beat, setBeat] = useState(-1);
  useEffect(() => {
    met.current = new Metronome();
    met.current.onBeat = (b) => setBeat(b);
    return () => met.current?.stop();
  }, []);
  useEffect(() => {
    if (!met.current) return;
    met.current.bpm = bpm;
    met.current.beatsPerBar = beats;
  }, [bpm, beats]);
  const toggle = async () => {
    await resumeAudio();
    if (!met.current) return;
    if (met.current.running) {
      met.current.stop();
      setOn(false);
      setBeat(-1);
    } else {
      met.current.bpm = bpm;
      met.current.beatsPerBar = beats;
      met.current.start();
      setOn(true);
    }
  };
  return (
    <div className="card">
      <div className="row between">
        <div className="note-display" style={{ fontSize: 48 }}>
          {bpm} <span className="small muted">bpm</span>
        </div>
        <div className="beat-dots">
          {Array.from({ length: beats }, (_, i) => (
            <span key={i} className={beat >= 0 && beat % beats === i ? 'on' : ''} />
          ))}
        </div>
      </div>
      <input type="range" min={30} max={200} value={bpm} onChange={(e) => setBpm(Number(e.target.value))} aria-label="Andamento" />
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn primary" onClick={() => void toggle()}>
          <Icon name={on ? 'pause' : 'play'} /> {on ? 'Parar' : 'Iniciar'}
        </button>
        <button className="btn sm" onClick={() => setBpm((b) => Math.max(30, b - 5))}>
          −5
        </button>
        <button className="btn sm" onClick={() => setBpm((b) => Math.min(200, b + 5))}>
          +5
        </button>
        <select value={beats} onChange={(e) => setBeats(Number(e.target.value))} aria-label="Tempos por compasso">
          {[2, 3, 4, 6].map((b) => (
            <option key={b} value={b}>
              {b} tempos
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { navigate } from '../lib/router';
import { Icon, type IconName } from '../components/Icon';
import { Metronome } from '../audio/metronome';
import { resumeAudio } from '../audio/context';

const TOOLS: { href: string; icon: IconName; title: string; desc: string }[] = [
  {
    href: '/treino/leitura',
    icon: 'eye',
    title: 'Leitura de notas',
    desc: 'Cartões com notas na pauta. O app repete mais as notas que você erra ou demora para reconhecer (repetição espaçada).',
  },
  {
    href: '/treino/leitura-primeira-vista',
    icon: 'sparkle',
    title: 'Leitura à primeira vista',
    desc: 'Melodias novas geradas no seu nível — a melhor forma de ganhar fluência na leitura.',
  },
  { href: '/treino/ritmo', icon: 'metronome', title: 'Ritmo', desc: 'Leia e bata ritmos com o metrônomo, do simples ao pontuado.' },
  {
    href: '/treino/detector',
    icon: 'mic',
    title: 'Microfone e afinação',
    desc: 'Veja quais notas o app está ouvindo, ajuste a sensibilidade e teste seu teclado.',
  },
];

export function PracticeHub() {
  return (
    <div>
      <div className="page-header">
        <h1>Treino</h1>
      </div>
      <p className="muted">Exercícios curtos para fazer todos os dias. 10 minutos de leitura diária valem mais do que uma hora por semana.</p>
      <div className="grid cols-2">
        {TOOLS.map((t) => (
          <button key={t.href} className="card song-card" onClick={() => navigate(t.href)}>
            <Icon name={t.icon} size={28} />
            <h3>{t.title}</h3>
            <div className="small muted">{t.desc}</div>
          </button>
        ))}
      </div>
      <div className="section-title">
        <h2>Metrônomo</h2>
      </div>
      <MetronomeWidget />
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

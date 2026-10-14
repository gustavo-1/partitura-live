import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { mic } from '../audio/mic';
import { input } from '../audio/input';
import type { DetectorFrame } from '../audio/detector';
import { Icon } from '../components/Icon';
import { Keyboard, type KeyMark } from '../components/Keyboard';
import { MicButton, MicHelp, useMicState } from '../components/ui';
import { back } from '../lib/router';
import { useStore } from '../lib/store';
import { keyboardRange, settings } from '../state/settings';
import { midiName } from '../music/theory';

export default function DetectorScreen() {
  const st = useStore(settings);
  const state = useMicState();
  useSyncExternalStore(input.subscribe, input.getVersion);
  const [frame, setFrame] = useState<DetectorFrame | null>(null);
  const [history, setHistory] = useState<{ midi: number; t: number }[]>([]);
  const last = useRef(0);

  useEffect(
    () =>
      mic.onFrame((f) => {
        const t = performance.now();
        if (t - last.current < 60) return;
        last.current = t;
        setFrame({ ...f, salience: f.salience.slice() });
      }),
    [],
  );
  useEffect(
    () =>
      input.on((e) => {
        if (e.type === 'on') setHistory((h) => [...h.slice(-11), { midi: e.midi, t: Date.now() }]);
      }),
    [],
  );

  const [lo, hi] = keyboardRange(st.keyboardSize);
  const marks = new Map<number, KeyMark>();
  for (const [m, src] of input.sounding) marks.set(m, { fill: src === 'mic' ? '#4ade80' : '#a5b4fc', label: midiName(m, st.naming) });
  const top = frame?.top;
  const active = frame?.active ?? [];
  const db = frame ? 20 * Math.log10(frame.rms + 1e-9) : -100;

  return (
    <div>
      <div className="page-header">
        <button className="btn ghost icon" onClick={() => back('/treino')} aria-label="Voltar">
          <Icon name="back" />
        </button>
        <h1 style={{ flex: 1 }}>Microfone e afinação</h1>
      </div>
      <MicHelp />
      <div className="card">
        <div className="row between">
          <MicButton />
          <span className="small muted">{state === 'on' ? `Nível: ${db.toFixed(0)} dB` : 'Ligue o microfone para começar'}</span>
        </div>
        <div className="note-display" style={{ marginTop: 16 }}>
          {active.length ? active.map((m) => midiName(m, st.naming, true)).join(' · ') : '—'}
        </div>
        {top && active.length === 1 && (
          <div style={{ maxWidth: 320, margin: '10px auto 0' }}>
            <div className="tuner-bar">
              <i style={{ left: `calc(${50 + Math.max(-50, Math.min(50, top.cents))}% - 2px)` }} />
            </div>
            <div className="row between tiny muted" style={{ marginTop: 4 }}>
              <span>−50</span>
              <span>
                {top.freq.toFixed(1)} Hz ({top.cents > 0 ? '+' : ''}
                {top.cents.toFixed(0)} cents)
              </span>
              <span>+50</span>
            </div>
          </div>
        )}
        <div style={{ marginTop: 16 }}>
          <Keyboard lo={lo} hi={hi} marks={marks} labels={st.keyLabels} naming={st.naming} onDown={(m) => input.press(m)} onUp={(m) => input.release(m)} />
        </div>
        <p className="small muted" style={{ marginTop: 8 }}>
          Últimas notas: {history.length ? history.map((h) => midiName(h.midi, st.naming, true)).join(', ') : 'nenhuma ainda'}
        </p>
      </div>

      <div className="card">
        <h3>Ajustes</h3>
        <div className="field">
          <span className="label">Sensibilidade: {Math.round(st.micSensitivity * 100)}%</span>
          <input type="range" min={0} max={1} step={0.05} value={st.micSensitivity} onChange={(e) => settings.set({ micSensitivity: Number(e.target.value) })} />
          <span className="hint">
            Aumente se notas suaves não forem reconhecidas; diminua se aparecerem notas que você não tocou (ambiente barulhento).
          </span>
        </div>
        <div className="field">
          <span className="label">Compensação de atraso: {st.latencyMs} ms</span>
          <input type="range" min={0} max={250} step={5} value={st.latencyMs} onChange={(e) => settings.set({ latencyMs: Number(e.target.value) })} />
          <span className="hint">Usada no modo "No tempo". Se o app sempre disser que você está atrasado, aumente este valor.</span>
        </div>
      </div>

      <div className="card flat">
        <h3>Dicas para o microfone ouvir melhor</h3>
        <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
          <li>Deixe o celular/computador a menos de 1 metro do alto-falante do teclado.</li>
          <li>Use um som de piano acústico no teclado (sem efeitos de eco/coro).</li>
          <li>Evite TV, música ou conversa ao fundo. Se usar o "tocar a outra mão", prefira fones.</li>
          <li>Teclados com saída USB/MIDI dão precisão perfeita: conecte via cabo (Chrome/Edge).</li>
        </ul>
      </div>
    </div>
  );
}

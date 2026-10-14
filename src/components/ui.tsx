import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { mic, type MicState } from '../audio/mic';
import { Icon } from './Icon';

export function Sheet({ open, onClose, children, title }: { open: boolean; onClose: () => void; children: ReactNode; title?: string }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        {title && (
          <div className="row between" style={{ marginBottom: 8 }}>
            <h2 style={{ margin: 0 }}>{title}</h2>
            <button className="btn ghost icon" onClick={onClose} aria-label="Fechar">
              <Icon name="x" />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

export function Toggle({ label, checked, onChange, hint }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="toggle">
      <span>
        <span style={{ fontWeight: 600 }}>{label}</span>
        {hint && <div className="small muted">{hint}</div>}
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="sw" />
    </label>
  );
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="radiogroup">
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={value === o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function useMicState(): MicState {
  return useSyncExternalStore(
    (fn) => mic.onState(fn),
    () => mic.state,
  );
}

/** Nível do microfone (0..1), atualizado ~20x/s. */
export function useMicLevel(): number {
  const [lvl, setLvl] = useState(0);
  const last = useRef(0);
  useEffect(
    () =>
      mic.onFrame((f) => {
        const t = performance.now();
        if (t - last.current < 50) return;
        last.current = t;
        const db = 20 * Math.log10(f.rms + 1e-9);
        setLvl(Math.max(0, Math.min(1, (db + 60) / 50)));
      }),
    [],
  );
  return lvl;
}

export function MicButton({ compact }: { compact?: boolean }) {
  const state = useMicState();
  const level = useMicLevel();
  const on = state === 'on';
  const label =
    state === 'on'
      ? 'Ouvindo'
      : state === 'starting'
        ? 'Iniciando…'
        : state === 'denied'
          ? 'Microfone bloqueado'
          : state === 'unsupported'
            ? 'Sem microfone'
            : state === 'error'
              ? 'Erro no microfone'
              : 'Ativar microfone';
  return (
    <button
      className={'mic-pill' + (on ? ' on' : '')}
      onClick={() => (on ? mic.stop() : void mic.start())}
      title={on ? 'Clique para desligar o microfone' : 'Clique para o app ouvir seu teclado'}
    >
      <span className="dot" />
      <Icon name={on ? 'mic' : 'micOff'} />
      {!compact && <span>{label}</span>}
      {on && (
        <span className="level-meter" aria-hidden>
          <div style={{ width: `${level * 100}%` }} />
        </span>
      )}
    </button>
  );
}

export function MicHelp() {
  const state = useMicState();
  if (state === 'denied')
    return (
      <div className="banner bad small">
        <Icon name="micOff" size={20} />
        <div>
          O navegador bloqueou o microfone. Toque no cadeado ao lado do endereço do site e permita o acesso ao microfone. Enquanto isso, você
          pode usar o teclado na tela ou o teclado do computador.
        </div>
      </div>
    );
  if (state === 'unsupported' || state === 'error')
    return (
      <div className="banner warn small">
        <Icon name="info" size={20} />
        <div>
          Não foi possível usar o microfone ({mic.errorMessage || 'sem suporte'}). O microfone só funciona em páginas https ou localhost.
        </div>
      </div>
    );
  return null;
}

export function ProgressBar({ value }: { value: number }) {
  return (
    <div className="progress" role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  );
}

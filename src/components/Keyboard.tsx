import { useLayoutEffect, useRef, useState } from 'react';
import { keyboardLayout } from './keyboardLayout';
import { midiName, type NamingStyle } from '../music/theory';

export interface KeyMark {
  /** cor de preenchimento (tecla pressionada / correta / errada) */
  fill?: string;
  /** dica: contorno/ponto colorido indicando a tecla a tocar */
  hint?: string;
  label?: string;
}

interface Props {
  lo: number;
  hi: number;
  marks?: Map<number, KeyMark>;
  labels?: 'none' | 'c' | 'all';
  naming?: NamingStyle;
  onDown?: (midi: number) => void;
  onUp?: (midi: number) => void;
  height?: number;
  className?: string;
  /** destaca o Dó central */
  markMiddleC?: boolean;
}

export function Keyboard({
  lo,
  hi,
  marks,
  labels = 'c',
  naming = 'solfege',
  onDown,
  onUp,
  height,
  className,
  markMiddleC = true,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const pointers = useRef(new Map<number, number>());

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth || 600));
    ro.observe(el);
    setWidth(el.clientWidth || 600);
    return () => ro.disconnect();
  }, []);

  const keys = keyboardLayout(lo, hi, width);
  const whiteW = keys.find((k) => !k.black)?.w ?? 20;
  const h = height ?? Math.max(70, Math.min(170, whiteW * 4.6));
  const blackH = h * 0.62;

  const midiAt = (clientX: number, clientY: number): number | null => {
    const el = ref.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const x = clientX - r.left;
    const y = clientY - r.top;
    if (y < blackH) {
      const b = keys.find((k) => k.black && x >= k.x && x <= k.x + k.w);
      if (b) return b.midi;
    }
    const w = keys.find((k) => !k.black && x >= k.x && x < k.x + k.w);
    return w ? w.midi : null;
  };

  const interactive = !!onDown;

  const handleDown = (e: React.PointerEvent) => {
    if (!interactive) return;
    e.preventDefault();
    const m = midiAt(e.clientX, e.clientY);
    if (m === null) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, m);
    onDown?.(m);
  };
  const handleMove = (e: React.PointerEvent) => {
    if (!interactive || !pointers.current.has(e.pointerId)) return;
    const m = midiAt(e.clientX, e.clientY);
    const prev = pointers.current.get(e.pointerId)!;
    if (m !== null && m !== prev) {
      onUp?.(prev);
      pointers.current.set(e.pointerId, m);
      onDown?.(m);
    }
  };
  const handleUp = (e: React.PointerEvent) => {
    const m = pointers.current.get(e.pointerId);
    if (m === undefined) return;
    pointers.current.delete(e.pointerId);
    onUp?.(m);
  };

  const showLabel = (midi: number, black: boolean) => {
    if (black) return false;
    if (labels === 'all') return true;
    if (labels === 'c') return midi % 12 === 0;
    return false;
  };

  return (
    <div
      ref={ref}
      className={'keyboard ' + (interactive ? 'interactive ' : '') + (className ?? '')}
      style={{ height: h }}
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerUp={handleUp}
      onPointerCancel={handleUp}
      role={interactive ? 'group' : undefined}
      aria-label="Teclado"
    >
      <svg width={width} height={h} viewBox={`0 0 ${width} ${h}`}>
        {keys
          .filter((k) => !k.black)
          .map((k) => {
            const mk = marks?.get(k.midi);
            return (
              <g key={k.midi}>
                <rect
                  x={k.x + 0.5}
                  y={0}
                  width={k.w - 1}
                  height={h}
                  rx={Math.min(5, k.w * 0.15)}
                  className="kb-white"
                  style={mk?.fill ? { fill: mk.fill } : undefined}
                />
                {mk?.hint && !mk.fill && (
                  <rect x={k.x + 2} y={h * 0.55} width={k.w - 4} height={h * 0.45 - 2} rx={4} fill={mk.hint} opacity={0.55} />
                )}
                {markMiddleC && k.midi === 60 && (
                  <circle cx={k.x + k.w / 2} cy={h - Math.min(28, k.w * 1.2)} r={Math.max(2, k.w * 0.09)} className="kb-middlec" />
                )}
                {(mk?.label || showLabel(k.midi, false)) && k.w > 11 && (
                  <text
                    x={k.x + k.w / 2}
                    y={h - 7}
                    textAnchor="middle"
                    className="kb-label"
                    style={{ fontSize: Math.max(8, Math.min(13, k.w * 0.42)) }}
                  >
                    {mk?.label ?? (labels === 'c' ? midiName(k.midi, naming) + (Math.floor(k.midi / 12) - 1) : midiName(k.midi, naming))}
                  </text>
                )}
              </g>
            );
          })}
        {keys
          .filter((k) => k.black)
          .map((k) => {
            const mk = marks?.get(k.midi);
            return (
              <g key={k.midi}>
                <rect
                  x={k.x}
                  y={0}
                  width={k.w}
                  height={blackH}
                  rx={Math.min(3, k.w * 0.15)}
                  className="kb-black"
                  style={mk?.fill ? { fill: mk.fill } : undefined}
                />
                {mk?.hint && !mk.fill && (
                  <rect x={k.x + 2} y={blackH * 0.5} width={k.w - 4} height={blackH * 0.5 - 3} rx={3} fill={mk.hint} opacity={0.8} />
                )}
                {mk?.label && k.w > 9 && (
                  <text x={k.x + k.w / 2} y={blackH - 6} textAnchor="middle" className="kb-label kb-label-black" style={{ fontSize: Math.max(7, Math.min(11, k.w * 0.5)) }}>
                    {mk.label}
                  </text>
                )}
              </g>
            );
          })}
      </svg>
    </div>
  );
}

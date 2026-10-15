import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { keyboardLayout } from './keyboardLayout';
import { midiName, type NamingStyle } from '../music/theory';
import type { Hand } from '../music/types';

export interface FallingNote {
  id: string;
  midi: number;
  start: number; // segundos (tempo da música)
  dur: number;
  hand: Hand;
  finger?: number;
  active: boolean; // pertence às mãos praticadas
}

export type FallState = 'ok' | 'bad' | 'missed';

interface Props {
  lo: number;
  hi: number;
  notes: FallingNote[];
  /** tempo atual da música em segundos (lido a cada quadro) */
  timeRef: React.MutableRefObject<number>;
  stateRef?: React.MutableRefObject<Map<string, FallState>>;
  lookahead?: number;
  showNames?: boolean;
  naming?: NamingStyle;
  height?: number;
  /** linhas de compasso (segundos) */
  barTimes?: number[];
}

const HAND_COLORS: Record<Hand, [string, string]> = {
  R: ['#3b82f6', '#1d4ed8'],
  L: ['#f97316', '#c2410c'],
};

export function Waterfall({ lo, hi, notes, timeRef, stateRef, lookahead = 3, showNames, naming = 'solfege', height, barTimes }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 600, h: height ?? 300 });
  const propsRef = useRef({ notes, lo, hi, lookahead, showNames, naming, barTimes });
  propsRef.current = { notes, lo, hi, lookahead, showNames, naming, barTimes };

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: height ?? el.clientHeight ?? 300 }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: height ?? el.clientHeight ?? 300 });
    return () => ro.disconnect();
  }, [height]);

  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.floor(size.w * dpr);
    cv.height = Math.floor(size.h * dpr);
    const ctx = cv.getContext('2d')!;
    let raf = 0;
    const styles = getComputedStyle(cv);
    const bg = styles.getPropertyValue('--wf-bg').trim() || '#0f172a';
    const lane = styles.getPropertyValue('--wf-lane').trim() || 'rgba(255,255,255,0.04)';
    const lineC = styles.getPropertyValue('--wf-line').trim() || 'rgba(255,255,255,0.12)';

    // o desenho das teclas só muda com a faixa/largura: não recalcula a cada quadro
    let layoutKey = '';
    let keys: ReturnType<typeof keyboardLayout> = [];
    let kx = new Map<number, (typeof keys)[number]>();
    const draw = () => {
      const { notes: ns, lo: a, hi: b, lookahead: la, showNames: sn, naming: nm, barTimes: bars } = propsRef.current;
      const W = size.w;
      const H = size.h;
      const t = timeRef.current;
      if (layoutKey !== `${a}|${b}|${W}`) {
        layoutKey = `${a}|${b}|${W}`;
        keys = keyboardLayout(a, b, W);
        kx = new Map(keys.map((k) => [k.midi, k]));
      }
      const pxPerSec = H / la;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);
      // faixas das teclas pretas e linhas de oitava
      for (const k of keys) {
        if (k.black) {
          ctx.fillStyle = lane;
          ctx.fillRect(k.x, 0, k.w, H);
        } else if (k.midi % 12 === 0) {
          ctx.fillStyle = lineC;
          ctx.fillRect(k.x, 0, 1, H);
        }
      }
      // linhas de compasso
      if (bars) {
        ctx.fillStyle = lineC;
        for (const bt of bars) {
          const y = H - (bt - t) * pxPerSec;
          if (y < 0 || y > H) continue;
          ctx.fillRect(0, y, W, 1);
        }
      }
      const st = stateRef?.current;
      for (const n of ns) {
        const y1 = H - (n.start - t) * pxPerSec; // base (início)
        const y0 = H - (n.start + n.dur - t) * pxPerSec; // topo (fim)
        if (y1 < 0 || y0 > H) continue;
        const k = kx.get(n.midi);
        if (!k) continue;
        const s = st?.get(n.id);
        let [c1, c2] = HAND_COLORS[n.hand];
        if (!n.active) {
          c1 = 'rgba(148,163,184,0.35)';
          c2 = 'rgba(148,163,184,0.5)';
        } else if (s === 'ok') {
          c1 = '#22c55e';
          c2 = '#15803d';
        } else if (s === 'missed') {
          c1 = '#94a3b8';
          c2 = '#64748b';
        }
        const pad = k.black ? 1 : 2;
        const x = k.x + pad;
        const w = k.w - pad * 2;
        const h = Math.max(6, y1 - y0 - 2);
        const r = Math.min(6, w / 3);
        const grad = ctx.createLinearGradient(x, 0, x + w, 0);
        grad.addColorStop(0, c1);
        grad.addColorStop(1, c2);
        ctx.fillStyle = grad;
        roundRect(ctx, x, y1 - h, w, h, r);
        ctx.fill();
        if (n.active && w > 12 && h > 16) {
          ctx.fillStyle = 'rgba(255,255,255,0.92)';
          ctx.font = `600 ${Math.min(13, w * 0.5)}px system-ui, sans-serif`;
          ctx.textAlign = 'center';
          const label = sn ? midiName(n.midi, nm) : n.finger ? String(n.finger) : '';
          if (label) ctx.fillText(label, x + w / 2, y1 - 6);
        }
      }
      // linha de toque
      ctx.fillStyle = 'rgba(250,204,21,0.9)';
      ctx.fillRect(0, H - 2, W, 2);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [size, timeRef, stateRef]);

  return (
    <div ref={wrap} className="waterfall" style={{ height: height ?? '100%' }}>
      <canvas ref={canvas} style={{ width: size.w, height: size.h }} />
    </div>
  );
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

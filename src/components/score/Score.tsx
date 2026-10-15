import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Song } from '../../music/types';
import { ensureMusicFonts, renderScore, type ScoreLayout, type ScoreOptions } from './renderScore';

export type NoteMark = 'current' | 'ok' | 'bad' | 'missed' | 'dim' | 'hint';

export interface Ghost {
  id: number;
  midi: number;
  staff: number; // índice da pauta na música
  nearElId: number; // posiciona perto desta nota
  kind: 'wrong' | 'played';
}

interface Props {
  song: Song;
  options?: Partial<ScoreOptions>;
  marks?: Map<number, NoteMark>;
  /** ids das notas do passo atual: desenha o cursor */
  cursorEls?: number[] | null;
  ghosts?: Ghost[];
  loop?: [number, number] | null;
  onMeasureClick?: (measure: number) => void;
  autoScroll?: boolean;
  className?: string;
  minHeight?: number;
}

const MARK_CLASSES: NoteMark[] = ['current', 'ok', 'bad', 'missed', 'dim', 'hint'];

export function Score({
  song,
  options,
  marks,
  cursorEls,
  ghosts,
  loop,
  onMeasureClick,
  autoScroll = true,
  className,
  minHeight,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [layout, setLayout] = useState<ScoreLayout | null>(null);
  const [error, setError] = useState<string | null>(null);
  const optsKey = JSON.stringify(options ?? {});

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = Math.floor(el.clientWidth);
      setWidth((prev) => (Math.abs(prev - w) > 8 ? w : prev));
    });
    ro.observe(el);
    setWidth(Math.floor(el.clientWidth));
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!width || !svgRef.current) return;
    let cancelled = false;
    ensureMusicFonts().then(() => {
      if (cancelled || !svgRef.current) return;
      try {
        const scale = options?.scale ?? (width < 520 ? 0.78 : width < 900 ? 0.9 : 1);
        const l = renderScore(svgRef.current, song, { width, scale, ...options });
        setLayout(l);
        setError(null);
      } catch (e) {
        console.error(e);
        setError(String(e));
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song, width, optsKey]);

  // marcações (cores) nas notas — só mexe nas que mudaram (partituras grandes têm milhares de notas)
  const applied = useRef<{ layout: unknown; marks: Map<number, string> }>({ layout: null, marks: new Map() });
  useEffect(() => {
    if (!layout) return;
    const prev = applied.current.layout === layout ? applied.current.marks : null;
    const next = new Map<number, string>(marks ? [...marks] : []);
    const set = (id: number, m: string | undefined) => {
      const g = layout.notes.get(id)?.group;
      if (!g) return;
      for (const c of MARK_CLASSES) g.classList.toggle('mk-' + c, m === c);
    };
    if (!prev) {
      for (const box of layout.notes.values()) set(box.el.id, next.get(box.el.id));
    } else {
      for (const [id, m] of next) if (prev.get(id) !== m) set(id, m);
      for (const id of prev.keys()) if (!next.has(id)) set(id, undefined);
    }
    applied.current = { layout, marks: next };
  }, [layout, marks]);

  // cursor
  let cursor: { x: number; y: number; h: number } | null = null;
  if (layout && cursorEls?.length) {
    const boxes = cursorEls.map((id) => layout.notes.get(id)).filter((b) => !!b);
    if (boxes.length) {
      const sys = layout.systems[boxes[0]!.system];
      cursor = { x: Math.min(...boxes.map((b) => b!.x)), y: sys.y, h: sys.height };
    }
  }

  // rolagem automática para o sistema atual
  const curSystem = cursor ? cursor.y : null;
  useEffect(() => {
    if (!autoScroll || curSystem === null || !wrapRef.current) return;
    const scroller = findScrollParent(wrapRef.current);
    if (!scroller) return;
    const wrapTop = wrapRef.current.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    const target = wrapTop + curSystem - 20;
    const viewTop = scroller.scrollTop;
    const viewH = scroller.clientHeight;
    if (target < viewTop + 10 || target + 160 > viewTop + viewH) {
      scroller.scrollTo({ top: Math.max(0, target - 10), behavior: 'smooth' });
    }
  }, [curSystem, autoScroll]);

  const loopBoxes =
    layout && loop
      ? [...layout.measures.values()].filter((m) => m.index >= loop[0] && m.index <= loop[1])
      : [];

  return (
    <div ref={wrapRef} className={'score ' + (className ?? '')} style={{ minHeight }}>
      <div className="score-inner" style={{ height: layout?.height, width: layout?.width }}>
        {loopBoxes.map((m) => {
          const sys = layout!.systems[m.system];
          return (
            <div
              key={'loop' + m.index}
              className="score-loop"
              style={{ left: m.x, top: sys.y, width: m.width, height: sys.height }}
            />
          );
        })}
        {cursor && (
          <div className="score-cursor" style={{ transform: `translate(${cursor.x - 14}px, ${cursor.y}px)`, height: cursor.h }} />
        )}
        <div ref={svgRef} className="score-svg-wrap" />
        {layout &&
          ghosts?.map((g) => {
            const near = layout.notes.get(g.nearElId);
            const pos = layout.staffIndices.indexOf(g.staff);
            if (!near || pos < 0) return null;
            const y = layout.yForMidi(near.system, pos, g.midi);
            return (
              <div
                key={g.id}
                className={'score-ghost ghost-' + g.kind}
                style={{ left: near.x + 16 * layout.scale, top: y, width: 11 * layout.scale, height: 9 * layout.scale }}
              />
            );
          })}
        {layout && onMeasureClick &&
          [...layout.measures.values()].map((m) => {
            const sys = layout.systems[m.system];
            return (
              <button
                key={'mc' + m.index}
                className="score-measure-hit"
                aria-label={`Compasso ${m.index + 1}`}
                style={{ left: m.x, top: sys.y, width: m.width, height: sys.height }}
                onClick={() => onMeasureClick(m.index)}
              />
            );
          })}
      </div>
      {error && <div className="score-error">Não foi possível desenhar a partitura: {error}</div>}
    </div>
  );
}

function findScrollParent(el: HTMLElement): HTMLElement | null {
  let p: HTMLElement | null = el.parentElement;
  while (p) {
    const s = getComputedStyle(p);
    if (/(auto|scroll)/.test(s.overflowY) && p.scrollHeight > p.clientHeight) return p;
    p = p.parentElement;
  }
  return document.scrollingElement as HTMLElement | null;
}

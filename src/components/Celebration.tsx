import { useEffect, useMemo, useState } from 'react';
import { onCelebrate, type Celebration } from '../state/gamification';
import { onBadges } from '../state/progress';
import { ACHIEVEMENTS } from '../data/achievements';

const COLORS = ['#4f46e5', '#ec4899', '#f59e0b', '#22c55e', '#3b82f6', '#f97316'];

/** Confete leve em CSS (some sozinho; respeita "reduzir movimento"). */
export function Confetti({ pieces = 36 }: { pieces?: number }) {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setOn(false), 2600);
    return () => clearTimeout(t);
  }, []);
  const items = useMemo(
    () =>
      Array.from({ length: pieces }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 0.5,
        dur: 1.6 + Math.random() * 0.9,
        rot: Math.random() * 360,
        color: COLORS[i % COLORS.length],
        w: 6 + Math.random() * 6,
      })),
    [pieces],
  );
  if (!on) return null;
  return (
    <div className="confetti" aria-hidden>
      {items.map((c, i) => (
        <i
          key={i}
          style={{
            left: `${c.left}%`,
            animationDelay: `${c.delay}s`,
            animationDuration: `${c.dur}s`,
            background: c.color,
            width: c.w,
            height: c.w * 0.45,
            transform: `rotate(${c.rot}deg)`,
          }}
        />
      ))}
    </div>
  );
}

type Item = (Celebration | { kind: 'badge'; icon: string; title: string; desc: string; confetti?: boolean }) & { key: number; label?: string };

/** Avisos de medalha, nível, missão cumprida e meta do dia (fila, um por vez). */
export function CelebrationToast() {
  const [queue, setQueue] = useState<Item[]>([]);
  useEffect(() => onCelebrate((c) => setQueue((q) => [...q, { ...c, key: Date.now() + Math.random() }])), []);
  useEffect(
    () =>
      onBadges((ids) =>
        setQueue((q) => [
          ...q,
          ...ids
            .map((id) => ACHIEVEMENTS.find((a) => a.id === id))
            .filter((a): a is NonNullable<typeof a> => !!a)
            .map((a) => ({ kind: 'badge' as const, icon: a.icon, title: a.title, desc: a.desc, label: 'Nova medalha!', key: Date.now() + Math.random() })),
        ]),
      ),
    [],
  );
  const cur = queue[0];
  useEffect(() => {
    if (!cur) return;
    const t = setTimeout(() => setQueue((q) => q.slice(1)), cur.kind === 'quest' ? 3200 : 4500);
    return () => clearTimeout(t);
  }, [cur]);
  if (!cur) return null;
  return (
    <>
      {cur.confetti && <Confetti key={cur.key} />}
      <div key={cur.key} className={'badge-toast celebrate is-' + cur.kind} role="status" onClick={() => setQueue((q) => q.slice(1))}>
        <span className="ic">{cur.icon}</span>
        <div>
          {cur.label && <div className="tiny muted upper">{cur.label}</div>}
          <b>{cur.title}</b>
          <div className="small muted">{cur.desc}</div>
        </div>
      </div>
    </>
  );
}

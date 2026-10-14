import { useEffect, useState } from 'react';
import { onBadges } from '../state/progress';
import { ACHIEVEMENTS } from '../data/achievements';

/** Aviso flutuante quando o usuário ganha uma medalha. */
export function BadgeToast() {
  const [queue, setQueue] = useState<string[]>([]);
  useEffect(() => onBadges((ids) => setQueue((q) => [...q, ...ids])), []);
  useEffect(() => {
    if (!queue.length) return;
    const t = setTimeout(() => setQueue((q) => q.slice(1)), 4200);
    return () => clearTimeout(t);
  }, [queue]);
  const a = ACHIEVEMENTS.find((x) => x.id === queue[0]);
  if (!a) return null;
  return (
    <div className="badge-toast" role="status" onClick={() => setQueue((q) => q.slice(1))}>
      <span className="ic">{a.icon}</span>
      <div>
        <div className="tiny muted" style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Nova medalha!
        </div>
        <b>{a.title}</b>
        <div className="small muted">{a.desc}</div>
      </div>
    </div>
  );
}

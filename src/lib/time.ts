/** Formatação de datas curtas em português. */

export function timeAgo(ms: number): string {
  const s = Math.max(1, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return 'agora';
  const m = Math.round(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? 'ontem' : `há ${d} dias`;
}

export function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function dayStart(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** "Hoje", "Ontem", "segunda-feira" (última semana) ou "12 de out." */
export function dayLabel(ms: number): string {
  const diff = Math.round((dayStart(Date.now()) - dayStart(ms)) / 86400000);
  if (diff <= 0) return 'Hoje';
  if (diff === 1) return 'Ontem';
  if (diff < 7) {
    const w = new Date(ms).toLocaleDateString('pt-BR', { weekday: 'long' });
    return w.charAt(0).toUpperCase() + w.slice(1);
  }
  return new Date(ms).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: diff > 300 ? 'numeric' : undefined });
}

export function sameDay(a: number, b: number): boolean {
  return dayStart(a) === dayStart(b);
}

/** Hora (hoje), "Ontem" ou data curta — para listas de conversas. */
export function shortWhen(ms: number): string {
  if (!ms) return '';
  const diff = Math.round((dayStart(Date.now()) - dayStart(ms)) / 86400000);
  if (diff <= 0) return clock(ms);
  if (diff === 1) return 'Ontem';
  if (diff < 7) return new Date(ms).toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
  return new Date(ms).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

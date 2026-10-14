// Ícones em SVG (traço) — sem dependências externas.
const P: Record<string, string> = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  path: 'M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6 15V9a3 3 0 0 1 3-3h7M18 9v6a3 3 0 0 1-3 3H8',
  music: 'M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  mic: 'M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3zM19 11a7 7 0 0 1-14 0M12 18v3',
  micOff: 'M2 2l20 20M9 9v3a3 3 0 0 0 5.1 2.1M15 9.3V6a3 3 0 0 0-5.9-.8M19 11a7 7 0 0 1-1.2 3.9M5 11a7 7 0 0 0 11.3 5.5M12 18v3',
  play: 'M7 4v16l13-8z',
  pause: 'M7 4h3v16H7zM14 4h3v16h-3z',
  back: 'M15 18l-6-6 6-6',
  next: 'M9 18l6-6-6-6',
  restart: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5',
  loop: 'M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3',
  eye: 'M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  ear: 'M6 8.5a6 6 0 0 1 12 0c0 3-2 4-3 5.5S14 17 13 19a3 3 0 0 1-5.5-1M9 9a3 3 0 0 1 6 0',
  star: 'M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  check: 'M20 6 9 17l-5-5',
  x: 'M18 6 6 18M6 6l12 12',
  book: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5zM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5',
  metronome: 'M7 21h10L14.5 3h-5zM12 15l5-9M9 17h6',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6',
  hand: 'M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8a8 8 0 0 0 8 8h1a7 7 0 0 0 7-7v-3a2 2 0 0 0-4 0',
  keys: 'M3 5h18v14H3zM8 5v8M13 5v8M18 5v8M8 13v6M13 13v6M18 13v6',
  fire: 'M12 22c4 0 7-3 7-7 0-5-5-7-5-12-3 2-6 6-6 9-1-1-2-2-2-4-1 2-1 4-1 7 0 4 3 7 7 7z',
  sheet: 'M3 6h18M3 10h18M3 14h18M3 18h18M9 4v12',
  waterfall: 'M5 3v8M10 3v12M15 3v6M20 3v10M2 21h20',
  sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 17l.8 2.2L22 20l-2.2.8L19 23l-.8-2.2L16 20l2.2-.8z',
  cloud: 'M17.5 19a4.5 4.5 0 1 0-1.4-8.8A6 6 0 0 0 4 12a4 4 0 0 0 1 7.9z',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-5M12 8h.01',
  plus: 'M12 5v14M5 12h14',
  volume: 'M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14',
};

export type IconName = keyof typeof P;

export function Icon({ name, size, className, fill }: { name: IconName; size?: number; className?: string; fill?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill={fill ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={fill ? 0 : 2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={P[name]} />
    </svg>
  );
}

export function Stars({ n, max = 3 }: { n: number; max?: number }) {
  return (
    <span className="stars" aria-label={`${n} de ${max} estrelas`}>
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={i < n ? 'on' : ''}>
          <Icon name="star" fill />
        </span>
      ))}
    </span>
  );
}

export function LevelDots({ level }: { level: number }) {
  return (
    <span className="level-dots" aria-label={`Nível ${level}`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <i key={i} className={i <= level ? 'on' : ''} />
      ))}
    </span>
  );
}

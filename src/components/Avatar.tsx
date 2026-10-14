export const AVATARS = ['🎹', '🎵', '🎶', '🎼', '🎸', '🎺', '🥁', '🎻', '🦊', '🐱', '🐼', '🐸', '🦉', '🐙', '🌟', '🔥', '🌈', '🚀', '🍀', '☕'];

const COLORS = ['#4f46e5', '#db2777', '#0d9488', '#ea580c', '#7c3aed', '#2563eb', '#16a34a', '#dc2626'];

function colorFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return COLORS[Math.abs(h) % COLORS.length];
}

/** Avatar: emoji escolhido > foto da conta Google > iniciais. */
export function Avatar({ name, photo, avatar, seed, size = 40 }: { name: string; photo?: string; avatar?: string; seed?: string; size?: number }) {
  const style = { width: size, height: size, fontSize: avatar ? size * 0.55 : size * 0.4 };
  if (avatar)
    return (
      <span className="avatar emoji" style={style} aria-label={name}>
        {avatar}
      </span>
    );
  if (photo) return <img className="avatar" src={photo} alt={name} style={style} referrerPolicy="no-referrer" />;
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join('') || '?';
  return (
    <span className="avatar" style={{ ...style, background: colorFor(seed ?? name) }} aria-label={name}>
      {initials}
    </span>
  );
}

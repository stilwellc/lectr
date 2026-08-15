'use client';

/**
 * ArtistAvatar — the list anchor (the Coinbase move): every artist gets a
 * consistent circular monogram with a deterministic, muted hue. Neutral
 * slates/bronzes only — green and red stay reserved for market state.
 */
const HUES = [215, 245, 195, 30, 270, 165, 45, 330]; // muted blues/violets/bronze

export default function ArtistAvatar({ label, size = 28 }: { label: string; size?: number }) {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = ((h << 5) - h + label.charCodeAt(i)) | 0;
  const hue = HUES[Math.abs(h) % HUES.length];
  const initials = label
    .split(/[\s&]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0])
    .join('')
    .toUpperCase();
  return (
    <span
      className="ray-avatar"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.38),
        ['--av-bg' as string]: `hsl(${hue}, 16%, 18%)`,
        color: `hsl(${hue}, 22%, 72%)`,
      }}
    >
      {initials}
    </span>
  );
}

'use client';

/**
 * MarketTape — a slow full-bleed ribbon of the market's biggest recent hammers,
 * so the page opens on money actually moving rather than a static headline. The
 * track is duplicated for a seamless loop; hover pauses it. All styling lives in
 * globals.css (a real stylesheet) so no raw-text <style> hydration traps apply.
 */
export type TapeItem = { artist: string; title: string; price: string; house: string };

export default function MarketTape({ items }: { items: TapeItem[] }) {
  if (!items.length) return null;
  const loop = [...items, ...items];
  return (
    <div className="ray-tape" aria-hidden="true">
      <div className="ray-tape-track">
        {loop.map((it, i) => (
          <span className="ray-tape-item" key={i}>
            <span className="ray-tape-artist">{it.artist}</span>
            <span className="ray-tape-title">{it.title}</span>
            <span className="ray-tape-price">{it.price}</span>
            <span className="ray-tape-house">{it.house}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

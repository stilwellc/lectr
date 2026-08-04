'use client';

import { useEffect, useState, type ImgHTMLAttributes } from 'react';

/**
 * PLATE IMG — a hotlinked photo that hangs OVER a monogram plate and vanishes
 * the moment it fails, so the letter behind it is always what the reader sees.
 *
 * The old `onError={e => e.currentTarget.remove()}` covered exactly one of the
 * three ways a remote auction image dies:
 *   (a) the host 404s / refuses the connection → `error` fires (covered).
 *   (b) the browser blocks the response before it ever becomes an image —
 *       ORB / cross-origin hotlink policy (christies.com does this: 200 to
 *       curl with a real UA, silently dropped in the page). No `error` event,
 *       no failed request in the network panel; the element is simply
 *       `complete` with `naturalWidth === 0` by the time it attaches.
 *   (c) the same block resolved late: `load` fires, still zero naturalWidth.
 *
 * Checking `complete && naturalWidth === 0` at attach plus on load catches
 * (b) and (c). Unmounting the <img> — rather than leaving it transparent —
 * guarantees the monogram is never sitting under an opaque dead element.
 * (Pattern lifted from RecordPlate.tsx.)
 */
export default function PlateImg({ src, ...rest }: ImgHTMLAttributes<HTMLImageElement> & { src?: string }) {
  const [ok, setOk] = useState(true);
  // a dead hotlink on one row must not blank the next when the list re-keys
  useEffect(() => { setOk(true); }, [src]);
  if (!src || !ok) return null;
  return (
    <img
      {...rest}
      src={src}
      onError={() => setOk(false)}
      onLoad={e => { if (e.currentTarget.naturalWidth === 0) setOk(false); }}
      ref={el => { if (el && el.complete && el.naturalWidth === 0) setOk(false); }}
    />
  );
}

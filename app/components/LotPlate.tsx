'use client';

import { useState, type ReactNode } from 'react';
import { httpsImg, sizedImg } from '../utils';
import styles from './LotPlate.module.css';

/**
 * LOT PLATE — the one spec for a lot photograph (docs/NORTHSTAR_UI.md §0.4).
 *
 *   a cream mat · 4:5 unless the surface says otherwise · hairline edge
 *   the object at 80% of the mat (contain), centred, multiply-blended so a
 *     white studio ground falls into the mat
 *   NO scrims, gradients or overlays on the photograph
 *   an optional FIG. caption beneath: gold "FIG. n", then Plex muted text
 *   a dead hotlink (error, or the silent ORB block: complete with zero
 *     naturalWidth) unmounts the <img> and the maker's initial shows
 *
 * Any surface that hangs a lot photograph adopts this component rather than
 * re-deriving the mat; pass `ratio` for a landscape well, `size` for the
 * resizer rung (defaults to a 720px rung — never the 2880px master).
 */
export default function LotPlate({
  src,
  monogram,
  fig,
  caption,
  ratio = '4 / 5',
  size = 720,
  eager = false,
  className,
}: {
  src?: string | null;
  /** the letter shown when there is no photograph (maker initial) */
  monogram?: string;
  /** FIG. number — omit for no caption label */
  fig?: number;
  caption?: ReactNode;
  /** CSS aspect-ratio of the mat */
  ratio?: string;
  /** image resizer rung, px */
  size?: number;
  /** the hero plate is the LCP — load it eagerly */
  eager?: boolean;
  className?: string;
}) {
  const url = (src ? sizedImg(httpsImg(src), size) : '') || '';
  // keyed by url, so a re-keyed list never inherits the previous lot's state
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const loaded = loadedUrl === url;
  const showImg = !!url && failedUrl !== url;
  const setOk = (v: boolean) => { if (!v) setFailedUrl(url); };
  const setLoaded = (v: boolean) => { if (v) setLoadedUrl(url); };

  return (
    <figure className={`${styles.plate}${className ? ` ${className}` : ''}`}>
      <div className={styles.mat} style={{ aspectRatio: ratio }}>
        {(!showImg || !loaded) && (
          <span className={styles.mono} aria-hidden>{(monogram || '').trim().charAt(0).toUpperCase()}</span>
        )}
        {showImg && (
          <img
            className={styles.img}
            src={url}
            alt=""
            loading={eager ? 'eager' : 'lazy'}
            // the LCP hint only for the hero plate
            {...(eager ? { fetchPriority: 'high' as const } : {})}
            decoding="async"
            referrerPolicy="no-referrer"
            data-loaded={loaded ? 'true' : undefined}
            onError={() => setOk(false)}
            onLoad={e => { if (e.currentTarget.naturalWidth === 0) setOk(false); else setLoaded(true); }}
            ref={el => {
              if (!el || !el.complete) return;
              if (el.naturalWidth === 0) setOk(false);
              else if (!loaded) setLoaded(true);
            }}
          />
        )}
      </div>
      {(fig != null || caption) && (
        <figcaption className={styles.cap}>
          {fig != null && <span className={styles.fig}>FIG. {fig}</span>}
          {caption && <span className={styles.capText}>{caption}</span>}
        </figcaption>
      )}
    </figure>
  );
}

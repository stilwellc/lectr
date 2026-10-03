'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useNow } from '../lib/closing';
import { asOfLabel, houseAsOfMap, staleHouses, usePipelineStatus } from '../lib/house-status';

/**
 * HouseAsOf — the per-house freshness note, printed wherever live lots of a
 * house are listed. Silent while every listed house was read within 36h;
 * otherwise one quiet line naming each stale house and when it was last read,
 * linking to /status. Renders nothing before mount (the clock is the
 * reader's, never the build's).
 */
export default function HouseAsOf({ lots, style }: {
  lots: ReadonlyArray<{ auctionHouse?: string | null; lastSeen?: string | null }>;
  style?: React.CSSProperties;
}) {
  const now = useNow();
  const status = usePipelineStatus();
  const stale = useMemo(() => {
    if (now == null || status === undefined) return [];
    const map = houseAsOfMap(status, lots);
    const houses = lots.map(l => l.auctionHouse).filter((h): h is string => !!h);
    return staleHouses(map, houses, now);
  }, [now, status, lots]);
  if (!stale.length) return null;
  return (
    <p
      role="note"
      style={{
        margin: '8px 0 0', fontSize: 12, lineHeight: 1.5, color: 'var(--color-text-muted)',
        display: 'flex', flexWrap: 'wrap', gap: '2px 10px', alignItems: 'baseline', ...style,
      }}
    >
      <span>
        {stale.map((s, i) => (
          <span key={s.house}>
            {i > 0 ? ' · ' : ''}
            <span style={{ color: 'var(--color-fg)', fontWeight: 500 }}>{s.house}</span> lots as of {asOfLabel(s.asOf)}
          </span>
        ))}
        {' '}— bids and closes for {stale.length === 1 ? 'this house' : 'these houses'} may have moved since.
      </span>
      <Link href="/status" style={{ color: 'var(--color-text-muted)', textDecoration: 'underline', textUnderlineOffset: 3 }}>
        Data status
      </Link>
    </p>
  );
}

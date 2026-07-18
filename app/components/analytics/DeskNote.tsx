'use client';

import Link from 'next/link';
import Flick from '../Flick';
import type { Market } from '../../constants';
import { MARKETS } from '../../constants';

/** current-quarter desk notes, per market — update when new notes publish;
 *  a market absent from the map (and 'all') shows nothing */
const NOTE_SLUG: Partial<Record<Market, string>> = {
  art: 'q2-2026-art',
  design: 'q2-2026-design',
  watches: 'q2-2026-watches',
  sports: 'q2-2026-sports',
  science: 'q2-2026-science',
};

/**
 * DeskNote — a one-line cross-link to the market's current-quarter note from
 * the desk. Mounted under the analytics masthead and on maker heroes.
 */
export default function DeskNote({ market, style }: { market: Market; style?: React.CSSProperties }) {
  const slug = NOTE_SLUG[market];
  if (!slug) return null;
  const label = MARKETS.find(m => m.key === market)?.label || market;
  return (
    <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: 0, ...style }}>
      Notes from the desk:{' '}
      <Link
        href={`/blog/${slug}`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          color: 'var(--color-fg)',
          fontWeight: 600,
          textDecoration: 'none',
        }}
      >
        {label} in Q2 <Flick size={11} />
      </Link>
    </p>
  );
}

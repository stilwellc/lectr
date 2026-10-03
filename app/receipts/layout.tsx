import type { Metadata } from 'next';
import backtest from '../../public/data/ray/backtest.json';
import { n, shareMeta } from '../lib/og-meta';

// Figures from the shipped backtest; the card (public/og/live/record.png) is
// drawn from the same file by scripts/build-og.tsx.
const B = backtest as { flagged?: { n?: number; hammerMedianPct?: number }; unflagged?: { hammerMedianPct?: number } };
const sp = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v)}%`;
const fl = B.flagged?.hammerMedianPct, un = B.unflagged?.hammerMedianPct;

export const metadata: Metadata = shareMeta({
  title: 'The record — calls graded against the hammer',
  description: `${B.flagged?.n ? `${n(B.flagged.n)} flagged calls` : 'Flagged calls'} replayed against the price each lot actually made${fl != null && un != null ? `: flagged lots hammered a median ${sp(fl)} against their estimate, the rest ${sp(un)}` : ''}. Calls are logged the night they are made; misses print exactly like hits.`,
  image: '/og/live/record.png',
});

export default function ReceiptsLayout({ children }: { children: React.ReactNode }) {
  return children;
}

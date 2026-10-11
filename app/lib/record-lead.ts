/**
 * record-lead.ts — THE RECORD, one figure, one label (r8, Oct 10 2026).
 *
 * QA3 N10: /analytics led "The record" with +32% (the all-in median,
 * unlabelled) while /value led with +5% (hammer vs estimate, all-in in the
 * sub). Every surface that prints the record's headline figure takes it from
 * recordLead: the HAMMER median when the replay publishes one (the basis the
 * Flags are called on), all-in in the sub; the all-in median, labelled, when
 * it does not; a market-scoped all-in median where the build published one
 * (n ≥ 50) and the caller asked for that scope.
 */
import { fmtSignedPct } from '../utils';
import { MARKETS } from '../constants';

export interface RecordLike {
  flagged: { n: number; medianPerfPct: number; hammerMedianPct?: number | null };
  byMarket?: Record<string, { flagged: { n: number; medPct: number | null } }>;
}

export interface RecordLead {
  pct: number;
  basis: 'hammer' | 'all-in';
  n: number;
  /** the market the figure is scoped to (null = every market) */
  scope: string | null;
  /** "hammer vs estimate · all-in +32% · n 9,399" */
  sub: string;
}

/** the record publishes at this many replayed flags */
export const RECORD_MIN_N = 100;

export function recordLead(bt: RecordLike | null | undefined, scope?: { key: string; label: string } | null): RecordLead | null {
  if (!bt?.flagged) return null;
  if (scope && scope.key !== 'all') {
    const s = bt.byMarket?.[scope.key]?.flagged;
    if (s?.medPct != null && s.n >= 50) {
      return { pct: s.medPct, basis: 'all-in', n: s.n, scope: scope.key, sub: `${scope.label} flags realized vs estimate, all-in, bought-ins counted · n\u00a0${s.n.toLocaleString()}` };
    }
  }
  const F = bt.flagged;
  if (!(F.n >= RECORD_MIN_N)) return null;
  if (F.hammerMedianPct != null) {
    return { pct: F.hammerMedianPct, basis: 'hammer', n: F.n, scope: null, sub: `hammer vs estimate · all-in ${fmtSignedPct(F.medianPerfPct)} · n\u00a0${F.n.toLocaleString()}` };
  }
  return { pct: F.medianPerfPct, basis: 'all-in', n: F.n, scope: null, sub: `realized vs estimate, all-in, bought-ins counted · n\u00a0${F.n.toLocaleString()}` };
}

/** the scope a market page asks the record for — /value's and /analytics' one label */
export function recordScope(key: string): { key: string; label: string } {
  const label = key === 'all' ? 'collectible' : key === 'tcg' ? 'TCG' : (MARKETS.find(m => m.key === key)?.label || key).toLowerCase();
  return { key, label };
}

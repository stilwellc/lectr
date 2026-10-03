'use client';

/**
 * RefList — the whole reference book for one maker (or every maker), as a
 * filterable, sortable list of links into /ref/<maker>/<key>. Replaces the
 * "deepest 8" ledger: every reference with a dossier is reachable, a filter
 * finds '5711' or 'nautilus' in one keystroke, and the label is always the
 * display name (never the run-together refs.json key). Rows that share a
 * display label are merged (ref-book.ts) — the deeper dossier keeps the row.
 */
import React, { useId, useMemo, useState } from 'react';
import Link from 'next/link';
import { ARTIST_LABEL } from '../constants';
import { foldText, refCompact } from '../lib/search-tokens';
import { encodeRefPath } from './ref-path';
import { dedupeRefs } from './ref-book';

export interface RefListRow {
  key?: string; maker: string; ref: string; n: number; med: number;
  /** a measured past-year move, already gated by the caller (else null) */
  ttm?: number | null;
  houses?: number;
}

type Sort = 'n' | 'ref' | 'med';

const fmt = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `$${Math.round(n / 1000)}K` : `$${Math.round(n).toLocaleString()}`;

export const REFLIST_CSS = `
.rl-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.rl-tools{display:flex;flex-wrap:wrap;gap:10px 14px;align-items:center;margin:14px 0 10px}
.rl-filter{flex:1 1 220px;min-width:0;max-width:360px;height:38px;padding:0 14px;border-radius:999px;border:1px solid var(--color-border-mid);background:var(--color-surface,transparent);color:var(--color-fg);font:inherit;font-size:14px}
.rl-filter::placeholder{color:var(--color-text-muted)}
.rl-filter:focus-visible{outline:2px solid var(--color-fg);outline-offset:2px}
.rl-sort{display:inline-flex;gap:4px;flex-wrap:wrap}
.rl-sort button{min-height:32px;padding:0 12px;border-radius:999px;border:1px solid transparent;background:none;color:var(--color-text-secondary);font:inherit;font-size:13px;cursor:pointer}
.rl-sort button[aria-pressed=true]{border-color:var(--color-border-mid);color:var(--color-fg)}
.rl-sort button:hover{color:var(--color-fg)}
.rl-rows{border-top:1px solid var(--color-border)}
.rl-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:4px 18px;align-items:baseline;min-height:44px;padding:10px 2px;border-bottom:1px dotted var(--color-border-mid);color:var(--color-fg);text-decoration:none}
.rl-row:hover{background:var(--color-butter-subtle,rgba(0,0,0,.03))}
.rl-row:focus-visible{outline:2px solid var(--color-fg);outline-offset:-2px;border-radius:4px}
.rl-name{font-size:14.5px;min-width:0;overflow-wrap:anywhere}
.rl-sub{display:block;font-size:12px;color:var(--color-text-muted);margin-top:2px}
.rl-val{font-size:14px;font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
.rl-tag{font-size:12px;margin-left:6px}
.rl-meta{font-size:12px;color:var(--color-text-muted);text-align:right;white-space:nowrap;min-width:64px}
.rl-foot{display:flex;flex-wrap:wrap;gap:10px 16px;align-items:center;margin-top:12px;font-size:12.5px;color:var(--color-text-muted)}
.rl-more{min-height:36px;padding:0 16px;border-radius:999px;border:1px solid var(--color-border-mid);background:none;color:var(--color-fg);font:inherit;font-size:13px;cursor:pointer}
.rl-more:hover{background:var(--color-butter-subtle,rgba(0,0,0,.04))}
@media (max-width:640px){.rl-row{grid-template-columns:minmax(0,1fr) auto}.rl-meta{display:none}}
`;

export default function RefList({ rows, showMaker = false, initial = 30, name = 'references' }: {
  rows: RefListRow[];
  /** print the maker beside each reference (the all-makers directory) */
  showMaker?: boolean;
  /** rows shown before "Show all" — the filter always searches everything */
  initial?: number;
  name?: string;
}) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('n');
  const [all, setAll] = useState(false);
  const inputId = useId();
  const book = useMemo(() => dedupeRefs(rows), [rows]);
  const filtered = useMemo(() => {
    const f = foldText(q.trim());
    const fc = refCompact(q);
    const words = f.split(/\s+/).filter(Boolean);
    const hit = book.filter(r => {
      if (!f) return true;
      if (fc && refCompact(r.ref).startsWith(fc)) return true;
      const hay = foldText(`${r.label} ${r.ref} ${showMaker ? ARTIST_LABEL[r.maker] || r.maker : ''}`);
      return words.every(w => hay.includes(w));
    });
    const cmp: Record<Sort, (a: typeof hit[number], b: typeof hit[number]) => number> = {
      n: (a, b) => b.n - a.n,
      med: (a, b) => b.med - a.med,
      ref: (a, b) => a.label.localeCompare(b.label, 'en', { numeric: true }),
    };
    return hit.sort(cmp[sort]);
  }, [book, q, sort, showMaker]);
  const shown = all || q.trim() ? filtered : filtered.slice(0, initial);

  return (
    <div>
      <style href="rl-reflist" precedence="default">{REFLIST_CSS}</style>
      <div className="rl-tools">
        <label htmlFor={inputId} className="rl-sr">Filter {name}</label>
        <input
          id={inputId}
          className="rl-filter"
          type="search"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder={`Filter ${book.length.toLocaleString()} ${name} — 5711, Nautilus…`}
          autoComplete="off"
          spellCheck={false}
        />
        <div className="rl-sort" role="group" aria-label="Sort references">
          {([['n', 'Most sales'], ['ref', 'A–Z'], ['med', 'Highest median']] as [Sort, string][]).map(([k, l]) => (
            <button key={k} type="button" aria-pressed={sort === k} onClick={() => setSort(k)}>{l}</button>
          ))}
        </div>
      </div>
      <div className="rl-rows">
        {shown.map(r => (
          <Link key={`${r.maker}:${r.ref}`} href={`/ref/${r.maker}/${encodeRefPath(r.ref)}`} className="rl-row">
            <span className="rl-name">
              {showMaker && <>{ARTIST_LABEL[r.maker] || r.maker} </>}{r.label}
              <span className="rl-sub">
                {r.n.toLocaleString()} sales
                {r.variants.length > 0 && <> · also {r.variants.map(v => `${v.n.toLocaleString()} under “${v.ref}”`).join(', ')}</>}
              </span>
            </span>
            <span className="rl-val">
              {fmt(r.med)}
              {r.ttm != null && Math.abs(r.ttm) >= 1 && (
                <span className="rl-tag" style={{ color: r.ttm >= 0 ? 'var(--color-up)' : 'var(--color-down-text)' }}>
                  {r.ttm >= 0 ? '+' : '−'}{Math.abs(r.ttm).toFixed(0)}% past year
                </span>
              )}
            </span>
            <span className="rl-meta">{r.houses != null ? `${r.houses} ${r.houses === 1 ? 'house' : 'houses'}` : 'median'}</span>
          </Link>
        ))}
        {!shown.length && <p className="nsp-note" style={{ padding: '14px 2px' }}>No reference matches &ldquo;{q}&rdquo;.</p>}
      </div>
      <div className="rl-foot">
        <span aria-live="polite">
          {q.trim()
            ? `${filtered.length.toLocaleString()} of ${book.length.toLocaleString()} ${name}`
            : `${shown.length.toLocaleString()} of ${book.length.toLocaleString()} ${name}`}
        </span>
        {!all && !q.trim() && filtered.length > initial && (
          <button type="button" className="rl-more" onClick={() => setAll(true)}>Show all {filtered.length.toLocaleString()} {name}</button>
        )}
      </div>
    </div>
  );
}

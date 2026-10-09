'use client';
/**
 * TriageBar — the compact triage row for /value and /makers (Oct 8): closing
 * window, "new since last visit", the clean sub-categories present in the
 * current pool, house and value floor. Same pills/selects as the home feed's
 * FeedToolbar so the three pages read as one system. Counts come from `lots`
 * (the page's live pool for the current market) so a chip never offers an
 * empty cut.
 */
import { useMemo } from 'react';
import { taxonOf, SUBS, CAT_LABEL, type CatKey } from '../lib/taxonomy';
import FollowChip from './FollowChip';
import { catFollow, houseFollow } from '../lib/follows';
import {
  WINDOWS, VALUE_FLOORS, TRIAGE_DEFAULTS, isTriageActive, passesTriage, type TriageFilters,
} from '../lib/feed-filters';

type TriageLot = Parameters<typeof passesTriage>[0];

const fmtFloor = (n: number) => (n >= 1000 ? `$${n / 1000}K+` : `$${n}+`);

export default function TriageBar({
  lots, filters, onChange, prevVisitDay = null, shown, total, showSubs = true, label = 'Narrow the board',
}: {
  lots: TriageLot[];
  filters: TriageFilters;
  onChange: (next: TriageFilters) => void;
  prevVisitDay?: string | null;
  /** optional "N of M" read-out */
  shown?: number;
  total?: number;
  /** hide the sub-category chips (a page that already groups by them) */
  showSubs?: boolean;
  label?: string;
}) {
  const set = (patch: Partial<TriageFilters>) => onChange({ ...filters, ...patch });

  // Chips adapt to the pool: a pool spanning 3+ clean categories (the total
  // market) gets CATEGORY chips; inside one or two (a single market — sports
  // is cards + memorabilia) it gets that market's SUB-category chips. Once a
  // category chip is picked, its subs appear so the reader can go one deeper.
  const chips = useMemo(() => {
    const byCat = new Map<CatKey, number>();
    const bySub = new Map<string, number>();
    for (const l of lots) {
      const t = taxonOf(l);
      byCat.set(t.cat, (byCat.get(t.cat) || 0) + 1);
      const k = `${t.cat}:${t.sub}`; bySub.set(k, (bySub.get(k) || 0) + 1);
    }
    const subChips = (only?: CatKey) => Array.from(bySub.entries())
      .filter(([k]) => !only || k.startsWith(`${only}:`))
      .map(([key, n]) => {
        const [cat, sub] = key.split(':') as [CatKey, string];
        const sl = SUBS[cat].find(x => x.key === sub)?.label ?? sub;
        return { key, cat, sub: sub as string | null, label: !only && byCat.size > 1 && cat === 'sports-cards' ? `Cards · ${sl}` : sl, n };
      }).sort((a, b) => b.n - a.n);
    if (byCat.size <= 2) return { level: 'sub' as const, items: subChips() };
    const cats = Array.from(byCat.entries()).sort((a, b) => b[1] - a[1])
      .map(([cat, n]) => ({ key: `${cat}:`, cat, sub: null as string | null, label: CAT_LABEL[cat], n }));
    return { level: 'cat' as const, items: cats, deeper: filters.cat ? subChips(filters.cat) : [] };
  }, [lots, filters.cat]);
  const houses = useMemo(() => {
    const c = new Map<string, number>();
    for (const l of lots) { const h = String((l as { auctionHouse?: string }).auctionHouse || ''); if (h) c.set(h, (c.get(h) || 0) + 1); }
    return Array.from(c.entries()).sort((a, b) => b[1] - a[1]);
  }, [lots]);
  const newCount = useMemo(
    () => lots.filter(l => passesTriage(l, { ...TRIAGE_DEFAULTS, newOnly: true }, { prevVisitDay })).length,
    [lots, prevVisitDay]
  );
  const subActive = (k: string) => filters.cat != null && `${filters.cat}:${filters.sub}` === k;
  const catActive = (cat: CatKey) => filters.cat === cat;

  return (
    <div className="ray-triagebar" role="group" aria-label={label}>
      <style dangerouslySetInnerHTML={{ __html: `
        .ray-triagebar { display: flex; flex-direction: column; gap: 8px; margin: 0 0 14px; }
        .ray-triagebar-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .ray-triagebar-subs { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; padding-bottom: 2px; }
        .ray-triagebar-subs::-webkit-scrollbar { display: none; }
        .ray-triagebar-subs .ray-toolbar-pill { flex: none; }
        .ray-triagebar .ray-toolbar-select {
          -webkit-appearance: none; appearance: none; cursor: pointer; padding-right: 26px;
          background-image: linear-gradient(45deg, transparent 50%, currentColor 50%), linear-gradient(135deg, currentColor 50%, transparent 50%);
          background-position: calc(100% - 13px) 52%, calc(100% - 9px) 52%;
          background-size: 4px 4px, 4px 4px; background-repeat: no-repeat;
        }
        .ray-triagebar-count { margin-left: auto; font-size: 12.5px; color: var(--color-text-muted); white-space: nowrap; }
        @media (max-width: 767px) {
          .ray-triagebar .ray-toolbar-pill, .ray-triagebar .ray-toolbar-select { min-height: 44px; flex: none; }
          /* one swipeable strip per row on a phone — never a 4-row wall above the board */
          .ray-triagebar-row { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; }
          .ray-triagebar-row::-webkit-scrollbar { display: none; }
          .ray-triagebar-count { display: none; }
        }
      ` }} />
      <div className="ray-triagebar-row">
        {WINDOWS.map(w => (
          <button key={w.key} type="button" className="ray-toolbar-pill" data-active={filters.win === w.key} aria-pressed={filters.win === w.key}
            onClick={() => set({ win: filters.win === w.key ? null : w.key })}>
            {w.label}
          </button>
        ))}
        {newCount > 0 && (
          <button type="button" className="ray-toolbar-pill" data-active={filters.newOnly} aria-pressed={filters.newOnly}
            onClick={() => set({ newOnly: !filters.newOnly })}>
            {prevVisitDay ? 'New since last visit' : 'New today'} <i>{newCount}</i>
          </button>
        )}
        {houses.length > 1 && (
          <select className="ray-toolbar-pill ray-toolbar-select" aria-label="Auction house" data-active={filters.house != null}
            value={filters.house ?? ''} onChange={e => set({ house: e.target.value || null })}>
            <option value="">All houses</option>
            {houses.map(([h, n]) => <option key={h} value={h}>{h} ({n})</option>)}
          </select>
        )}
        <select className="ray-toolbar-pill ray-toolbar-select" aria-label="Minimum value" data-active={filters.minUsd != null}
          value={filters.minUsd ?? ''} onChange={e => set({ minUsd: e.target.value ? Number(e.target.value) : null })}>
          <option value="">Any value</option>
          {VALUE_FLOORS.map(v => <option key={v} value={v}>{fmtFloor(v)}</option>)}
        </select>
        {filters.cat && <FollowChip follow={catFollow(filters.cat, filters.sub)} />}
        {filters.house && <FollowChip follow={houseFollow(filters.house)} />}
        {isTriageActive(filters) && (
          <button type="button" className="ray-toolbar-reset" onClick={() => onChange(TRIAGE_DEFAULTS)}>Clear</button>
        )}
        {shown != null && total != null && isTriageActive(filters) && (
          <span className="ray-triagebar-count">{shown.toLocaleString()} of {total.toLocaleString()}</span>
        )}
      </div>
      {showSubs && chips.items.length > 1 && (
        <div className="ray-triagebar-row ray-triagebar-subs ray-markets-fade">
          {chips.level === 'cat'
            ? chips.items.map(c => (
              <button key={c.key} type="button" className="ray-toolbar-pill" data-active={catActive(c.cat)} aria-pressed={catActive(c.cat)}
                onClick={() => (catActive(c.cat) ? set({ cat: null, sub: null }) : set({ cat: c.cat, sub: null }))}>
                {c.label} <i>{c.n}</i>
              </button>
            ))
            : chips.items.map(c => (
              <button key={c.key} type="button" className="ray-toolbar-pill" data-active={subActive(c.key)} aria-pressed={subActive(c.key)}
                onClick={() => (subActive(c.key) ? set({ cat: null, sub: null }) : set({ cat: c.cat, sub: c.sub }))}>
                {c.label} <i>{c.n}</i>
              </button>
            ))}
        </div>
      )}
      {showSubs && chips.level === 'cat' && chips.deeper.length > 1 && (
        <div className="ray-triagebar-row ray-triagebar-subs ray-markets-fade">
          {chips.deeper.map(c => (
            <button key={c.key} type="button" className="ray-toolbar-pill" data-active={subActive(c.key)} aria-pressed={subActive(c.key)}
              onClick={() => (subActive(c.key) ? set({ sub: null }) : set({ cat: c.cat, sub: c.sub }))}>
              {c.label} <i>{c.n}</i>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

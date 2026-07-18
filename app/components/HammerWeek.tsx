'use client';

import { useMemo } from 'react';
import type { AuctionLot } from '../types';

/**
 * HammerWeek — a thin ruled seven-day strip between the feed toolbar and the
 * lot grid: the shape behind "Hammers this week". Seven certificate-microcap
 * columns MON..SUN of the current week (Monday computed in UTC), each with the
 * count of lots hammering that day and one 3px hairline tick per house with a
 * sale — ruled marks, not chrome. Today's column carries the beige lift; past
 * days recede. A day is a real button: click filters the feed to that hammer
 * date via the saleDay lens; clicking the active day again clears it.
 * Renders nothing when the week is empty.
 */

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_MS = 86_400_000;
const MAX_TICKS = 6;

/** The ONE Mon–Sun week: seven UTC calendar days (YYYY-MM-DD) for the week
 *  containing `todayIso`. Locale-stable — everything in UTC, same as the
 *  lots' ISO saleDate strings. The ledger's "Hammers this week" and this
 *  strip both count against exactly this window. */
export function weekDaysFor(todayIso: string): string[] {
  const anchor = new Date(`${todayIso}T00:00:00Z`);
  const backToMonday = (anchor.getUTCDay() + 6) % 7;
  const monday = anchor.getTime() - backToMonday * DAY_MS;
  return Array.from({ length: 7 }, (_, i) =>
    new Date(monday + i * DAY_MS).toISOString().slice(0, 10)
  );
}

export default function HammerWeek({
  lots,
  activeDay,
  onSelectDay,
  todayIso,
}: {
  lots: AuctionLot[]; // the unfiltered upcoming pool (same array the feed reads)
  activeDay: string | null | undefined; // feedFilters.saleDay (YYYY-MM-DD)
  onSelectDay: (day: string | null) => void;
  /** the crawl day (YYYY-MM-DD) — the data's "today". The beige-lift column
   *  tracks the edition's date, not the client clock. Falls back to client. */
  todayIso?: string;
}) {
  const week = useMemo(() => {
    // crawl-day = the data's "today" — one edition date across the page
    const today = todayIso || new Date().toISOString().slice(0, 10);
    const days = weekDaysFor(today);
    const daySet = new Set(days);
    const counts = new Map<string, number>();
    const houses = new Map<string, Set<string>>();
    for (const l of lots) {
      const day = l.saleDate?.slice(0, 10);
      if (!day || !daySet.has(day)) continue;
      counts.set(day, (counts.get(day) || 0) + 1);
      (houses.get(day) || houses.set(day, new Set()).get(day)!).add(l.auctionHouse);
    }
    let total = 0;
    counts.forEach(n => { total += n; });
    return { days, todayIso: today, counts, houses, total };
  }, [lots, todayIso]);

  // The strip only earns its rule when the week actually has hammers.
  if (week.total === 0) return null;

  return (
    <div
      id="hammer-week"
      role="group"
      aria-label="Hammers by day, this week"
      className="ray-hammerweek"
      style={{
        borderBlock: '1px solid var(--hairline)',
        maxHeight: 64,
        overflowX: 'auto',
        overflowY: 'hidden',
        marginBottom: 22,
        WebkitOverflowScrolling: 'touch',
      }}
    >
      {/* __html, not a text child: the [data-*="true"] attribute selectors
          carry quotes which React would escape in SSR text while the browser
          leaves <style> raw text undecoded — a hydration mismatch whenever
          this ships in prerendered HTML. */}
      <style dangerouslySetInnerHTML={{ __html: `
        .ray-hammerweek { scrollbar-width: none; }
        .ray-hammerweek::-webkit-scrollbar { display: none; }
        .ray-hammerweek-row {
          display: grid;
          grid-template-columns: repeat(7, minmax(64px, 1fr));
          min-width: 448px;
        }
        .ray-hammerweek-day {
          appearance: none;
          background: none;
          border: none;
          border-left: 1px solid var(--hairline);
          margin: 0;
          padding: 7px 8px 8px;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 3px;
          font-family: var(--font-sans), sans-serif;
          text-align: left;
          cursor: pointer;
          transition: background 140ms ease;
        }
        .ray-hammerweek-day:first-child { border-left: none; }
        .ray-hammerweek-day:disabled { cursor: default; }
        .ray-hammerweek-day[data-past="true"] { opacity: 0.45; }
        .ray-hammerweek-day[data-today="true"] {
          background: color-mix(in srgb, var(--color-beige) 12%, transparent);
          box-shadow: inset 0 1px 0 var(--color-beige);
        }
        .ray-hammerweek-day[aria-pressed="true"] {
          background: color-mix(in srgb, var(--color-beige) 24%, transparent);
          box-shadow: inset 0 1px 0 var(--color-beige), inset 0 -1px 0 var(--color-beige);
        }
        .ray-hammerweek-day:not(:disabled):not([aria-pressed="true"]):hover {
          background: color-mix(in srgb, var(--color-beige) 7%, transparent);
        }
      ` }} />
      <div className="ray-hammerweek-row">
        {week.days.map((day, i) => {
          const n = week.counts.get(day) || 0;
          const houseCount = week.houses.get(day)?.size || 0;
          const isToday = day === week.todayIso;
          const isPast = day < week.todayIso;
          const isActive = activeDay === day;
          const dom = Number(day.slice(8, 10));
          return (
            <button
              key={day}
              type="button"
              className="ray-hammerweek-day"
              data-today={isToday || undefined}
              data-past={(isPast && !isActive) || undefined}
              aria-pressed={isActive}
              disabled={n === 0}
              onClick={() => onSelectDay(isActive ? null : day)}
              aria-label={`${DAY_LABELS[i]} ${dom} — ${n === 0 ? 'no hammers' : `${n} ${n === 1 ? 'lot hammers' : 'lots hammer'} across ${houseCount} ${houseCount === 1 ? 'house' : 'houses'}`}`}
            >
              <span style={{
                fontSize: 10.5,
                fontWeight: 700,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: isActive ? 'var(--color-beige-text)' : 'var(--color-text-muted)',
                whiteSpace: 'nowrap',
              }}>
                {DAY_LABELS[i]} {dom}
              </span>
              <span style={{
                fontSize: 17,
                lineHeight: '18px',
                fontWeight: 600,
                fontVariantNumeric: 'tabular-nums',
                color: n === 0 ? 'var(--color-text-muted)' : 'var(--color-fg)',
              }}>
                {n === 0 ? '—' : n}
              </span>
              {/* one ruled 3px tick per house with a sale that day */}
              <span aria-hidden="true" style={{ display: 'flex', gap: 1, height: 3, minHeight: 3 }}>
                {Array.from({ length: Math.min(houseCount, MAX_TICKS) }, (_, t) => (
                  <span key={t} style={{
                    width: 3,
                    height: 3,
                    background: isActive || isToday ? 'var(--color-beige)' : 'var(--color-text-muted)',
                  }} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

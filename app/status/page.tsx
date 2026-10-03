'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useRayData } from '../hooks/useRayData';
import ArtistNav from '../components/ArtistNav';
import { Colophon } from '../components/Terminal';
import { useNow, isOpen, closeMs } from '../lib/closing';
import { usePipelineStatus, houseAsOfMap, ageLabel, asOfLabel, HOUSE_STALE_MS, type HouseStatus } from '../lib/house-status';
import { formatDate, getUpcomingCounts } from '../utils';

/* ============================================================
   /status — how fresh the book is, in plain words.

   Source of truth: public/data/ray/status.json, written by the
   pipeline on every publish (may be absent on an older data
   build). Without it the page says so, and derives what it
   honestly can from the served data itself: the crawl stamp in
   meta.json and the `lastSeen` stamps the live lots carry. No
   stamp, no claim — a house with nothing to read says "not
   stamped" rather than borrowing the site-wide crawl time.

   Color law: green/red belong to the market's direction. A
   stale house is a caution, printed in muted ink with a word,
   never a red badge.
   ============================================================ */

const CSS = `
.st-page{padding-block:28px 64px}
.st-h1{font-size:clamp(30px,4.4vw,46px);font-weight:330;letter-spacing:-0.025em;line-height:1.06;color:var(--color-fg);margin:0 0 12px}
.st-dek{font-size:15px;line-height:1.6;color:var(--color-text-secondary);max-width:62ch;margin:0}
.st-sec{margin-top:36px;padding-top:16px}
.st-h2{font-size:clamp(19px,2.2vw,23px);font-weight:350;letter-spacing:-0.02em;color:var(--color-fg);margin:0 0 6px}
.st-note{font-size:13px;line-height:1.55;color:var(--color-text-muted);max-width:66ch;margin:8px 0 0}
.st-pub{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:0;margin-top:14px;border-top:1px solid var(--hairline)}
.st-pub>div{padding:14px 16px 12px 0;border-bottom:1px dotted var(--color-border-mid)}
.st-k{font-size:12.5px;color:var(--color-text-muted)}
.st-v{font-size:20px;font-weight:400;letter-spacing:-0.01em;color:var(--color-fg);margin-top:4px;font-variant-numeric:tabular-nums}
.st-s{font-size:12px;color:var(--color-text-faint);margin-top:3px}
.st-table{margin-top:14px;border-top:1px solid var(--hairline)}
.st-row{display:grid;grid-template-columns:minmax(0,1.3fr) 130px 110px 90px minmax(0,1.6fr);gap:0 16px;align-items:baseline;padding:11px 2px;border-bottom:1px dotted var(--color-border-mid);font-size:13.5px}
.st-row.head{font-size:12px;color:var(--color-text-muted);border-bottom:1px solid var(--hairline);padding-block:8px}
.st-house{color:var(--color-fg);font-weight:500}
.st-num{font-variant-numeric:tabular-nums;color:var(--color-fg)}
.st-dim{color:var(--color-text-faint)}
.st-state{color:var(--color-text-secondary)}
.st-state b{font-weight:600;color:var(--color-fg)}
.st-state.stale b{color:var(--color-text-muted);text-decoration:underline dotted;text-underline-offset:3px}
@media (max-width:760px){
  .st-row{grid-template-columns:minmax(0,1fr) auto;gap:3px 12px}
  .st-row.head{display:none}
  .st-row>.st-c-asof{text-align:right}
  .st-row>.st-c-live,.st-row>.st-c-date{font-size:12px;color:var(--color-text-muted)}
  .st-row>.st-c-date{text-align:right}
  .st-row>.st-c-state{grid-column:1 / -1;font-size:12.5px}
  .st-row>.st-c-live::before{content:"Live lots "}
}
`;

interface Row {
  house: string;
  asOf: string | null;
  /** status.json lastSaleDate, or (derived) the next close on the book */
  date: string | null;
  live: number | null;
  ok: boolean | null;
  reason: string | null;
  staleHidden: number | null;
}

/** the publish signal, said plainly; unknown words print as given */
function signalWords(sig: string | null | undefined): string | null {
  if (!sig) return null;
  const s = sig.toLowerCase();
  if (['ok', 'green', 'healthy', 'pass', 'success'].includes(s)) return 'Healthy — every check passed';
  if (['warn', 'warning', 'amber', 'yellow', 'degraded', 'partial'].includes(s)) return 'Published with warnings';
  if (['red', 'fail', 'failed', 'error', 'blocked'].includes(s)) return 'The last run hit a problem — the previous publish stands';
  return sig;
}

function isStale(asOf: string | null, now: number | null): boolean {
  if (!asOf || now == null) return false;
  const t = /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? Date.parse(`${asOf}T23:59:59Z`) : Date.parse(asOf);
  return !isNaN(t) && now - t > HOUSE_STALE_MS;
}

export default function StatusPage() {
  const { allLots, lastCrawl, sources, loading } = useRayData();
  const status = usePipelineStatus();
  const now = useNow();

  const rows: Row[] = useMemo(() => {
    if (status && status.houses.length) {
      return status.houses.map((h: HouseStatus) => ({
        house: h.house, asOf: h.asOf, date: h.lastSaleDate, live: h.live,
        ok: h.ok, reason: h.reason, staleHidden: h.staleHidden,
      })).sort((a, b) => a.house.localeCompare(b.house));
    }
    // DERIVED (no status file): per house, the live lots on the served book
    // and the newest lastSeen stamp they carry
    const asOf = houseAsOfMap(null, allLots as unknown as { auctionHouse?: string | null; lastSeen?: string | null }[]);
    const live = new Map<string, number>();
    const next = new Map<string, number>();
    for (const l of allLots) {
      const h = l.auctionHouse;
      if (!h) continue;
      if (now != null && isOpen(l, now)) {
        live.set(h, (live.get(h) || 0) + 1);
        const c = closeMs(l);
        if (c != null && (!next.has(h) || c < next.get(h)!)) next.set(h, c);
      }
    }
    const houses = new Set<string>(sources.concat(Array.from(live.keys())));
    return Array.from(houses).sort((a, b) => a.localeCompare(b)).map(h => ({
      house: h,
      asOf: asOf.get(h) || null,
      date: next.has(h) ? new Date(next.get(h)!).toISOString().slice(0, 10) : null,
      live: now == null ? null : (live.get(h) || 0),
      ok: null, reason: null, staleHidden: null,
    }));
  }, [status, allLots, sources, now]);

  const derived = status === null || (!!status && !status.houses.length);
  const pub = status?.publish || null;
  const publishedAt = pub?.lastPublishedAt || status?.generatedAt || null;
  const staleCount = rows.filter(r => isStale(r.asOf, now)).length;

  return (
    <div className="terminal-shell" style={{ minHeight: '100vh', fontFamily: 'var(--font-sans), sans-serif' }}>
      <ArtistNav activeSlug="status" upcomingCounts={getUpcomingCounts(allLots)} lastCrawl={lastCrawl ? formatDate(lastCrawl) : undefined} />
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <main className="rail st-page">
        <span className="ns-kicker">Data status</span>
        <h1 className="st-h1">How fresh the book is</h1>
        <p className="st-dek">
          lectr reads every auction house on a nightly crawl and publishes once the run passes its checks.
          This page shows when that last happened, and when each house was last read. A house not read
          in 36 hours is marked stale, and its lots say so wherever they&rsquo;re listed.
        </p>

        <section className="st-sec ns-plate" aria-labelledby="st-pub">
          <h2 className="st-h2" id="st-pub">The last publish</h2>
          {status === undefined || loading ? (
            <p className="st-note">Reading the status&hellip;</p>
          ) : (
            <>
              {derived && (
                <p className="st-note">
                  The pipeline hasn&rsquo;t published a status file yet, so the figures below are read off the served
                  data itself: the crawl stamp, and the day each house&rsquo;s live lots were last seen.
                </p>
              )}
              <div className="st-pub">
                <div>
                  <div className="st-k">{derived ? 'Last crawl' : 'Last published'}</div>
                  <div className="st-v">
                    {(() => {
                      const at = derived ? lastCrawl : publishedAt;
                      const age = now != null ? ageLabel(at, now) : null;
                      return at ? (age ? `${age} ago` : formatDate(at)) : '—';
                    })()}
                  </div>
                  <div className="st-s">{(derived ? lastCrawl : publishedAt) ? new Date((derived ? lastCrawl : publishedAt)!).toUTCString().replace(' GMT', ' UTC') : 'no stamp'}</div>
                </div>
                {!derived && (
                  <div>
                    <div className="st-k">Run</div>
                    <div className="st-v">{pub?.runId ? pub.runId : '—'}</div>
                    <div className="st-s">{pub?.engineVersion ? `engine ${pub.engineVersion}` : 'engine version not stamped'}</div>
                  </div>
                )}
                {!derived && (
                  <div>
                    <div className="st-k">Health</div>
                    <div className="st-v" style={{ fontSize: 15, lineHeight: 1.4 }}>{signalWords(pub?.signal) || 'Not reported'}</div>
                  </div>
                )}
                <div>
                  <div className="st-k">Houses</div>
                  <div className="st-v">{rows.length}</div>
                  <div className="st-s">{now == null ? ' ' : staleCount ? `${staleCount} not read in 36h` : 'all read in the last 36h'}</div>
                </div>
              </div>
            </>
          )}
        </section>

        <section className="st-sec ns-plate" aria-labelledby="st-houses">
          <h2 className="st-h2" id="st-houses">Each house</h2>
          <p className="st-note">
            {derived
              ? <>&ldquo;Last read&rdquo; is the newest day any of a house&rsquo;s live lots was seen by the crawler. Houses whose lots carry no such stamp say so.</>
              : <>&ldquo;Last read&rdquo; is the last time the crawler read the house successfully.</>}
          </p>
          <div className="st-table" role="table" aria-label="Freshness by auction house">
            <div className="st-row head" role="row">
              <span role="columnheader">House</span>
              <span role="columnheader">Last read</span>
              <span role="columnheader">{derived ? 'Next close' : 'Newest sale'}</span>
              <span role="columnheader">Live lots</span>
              <span role="columnheader">State</span>
            </div>
            {rows.map(r => {
              const stale = isStale(r.asOf, now);
              const age = r.asOf && now != null ? ageLabel(r.asOf, now) : null;
              const isDay = !!r.asOf && /^\d{4}-\d{2}-\d{2}$/.test(r.asOf);
              let state: React.ReactNode;
              if (r.ok === false) state = <><b>Not reading</b>{r.reason ? ` — ${r.reason}` : ''}</>;
              else if (stale) state = <><b>Stale</b>{r.reason ? ` — ${r.reason}` : ` — not read since ${asOfLabel(r.asOf!)}`}</>;
              else if (!r.asOf) state = <span className="st-dim">{derived ? 'Not stamped on its lots' : 'No read recorded'}</span>;
              else state = <><b>Current</b>{r.reason ? ` — ${r.reason}` : ''}</>;
              return (
                <div className="st-row" role="row" key={r.house}>
                  <span role="cell" className="st-house">{r.house}</span>
                  <span role="cell" className="st-c-asof st-num">
                    {r.asOf ? (isDay ? asOfLabel(r.asOf) : age ? `${age} ago` : asOfLabel(r.asOf)) : <span className="st-dim">—</span>}
                  </span>
                  <span role="cell" className="st-c-date st-num">{r.date ? formatDate(r.date) : <span className="st-dim">—</span>}</span>
                  <span role="cell" className="st-c-live st-num">{r.live != null ? r.live.toLocaleString() : '—'}</span>
                  <span role="cell" className={`st-c-state st-state${stale || r.ok === false ? ' stale' : ''}`}>
                    {state}
                    {r.staleHidden ? <span className="st-dim"> · {r.staleHidden.toLocaleString()} {r.staleHidden === 1 ? 'lot' : 'lots'} hidden while stale</span> : null}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="st-note">
            The forecasts themselves are graded on <Link href="/receipts" className="rcp-link">the record</Link>.
          </p>
        </section>
      </main>
      <Colophon />
    </div>
  );
}

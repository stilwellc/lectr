'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAlerts, useSavedSearches } from '../lib/alerts';
import { supabase } from '../lib/supabase';
import { craftTitle, formatDate, formatPrice, fmtSignedPct, httpsImg } from '../utils';
import { ARTIST_LABEL } from '../constants';

interface SlimLot {
  id: string;
  title?: string;
  artist?: string;
  saleDate?: string | null;
  estimateLow?: number | null;
  estimateHigh?: number | null;
  imageUrl?: string | null;
  auctionHouse?: string;
  /** crawl-time comp signal — rides on the synced lot row when present */
  signal?: { label: 'Below Market' | 'Above Market'; pct: number } | null;
}

const CSS = `
.lectr-inbox-row {
  display: flex; align-items: center; gap: 12px;
  padding: 9px 0; text-decoration: none;
  border-bottom: 1px solid var(--hairline);
}
.lectr-inbox-row:last-child { border-bottom: none; }
.lectr-inbox-thumb {
  width: 36px; height: 36px; flex: none; object-fit: cover;
  border-radius: 3px; background: var(--color-bg-elevated);
}
.lectr-inbox-title {
  font-size: 13.5px; color: var(--color-fg); font-weight: 550;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.lectr-inbox-row:hover .lectr-inbox-title { color: var(--color-butter-text); }
.lectr-inbox-meta {
  font-size: 11.5px; color: var(--color-text-muted);
  font-variant-numeric: tabular-nums; white-space: nowrap;
}
.lectr-inbox-dot {
  width: 6px; height: 6px; border-radius: 50%; flex: none;
  background: var(--color-up); /* new = a verb — mint, like the nav's alert dots */
}
.lectr-inbox-search {
  display: flex; align-items: baseline; gap: 10px;
  font-size: 10.5px; font-weight: 700; letter-spacing: 0.14em;
  text-transform: uppercase; color: var(--color-text-faint);
  margin: 18px 0 2px;
}
.lectr-inbox-del {
  background: none; border: none; cursor: pointer; padding: 0 2px;
  font-size: 12.5px; color: var(--color-text-faint); line-height: 1;
}
.lectr-inbox-del:hover { color: var(--color-down-text); }
.lectr-inbox-auto {
  font-size: 9px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase;
  color: var(--color-text-faint); border: 1px solid var(--color-border);
  border-radius: 5px; padding: 1px 6px;
}
`;

/**
 * The alert inbox on My profile — what the nightly crawl found for each
 * saved search. Rows are certificate-ledger lines; unseen matches carry the
 * butter marker until "Mark all read". Hidden entirely when the reader has
 * no saved searches (the toolbar's "Save this search" is the front door).
 */
export default function AlertsInbox() {
  const { searches, ready: searchesReady, remove } = useSavedSearches();
  const { alerts, ready: alertsReady, markAllSeen, unseen } = useAlerts();
  const [lots, setLots] = useState<Record<string, SlimLot>>({});

  const shownAlerts = useMemo(() => alerts.slice(0, 40), [alerts]);

  useEffect(() => {
    let dead = false;
    (async () => {
      if (!supabase || !shownAlerts.length) return;
      const ids = Array.from(new Set(shownAlerts.map(a => a.lot_id)));
      const { data } = await supabase.from('lots').select('id,data').in('id', ids);
      if (dead || !data) return;
      const map: Record<string, SlimLot> = {};
      for (const r of data as { id: string; data: SlimLot }[]) if (r.data) map[r.id] = r.data;
      setLots(map);
    })();
    return () => { dead = true; };
  }, [shownAlerts]);

  if (!searchesReady || !alertsReady) return null;
  if (searches.length === 0) {
    // normally invisible with no standing searches — but orphaned unseen
    // alerts (searches deleted on another device, alert rows left behind)
    // would otherwise pin "N new matches" in the away strip forever while
    // the only Mark-all-read control lives inside this hidden section
    if (unseen === 0) return null;
    return (
      <section className="rail ray-enter" aria-label="Saved searches" style={{ paddingBlock: '34px 8px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 14px' }}>
          <span style={{ fontSize: 12.5, color: 'var(--color-text-muted)' }}>
            {unseen} unread {unseen === 1 ? 'match' : 'matches'} from searches you&rsquo;ve since deleted.
          </span>
          <button className="ray-toolbar-reset" style={{ color: 'var(--color-butter-text)' }} onClick={markAllSeen}>Mark all read</button>
        </div>
      </section>
    );
  }

  const bySearch = new Map<string, typeof shownAlerts>();
  for (const a of shownAlerts) {
    const arr = bySearch.get(a.search_id) || [];
    arr.push(a);
    bySearch.set(a.search_id, arr);
  }

  return (
    <section className="rail ray-enter" aria-label="Saved searches" style={{ paddingBlock: '34px 8px' }}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 14px', marginBottom: 4 }}>
        <h2 className="ray-h2" style={{ margin: 0 }}>Saved searches</h2>
        <span style={{ fontSize: 13.5, color: 'var(--color-text-muted)' }}>
          {searches.length === 1 ? 'one standing search' : `${searches.length} standing searches`} · matched nightly against every new lot
        </span>
        {unseen > 0 && (
          <button
            className="ray-toolbar-reset"
            style={{ marginLeft: 'auto', color: 'var(--color-butter-text)' }}
            onClick={markAllSeen}
          >
            Mark all read · {unseen}
          </button>
        )}
      </div>

      {searches.filter(s => (bySearch.get(s.id) || []).length > 0).map(s => {
        const allRows = bySearch.get(s.id) || [];
        // SIX rows per search — the inbox is a digest, not the archive; a
        // 40-row Pokémon wall drowned every other search's matches
        const rows = allRows.slice(0, 6);
        // synthetic signal feeds (query._signal) are standing sections the
        // nightly maintains — no delete (it would re-create tomorrow)
        const auto = !!(s.query as { _signal?: string } | null)?._signal;
        return (
          <div key={s.id}>
            <div className="lectr-inbox-search">
              <span>{s.name}</span>
              {auto ? (
                <span className="lectr-inbox-auto" title="A standing feed the engine maintains from your watchlist">auto</span>
              ) : (
                <button className="lectr-inbox-del" title="Delete this saved search" aria-label={`Delete saved search: ${s.name}`} onClick={() => remove(s.id)}>×</button>
              )}
              {allRows.length > rows.length && (
                <span style={{ fontWeight: 400, letterSpacing: 0, textTransform: 'none' }}>+{allRows.length - rows.length} more</span>
              )}
            </div>
            {(
              rows.map(a => {
                const lot = lots[a.lot_id];
                const est = lot?.estimateLow || lot?.estimateHigh;
                const sig = lot?.signal;
                return (
                  <Link key={a.id} href={`/lot?id=${encodeURIComponent(a.lot_id)}`} className="lectr-inbox-row">
                    {!a.seen && <span className="lectr-inbox-dot" aria-label="new" />}
                    {lot?.imageUrl && (
                      // no-referrer + remove-on-error: the houses hotlink-block
                      // on referer, and a dead thumb collapses out of the row
                      // instead of a broken-image glyph (the shared comp-thumb
                      // pattern — LotPage/ComparableModal/RefPage)
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="lectr-inbox-thumb" src={httpsImg(lot.imageUrl)} alt="" loading="lazy" referrerPolicy="no-referrer" onError={e => e.currentTarget.remove()} />
                    )}
                    <span className="lectr-inbox-title">{lot ? craftTitle(lot.title || a.lot_id) : a.lot_id}</span>
                    <span className="lectr-inbox-meta" style={{ marginLeft: 'auto', flex: 'none' }}>
                      {lot?.artist ? `${ARTIST_LABEL[lot.artist] || lot.artist} · ` : ''}
                      {est ? `est. ${formatPrice(est)}` : 'no estimate'}
                      {lot?.saleDate ? ` · ${formatDate(lot.saleDate)}` : ''}
                      {/* measured comp signal only — green/red never decorates anything else */}
                      {sig && (
                        <b style={{
                          marginLeft: 8,
                          fontFamily: 'var(--font-mono), monospace',
                          fontWeight: 700,
                          color: sig.label === 'Below Market' ? 'var(--color-up)' : 'var(--color-down-text)',
                        }}>
                          {fmtSignedPct(sig.pct)}
                        </b>
                      )}
                    </span>
                  </Link>
                );
              })
            )}
          </div>
        );
      })}
      {(() => {
        // the quiet searches, folded into ONE line — repeating "no new
        // matches yet" once per search read as a wall of empty states
        const quiet = searches.filter(s => (bySearch.get(s.id) || []).length === 0);
        if (!quiet.length) return null;
        return (
          <div style={{ fontSize: 12.5, color: 'var(--color-text-faint)', padding: '14px 0 0' }}>
            {quiet.length === searches.length ? 'No new matches yet' : 'Quiet'}:{' '}
            {quiet.map((s, i) => {
              const auto = !!(s.query as { _signal?: string } | null)?._signal;
              return (
                <span key={s.id} style={{ whiteSpace: 'nowrap' }}>
                  {i > 0 && ' · '}
                  {s.name}
                  {!auto && (
                    <button className="lectr-inbox-del" title="Delete this saved search" aria-label={`Delete saved search: ${s.name}`} onClick={() => remove(s.id)}>×</button>
                  )}
                </span>
              );
            })}
            {' '}— the next crawl checks tonight
          </div>
        );
      })()}
      {alerts.length > shownAlerts.length && (
        <div style={{ fontSize: 11.5, color: 'var(--color-text-faint)', marginTop: 8 }}>
          and {alerts.length - shownAlerts.length} older matches
        </div>
      )}
    </section>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAlerts, useSavedSearches } from '../lib/alerts';
import { supabase } from '../lib/supabase';
import { craftTitle, formatDate, formatPrice, httpsImg } from '../utils';
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
}

const CSS = `
.lectr-inbox-row {
  display: flex; align-items: center; gap: 12px;
  padding: 9px 0; text-decoration: none;
  border-bottom: 1px dotted var(--color-border);
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
  background: var(--color-butter);
}
.lectr-inbox-search {
  display: flex; align-items: baseline; gap: 10px;
  font-size: 10.5px; font-weight: 700; letter-spacing: 0.14em;
  text-transform: uppercase; color: var(--color-text-faint);
  margin: 18px 0 2px;
}
.lectr-inbox-del {
  background: none; border: none; cursor: pointer; padding: 0 2px;
  font-size: 12px; color: var(--color-text-faint); line-height: 1;
}
.lectr-inbox-del:hover { color: var(--color-down-text); }
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

  if (!searchesReady || !alertsReady || searches.length === 0) return null;

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
        <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
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

      {searches.map(s => {
        const rows = bySearch.get(s.id) || [];
        return (
          <div key={s.id}>
            <div className="lectr-inbox-search">
              <span>{s.name}</span>
              <button className="lectr-inbox-del" title="Delete this saved search" onClick={() => remove(s.id)}>×</button>
            </div>
            {rows.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--color-text-faint)', padding: '7px 0' }}>
                no new matches yet — the next crawl checks tonight
              </div>
            ) : (
              rows.map(a => {
                const lot = lots[a.lot_id];
                return (
                  <Link key={a.id} href={`/lot?id=${encodeURIComponent(a.lot_id)}`} className="lectr-inbox-row">
                    {!a.seen && <span className="lectr-inbox-dot" aria-label="new" />}
                    {lot?.imageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="lectr-inbox-thumb" src={httpsImg(lot.imageUrl)} alt="" loading="lazy" />
                    )}
                    <span className="lectr-inbox-title">{lot ? craftTitle(lot.title || a.lot_id) : a.lot_id}</span>
                    <span className="lectr-inbox-meta" style={{ marginLeft: 'auto', flex: 'none' }}>
                      {lot?.artist ? `${ARTIST_LABEL[lot.artist] || lot.artist} · ` : ''}
                      {lot?.estimateLow ? `est. ${formatPrice(lot.estimateLow)}` : 'no estimate'}
                      {lot?.saleDate ? ` · ${formatDate(lot.saleDate)}` : ''}
                    </span>
                  </Link>
                );
              })
            )}
          </div>
        );
      })}
      {alerts.length > shownAlerts.length && (
        <div style={{ fontSize: 11.5, color: 'var(--color-text-faint)', marginTop: 8 }}>
          and {alerts.length - shownAlerts.length} older matches
        </div>
      )}
    </section>
  );
}

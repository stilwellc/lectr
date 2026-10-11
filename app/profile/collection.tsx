'use client';
/**
 * FOR YOUR COLLECTION (N3, Oct 11 2026) — live lots that would do something
 * to what the reader already holds (app/lib/collection-picks): the same card
 * in a higher grade (or the same watch reference), the next numbers of a set
 * they own singles of, the rest of a print portfolio, more by the makers and
 * players they own. Owned lots ("I won it") are the evidence; saved lots
 * count, weaker, and every reason says which.
 *
 * Composable: one self-contained section. It reads the desk (on-device
 * saves signed out, the account's saved_lots signed in — one useAccount),
 * resolves each held id against the loaded book (else its snapshot), and
 * deals over the block it is handed. A card upgrade's grade premium is read
 * from the entity's matched grade ladder (pages/entity-<bb>.json), loaded
 * only for the entities an upgrade names. Renders nothing for a desk that
 * holds nothing.
 */
import React, { useEffect, useMemo, useState } from 'react';
import type { AuctionLot } from '../types';
import { useAccount } from '../lib/account';
import { idAliases } from '../lib/recs';
import { useAfterPaint } from './stall';
import { collectionPicks, type HeldInput, type MatchedLadder, type PickKind } from '../lib/collection-picks';
import { loadEntityDetail } from '../hooks/useEntities';
import { useLotModal } from '../lib/use-lot-modal';
import LotCard from '../components/LotCard';
import ComparableModal from '../components/ComparableModal';
import { FeedRow, belowSignalOf, feedTone } from '../components/LotBrowser';
import { CollectionMark } from '../components/marks';
import { RoomHead } from './head';
import { withTimeout, READ_DEADLINE_MS } from './stall';
import { useGridCols } from './grid';

const KIND_LABEL: Record<PickKind, string> = { upgrade: 'Upgrades', set: 'Sets', series: 'Series', maker: 'More by' };
const KINDS: PickKind[] = ['upgrade', 'set', 'series', 'maker'];

/** the held lots, as the desk knows them (resolved row, else the snapshot) */
export function useHeld(book: readonly AuctionLot[]): { held: HeldInput[]; ready: boolean } {
  const { savedIds, savedMeta, savedReady } = useAccount();
  const byId = useMemo(() => {
    const m = new Map<string, AuctionLot>();
    if (savedIds.length) for (const l of book) m.set(l.id, l);
    return m;
  }, [book, savedIds.length]);
  const held = useMemo(() => savedIds.map(id => {
    const meta = savedMeta[id];
    let lot: AuctionLot | undefined;
    for (const a of idAliases(id)) { lot = byId.get(a); if (lot) break; }
    return { id, owned: meta?.owned === true, lot: lot ?? null, title: meta?.title ?? null, artist: meta?.artist ?? null };
  }), [savedIds, savedMeta, byId]);
  return { held, ready: savedReady };
}

export default function ForYourCollection({ book, pool, compLots, ready, lastCrawl, isSaved, onToggleSave, onCount }: {
  book: AuctionLot[];
  /** the live block the picks deal from (the page's one deal pool) */
  pool: AuctionLot[];
  compLots: AuctionLot[];
  /** the desk has resolved (every save against the corpus, or its snapshot) */
  ready: boolean;
  lastCrawl?: string;
  isSaved: (id: string) => boolean;
  onToggleSave: (id: string, lot?: AuctionLot) => void;
  /** the pick count, for the page's rail */
  onCount?: (n: number) => void;
}) {
  const { held, ready: heldReady } = useHeld(book);
  // below the fold: read a frame after the picks above it have painted
  const dealt = useAfterPaint(ready);
  const nowDay = new Date().toISOString().slice(0, 10);
  const [ladders, setLadders] = useState<Map<string, MatchedLadder | null>>(() => new Map());
  const result = useMemo(
    () => (dealt && heldReady && held.length ? collectionPicks(held, pool, { ladders }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dealt, heldReady, held, pool, ladders, nowDay],
  );
  // the matched grade ladders an upgrade names — loaded once each
  const want = (result?.ladderIds ?? []).filter(id => !ladders.has(id)).join(',');
  useEffect(() => {
    if (!want) return;
    let live = true;
    const ids = want.split(',');
    // (deadline) a bucket that never answers reads as no ladder, never a wait
    Promise.all(ids.map(id => withTimeout(loadEntityDetail(id, lastCrawl), READ_DEADLINE_MS, null).then(d => {
      const g = d?.facets?.find(f => f.key === 'grade' && f.basis === 'matched');
      return [id, g ? { basis: 'matched' as const, cards: g.cards, rows: g.rows } : null] as const;
    }).catch(() => [id, null] as const))).then(rows => {
      if (!live) return;
      setLadders(prev => { const m = new Map(prev); for (const [id, g] of rows) m.set(id, g); return m; });
    });
    return () => { live = false; };
  }, [want, lastCrawl]);

  const picks = useMemo(() => result?.picks ?? [], [result]);
  useEffect(() => { onCount?.(picks.length); }, [picks.length, onCount]);

  const [kind, setKind] = useState<PickKind | null>(null);
  const counts = useMemo(() => {
    const c: Record<PickKind, number> = { upgrade: 0, set: 0, series: 0, maker: 0 };
    for (const p of picks) c[p.kind]++;
    return c;
  }, [picks]);
  const shownKind = kind && counts[kind] > 0 ? kind : null;
  const list = useMemo(() => (shownKind ? picks.filter(p => p.kind === shownKind) : picks), [picks, shownKind]);

  const cols = useGridCols();
  const narrow = cols === 1;
  // a room inside the picks group: one row of cards (three rows on a phone),
  // Show more deals the rest
  const page = cols === 1 ? 3 : cols;
  const [shown, setShown] = useState<number | null>(null);
  const visible = shown ?? page;
  const [openLot, setOpenLot] = useLotModal<AuctionLot>();
  const below = useMemo(() => belowSignalOf(list.map(p => p.lot), compLots), [list, compLots]);

  if (!result || !result.read.held) return null;
  const r = result.read;
  const readable = r.cards + r.watches + r.prints + r.makers > 0;
  const from = [r.owned ? `${r.owned} owned` : null, r.saved ? `${r.saved} saved` : null].filter(Boolean).join(' and ');
  const kindsLive = KINDS.filter(k => counts[k] > 0);

  return (
    <section id="for-collection" className="ck-subroom rail ray-enter" aria-label="For your collection">
      <div>
        <RoomHead level={3} mark={<CollectionMark size={15} />} title="For your collection" style={{ marginBottom: picks.length ? 14 : 0 }}
          help={{ name: 'For your collection', body: <>            Live lots read against what you <b>own</b> (lots you marked &ldquo;I won it&rdquo;) and, as weaker evidence,
            what you <b>save</b>. <b>Upgrade</b>: the same card — same year, set, number and parallel — live in a higher
            grade, or a watch with the same reference number; a raw card is never &ldquo;upgraded&rdquo; by a slab, and a
            qualified grade (OC, MK) or an Authentic slab never counts. The same-card median is that grade&rsquo;s own
            record, all-in (buyer&rsquo;s premium included): its sales in the last year when it sold then — the
            window lectr&rsquo;s card value reads, named &ldquo;N sales in the last year&rdquo; — else every sale on
            file, named &ldquo;all-time&rdquo; with its years and n (under 3 sales, no figure); a grade premium is printed only from the player&rsquo;s matched grade ladder — the same
            cards sold at both grades. <b>Sets</b>: when you hold two or more singles of one set, live cards from that
            set and year whose numbers you don&rsquo;t hold. &ldquo;N of M&rdquo; is printed only for sets whose size is
            settled (1952 Topps, Base Set…); otherwise it says &ldquo;same set&rdquo;. <b>Series</b>: other prints from a
            portfolio you hold one of — Warhol by his Feldman &amp; Schellmann number, others by the &ldquo;from …&rdquo;
            the house printed. <b>More by</b>: other live lots by the makers and players you hold. Each line says which
            of your lots it was read from.
          </> }}
          sub={picks.length > 0
            ? <>{picks.length} picked<span className="ck-wide"> from {pool.length.toLocaleString()} live lots</span>{from ? <> · read from {from}</> : null}</>
            : readable
              // the thin state is one line: what was read, and that nothing ties
              ? <>Nothing on the block ties to what you hold right now{from ? <> · read from {from}</> : null} — new lots land with every crawl.</>
              : <>None of your lots carries an identity this room can read yet — a card needs its year, set and number; a print its series; a watch its reference.</>} />

        {kindsLive.length > 1 && (
          <div role="group" aria-label="Kind of tie" className="ck-kinds">
            <button type="button" className="ray-toolbar-pill" data-active={!shownKind} aria-pressed={!shownKind} onClick={() => { setKind(null); setShown(null); }}>All {picks.length}</button>
            {kindsLive.map(k => (
              <button key={k} type="button" className="ray-toolbar-pill" data-active={shownKind === k} aria-pressed={shownKind === k}
                onClick={() => { setKind(shownKind === k ? null : k); setShown(null); }}>{KIND_LABEL[k]} {counts[k]}</button>
            ))}
          </div>
        )}

        {picks.length === 0 ? null : narrow ? (
          <div>
            {list.slice(0, visible).map(p => (
              <div key={p.lot.id} data-pick data-nav-row>
                <FeedRow stack lot={p.lot} onOpen={() => setOpenLot(p.lot)} tone={feedTone(p.lot, below.ids, below.hasSig)} note={p.reason} />
              </div>
            ))}
          </div>
        ) : (
          <div className="ray-saved-grid ck-picks">
            {list.slice(0, visible).map((p, i) => (
              <div key={p.lot.id} data-pick data-nav-row className="ray-enter-card" style={{ '--enter-delay': `${Math.min(i, 8) * 60}ms` } as React.CSSProperties}>
                <LotCard lot={p.lot} showArtist subjectMaker allLots={compLots} saved={isSaved(p.lot.id)} onToggleSave={onToggleSave}
                  lastCrawl={lastCrawl} note={p.reason} />
              </div>
            ))}
          </div>
        )}

        {visible < list.length && (
          <div className="ck-more-row">
            <button className="ray-show-more" onClick={() => setShown(Math.min(list.length, visible + 6))}>
              Show more ({list.length - visible} more {list.length - visible === 1 ? 'pick' : 'picks'})
            </button>
          </div>
        )}
      </div>
      {openLot && <ComparableModal lot={openLot} allLots={compLots} onClose={() => setOpenLot(null)} />}
    </section>
  );
}

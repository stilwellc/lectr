/**
 * THE DESK v3 (Oct 11 2026) — the one contract every /profile section reads.
 *
 * A section is a pure function of this data: it never fetches the book, the
 * saves or the taste itself (the page resolves them once, in order, with the
 * stall deadlines in ./stall). A section may fetch ENTITY detail buckets
 * (app/hooks/useEntities loadEntityDetail / useEntity) — those are small,
 * per-name, and cached — and nothing else.
 *
 * One clock per render: `now` is the page's, so every countdown, "closes in",
 * and day boundary on the desk agrees (closeDayOf / decisionOf read it).
 */
import type { AuctionLot } from '../../types';
import type { SavedMeta } from '../../lib/account';
import type { LedgerEntry } from '../../hooks/useRayData';
import type { Taste, Rec } from '../../lib/recs';
import type { Follow } from '../../lib/follows';
import type { PricePref } from '../../lib/interests';

export interface DeskData {
  /** the page's clock (ms) — the ONE now for the whole desk */
  now: number;
  signedIn: boolean;
  /** the live book (upcoming.json rows, enriched) plus the desk's kept
   *  settled rows — every lot a section may show; isOnBlock() says live */
  book: AuctionLot[];
  /** the full corpus / sold archive has arrived (settled saves resolved) */
  fullLoaded: boolean;
  /** the archive gave up (stall deadline) — say so, never spin */
  fullError: boolean;
  lastCrawl: string | null;
  /** every save resolved to its row (live, settled, or the save's own
   *  snapshot when the crawl dropped the lot) */
  saved: AuctionLot[];
  savedIds: ReadonlySet<string>;
  metaFor: (lotId: string) => SavedMeta | null;
  /** the collection: saves marked owned, resolved */
  collection: AuctionLot[];
  ownedIds: ReadonlySet<string>;
  /** the sold ledger: lot id → [priceUsd, saleDate, provisional?] */
  ledger: ReadonlyMap<string, LedgerEntry>;
  ledgerLoaded: boolean;
  taste: Taste | null;
  follows: readonly Follow[];
  /** the stated budget band (quick start / interests) */
  price: PricePref;
  /** the current picks in rank order (Top 3 first, then the room) */
  recs: readonly Rec<AuctionLot>[];
  /** the reader's last visit (ms) or null on a first visit */
  lastVisitMs: number | null;
}

/** actions a section may offer — every one already exists on the desk */
export interface DeskActions {
  toggleSave: (lot: AuctionLot) => void;
  toggleOwned: (lotId: string) => void;
  setSavedFields: (lotId: string, fields: Partial<SavedMeta>) => void;
  setPrice: (p: PricePref) => void;
  openLot: (lot: AuctionLot) => void;   // the comps modal (use-lot-modal)
  follow: (f: Follow) => void;
  unfollow: (f: Follow) => void;
}

export interface SectionProps {
  desk: DeskData;
  act: DeskActions;
  /** phone (< 900px) — decided by the page, never read from window at render */
  narrow: boolean;
}

/** what a section registers with the rail: the page builds the rail from
 *  these, in section order; `count` is the pill's live number */
export interface SectionMeta {
  id: string;           // the hash anchor (#week, #budget …)
  label: string;        // rail pill text
  count?: number | string | null;
  /** true when the section has nothing to say on this desk — the page
   *  still mounts it (never removes a feature) but folds it */
  quiet?: boolean;
  /** signed ink for a measured delta in `count` (lamp law: only a real sign) */
  tone?: 'up' | 'down';
  /** unseen matches waiting (the inbox dot — ink, never a lamp) */
  dot?: boolean;
}

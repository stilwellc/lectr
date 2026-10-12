/**
 * lot-face.ts — ONE LOT, ONE NUMBER (r8, Oct 10 2026).
 *
 * Every figure a surface prints about a live lot's value comes from HERE:
 * the /value call plate and ledger rows, the lot page, the comps modal, the
 * lot card and the home table. Each figure is read off the engine's own
 * stamp (lot.value, and lot.signal — its build stamp of comps.engineFlagOf),
 * formatted once (verdict.fmtUsd) and labelled once (FACE_LABEL). A surface
 * never re-derives a median, a range or a ratio of its own.
 *
 * QA3 N1 (the bug this closes): /value's headline lot printed "4.0× below
 * market", "expected hammer $411" and, in the modal, "lectr value $2K ·
 * Range $5K — $5K" — the modal labelled the comps median "lectr value" and
 * took its range from the one pool row the client could resolve. The three
 * figures, and what each one is:
 *
 *   value  "lectr value"   the engine's PREDICTION — expected hammer and its
 *                          calibrated likely range (value.expectedHammerUsd /
 *                          bandLowUsd / bandHighUsd, hammer basis; verdict.ts)
 *   comps  "Comps median"  the WEIGHTED median (similarity × recency) of the
 *                          engine's pool, all-in realized — value.compMedianUsd.
 *                          A weighted median is always one of the pool's own
 *                          sales (stats.weightedMedian), so `medId` names the
 *                          row it is; the rows a surface lists are the pool
 *                          (poolIds), never another read.
 *   call   "4.0×"          the engine's flag ratio — computed FROM the comps
 *                          median above: its hammer (the lot's premium
 *                          stripped) over the estimate midpoint as this house
 *                          habitually clears it (value.houseFactor). `net`
 *                          spells that basis out, so the printed ratio is
 *                          reconstructable from printed numbers.
 */
import type { AuctionLot } from '../types';
import { engineFlagOf, signalMagnitude } from './comps';
import { enginePoolOf } from './engine-pool';
import { lotHammerFromAllIn } from './premiums';
import { fmtUsd, lotMaxBid, lotVerdict } from './verdict';
import { prioStatic, projectedCloseOf } from './priority';
import { closeMs as houseCloseMs, closeIsTimed, localDayIn, houseTzOf } from './house-tz';
import { closeWhenText, calendarDaysBetween } from './close-time';
import { allInNote, cardRecordOf, cardValueBasis, spanText } from './card-record';

/** the one set of labels — a surface that prints a face figure prints its label */
export const FACE_LABEL = {
  value: 'lectr value',
  valueSub: 'expected hammer',
  range: 'likely',
  comps: 'Comps median',
  compsSub: 'weighted',
} as const;

/** the one formatter for every face figure ($1.7K, $416, $4.96M) */
export const fmtFace = fmtUsd;

export interface FaceValue {
  /** expected hammer (premium stripped) */
  hammer: number;
  lo: number;
  hi: number;
  /** the same prediction all-in (value.compValueUsd) */
  allIn: number;
  confidence: 'high' | 'medium' | 'low';
  /** "$416" */
  text: string;
  /** "$292–$927" */
  range: string;
}

export interface FaceComps {
  /** the weighted comps median, all-in realized */
  med: number;
  /** the pool's size (the engine's n) */
  n: number;
  /** the pool's ids (the rows behind the median) */
  ids: string[];
  /** (W29) the pool ids the engine calls ANOTHER work (value.otherWorkIds,
   *  held to `ids`): they priced the median, but they are not this object */
  other: string[];
  /** the pool's comparables proper — n less the other works (the count a
   *  "N comparable …" head prints) */
  sameN: number;
  /** "$1.7K" */
  text: string;
  /** "weighted · 4 sales" */
  sub: string;
  /** (W29) `sub` where the pool's rows are listed (the lot page, the comps
   *  modal): "weighted · 4 sales · incl. 2 other works" — the median names
   *  the other works it read; `sub` itself when there are none */
  listSub: string;
}

export interface FaceCall {
  label: 'Below Market' | 'Above Market';
  pct: number;
  /** the engine's flag ratio (null on a legacy crawl-stamped signal) */
  ratio: number | null;
  /** "4.0×" / "+45%" / "−20%" — signalMagnitude, the capped token */
  text: string;
  confidence: 'very-high' | 'high' | 'medium' | 'low';
  /** the comps median's hammer — the numerator the ratio reads */
  compsHammer: number | null;
  /** the estimate midpoint × the house's habit — the denominator */
  askAdj: number | null;
  /** "net of 25% premium · ask × 1.10 house habit" */
  net: string | null;
  /** "$1.3K comps hammer ÷ $331 adj. ask" — the ratio from printed numbers */
  derivation: string | null;
}

/** THE CARD PATH (r9, QA4 B2). A card-comp lot's value IS `value` above
 *  (the engine's expected hammer off its same-card pool); this is the
 *  card's own record beside it — context, never a second value. Before r9
 *  the lot page hid the value, printed this median as "This card" and a max
 *  bid derived from the hidden value: 1951 Bowman Mantle read "This card
 *  $10K · Max bid ≤ $17K" while the modal said "lectr value $20K". */
export interface FaceCard {
  /** "from 2 sales of this card & grade in the last year" — what the value
   *  was read from, in the engine's own count and window (card-record) */
  basis: string | null;
  /** the printed same-card, same-grade figure (all-in realized): the
   *  last-year median when the card sold in the window, else all-time */
  med: number | null;
  /** the n beside `med` (in its window) */
  n: number;
  /** "$23K" */
  text: string | null;
  /** which window `med` reads: 'year' (the pricer's window) or 'all' */
  window: 'year' | 'all';
  /** the leader row's short line: "median · 2 sales in the last year ·
   *  all-time $10K, 11 sales since 2021" */
  sub: string;
  /** the section head's short line: "$23K median · 2 sales in the last year" */
  head: string;
  /** the all-time record, dated: "$10K median · since 2021 · 11 sales, most 2021–23" */
  allTime: string | null;
  /** the most recent same-card sale */
  last: { p: number; d: string | null } | null;
  /** realized sales are all-in, the value is hammer — the sentence that
   *  makes "$19K" beside "$21.5K / $24.6K" read right (null without a value) */
  note: string | null;
}

export interface FaceMaxBid {
  hammer: number;
  allIn: number;
  /** "≤ $17K hammer" */
  text: string;
  /** "walk-away price · $21K all-in" */
  sub: string;
}

export interface LotFace {
  value: FaceValue | null;
  comps: FaceComps | null;
  call: FaceCall | null;
  /** the engine's max bid (verdict.lotMaxBid) — every surface's one walk-away */
  maxBid: FaceMaxBid | null;
  /** card lots: the same-card record beside the value (null off the card path) */
  card: FaceCard | null;
}

function estMidOf(lot: AuctionLot): number | null {
  const lo = lot.estLowUsd ?? lot.estimateLow ?? lot.estHighUsd ?? lot.estimateHigh ?? null;
  const hi = lot.estHighUsd ?? lot.estimateHigh ?? lo;
  return lo && hi ? (lo + hi) / 2 : null;
}

/** the n beside a comps median, in the engine's own count: the weighted
 *  median reads the pool's closest K (the engine's TOP_K) — a larger pool
 *  says so ("12 closest of 118 sales"), never "N sales" over a median of fewer */
export function compsCountText(n: number, k: number): string {
  return n > k && k > 0
    ? `${k} closest of ${n.toLocaleString()} sales`
    : `${n.toLocaleString()} ${n === 1 ? 'sale' : 'sales'}`;
}

function compsSub(n: number, k: number): string {
  return `${FACE_LABEL.compsSub} · ${compsCountText(n, k)}`;
}

/** (W29) the median was read over the other works too — said beside it
 *  where the rows are listed, so the figure matches the rows under it */
function compsListSub(sub: string, other: number, n: number): string {
  if (!(other > 0)) return sub;
  return other >= n ? `${sub} · all other works` : `${sub} · incl. ${otherWorksCount(other)}`;
}

/* ── OTHER WORKS (W29, Oct 11 2026) ───────────────────────────────────────
   The engine (W24, docs/ENGINE_LANES.md §22) keeps every pool row in the
   blend — on art the value leans on the house estimate, so an off-object
   row barely moves it — but it marks the rows its estimate-scale and
   work-date readers call a DIFFERENT WORK (value.otherWorkIds): Picasso's
   1965 "Femmes à leur toilette" priced beside two 1956 linocuts, the
   Lichtenstein Cow Triptych beside a $1,250 Rago poster. A comps list sets
   them apart, after the comparables, labelled for what they are: other
   works by the maker, for context. The comps median is still the pool's
   (they are in it) and says so; the "N comparable" count is the rest. */

/** "1 other work" / "2 other works" */
export function otherWorksCount(k: number): string {
  return `${k} other ${k === 1 ? 'work' : 'works'}`;
}

/** the group label: "Other works by Pablo Picasso, for context" */
export function otherWorksLabel(maker: string | null | undefined): string {
  const m = (maker || '').trim();
  return m ? `Other works by ${m}, for context` : 'Other works, for context';
}

/** the engine's other-work ids for this lot's pool (empty when none) */
export function otherWorkIdsOf(v: { otherWorkIds?: readonly (string | number)[] | null; poolIds?: readonly (string | number)[] | null } | null | undefined): string[] {
  const o = v?.otherWorkIds;
  if (!o || !o.length) return [];
  const pool = new Set((v?.poolIds || []).map(String));
  return o.map(String).filter(id => pool.has(id));
}

/** a comps head's form noun at its count: "1 comparable print", never
 *  "1 comparable prints" (comps.FORM_LABEL is plural) */
export function formNoun(label: string, n: number): string {
  if (n !== 1) return label;
  const fixed: Record<string, string> = {
    'works on paper': 'work on paper', 'books & catalogues': 'book or catalogue',
    'tickets & passes': 'ticket or pass', 'trophies & awards': 'trophy or award',
  };
  if (fixed[label]) return fixed[label];
  if (/(ches|shes|xes|sses)$/.test(label)) return label.slice(0, -2);
  if (/[^s]s$/.test(label)) return label.slice(0, -1);
  return label;
}

/** rows split into the comparables and the other works, each keeping its
 *  order; no other-work ids → every row is a comparable (the same array) */
export function splitOtherWorks<T extends { id: string }>(rows: readonly T[], otherIds: readonly string[] | null | undefined): { same: T[]; other: T[] } {
  if (!otherIds || !otherIds.length) return { same: rows as T[], other: [] };
  const o = new Set(otherIds);
  const same: T[] = [], other: T[] = [];
  for (const r of rows) (o.has(String(r.id)) ? other : same).push(r);
  return { same, other };
}

/** a lot's live signal as a surface holds it: the build stamp's shape, with
 *  the flag's median where the stamp carries one */
export type LiveSignalOf = (NonNullable<AuctionLot['signal']> & { med?: number }) | null;

/** THE LIVE SIGNAL — ONE SOURCE (X5, Oct 11 2026): the build's stamp
 *  (`lot.signal`, stamped on the whole book, null included — a stamped null
 *  is an abstention), else the engine's flag read off the lot's own value
 *  (comps.engineFlagOf). Never a client recompute over whatever pool the
 *  page holds (flags.ts law). lotFace's call and LotCard.lotSignal (the
 *  desk's signalById, the feeds, /value, the lot page) all read this. */
export function liveSignalOf(lot: AuctionLot): LiveSignalOf {
  return (lot.signal !== undefined ? lot.signal : engineFlagOf(lot)) as LiveSignalOf;
}

/** THE ONE FUNCTION — every printed value figure of a lot. */
export function lotFace(lot: AuctionLot): LotFace {
  // a card value the engine marked context-only (abstain 'card:…') is
  // never printed as a value (verdict.cardCompsHammer's rule)
  const ab = (lot.value as { abstain?: string | null } | null | undefined)?.abstain;
  const v = typeof ab === 'string' && ab.startsWith('card:') ? null : lotVerdict(lot);
  const value: FaceValue | null = v && v.expected > 0 ? {
    hammer: v.expected, lo: v.bandLo, hi: v.bandHi, allIn: v.expectedAllIn, confidence: v.confidence,
    text: fmtFace(v.expected),
    range: `${fmtFace(v.bandLo)}–${fmtFace(v.bandHi)}`,
  } : null;

  // the call: the build stamp (lot.signal ≡ engineFlagOf at build), else
  // the engine's flag read off the value directly — liveSignalOf, the one source
  const sig = liveSignalOf(lot);

  const ep = enginePoolOf(lot.value);
  const flagMed = sig?.med;
  const other = ep ? otherWorkIdsOf(lot.value) : [];
  let comps: FaceComps | null = null;
  if (ep) {
    const sub = compsSub(ep.n, ep.ids.length);
    comps = { med: ep.med, n: ep.n, ids: ep.ids, other, sameN: Math.max(0, ep.n - other.length), text: fmtFace(ep.med), sub, listSub: compsListSub(sub, other.length, ep.n) };
  } else if (flagMed != null && flagMed > 0) {
    const sub = compsSub(sig!.basis || 0, 0);
    comps = { med: flagMed, n: sig!.basis || 0, ids: [], other: [], sameN: sig!.basis || 0, text: fmtFace(flagMed), sub, listSub: sub };
  }

  let call: FaceCall | null = null;
  if (sig) {
    const ev = lot.value as (NonNullable<AuctionLot['value']> & { houseFactor?: number }) | null | undefined;
    const ratio = ev?.flagRatio ?? ev?.compRatio ?? null;
    const mid = estMidOf(lot);
    let compsHammer: number | null = null, askAdj: number | null = null, net: string | null = null, derivation: string | null = null;
    if (comps && mid && ratio != null) {
      compsHammer = Math.round(lotHammerFromAllIn(lot, comps.med));
      const hf = typeof ev?.houseFactor === 'number' && ev.houseFactor > 0 ? ev.houseFactor : 1;
      askAdj = Math.round(mid * hf);
      const prem = compsHammer > 0 ? Math.round((comps.med / compsHammer - 1) * 100) : 0;
      net = [prem > 0 ? `net of ${prem}% premium` : null, Math.abs(hf - 1) >= 0.005 ? `ask × ${hf.toFixed(2)} house habit` : null]
        .filter(Boolean).join(' · ') || null;
      derivation = `${fmtFace(compsHammer)} comps hammer ÷ ${fmtFace(askAdj)} ${Math.abs(hf - 1) >= 0.005 ? 'adj. ' : ''}ask`;
    }
    call = {
      label: sig.label,
      pct: sig.pct,
      ratio,
      text: signalMagnitude(sig.label, sig.pct),
      confidence: sig.confidence || 'low',
      compsHammer, askAdj, net, derivation,
    };
  }
  const mb = lotMaxBid(lot);
  const maxBid: FaceMaxBid | null = mb ? {
    hammer: mb.hammer, allIn: mb.allIn,
    text: `≤ ${fmtFace(mb.hammer)} hammer`,
    sub: `walk-away price · ${fmtFace(mb.allIn)} all-in`,
  } : null;

  return { value, comps, call, maxBid, card: cardFaceOf(lot, value) };
}

function cardFaceOf(lot: AuctionLot, value: FaceValue | null): FaceCard | null {
  const cc = lot.cardComps;
  const isCard = lot.value?.basis === 'card-comp';
  if (!isCard && !(cc && cc.n > 0)) return null;
  // (W17) the card's record DATED: the value reads the last year's sales of
  // this card & grade, so the figure beside it does too when it can — the
  // all-time median (1951 Bowman Mantle SGC 3: $10K, mostly 2021–23) prints
  // labelled all-time, with its years, never bare beside a 2026 value
  const rec = cardRecordOf(lot);
  const allN = rec?.all.n ?? (cc?.n || 0);
  const allMed = rec?.all.med ?? null;
  const dated = spanText(allN, rec?.all.span);
  const recent = rec?.recent && rec.recent.n > 0 && rec.recent.med != null && rec.recent.med > 0 ? rec.recent : null;
  const yearWord = (k: number) => `${k} ${k === 1 ? 'sale' : 'sales'} in the last year`;
  const allTime = allMed != null ? `${fmtFace(allMed)} median · ${dated}` : null;
  let med: number | null, n: number, sub: string, head: string;
  if (recent) {
    med = recent.med; n = recent.n;
    // short: it rides a leader row; the all-time record, dated, is `allTime`
    sub = `${n === 1 ? yearWord(1) : `median · ${yearWord(n)}`}${allMed != null && allN > n ? ` · all-time ${fmtFace(allMed)}, ${allN} ${allN === 1 ? 'sale' : 'sales'}${rec?.all.span ? ` since ${rec.all.span.y0}` : ''}` : ''}`;
    head = `${fmtFace(recent.med!)}${n === 1 ? '' : ' median'} · ${yearWord(n)}`;
  } else {
    med = allMed; n = allN;
    // "none in the last year" only when the record proves it
    const none = rec?.recent && rec.recent.n === 0 ? ' · none in the last year' : '';
    sub = `all-time median · ${dated}${none}`;
    head = allMed != null && allN >= 3 ? `${fmtFace(allMed)} all-time median · ${dated}${none}` : `${dated}${none}`;
  }
  const last = cc?.lastSales?.find(s => s.p > 0) || null;
  const pf = (lot.value as { premiumFactor?: number } | null | undefined)?.premiumFactor;
  return {
    basis: isCard && value ? cardValueBasis(lot.value as Parameters<typeof cardValueBasis>[0]) : null,
    med, n,
    text: med != null ? fmtFace(med) : null,
    window: recent ? 'year' : 'all',
    sub, head, allTime,
    last: last ? { p: last.p, d: last.d } : null,
    note: isCard && value ? allInNote(value.text, fmtFace(value.allIn), pf && pf > 1 ? Math.round((pf - 1) * 100) : null) : null,
  };
}

/** "lectr value $416 · likely $292–$927" — the one sentence form */
export function valueSentence(f: FaceValue): string {
  return `${FACE_LABEL.value} ${f.text} · ${FACE_LABEL.range} ${f.range}`;
}

/** the pool row the weighted median IS — the row at that price (192 of 198
 *  checkable live pools match to the dollar); a row re-priced since the
 *  engine read it (a re-crawled FX or premium, ≤5% on the Oct 9 book) is
 *  still that row: the closest within 5% */
export function medianRowId<T extends { id: string; priceUsd?: number | null }>(rows: readonly T[], med: number): string | null {
  let best: T | null = null, bestD = Infinity;
  for (const r of rows) {
    if (r.priceUsd == null || !(r.priceUsd > 0)) continue;
    const d = Math.abs(r.priceUsd / med - 1);
    if (d < bestD) { best = r; bestD = d; }
  }
  return best && bestD <= 0.05 ? best.id : null;
}

/* ── THE DECISION LINE (N2, Oct 11 2026) ─────────────────────────────────
   One compact line per pick: what the room is expected to pay, what the
   engine says it is worth up to, the gap between them when it means
   something, and when it closes —
     "projected close ~$34K · worth up to $38K · $4K headroom · closes Thu 10 PM"
   Every number is read from one source, never re-derived here:
     close  bid rooms: THE projected close (priority.projectedCloseOf — the
            ranker's own anchor, src 'proj': the live bid × the room's close
            multiple, close-k.ts, narrowed by a sound engine read), hammer
            basis; projectedCloseFace below is the lot page's read of the
            same figure. Estimate houses:
            the house estimate, labelled as such. A bid already past its
            anchor, an engine-only or a bare-bid anchor prints no close
            figure (the reason line and the card already say those).
     worth  lotFace(lot).maxBid — the engine's max bid (hammer), the lot
            page's "Max bid". No max bid → nothing; "no engine read" only
            when the engine abstained in so many words. Never invented.
            Under DECISION_COMPS_RULE (a ≥2× Below call whose max bid sits
            under half the comps median) the flag's basis prints instead —
            "comps median $23K · 12 closest of 118 sales" — and the max bid
            rides the tooltip with its definition.
     gap    only between two figures printed on the same line, same basis
            (hammer), and only when they sit ≥10% apart.
     when   the house-tz close clock (priority.closeMsOf's), in the reader's
            words; a date-only sale names the day, never an invented hour. */

export interface DecisionClose {
  kind: 'proj' | 'est';
  /** hammer-basis USD: the projection, or the estimate midpoint (the anchor) */
  usd: number;
  /** a projection's all-in (usd × the lot's premium factor) — printed only
   *  labelled "all-in"; null on an estimate */
  allIn: number | null;
  lo: number | null;
  hi: number | null;
  /** an estimate with one published bound (the hosts print the live bid
   *  in its place — formatEstimate — so the line names it) */
  oneSided: boolean;
  /** "projected close ~$34K" / "estimate $20K–$30K" */
  text: string;
  /** what the figure is, in full (a tooltip) */
  title: string;
}
export interface DecisionWorth {
  usd: number;
  text: string;
  title: string;
  /** 'max' — the engine's max bid, hammer ("worth up to $7K"); 'comps' —
   *  the flag's basis, the weighted comps median, all-in realized ("comps
   *  median $23K · 12 closest of 118 sales"), printed under
   *  DECISION_COMPS_RULE with the max bid in `title` */
  kind: 'max' | 'comps';
}
export interface DecisionGap { usd: number; dir: 'room' | 'over'; text: string }
export interface DecisionWhen { ms: number; timed: boolean; text: string }
export interface Decision {
  close: DecisionClose | null;
  worth: DecisionWorth | null;
  /** no max bid, no value, and the engine abstained explicitly ("no engine read") */
  abstained: boolean;
  gap: DecisionGap | null;
  when: DecisionWhen | null;
}

/** a gap prints only when the two figures are at least this far apart */
export const DECISION_GAP_MIN = 0.10;

/* ── THE COMPS RULE (X5, Oct 11 2026 — R1#3, R3#6) ───────────────────────
   Cow 1976 (Bonhams, est $4.6K–$6.9K) wore "3.2×" — comps sit 3.2× the ask —
   beside "worth up to $7K": the max bid is read off the VALUE, and on art
   the value leans on the house estimate (ENGINE_LANES §22), so the two
   figures contradict each other on one row ("4.1× BELOW … comps median
   $1.7K · 4 sales … worth up to $338" on the Coldplay drumhead). When the
   call is Below Market at ≥ 2× (signalMagnitude's × grammar, pct ≥ 100)
   AND the max bid sits under half the comps median, the line prints the
   flag's own basis — the comps median, with its n — and the max bid moves
   to the tooltip with its definition. Both figures are still lotFace's;
   nothing is re-derived. The comps median is all-in realized and the
   estimate / projection is hammer, so no gap prints across the two bases.
   Every surface reads the line through decisionOf (lot page, cards, feeds,
   the desk's rooms, the .ics) — the rule lives here only. */
export const DECISION_COMPS_RULE = {
  /** the call's magnitude, in signal pct points: 100 = 2× */
  minPct: 100,
  /** the max bid under this share of the comps median */
  maxBidShare: 0.5,
} as const;

/** the max bid's definition, as value.ts MAXBID_Q prints it (30%): the hammer
 *  only ~30% of comparable outcomes cleared at or under — a test pins the two */
export const MAXBID_POINT_PCT = 30;

/** whether the comps rule governs this lot's decision line */
export function compsRuleFires(face: LotFace): boolean {
  const c = face.call, m = face.maxBid, k = face.comps;
  return !!c && !!m && !!k && c.label === 'Below Market'
    && c.pct >= DECISION_COMPS_RULE.minPct
    && m.hammer < k.med * DECISION_COMPS_RULE.maxBidShare;
}

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function decisionWhen(lot: AuctionLot, nowMs: number): DecisionWhen | null {
  const ms = houseCloseMs(lot);
  if (ms == null || ms <= nowMs) return null;
  const timed = closeIsTimed(lot);
  if (!timed) {
    // a date-only sale is a DAY where it is sold (its close is that day's
    // end in the house's zone — past midnight on a reader's clock to the
    // east or west): name that day, never the reader-local day of the instant
    const day = localDayIn(ms - 1000, houseTzOf(lot));
    const n = new Date(nowMs);
    const today = Date.UTC(n.getFullYear(), n.getMonth(), n.getDate());
    const at = Date.parse(`${day}T12:00:00Z`);
    const dd = Math.round((at - 12 * 3_600_000 - today) / 864e5);
    const wd = new Date(at);
    const when = dd <= 0 ? 'today' : dd === 1 ? 'tomorrow' : dd < 7 ? WD[wd.getUTCDay()]
      : wd.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
    return { ms, timed, text: `sells ${when}` };
  }
  const days = calendarDaysBetween(nowMs, ms);
  let when: string;
  // a timed close on the reader's clock: "tonight at 10:00 PM", "Thu 10 PM",
  // past a week the date alone
  if (days <= 1) when = closeWhenText(ms, nowMs, true);
  else if (days < 7) {
    const d = new Date(ms);
    when = `${WD[d.getDay()]} ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(':00 ', ' ')}`;
  } else when = closeWhenText(ms, nowMs, false);
  return { ms, timed, text: `closes ${when}` };
}

/** what a projected close is, in full (the decision line's tooltip, the lot page's row) */
export const PROJ_TITLE = 'The live bid projected to its close by this room’s measured close multiple (days out × bid size) — hammer, before premium';

export interface ProjectedCloseFace {
  hammer: number;
  allIn: number;
  /** the buyer's premium the all-in carries, whole % */
  premiumPct: number;
  /** "~$34K" (hammer) */
  text: string;
  /** "~$41K all-in" — the labelled derivative */
  allInText: string;
}

/** THE PROJECTED CLOSE as every surface prints it — priority.projectedCloseOf
 *  formatted once. The figure is hammer; the all-in is the same figure × the
 *  lot's premium factor and never prints without "all-in" beside it. */
export function projectedCloseFace(lot: AuctionLot, nowMs: number = Date.now(),
  st: ReturnType<typeof prioStatic> = prioStatic(lot as Parameters<typeof prioStatic>[0], nowMs)): ProjectedCloseFace | null {
  const pc = projectedCloseOf(lot as Parameters<typeof projectedCloseOf>[0], nowMs, st);
  if (!pc) return null;
  return {
    hammer: pc.hammer, allIn: pc.allIn,
    premiumPct: Math.round((pc.factor - 1) * 100),
    text: `~${fmtFace(pc.hammer)}`,
    allInText: `~${fmtFace(pc.allIn)} all-in`,
  };
}

/** THE DECISION — the lot's projected close, the engine's walk-away, the gap
 *  and the close; each part null when it does not exist. */
export function decisionOf(lot: AuctionLot, nowMs: number = Date.now(), face: LotFace = lotFace(lot)): Decision {
  const p = prioStatic(lot as Parameters<typeof prioStatic>[0], nowMs);
  let close: DecisionClose | null = null;
  const pc = projectedCloseFace(lot, nowMs, p);
  if (pc) {
    close = {
      kind: 'proj', usd: pc.hammer, allIn: pc.allIn, lo: null, hi: null, oneSided: false,
      text: `projected close ${pc.text}`,
      title: `${PROJ_TITLE} · ${pc.allInText}`,
    };
  } else if (p && !p.over && p.src === 'est') {
    // a one-sided estimate says which side the house put on paper
    // (estimate-text's rule) — never a range it did not publish
    const lo = (lot.estLowUsd ?? lot.estimateLow) || 0;
    const hi = (lot.estHighUsd ?? lot.estimateHigh) || 0;
    if (lo > 0 || hi > 0) {
      const text = lo > 0 && hi > 0
        ? (fmtFace(lo) === fmtFace(hi) ? fmtFace(lo) : `${fmtFace(lo)}–${fmtFace(hi)}`)
        : lo > 0 ? `from ${fmtFace(lo)}` : `to ${fmtFace(hi)}`;
      close = { kind: 'est', usd: p.a, allIn: null, lo: lo || null, hi: hi || null, oneSided: !(lo > 0 && hi > 0),
        text: `estimate ${text}`, title: 'The house estimate — hammer, before premium' };
    }
  }
  const mb = face.maxBid;
  let worth: DecisionWorth | null = null;
  if (mb && mb.hammer > 0) {
    if (compsRuleFires(face)) {
      const k = face.comps!, c = face.call!;
      worth = {
        kind: 'comps', usd: k.med,
        text: `${FACE_LABEL.comps.toLowerCase()} ${k.text} · ${compsCountText(k.n, k.ids.length)}`,
        title: `${FACE_LABEL.comps} ${k.text} — ${k.sub}, all-in realized: the basis of the ${c.text} flag · walk-away bid ${mb.text}: the engine’s ${MAXBID_POINT_PCT}% point — only ~${MAXBID_POINT_PCT}% of comparable outcomes cleared at or under it (${mb.sub})`,
      };
    } else {
      worth = { kind: 'max', usd: mb.hammer, text: `worth up to ${fmtFace(mb.hammer)}`, title: `lectr’s max bid ${mb.text} — ${mb.sub}` };
    }
  }
  const ab = (lot.value as { abstain?: string | null } | null | undefined)?.abstain;
  // (W23) "no engine read" only when there is NO read: an abstain that held
  // back the FLAG ('flag:purity') or the max bid (a low-confidence value)
  // still prints a lectr value on the lot — 102 live lots read "no engine
  // read" in the line over "lectr value $2.61M" in the rows under it
  const abstained = !worth && !face.value && typeof ab === 'string' && ab.length > 0;

  let gap: DecisionGap | null = null;
  // a comps-median worth is all-in realized; the close figure is hammer —
  // no gap across bases (DECISION_COMPS_RULE)
  if (close && worth && worth.kind === 'max') {
    if (close.kind === 'proj') {
      const d = worth.usd - close.usd;
      if (Math.abs(d) >= DECISION_GAP_MIN * close.usd) {
        gap = d > 0
          ? { usd: d, dir: 'room', text: `${fmtFace(d)} headroom` }
          : { usd: -d, dir: 'over', text: `${fmtFace(-d)} past worth` };
      }
    } else {
      if (close.hi != null && worth.usd >= close.hi * (1 + DECISION_GAP_MIN)) {
        const d = worth.usd - close.hi;
        gap = { usd: d, dir: 'room', text: `${fmtFace(d)} over the high estimate` };
      } else if (close.lo != null && worth.usd <= close.lo * (1 - DECISION_GAP_MIN)) {
        const d = close.lo - worth.usd;
        gap = { usd: d, dir: 'over', text: `${fmtFace(d)} under the low estimate` };
      }
    }
  }
  return { close, worth, abstained, gap, when: decisionWhen(lot, nowMs) };
}

/** the line's parts, in order — what DecisionLine prints (and the tests read).
 *  `when: false` drops the close time (a surface with its own Hammers
 *  column); `close: false` drops the projection/estimate figure. */
export function decisionParts(d: Decision, opts: { when?: boolean; close?: boolean } = {}): string[] {
  const out: string[] = [];
  if (d.close && opts.close !== false) out.push(d.close.text);
  if (d.worth) out.push(d.worth.text);
  else if (d.abstained) out.push('no engine read');
  if (d.gap) out.push(d.gap.text);
  if (d.when && opts.when !== false) out.push(d.when.text);
  return out;
}

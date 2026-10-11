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
  /** "$1.7K" */
  text: string;
  /** "weighted · 4 sales" */
  sub: string;
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

function compsSub(n: number, k: number): string {
  // the weighted median reads the pool's closest K (the engine's TOP_K); a
  // larger pool says so, never "N sales" over a median of fewer
  return n > k && k > 0
    ? `${FACE_LABEL.compsSub} · ${k} closest of ${n.toLocaleString()} sales`
    : `${FACE_LABEL.compsSub} · ${n.toLocaleString()} ${n === 1 ? 'sale' : 'sales'}`;
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
  // the engine's flag read off the value directly
  const sig = (lot.signal !== undefined ? lot.signal : engineFlagOf(lot)) as
    (NonNullable<AuctionLot['signal']> & { med?: number }) | null;

  const ep = enginePoolOf(lot.value);
  const flagMed = sig?.med;
  const comps: FaceComps | null = ep
    ? { med: ep.med, n: ep.n, ids: ep.ids, text: fmtFace(ep.med), sub: compsSub(ep.n, ep.ids.length) }
    : flagMed != null && flagMed > 0
      ? { med: flagMed, n: sig!.basis || 0, ids: [], text: fmtFace(flagMed), sub: compsSub(sig!.basis || 0, 0) }
      : null;

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
export interface DecisionWorth { usd: number; text: string; title: string }
export interface DecisionGap { usd: number; dir: 'room' | 'over'; text: string }
export interface DecisionWhen { ms: number; timed: boolean; text: string }
export interface Decision {
  close: DecisionClose | null;
  worth: DecisionWorth | null;
  /** no max bid, and the engine abstained explicitly ("no engine read") */
  abstained: boolean;
  gap: DecisionGap | null;
  when: DecisionWhen | null;
}

/** a gap prints only when the two figures are at least this far apart */
export const DECISION_GAP_MIN = 0.10;

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
  const worth: DecisionWorth | null = mb && mb.hammer > 0
    ? { usd: mb.hammer, text: `worth up to ${fmtFace(mb.hammer)}`, title: `lectr’s max bid ${mb.text} — ${mb.sub}` }
    : null;
  const ab = (lot.value as { abstain?: string | null } | null | undefined)?.abstain;
  const abstained = !worth && typeof ab === 'string' && ab.length > 0;

  let gap: DecisionGap | null = null;
  if (close && worth) {
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

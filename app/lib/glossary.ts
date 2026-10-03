/**
 * glossary.ts — lectr's vocabulary in plain language, ONE source.
 *
 * Every page that prints a desk word (Flags, the Gap, odds, forming…) renders
 * it through <Term id="…"> (app/components/Term.tsx), which shows `short` on
 * hover / focus / tap; /glossary prints every entry with its `long` text.
 * Written from docs/ENGINE_LANES.md and the engine code (app/lib/value.ts,
 * app/lib/lanes.ts, app/lib/premiums.ts) — when a threshold there moves, the
 * sentence here moves with it. Say what the number IS and where it stops;
 * never sell it.
 */

export interface GlossaryEntry {
  id: string;
  /** the word as the desk prints it */
  term: string;
  /** one or two sentences — the hover/tap definition */
  short: string;
  /** the /glossary paragraph: what it is, how it is made, where it stops */
  long: string;
  /** where on the site the word lives */
  seeAlso?: { label: string; href: string };
}

export const GLOSSARY: GlossaryEntry[] = [
  {
    id: 'flags',
    term: 'Flags',
    short: 'Live lots whose comparable sales sit well above the house estimate, at odds the record backs. lectr’s one certified call.',
    long: 'A lot is flagged when the median of its comparable sales is at least 1.3× the house estimate AND, historically, at least half of the calls at that comp-to-estimate ratio sold above the high estimate. A flag says the estimate looks low — it does not say the lot will be cheap: flagged lots have tended to hammer above their estimate. The Flags are the only lane ranked by odds and the only one with a replayed record.',
    seeAlso: { label: 'The value desk', href: '/value' },
  },
  {
    id: 'gap',
    term: 'the Gap',
    short: 'No-estimate lots whose projected closing price is still well under the value floor. A projection, not a certified call.',
    long: 'For lots with no house estimate (mostly bid-only card and memorabilia houses), lectr projects the closing price from today’s bid using a close-day growth curve fitted from past bid histories, then compares that projection to the value floor. A lot sits in the Gap when the projected close is 25–90% under the floor and it closes within 3.5 days (“at the wire”), or 40–90% under and 3.5–8 days out (“forming”). Lots with an estimate, condition flags or no gated floor never enter. The Gap keeps its own record, separate from the Flags.',
    seeAlso: { label: 'The value desk', href: '/value' },
  },
  {
    id: 'sleepers',
    term: 'Sleepers',
    short: 'Fairly priced lots with zero bids, closing within a week. A read on attention, not on price.',
    long: 'A Sleeper is a lot whose price is verified fair — the comps sit 0.75–1.3× the estimate midpoint (both all-in), or, with no estimate, the engine appraised it at medium or high confidence — that has no bids and closes within 7 days. It only exists where a house shows its live bidding; houses that hide their book (most watch, art and design sales) never produce Sleepers. Figures stay in neutral ink until the lane’s record grades.',
    seeAlso: { label: 'The value desk', href: '/value' },
  },
  {
    id: 'odds',
    term: 'odds',
    short: 'Of past calls at this comp-to-estimate ratio, the share that sold above the high estimate. Refit nightly from the record.',
    long: 'Odds are a calibration, not a forecast for this one lot: lectr groups its past calls by how far the comps sat above the estimate and measures how often each group beat the high estimate. A lot inherits the rate of its group. Many lots share the same bucket, which is why the same figure repeats down a board. Odds below 50% never flag.',
    seeAlso: { label: 'The record', href: '/receipts' },
  },
  {
    id: 'confidence',
    term: 'confidence',
    short: 'High, medium or low — how much the comparable sales agree. High needs 6+ close comps in a tight band; medium 4+.',
    long: 'Each appraisal carries a tier from the size of its comp pool, how closely the comps match the lot, and how spread their prices are. High needs at least six comps, a strong match (or four exact-reference/edition matches) and a tight price spread; medium needs four. A tier is then demoted if, in that market, the record shows it missing by more than its ceiling (30% median error for high, 50% for medium). Low-confidence reads never set a value floor.',
  },
  {
    id: 'expected-hammer',
    term: 'expected hammer',
    short: 'The hammer price the engine expects — its all-in appraisal with the buyer’s premium taken off, so it compares directly with the house estimate.',
    long: 'Auction estimates are quoted on the hammer; realized prices include the buyer’s premium. lectr appraises on the all-in basis (what buyers actually paid for comparable lots) and divides by the house’s premium schedule to state the same figure on the hammer basis. It is a median of comparable sales, carried to today — not a guarantee of the room.',
  },
  {
    id: 'max-bid',
    term: 'max bid',
    short: 'A walk-away hammer: the value floor with the buyer’s premium taken off. Bid above it and you pay more than the floor all-in.',
    long: 'Max bid converts the value floor into the number you would actually bid in the room, by removing the house’s buyer’s premium. It is a discipline line, not a prediction: it says where the comps stop supporting the price, not where the lot will hammer. No gated floor, no max bid.',
  },
  {
    id: 'comps-median',
    term: 'comps median',
    short: 'The median all-in price of the lot’s comparable sales — same maker, same form, similar size. Medians, never means.',
    long: 'Comparable sales are past auction results for the same maker and form, size-banded where size matters, matched on title and reference. Asking prices never enter. The median is taken over the realized, buyer’s-premium-included prices, each carried to today by its market’s index. One outlier cannot drag a median the way it drags a mean.',
  },
  {
    id: 'value-floor',
    term: 'value floor',
    short: 'The engine’s conservative lower bound — the appraisal’s low end at medium-or-better confidence, else 0.85× the exact-card median at 3+ sales.',
    long: 'One rule, used everywhere a floor appears: the low end of the engine’s appraisal band, but only when the appraisal is medium or high confidence; otherwise 85% of the median of exact-card comps when there are at least three; otherwise no floor at all. The Gap and max bid both lean on it, so neither exists when the floor does not.',
  },
  {
    id: 'record',
    term: 'the record',
    short: 'Every call graded against the hammer it predicted — the replayed backtest plus the forward tape of calls logged before their outcomes.',
    long: 'The track record has two parts that are never summed. The replay re-runs the engine over past sales using only data known before each sale. The forward tape is append-only: a call is written the night it is made and graded when its lot hammers. Each lane publishes its numbers only after 20 graded calls.',
    seeAlso: { label: 'The record', href: '/receipts' },
  },
  {
    id: 'forming',
    term: 'forming',
    short: '3.5–8 days from the close. The projection is still loose, so the bar is stricter: 40% under the floor instead of 25%.',
    long: 'Lots far from the close have most of their bidding ahead of them, so a projection made a week out is wide. Forming lots are shown so you can watch them, ranked below the wire, and must sit at least 40% under the floor to appear. Past 8 days the projection curve has no fitted data, so lectr makes no read at all.',
  },
  {
    id: 'at-the-wire',
    term: 'at the wire',
    short: 'Closing within 3.5 days — close enough that the close-day projection is at its most accurate.',
    long: 'At the wire is the Gap’s main shelf: lots inside 3.5 days of the close whose projected all-in price is 25–90% under the value floor. The 90% cap exists because a lot that far under usually means the floor is wrong (a damaged or misidentified item), not that the lot is a steal.',
  },
  {
    id: 'abstain',
    term: 'abstain',
    short: 'The engine declines to put a number on a lot when the comps are too few, too loose or too spread. A blank beats a wrong number.',
    long: 'lectr abstains when fewer than three usable comps survive, when only a loose proxy (such as a player-level median for a specific card) is available, or when a sanity check fails. An abstaining lot shows no value, no floor and no flag — never a guessed figure dressed as a read.',
  },
];

const BY_ID = new Map(GLOSSARY.map(e => [e.id, e]));

export type GlossaryId = (typeof GLOSSARY)[number]['id'];

export function glossaryEntry(id: string): GlossaryEntry | undefined {
  return BY_ID.get(id);
}

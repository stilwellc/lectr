/**
 * premiums.ts — the per-house buyer's-premium schedule.
 *
 * Everything premium-aware previously leaned on one flat 1.25× fallback
 * (backtest-core PREMIUM_FALLBACK). Actual schedules run 1.175×–1.28× and the
 * big three tier by hammer band — a ~10% cross-house bias on comp medians and
 * the blocker for max-bid guidance ("your walk-away hammer for this band").
 *
 * Sources: measured corpus ratios where hammer+premium pairs exist
 * (Goldin med 1.220 n=182k; Bonhams 1.250 n=16k p90 1.28; Wright 1.250
 * n=16k), bid-increment quantization reverse-derivation (REA 1.175 — the
 * integrity audit's $6,463 = $5,500 × 1.175 clusters), and published fee
 * schedules for the rest. A lot's own stamped buyerPremiumPct always wins.
 */

// flat factors (realized = hammer × factor)
const FLAT: Record<string, number> = {
  'Goldin': 1.22,          // measured 1.220 (2022-24 rows run 1.20)
  'REA': 1.175,            // derived from increment quantization
  'Huggins & Scott': 1.195,
  'SCP': 1.20,
  'Lelands': 1.20,
  'Memory Lane': 1.20,
  'Love of the Game': 1.195,
  'RR Auction': 1.25,
  'Wright': 1.25,          // measured 1.250
  'Rago': 1.25,
  'LAMA': 1.25,
};

// tiered schedules for the estimate houses (hammer-USD bands, descending BP)
const TIERED: Record<string, [number, number][]> = {
  // [band ceiling, factor] — first band whose ceiling >= hammer wins
  "Sotheby's": [[1_000_000, 1.27], [4_500_000, 1.21], [Infinity, 1.15]],
  "Christie's": [[1_000_000, 1.26], [6_000_000, 1.21], [Infinity, 1.15]],
  'Phillips': [[1_000_000, 1.27], [4_500_000, 1.21], [Infinity, 1.15]],
  'Bonhams': [[1_000_000, 1.28], [Infinity, 1.20]], // measured p90 1.28 low bands
};

/** realized = hammer × factor for this house at this hammer level. */
export function houseAllInFactor(house: string | null | undefined, hammerUsd?: number | null): number {
  if (!house) return 1.25;
  const tiers = TIERED[house];
  if (tiers) {
    const h = hammerUsd && hammerUsd > 0 ? hammerUsd : 0;
    for (const [ceil, f] of tiers) if (h <= ceil) return f;
    return tiers[tiers.length - 1][1];
  }
  return FLAT[house] ?? 1.25;
}

/** ERA-DATED premium schedules (Oct 5 2026) — houses whose buyer's premium
 *  changed over the years the corpus spans. [first saleDate (YYYY-MM-DD) the
 *  rate applies to, factor], ascending; a saleDate before the first entry takes
 *  the first rate.
 *
 *  REA (183k rows, 2004 → today, NO stamped buyerPremiumPct/hammer). MEASURED
 *  on the corpus by increment quantization: for every sold REA row ≥ $1,000,
 *  the share whose price ÷ factor is a round flat bid increment is ~100% for
 *  exactly ONE factor per sale and ~0% for the neighbours (≥ 85% where the
 *  remainder are off-ladder bids), with clean break points between sales:
 *    2004 (Apr)                  1.15   100%
 *    2005 – 2006                 1.16   100%
 *    2007 – 2011                 1.175  100%
 *    2012 – Spring 2014 (Apr)    1.185  100%
 *    Fall 2014 (Oct) – Jul 2025  1.20   85–100%
 *    Sep 2025 → today            1.23   79–90%
 *  CONFIRMED against REA's published terms ("A N% buyer's premium will be
 *  added to all winning bids" — one flat rate, no card/cash variant; checked
 *  Oct 5 2026 on Wayback captures):
 *    15%   web.archive.org/web/20040302013238/http://www.robertedwardauctions.com/site/terms.asp
 *    16%   web.archive.org/web/20051109084900/http://www.robertedwardauctions.com/site/terms.asp
 *    17.5% web.archive.org/web/20071009013020/http://bid.robertedwardauctions.com/terms.aspx
 *    18.5% web.archive.org/web/20120511121233/http://bid.robertedwardauctions.com/terms.aspx
 *          (still 18.5% at …/20140407193704/…/terms.aspx)
 *    20%   web.archive.org/web/20150301124756/http://bid.robertedwardauctions.com/terms.aspx
 *          (… through …/20250801160420/https://bid.collectrea.com/terms-and-conditions)
 *    23%   web.archive.org/web/20251006210043/https://bid.collectrea.com/terms-and-conditions
 *          effective Sep 1 2025 (REA customer notice, reported by postwarcards.com).
 *  The capture dates lag the changes; the boundaries below are the sale
 *  seasons the corpus quantization pins (Spring 2014 = 18.5, Fall 2014 = 20).
 *
 *  USED BY the price-bleed sentinel's honesty test (scripts/assemble.ts
 *  computeSentinel): the 29+ standing REA "poison" signatures were real flat
 *  increments × the OLDER premiums that the flat 1.175 could not see. And
 *  (Oct 5 2026, engine) by lotAllInFactor → inferHammerUsd / buyerFields /
 *  vsBidRead whenever the lot carries a saleDate: measured on the live book
 *  (Sep 14 snapshot, 145 REA lots sold by Oct 5, true hammer = realized ÷ the
 *  era premium) the served expected hammer moved median abs error 40.3% →
 *  34.8%, ±30% 37.9% → 46.2%, hammers ≤ max bid 57.9% → 49.7% (nominal 30);
 *  all-in figures are unchanged by construction. docs/ENGINE_LANES.md §10. */
export const DATED_PREMIUMS: Record<string, Array<[string, number]>> = {
  REA: [
    ['0000-01-01', 1.15],
    ['2005-01-01', 1.16],
    ['2007-01-01', 1.175],
    ['2012-01-01', 1.185],
    ['2014-07-01', 1.20],
    ['2025-09-01', 1.23], // REA's stated effective date
  ],
};

/** ERA-DATED TIERED schedules (Oct 5 2026) — Christie's and Sotheby's.
 *  premium = rates[0] on the hammer up to ceilings[0], rates[1] on the part
 *  between ceilings[0] and ceilings[1], rates[2] above (marginal bands). The
 *  thresholds are PUBLISHED PER SALE CURRENCY (they are not FX translations of
 *  the dollar band), so `ceilings` is keyed by currency; a currency missing
 *  from an era has no tiered read (callers fall back to the undated schedule).
 *  `rateOverride` = a saleroom currency that charged a different rate set.
 *
 *  HOW EACH ERA WAS PINNED: corpus increment quantization on premiumNative
 *  (Oct 5 2026 R2 segments, 77k Christie's + 60k Sotheby's sold rows): the
 *  band-1 rate is the one factor under which ~100% of low lots come back as
 *  round hammers (neighbours ~0%); the band-1 ceiling is the grid value under
 *  which the lots ABOVE it also invert to round hammers (98–100% where n ≥ 50);
 *  the era boundary is the first sale that switches. The published terms
 *  (cited per era) supply band-2 ceilings and the upper rates, which the
 *  corpus can only sparsely confirm. Known exception NOT modelled: Christie's
 *  South Kensington kept 17.5% until Mar 2004 while King Street went 19.5% in
 *  Jun 2002 (same GBP) — a CSK repeat cluster in that window reads as poison
 *  (the safe direction).
 *
 *  USED BY the sentinel honesty test only (scripts/assemble.ts
 *  computeSentinel → houseHammerFromAllInAt). NOT wired into lotAllInFactor /
 *  inferHammerUsd — that is the engine owner's call. */
type TieredEra = { from: string; rates: number[]; ceilings: Record<string, number[]>; rateOverride?: Record<string, number[]> };
export const DATED_TIERED_PREMIUMS: Record<string, TieredEra[]> = {
  // Christie's — captures of christies.com's buyer's-premium page (checked Oct 5 2026):
  //   A  web.archive.org/web/20010806212137/http://www.christies.com:80/howtobuy/buyers_premium.asp
  //   B  web.archive.org/web/20021015202936/http://www.christies.com:80/howtobuy/buyers_premium.asp
  //   C  web.archive.org/web/20030608085235/http://www.christies.com:80/howtobuy/buyers_premium.asp
  //   D  web.archive.org/web/20080814011436/http://www.christies.com:80/features/guides/buying/buyers-premium.aspx
  //   E  web.archive.org/web/20081101172651/http://www.christies.com:80/features/guides/buying/buyers-premium.aspx
  //   F  web.archive.org/web/20130807115924/http://www.christies.com:80/features/guides/buying-guide/related-information/buyers-premium
  //   G  web.archive.org/web/20131204161516/http://www.christies.com:80/features/guides/buying-guide/related-information/buyers-premium/
  //   H  web.archive.org/web/20161101075738/http://www.christies.com:80/buying-services/buying-guide/financial-information
  //   I  web.archive.org/web/20171101165246/…/buying-services/buying-guide/financial-information/
  //   J  web.archive.org/web/20190320144625/…/financial-information/      K  web.archive.org/web/20201204183701/…/financial-information/
  //   L  web.archive.org/web/20220603075758/…/financial-information/      M  web.archive.org/web/20230530081838/…/financial-information/
  //   N  web.archive.org/web/20251119152735/https://www.christies.com/en/help/buying-guide-important-information/financial-information
  //   O  web.archive.org/web/20260929120322/https://www.christies.com/en/help/buying-guide-important-information/financial-information
  //   P  antiquesandthearts.com/christies-modifies-buyers-premium-again/ (Jan 2005)
  //   Q  antiquestradegazette.com/news/2007/christie-s-match-sotheby-s-on-new-buyer-s-premium-rates/ (Feb 2007)
  //   R  iphotocentral.com/news/article-view.php/1/142/133/768/1/6/10 (Sep 2007; press, weak)
  "Christie's": [
    // corpus only (no capture before 2001): 15% → $50k / £30k / CHF70k / HK$400k, 10% above — 95–100% round in USD/CHF/HKD
    { from: '1993-01-01', rates: [0.15, 0.10], ceilings: { USD: [50_000], GBP: [30_000], CHF: [70_000], HKD: [400_000] } },
    // A (start date not printed; corpus: last 15% sale Mar 30 2000, first 17.5% Apr 5 2000)
    { from: '2000-04-01', rates: [0.175, 0.10], ceilings: { USD: [80_000], GBP: [50_000], HKD: [600_000] } },
    // B, effective 15 Apr 2002. King Street GBP; South Kensington stayed 17.5% to £50k until 30 Mar 2004 and
    // Paris 17.5% to €110k until 2005 — neither modelled (EUR omitted; a CSK cluster reads poison, the safe side)
    { from: '2002-04-15', rates: [0.195, 0.10], ceilings: { USD: [100_000], GBP: [70_000], CHF: [160_000], HKD: [780_000] } },
    // C, effective 1 Mar 2003: 12% above the band (corpus: 10% through Dec 2002, 12% by Apr 2003)
    { from: '2003-03-01', rates: [0.195, 0.12], ceilings: { USD: [100_000], GBP: [70_000], CHF: [160_000], HKD: [850_000] } },
    // P: 20% from 1 Jan 2005 ($100k), band widened 17 Jan 2005; EUR thresholds 2005–07 not found → omitted
    { from: '2005-01-01', rates: [0.20, 0.12], ceilings: { USD: [100_000], GBP: [70_000] } },
    { from: '2005-01-17', rates: [0.20, 0.12], ceilings: { USD: [200_000], GBP: [100_000], CHF: [250_000], HKD: [1_500_000] } },
    // Q, 5 Feb 2007
    { from: '2007-02-05', rates: [0.20, 0.12], ceilings: { USD: [500_000], GBP: [250_000] } },
    // R ~1 Sep 2007 (corpus: first 25% sale Sep 10 2007 NY / Sep 18 London); CHF/HKD band-1 tops corpus-pinned
    // (CHF 20k: 91% of 235 lots above it round; HK$150k: 100% of 149), band 2 not published → CHF/HKD c2 = the 2008 value
    { from: '2007-09-01', rates: [0.25, 0.20, 0.12], ceilings: { USD: [20_000, 500_000], GBP: [10_000, 250_000], EUR: [5_000, 400_000], CHF: [20_000, 1_200_000], HKD: [150_000, 8_000_000] } },
    // D, 2 Jun 2008
    { from: '2008-06-02', rates: [0.25, 0.20, 0.12], ceilings: { USD: [50_000, 1_000_000], GBP: [25_000, 500_000], EUR: [10_000, 700_000], CHF: [60_000, 1_200_000], HKD: [400_000, 8_000_000] } },
    // E, Paris only (between the 2 Oct and 1 Nov 2008 captures)
    { from: '2008-10-15', rates: [0.25, 0.20, 0.12], ceilings: { USD: [50_000, 1_000_000], GBP: [25_000, 500_000], EUR: [20_000, 800_000], CHF: [60_000, 1_200_000], HKD: [400_000, 8_000_000] } },
    // F, 11 Mar 2013 (corpus agrees to the pound: London £37,500)
    { from: '2013-03-11', rates: [0.25, 0.20, 0.12], ceilings: { USD: [75_000, 1_500_000], GBP: [37_500, 750_000], EUR: [30_000, 1_200_000], CHF: [75_000, 1_500_000], HKD: [600_000, 12_000_000] } },
    // G, 30 Sep 2013
    { from: '2013-09-30', rates: [0.25, 0.20, 0.12], ceilings: { USD: [100_000, 2_000_000], GBP: [50_000, 1_000_000], EUR: [30_000, 1_200_000], CHF: [100_000, 2_000_000], HKD: [800_000, 15_000_000] } },
    // H, 19 Sep 2016
    { from: '2016-09-19', rates: [0.25, 0.20, 0.12], ceilings: { USD: [150_000, 3_000_000], GBP: [100_000, 2_000_000], EUR: [50_000, 1_600_000], CHF: [150_000, 2_500_000], HKD: [1_200_000, 20_000_000] } },
    // I, 11 Sep 2017
    { from: '2017-09-11', rates: [0.25, 0.20, 0.125], ceilings: { USD: [250_000, 4_000_000], GBP: [175_000, 3_000_000], EUR: [150_000, 2_000_000], CHF: [250_000, 4_000_000], HKD: [2_000_000, 30_000_000] } },
    // J, 1 Feb 2019
    { from: '2019-02-01', rates: [0.25, 0.20, 0.135], ceilings: { USD: [300_000, 4_000_000], GBP: [225_000, 3_000_000], EUR: [200_000, 2_500_000], CHF: [300_000, 4_000_000], HKD: [2_500_000, 30_000_000] } },
    // K, 21 Sep 2020
    { from: '2020-09-21', rates: [0.25, 0.20, 0.145], ceilings: { USD: [600_000, 6_000_000], GBP: [450_000, 4_500_000], EUR: [400_000, 4_000_000], CHF: [600_000, 6_000_000], HKD: [5_000_000, 50_000_000] } },
    // L, 7 Feb 2022
    { from: '2022-02-07', rates: [0.26, 0.20, 0.145], ceilings: { USD: [1_000_000, 6_000_000], GBP: [700_000, 4_500_000], EUR: [700_000, 4_000_000], CHF: [900_000, 6_000_000], HKD: [7_500_000, 50_000_000] } },
    // M, 17 Apr 2023
    { from: '2023-04-17', rates: [0.26, 0.21, 0.15], ceilings: { USD: [1_000_000, 6_000_000], GBP: [800_000, 4_500_000], EUR: [800_000, 4_000_000], CHF: [900_000, 6_000_000], HKD: [7_500_000, 50_000_000] } },
    // N, 1 Sep 2025 (one NY online sale closing Oct 22 2025 still priced at 26% — reads poison if it ever clusters)
    { from: '2025-09-01', rates: [0.27, 0.22, 0.15], ceilings: { USD: [1_500_000, 8_000_000], GBP: [1_000_000, 6_000_000], EUR: [1_200_000, 7_000_000], CHF: [1_200_000, 6_500_000], HKD: [10_000_000, 60_000_000] } },
    // O, 1 Sep 2026
    { from: '2026-09-01', rates: [0.28, 0.22, 0.15], ceilings: { USD: [2_000_000, 8_000_000], GBP: [1_500_000, 6_000_000], EUR: [1_750_000, 7_000_000], CHF: [1_600_000, 7_000_000], HKD: [15_000_000, 60_000_000] } },
  ],
  // Sotheby's — its SEC filings (S = www.sec.gov/Archives/edgar/data/823094/) and rate-chart captures:
  //   a  S000100547701500349/form10-q.txt (10-Q Aug 2001)
  //   b  web.archive.org/web/20020607081235/http://www.sothebys.com:80/help/faq/buyerspremium.html
  //   c  S000095011703001004/a34642.txt (10-K Mar 2003)       d  S000095011705000990/a39405.htm (10-K Mar 2005)
  //   e  S000093041307001853/c46683_10k.htm (10-K Mar 2007)   f  S000093041308002972/c53471_10-q.htm (10-Q May 2008)
  //   g  S000093041309002535/c57505_10q.htm (10-Q May 2009)   h  S000082309413000005/bid-12312012x10k.htm (10-K Feb 2013)
  //   i  web.archive.org/web/20160121192629/http://www.sothebys.com/content/dam/sothebys/PDFs/buyerspremium/Buyers_Premium_2015.pdf
  //   j  S000082309417000009/bid1231201610k_xbrl2016.htm      k  S000082309417000056/bid9302017-10q_xbrl2017.htm
  //   l  web.archive.org/web/20220306055428/http://www.sothebys.com/content/dam/sothebys/PDFs/buyerspremium/June-2018-Buyers-Premium.pdf
  //   m  web.archive.org/web/20220306001202/http://www.sothebys.com/content/dam/sothebys/PDFs/buyerspremium/February-2019-Buyers-Premium.pdf
  //   n  web.archive.org/web/20210509135509/https://www.sothebys.com/1-february-2021-buyers-premium.pdf (+1% overhead premium on hammer)
  //   o  www.sec.gov/Archives/edgar/data/1979634/000149315223020025/partiiandiii.htm (Masterworks 1-A, 2023: 26/21/14.9 to $1M/$4.5M)
  //   p  artnews.com/art-news/news/sothebys-overhauls-fee-structure-lowers-buyers-premium-1234694742/ (2024 overhaul)
  //   q  en.thevalue.com/articles/sothebys-reverts-to-previous-fees-structure (Feb 2025)
  //   r  help.sothebys.com/en/support/solutions/articles/44002686902 +
  //      antiquestradegazette.com/news/2026/sotheby-s-raises-buyer-s-premium-to-28-at-the-lower-tier
  // Non-USD band-1 tops before 2015 are corpus-pinned (no capture found); Sotheby's sets them as rounded
  // local figures, not FX translations.
  "Sotheby's": [
    // a, 1 Apr 2000 (corpus: GBP 15% through Apr 13 2000, 20% from May); GBP/CHF tops corpus-pinned (97–98% above them round)
    { from: '2000-04-01', rates: [0.20, 0.15, 0.10], ceilings: { USD: [15_000, 100_000], GBP: [10_000, 60_000], CHF: [25_000, 150_000] } },
    // b, 1 Apr 2002: Bond St £70k; Olympia/Sussex 17.5% to £50k (not modelled — those London clock/watch sales read
    // poison, the safe side); Hong Kong 18% to HK$1M then 10%; EUR differs by saleroom (Paris/Milan) → omitted
    { from: '2002-04-01', rates: [0.195, 0.10], ceilings: { USD: [100_000], GBP: [70_000], CHF: [170_000], HKD: [1_000_000] }, rateOverride: { HKD: [0.18, 0.10] } },
    // c, Jan 2003
    { from: '2003-01-01', rates: [0.20, 0.12], ceilings: { USD: [100_000], GBP: [70_000], CHF: [100_000], HKD: [800_000] } },
    // d, 1 Jan 2005 ("other currencies set as fixed local translations")
    { from: '2005-01-01', rates: [0.20, 0.12], ceilings: { USD: [200_000], GBP: [100_000], EUR: [150_000], CHF: [250_000], HKD: [1_500_000] } },
    // e, 12 Jan 2007
    { from: '2007-01-12', rates: [0.20, 0.12], ceilings: { USD: [500_000], GBP: [250_000] } },
    // f, 1 Sep 2007 (non-USD tops corpus-pinned: £10k 99% of 238 lots above it round, €5k 94%, CHF20k 98%)
    { from: '2007-09-01', rates: [0.25, 0.20, 0.12], ceilings: { USD: [20_000, 500_000], GBP: [10_000, 250_000], EUR: [5_000, 400_000], CHF: [20_000, 500_000] } },
    // g, 1 Jun 2008 (corpus: £25k 100% of 445, €15k 94% of 160, CHF50k 100% of 84, HK$400k 100% of 87)
    { from: '2008-06-01', rates: [0.25, 0.20, 0.12], ceilings: { USD: [50_000, 1_000_000], GBP: [25_000, 500_000], EUR: [15_000, 700_000], CHF: [50_000, 1_000_000], HKD: [400_000, 8_000_000] } },
    // h, 15 Mar 2013
    { from: '2013-03-15', rates: [0.25, 0.20, 0.12], ceilings: { USD: [100_000, 2_000_000], GBP: [50_000, 1_000_000], EUR: [30_000, 1_200_000], CHF: [100_000, 2_000_000], HKD: [800_000, 15_000_000] } },
    // i, 1 Feb 2015
    { from: '2015-02-01', rates: [0.25, 0.20, 0.12], ceilings: { USD: [200_000, 3_000_000], GBP: [100_000, 1_800_000], EUR: [60_000, 1_800_000], CHF: [200_000, 3_000_000], HKD: [1_600_000, 22_500_000] } },
    // j, 13 Nov 2016 ("other currencies commensurate"; corpus: £175k, €150k, CHF250k, HK$2M)
    { from: '2016-11-13', rates: [0.25, 0.20, 0.125], ceilings: { USD: [250_000, 3_000_000], GBP: [175_000, 2_000_000], EUR: [150_000, 2_000_000], CHF: [250_000, 3_000_000], HKD: [2_000_000, 25_000_000] } },
    // k, 1 Nov 2017 (non-USD = the l chart's; GBP left out — no band-1 top on the grid inverts the London lots
    // above it (n=17) until the Jun 2018 chart, so London Nov 2017–May 2018 has no tiered read)
    { from: '2017-11-01', rates: [0.25, 0.20, 0.129], ceilings: { USD: [300_000, 3_000_000], EUR: [180_000, 2_000_000], CHF: [300_000, 4_000_000], HKD: [2_400_000, 31_000_000] } },
    // l, 2 Jun 2018
    { from: '2018-06-02', rates: [0.25, 0.20, 0.129], ceilings: { USD: [300_000, 4_000_000], GBP: [200_000, 3_000_000], EUR: [180_000, 2_000_000], CHF: [300_000, 4_000_000], HKD: [2_400_000, 31_000_000] } },
    // m, 25 Feb 2019
    { from: '2019-02-25', rates: [0.25, 0.20, 0.139], ceilings: { USD: [400_000, 4_000_000], GBP: [300_000, 3_000_000], EUR: [250_000, 2_500_000], CHF: [400_000, 4_000_000], HKD: [3_500_000, 31_000_000] } },
    // n: the +1% overhead premium makes it 26/21/14.9 all-in; the corpus shows it from the first Oct 2020 sale
    { from: '2020-10-01', rates: [0.26, 0.21, 0.149], ceilings: { USD: [400_000, 4_000_000], GBP: [300_000, 3_000_000], EUR: [250_000, 2_500_000], CHF: [400_000, 4_000_000], HKD: [3_500_000, 31_000_000] } },
    // o (in force by Jul 2022; corpus: old bands through Dec 2021, $1M band from the May 2022 sales);
    // non-USD: £800k per r's "prior UK ceiling", HK$7.5M corpus-pinned, EUR/CHF assumed
    { from: '2022-02-01', rates: [0.26, 0.21, 0.149], ceilings: { USD: [1_000_000, 4_500_000], GBP: [800_000, 3_800_000], EUR: [800_000, 3_800_000], CHF: [1_000_000, 4_500_000], HKD: [7_500_000, 35_000_000] } },
    // corpus only: 27% from the first Feb 2023 sale (no capture found); upper bands as o
    { from: '2023-02-01', rates: [0.27, 0.21, 0.15], ceilings: { USD: [1_000_000, 4_500_000], GBP: [800_000, 3_800_000], EUR: [800_000, 3_800_000], CHF: [1_000_000, 4_500_000], HKD: [7_500_000, 35_000_000] } },
    // p (~May 2024; corpus: last 27% sale May 15, first 20% sale May 24): 20% to $6M, 10% above; non-USD tops unpublished
    { from: '2024-05-20', rates: [0.20, 0.10], ceilings: { USD: [6_000_000], GBP: [4_500_000], EUR: [5_000_000], CHF: [5_000_000], HKD: [45_000_000] } },
    // q, 17 Feb 2025 (band 2 to $8M; one source says $4.5M — the corpus prefers $8M)
    { from: '2025-02-17', rates: [0.27, 0.22, 0.15], ceilings: { USD: [1_000_000, 8_000_000], GBP: [800_000, 6_000_000], EUR: [800_000, 6_000_000], CHF: [1_000_000, 8_000_000], HKD: [7_500_000, 60_000_000] } },
    // r, 13 Feb 2026
    { from: '2026-02-13', rates: [0.28, 0.22, 0.15], ceilings: { USD: [2_000_000, 8_000_000], GBP: [1_500_000, 6_000_000], EUR: [1_750_000, 7_000_000], CHF: [1_600_000, 7_000_000], HKD: [15_000_000, 60_000_000] } },
  ],
};

const isoDay = (saleDate: string | null | undefined): string | null => {
  const d = typeof saleDate === 'string' ? saleDate.slice(0, 10) : '';
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
};

/** The tiered schedule a lot sold under: `rates` per band, `ceilings` = the
 *  band tops in the SALE currency (rates.length === ceilings.length + 1).
 *  null when the house has no tiered eras, the date doesn't parse, the date
 *  precedes the table, or the era publishes no thresholds for that currency. */
export function tieredScheduleAt(house: string | null | undefined, saleDate: string | null | undefined, currency: string | null | undefined = 'USD'): { rates: number[]; ceilings: number[] } | null {
  const eras = house ? DATED_TIERED_PREMIUMS[house] : undefined;
  const d = isoDay(saleDate);
  if (!eras || !d) return null;
  let era: TieredEra | null = null;
  for (const e of eras) if (d >= e.from) era = e;
  const cur = (currency || 'USD').toUpperCase();
  const ceilings = era?.ceilings[cur];
  if (!era || !ceilings) return null;
  return { rates: era.rateOverride?.[cur] ?? era.rates, ceilings };
}

/** Premium-inclusive price for a hammer under a tiered schedule: rate₁ on the
 *  part of the hammer up to ceiling₁, rate₂ on the part between ceiling₁ and
 *  ceiling₂, … (marginal bands, like income-tax brackets — NOT one rate on the
 *  whole hammer). */
export function allInFromHammer(hammer: number, s: { rates: number[]; ceilings: number[] }): number {
  let premium = 0, lo = 0;
  for (let i = 0; i < s.rates.length; i++) {
    const hi = i < s.ceilings.length ? s.ceilings[i] : Infinity;
    if (hammer <= lo) break;
    premium += (Math.min(hammer, hi) - lo) * s.rates[i];
    lo = hi;
  }
  return hammer + premium;
}

/** The inverse: hammer from a premium-inclusive price. all-in is continuous and
 *  strictly increasing in hammer, so walk the bands: the all-in at each ceiling
 *  is a breakpoint, and inside a band hammer = ceiling_prev + (allIn − allIn_at_prev) ÷ (1 + rate). */
export function hammerFromAllIn(allIn: number, s: { rates: number[]; ceilings: number[] }): number {
  if (!(allIn > 0)) return 0;
  let lo = 0, loAllIn = 0;
  for (let i = 0; i < s.rates.length; i++) {
    const hi = i < s.ceilings.length ? s.ceilings[i] : Infinity;
    const hiAllIn = hi === Infinity ? Infinity : loAllIn + (hi - lo) * (1 + s.rates[i]);
    if (allIn <= hiAllIn) return lo + (allIn - loAllIn) / (1 + s.rates[i]);
    lo = hi; loAllIn = hiAllIn;
  }
  return lo;
}

/** The house's premium factor AT a sale date (realized = hammer × factor):
 *  REA's flat era rate; for Christie's / Sotheby's the BLENDED factor of the
 *  tiered schedule in force that day at that hammer (`currency` = the sale
 *  currency the hammer is in, default USD); else houseAllInFactor (same as
 *  undated). */
export function houseAllInFactorAt(house: string | null | undefined, hammerUsd: number | null | undefined, saleDate: string | null | undefined, currency?: string | null): number {
  const d = isoDay(saleDate);
  const tiered = tieredScheduleAt(house, d, currency);
  if (tiered) {
    const h = hammerUsd && hammerUsd > 0 ? hammerUsd : 0;
    return h > 0 ? allInFromHammer(h, tiered) / h : 1 + tiered.rates[0];
  }
  const eras = house ? DATED_PREMIUMS[house] : undefined;
  if (!eras || !d) return houseAllInFactor(house, hammerUsd);
  let f = eras[0][1];
  for (const [from, factor] of eras) if (d >= from) f = factor;
  return f;
}

/** HAMMER from a premium-inclusive price at a sale date, in the sale currency:
 *  the exact band-walk inverse for the tiered era schedules; otherwise
 *  allIn ÷ houseAllInFactorAt (REA's era rate, else the undated schedule read
 *  at the all-in figure — the sentinel's pre-Oct-5 behaviour). ONE schedule per
 *  call: the caller never shops across factors for a round answer. */
export function houseHammerFromAllInAt(house: string | null | undefined, allIn: number, saleDate: string | null | undefined, currency?: string | null): number {
  if (!(allIn > 0)) return 0;
  const tiered = tieredScheduleAt(house, saleDate, currency);
  if (tiered) return hammerFromAllIn(allIn, tiered);
  return allIn / houseAllInFactorAt(house, allIn, saleDate);
}

/** The factor for a specific lot: its own stamped premium wins, then the house
 *  schedule AS OF the lot's saleDate (era-dated houses), then the undated
 *  schedule. `usd` disambiguates the tiered houses' band. */
export function lotAllInFactor(lot: { auctionHouse?: string | null; buyerPremiumPct?: number | null; saleDate?: string | null }, usd?: number | null): number {
  const bp = lot.buyerPremiumPct;
  if (typeof bp === 'number' && bp > 0 && bp < 60) return 1 + bp / 100;
  // the premium IN FORCE on the lot's sale date (DATED_PREMIUMS; REA's eras) —
  // a sold lot's hammer, and a live lot's expected hammer / max bid at the
  // premium it will actually be charged. Undated lots take the house schedule.
  if (lot.saleDate) return houseAllInFactorAt(lot.auctionHouse, usd, lot.saleDate);
  return houseAllInFactor(lot.auctionHouse, usd);
}

/** Max-bid guidance: the walk-away HAMMER for a target all-in value. */
export function maxHammerFor(allInUsd: number, lot: { auctionHouse?: string | null; buyerPremiumPct?: number | null }): number {
  return Math.floor(allInUsd / lotAllInFactor(lot, allInUsd));
}

/** THE hammer inference (P1-5, Sep 2 2026): the lot's published hammer when
 *  it has one, else realized ÷ the lot's own premium factor (stamped
 *  buyerPremiumPct, then the house schedule; the tiered houses read the band
 *  off the realized figure, the closest proxy for the hammer band). Every
 *  hammer-basis read — indices.houseAccuracy, build-market houseCal +
 *  seasonality, the backtest's hammer perfs — goes through here; there is no
 *  flat /1.25 left in the engine. */
export function inferHammerUsd(lot: { auctionHouse?: string | null; buyerPremiumPct?: number | null; hammerUsd?: number | null; realizedUsd?: number | null; priceUsd?: number | null }): number {
  const h = lot.hammerUsd;
  if (typeof h === 'number' && h > 0) return h;
  const realized = (lot.realizedUsd && lot.realizedUsd > 0 ? lot.realizedUsd : lot.priceUsd) || 0;
  if (!(realized > 0)) return 0;
  return realized / lotAllInFactor(lot, realized);
}

/** Houses whose bid ladder is PERCENTAGE-based, not flat: each next bid is the
 *  current bid + 10%, unrounded (1,050 → 1,155 → 1,271 → 1,398 → 1,538 → 1,692 …).
 *  Measured on the Sep 27 audit: Memory Lane / Lelands / Love of the Game
 *  repeat-price clusters sit on exactly these rungs — a REAL geometric ladder,
 *  not placeholder prices (a null rule there would have wiped ~7k honest rows). */
export const BID_LADDER_PCT: Record<string, number> = {
  'Lelands': 0.10,
  'Memory Lane': 0.10,
  'Love of the Game': 0.10,
};

/** A percentage bid ladder to test against: `pct` per step, and `peers` = the
 *  OTHER prices that house repeatedly clears at (the ladder's observed rungs). */
export type BidLadder = { pct: number; peers: Iterable<number> };

/** Is `hammer` a round bid increment? Poisoned feeds stamp one arbitrary
 *  price across a batch ($10,050 ×3,622); honest repeats are increment ×
 *  premium ties ($1,000 × 1.22 = $1,220 ×40 inside one sale). Absolute
 *  tolerance on purpose: a relative one would bless any large number.
 *
 *  PERCENTAGE LADDERS (Sep 27 2026): a flat-step test can never see a 10%
 *  geometric ladder — its rungs are unrounded by construction. When a `ladder`
 *  is passed (the house's step pct + its other repeat prices), the value is ALSO
 *  honest if it sits ON that ladder: at least two neighbouring rungs, each one
 *  step (×(1+pct)) away, chained through the peer set (value ↔ rung ↔ rung, in
 *  either direction). Requiring a 3-rung chain keeps an isolated bleed from being
 *  blessed by one coincidental neighbour. Rung tolerance is ±max(1.5, 0.2%) —
 *  the ladder rounds each step to the dollar, so rounding drifts by <1/step. */
export function isRoundIncrement(hammer: number, tolUsd = 1, ladder?: BidLadder): boolean {
  if (!(hammer > 0)) return false;
  const step = hammer < 5_000 ? 50 : hammer < 50_000 ? 100 : hammer < 500_000 ? 500 : 1_000;
  const r = Math.round(hammer / step) * step;
  if (Math.abs(hammer - r) <= tolUsd) return true;
  if (!ladder || !(ladder.pct > 0)) return false;
  return onPercentLadder(hammer, ladder);
}

function onPercentLadder(v: number, ladder: BidLadder): boolean {
  const k = 1 + ladder.pct;
  const peers = Array.from(ladder.peers).filter(p => p > 0 && p !== v).sort((a, b) => a - b);
  if (peers.length < 2) return false;
  const tolOf = (x: number) => Math.max(1.5, x * 0.002);
  // binary-search a peer within tolerance of `target`
  const has = (target: number, exclude: number): number | null => {
    const tol = tolOf(target);
    let lo = 0, hi = peers.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (peers[mid] < target - tol) lo = mid + 1; else hi = mid - 1;
    }
    for (let i = lo; i < peers.length && peers[i] <= target + tol; i++) if (peers[i] !== exclude) return peers[i];
    return null;
  };
  const up = has(v * k, v), down = has(v / k, v);
  // v sits between two rungs, or at the end of a 3-rung run in either direction
  if (up !== null && down !== null) return true;
  if (up !== null && has(up * k, v) !== null) return true;
  if (down !== null && has(down / k, v) !== null) return true;
  return false;
}

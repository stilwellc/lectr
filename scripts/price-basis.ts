/**
 * price-basis.ts — the ONE price-basis declaration, stamped into meta.json.
 *
 * Why this file exists: the declaration was previously inlined in ray-crawl.ts
 * only. The segmented nightly runs `crawl` (per house) and then `assemble`, and
 * assemble rewrites meta.json from scratch — so it silently dropped the block on
 * every nightly. Production ran without it (verified 2026-08-06: meta.json on
 * lectr.bid carried no priceBasis at all). The declaration exists specifically
 * so the buyer's-premium mistake cannot be repeated, which makes a version that
 * quietly evaporates worse than none.
 *
 * Both writers now import this. Do not inline it again.
 */
export const PRICE_BASIS = {
  pricesIncludeBuyerPremium: true,
  note:
    'priceUsd is the price the buyer PAYS — the house\'s buyer premium is ' +
    'INCLUDED. Christie\'s, Sotheby\'s, Phillips, Bonhams, Wright and Rago ' +
    'all publish premium-inclusive prices (per-lot field: priceBasis). ' +
    'Estimates are the house\'s guess at the HAMMER, which excludes premium. ' +
    'So price-vs-estimate is "total cost vs what they guessed it would hammer ' +
    'at" and carries ~20-28pts of fee inside it BY DESIGN. This is the ' +
    'intended product read (what a buyer actually pays). Do NOT divide the ' +
    'premium out to make the number look better-behaved: only Bonhams ' +
    '(~14k lots) publishes a real per-lot hammer, so any deduction for ' +
    'Christie\'s + Sotheby\'s + Phillips (88% of the demand pool) is an ' +
    'INVENTED number. Consumers: app/lib/demand.ts and overEstimatePct in ' +
    'app/utils.ts — they must always share one basis.',
  estimatesAreHammerBasis: true,
  housesPublishingRealHammer: ['Bonhams'],
} as const;

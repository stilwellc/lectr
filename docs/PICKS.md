# PICKS — the standing law of "Lots you may like"

`app/lib/recs.ts` is ONE recommender for the profile's For-you room, the home
feed's For-you tab, the Today strip (`topOf`) and the Daily Desk email, so they
agree. This page is the law in one sitting; the file's header is the long form,
`app/lib/__tests__/recs*.test.ts` the proof. Last revised Oct 29 2026 (passes 1–6).

## 1 · What is weighed

The taste is a list of SEEDS, each with a weight by how strongly the reader
said it, × recency (a save or search halves every 120 days, floored at 0.4; a
follow does not decay):

| seed | weight | from |
|---|---|---|
| owned | 1.00 | a lot marked "I won it" |
| saved | 0.75 | a lot on the desk (live or settled) |
| follow | 0.55 | a maker / player / subject / category / house |
| search | 0.35 | a saved search (its own matcher) |
| signal | as given | this device: a lot opened .25, an entity page .20, a typed term .15, "More like this" .70 (recs-signals, never uploaded) |
| market | 0.30 | a quick-start market with no name in it |

"Not for me" bans the lot, quiets its card (×0.3) and name (×0.6 a pass), and
the seed that explained it (×0.75 a pass). A lot the device saw the reader OPEN
in the last 7 days is never dealt back unless the engine now reads it below
market (`negative.viewed`).

## 2 · The tie law (lotSim)

Nothing crosses a category or a sport. Inside one, a candidate ties to a seed
lot only through something REAL: the same named entity, the same card in any
grade, the same franchise, the same model line, or — in cards, TCG, space and
watches — a shared distinctive facet (era, grader, language, complication,
flown) in the same sub at a comparable price. Two WEAK ties exist, both saying
only the cut: in art, design and watches the same sub at your price ("More
prints in your range"); in cards the SPORT CUT — the same sport and sub within
~×2.5 of one save, spanning eras ("More hockey cards near your save's price").
Memorabilia, entertainment and historical lots are about WHO or WHAT: only the
entity or the franchise ties them. A category-level reach (a category or market
follow, a rung, a cut) must also pass the KIND gate (`object-kind.kindFits`): a
guitar is not a single, a menu is not a watch, a Type I photograph or a replica
jersey is not a card, a strategy guide is not a Pokémon card. A NAMED reach
does not (an Omega menu is still Omega's) — but its group noun says "pieces"
when the lot is not the kind.

    score = taste × (0.8 + 0.2·priority/100) × window × band × span × placed × quiet × lift

`priority` is the "matters most" score (app/lib/priority — it carries the
engine's edge). `window`: closing this week 1, ≤14 days 0.8, ≤30 days 0.55,
later 0.35, undated 0.45. `band`: the reader's learned band per category (≥3
priced saves, median ± 1.5 robust spreads, soft floor .45), else the stated
range (quick start; steeper, floor .2). `span` (pass 3): with no band, or one
too wide to print (> ×20), the prices owned and saved still hold — a lot past
their span by ×2 sinks on the band's kernel. `placed`: no price yet ×0.8; a
priced, dated lot with a bid ×1.05 (EVIDENCE — under the rotation band, a
tie-breaker only). `lift`: Below Market ×1.2 outside priority's EDGE_CATS; no
photo ×0.5.

## 3 · The ladder (when real ties run short, < 48 rows)

Rungs deal strictly below every real tie, each saying its rung and whose it is:

- **2 · another of the family** — another Pokémon, film, mission, team, set;
  another maker of the same category · sub near the anchor's prices; another
  player of the same sport and era. Another PERSON (every signer on the culture
  market is one family) needs a shared ANCHOR beyond the sub: the franchise the
  desk keeps (and only that when it keeps one), else the DOMAIN (film & TV /
  music by facet, a historical line, a space program), an ERA within 25 years,
  or the FORM of the object (photograph, letter, document, book, program,
  poster, print, prop, record — never a bare signature cut). Two domains that
  disagree veto. The reason says which: "Another film & TV figure", "Another
  signed letter", "Another figure of the 1950s". In sports memorabilia a
  player rung keeps the sub (a ticket desk is not handed a bobblehead).
- **3 · the same sub and a shared cut** — "More vintage PSA basketball cards ·
  you follow Patrick Ewing".
- **4 · the same sub at the anchor's prices** — in cards and space only with
  an era or program anchor ("More Mercury & Gemini pieces at your save's
  prices"); art, design and watches keep the rung as the tie law already is.

## 4 · The discover lane

About a quarter of the seats (every fourth from the third; ≥3 at n ≥ 12) for
lots the taste reaches only SOFTLY — no strong tie, in one of the reader's
CUTS (category · sub · sport · medium of a save, an owned lot, a "More like
this", or a followed name's live lots — a category follow or a market is a tie
already), inside the learned band when it prints, else the stated range, else
the interquartile span of ≥3 priced saves (×1.26 grace), else ±0.4 decade of
the cut's own level; the kind of object the cut names; a photo; closing inside
14 days; in the WHO/WHAT markets a shared franchise (else domain). Ranked by
priority and the engine's read, one per name, spread across cuts, never shut by
the sale cap. Each says only what is true: "New to you · film & TV pieces in
your $330–$1.3K range", "New to you · prints near Andy Warhol's prices".
`Rec.lane = 'discover'`.

## 5 · The deal (recommend)

Greedy, best first, with soft repeat penalties — a NAMED tie barely discounts
its own repeats, a generic tie is spread hard — under hard caps that lift one
seat at a time only when every seed is stuck (never filler): one seed ≤ 40%
(a broad seed ≤ 20%); one NAME: followed ≤ 40–90% by its share, saved
0.08 + 0.24·share, looked-at a fifth, ≥3; one HOUSE ≤ 40% while another is in
reach; one SALE ≤ 1/6 of the GENERIC seats (a named tie is never sale-capped;
the cap yields when nothing elsewhere comes within 70%); one object (a card in
any grade, a title per house) one seat. The device's quiet signals keep 3 of
24 seats once the reader has said anything out loud. Phases: every real tie in
range → the ladder → real ties far outside a stated range (saying so).

**This week first**: of every 12-seat screen at most a third go to lots
closing past 14 days (or undated) while a nearer lot weighs within 80% of the
far one — weighed without the day's jitter; the far lot waits, never dropped.
**Rotation**: rows within 8% of each other swap seats by the day, a shuffle
seeded by the reader's local date and the taste — one day, one list, on every
surface (home's 20 is the profile's prefix). **Top of the deal** (`topOf`): the
strip takes the deal's first n, any lane, skipping what the band shows, never
all n from one house while another's pick weighs within 80%.

## 6 · The reason grammar

Every pick carries `reason` (one line) and `why` (the matched facts). A reason
must be TRUE, checked by `scripts/recs-eval.ts` §4 over 22 personas:

- `Because you saved|own|watched <title>` · `You follow <name>` · `Matches your search "…"` · `Because you looked at|asked for more like|searched …`
- `Like your <Name> <noun> · $lo–hi` — ≥2 desk lots of that name and KIND; the band only on a lot inside it ("near your" within ×1.6; never a band wider than ×20)
- `More <cut words> <noun> like yours · $lo–hi` · `More <noun> in your range` (the band prints) · `More <noun> near your save's price` / `saves' prices`
- `Another <family> · you saved …` · `More <cut> <noun> · …` · `More <noun> at <whose> prices · ~$x`
- `New to you · <cut> <price words>`
- suffixes, each only when true: `engine reads below market` · `in your $… range` · `below your $50K floor` · `also live as PSA 10`

## 7 · Re-reading the picks

    npx tsx scripts/recs-sweep.ts [book.json] [--desk "2 Warhol"]   eleven desks, every seat with lane + reason — read as the owner
    npx tsx scripts/recs-eval.ts  [--impl app/lib/recs_base.ts]      holdout, scenarios, ten collectors, reason truth; --impl pairs a saved copy of the old recs.ts (never committed)

The eval's "want" judge reads a discover seat on the lane's own law (the cut,
the prices, a photo, ≤14 days), a tie seat on the persona's want.

## 8 · Known gaps (Oct 29)

- The house cap wins over this-week-first: on a Bonhams-heavy watch desk the
  second screen fills with 16–20-day Christie's / Sotheby's lots because every
  nearer lot left is Bonhams past 40%.
- Memorabilia players carry no era: a 1960s Namath jersey desk is dealt this
  season's game-worn jerseys ("Another football player"). Needs a career era.
- Named ties ignore era: a 2018 Nolan Ryan autograph card for a 1969 desk.
- WNBA and NBA share one sport; a league facet would separate them.
- A followed name's lane level is the name's own live median — Charizard's puts
  $19.6K Skyridge holos "near Charizard's prices".
- A lot with no price and no bid can lead when nothing behind it has a bid
  either (the Welles letter): evidence only breaks ties.
- One object in two lots (CoroCoro inserts, edition prints) takes two seats
  when the titles differ by a number.
- One-house markets (modern basketball, Pokémon) are one house; thin books
  (design, hockey) deal 0–3 — honestly.
- The eval's `want` judge for the lane is a rule-of-thumb mirror of the lane,
  not the scorer; the holdout (§1) still counts lane seats as misses by
  construction (its targets are the saved names' own lots).

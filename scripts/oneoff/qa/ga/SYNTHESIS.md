# GA-Readiness Synthesis — 20-agent audit fleet
Audited 2026-08-03, the night before GA. Full reports: A1–A6 (live prod QA), B1–B6
(every-line code audit), C1–C4 (security / honesty / perf / SEO), D1–D4 (UI
production-readiness) — each in this directory. This file is the ranked
consolidation and the fix record.

## AUG 4 GATE RUN — both ship-blockers now RESOLVED (see next section)
Original verdict was NO-GO on two link-integrity defects; both were closed later
the same day. Remaining before ship: rebuild + re-verify comp links on the built
output, then Collin's sign-off. See "AUG 4, LATER" below.
The full gate ran: tsc clean, `npm run build` clean (811 pages), screenshot pass,
smoke fleet (A1/A2/A6 re-run against the built output). Result below; the Aug-3
verdict line that follows is superseded on these two points.

### AUG 4, LATER — both ship-blockers RESOLVED
**#2 brk_ / Bruun Rasmussen — dissolved, no data surgery needed.** The
`bonhams` SEGMENT (authoritative; assemble concatenates segments into the
corpus) was ALREADY fixed by last night's restamp — 75 bruun-rasmussen.dk URLs,
zero dead ones. Only the assembled corpus was stale (never re-assembled after
the restamp). Prod's 10 dead links are exactly the still-crawlable UPCOMING
lots, which the Aug-4 nightly re-stamped with the old crawler; the 58 historical
rows stayed fixed. **Shipping the crawler fix closes this entirely.** Verified:
20/20 sampled lots 200 on bruun-rasmussen.dk. Note the fix rewrites the URL ONLY
and leaves `auctionHouse: 'Bonhams'` — matching the crawler exactly, so the
nightly does not fight the restamp and no unknown house label reaches houseColors.

**#1 Wright/Rago crosstalk — RESTAMPED (`scripts/restamp-rago.ts`).**
Every wright20.com sale in the corpus (575 sales / 9,500 rows) was probe-
classified on BOTH hosts. A sale counts as Rago only on a 200 with matching
canonical link + "<lot>:" meta title, against a distinctive hard-404 shell;
classifier pre-validated on 7 known-truth URLs; zero soft-404s, zero redirects,
zero rate-limiting across ~1,460 requests.
| verdict | sales | rows | action |
|---|---|---|---|
| WRIGHT | 321 | 5,636 | leave |
| RAGO | 129 | 1,962 | **restamp url host + auctionHouse** |
| DEAD (delisted on BOTH hosts) | 125 | 1,902 | leave — rewriting swaps one dead link for another |
| ambiguous | 0 | 0 | — |
103/129 confirmed 2-of-2 lots; the other 26 by sale-index page. All 125 DEAD
also had their sale-index 404 on both hosts, so no DEAD hides a misattribution.
Applied to the wright SEGMENT + assembled corpus (1,962 each — two independently
stored copies agreeing exactly with the probe's prediction); row counts
preserved, zero residual, backups at `*.pre-rago.bak`. **15/15 sampled rewritten
URLs return 200.** `id` is deliberately NOT renamed: ids are permalinks keyed by
/lot/<id>, useSavedLots and the never-deleting Supabase mirror. Segment-safe:
corpus-io maps BOTH 'Wright' and 'Rago' to the `wright` segment.
Residual to watch: the crawler namespaces re-crawled Rago lots as `rago-*`, so
the handful of still-active 2026 sales may produce a second row alongside the
restamped `wright-*` one — eviction/dedupe is the crawler's domain.

**Blocker #4 (shard leak) VERIFIED FIXED:** phase-2 lots shards **16 → 9,
~290MB → 152.1MB**, and the sold archive now sits in its OWN phase-3 tier
(144.6MB) instead of riding the client payload. CAVEAT: `useRayData` still
promises "~10MB across shards" and B6 predicted ~2-3 shards — the leak is fixed
but phase 2 remains heavy and that comment is still inaccurate.

**NEW RISK FOUND + MITIGATED — CI timeouts.** `assemble` measured 37.5min
(Aug 3) → **42min (Aug 4) against a 60min ceiling**, and build-market alone
takes **803s** locally (the "171s" figure in memory is stale) — and the
MARKETS-from-ARTISTS fix adds markets to every per-market pass in that same job.
A timeout kills the night mid-assemble. Raised assemble 60→120 and the crawl
matrix 60→90 (christies peaked at 43.9min = 73% of its ceiling). Ceilings are
free: Actions bills minutes USED, not reserved.

**CLS `/makers/kaws` FIXED (0.346 → expect ~0):** node attribution showed
`stats.recordPrice` rides phase 1 while the record LOT's photo needs phase 2, so
the plate painted certificate-only then grew by the image well's 190px+12px at
~1.4s. RecordPlate now holds that space while phase 2 could still deliver, and
stops once `fullLoaded` proves it won't — no permanently empty frame. The
reserved well draws no background/outline.

### SHIPPED — commit 077ce88, deployed Aug 4 2026 ~19:56 UTC
Verified ON PRODUCTION (lectr.bid), not just "deploy succeeded":
comp links **81/85 200** with 21 ragoarts links live (the 4 failures are the
delisted-on-both-hosts sales we deliberately left) · 0 broken images, 0 console
errors, 0 overflow on / · /value · /makers · /analytics.

**MISTAKE MADE — prod data regressed ~10h. Read this before any future
out-of-band `data:push`.** `npm run data:push` overwrote R2's pointer with a
payload built from a LOCAL corpus dated Jul 31, while the Aug-4 nightly had
already written newer data. Prod went `lastCrawl 2026-08-04 / 760,988 lots /
742,370 sold` → `2026-07-31 / 760,972 / 741,521`: 16 lots and 849 sold records
dropped, and a user-visible crawl date four days stale on GA day.
ROOT CAUSE: **the freshness guard lives on `pull`, not on `push`** — pull
refuses to regress newer local data, but nothing stops a push from regressing
newer REMOTE data. ALWAYS `npm run data:pull` before building a payload on a
local corpus you have been sitting on. Recoverable: `versions/` keys are
write-once, so the nightly's payload survives.
Collin's call: let the 06:00 UTC nightly repair it — it re-crawls, assembles
from the FIXED wright segment pushed here, and runs the FIXED crawler, so one
run restores fresh data, keeps the Rago fix, and closes the brk_ links.

**brk_ links did NOT land in this deploy** (still 10 dead on prod, 0
bruun-rasmussen). The restamp fixed the SEGMENT; build-market derives served
data from the CORPUS, which still carried the old URLs. Closes on the nightly.

### WRAP-UP PASS — the remaining known-open items, closed
- **`/makers` roster 29.3s → 2.0s (Fast-4G, all 39 links).** The curves are
  sold-derived and rightly wait for phase 2, but the NAMES and LINKS are not —
  they come from ARTISTS + static routes. The placeholder now renders every
  tracked name as a real link in its final grid slot with the curve well
  reserved above it. Deliberately NO sold-derived figure in the placeholder:
  printing one from the phase-1 set would be a number that silently changes.
- **Home CLS 0.509 → 0.002 mobile / 0.046 desktop** (3/3 stable runs each).
  THIRD diagnosis was the right one, and the first two are instructive:
  (1) blamed `.ray-close-on`; wrong, clip-path doesn't affect layout.
  (2) blamed F4's Footer.tsx swap; that WAS a real defect (stand-in unmounted
      407px→0) and fixing it took 0.509→0.266 — but it wasn't the whole story.
  (3) The real cause: `Phase2Sentinel` defers the ~28MB corpus until the reader
      approaches, so the 287px settlement slip mounts MID-SCROLL and displaces
      everything under it. The footer was only ever the victim — its reported
      rects are viewport-CLIPPED, which is why it looked like it shrank to 0.
  Fix: `.slipHold` reserves the room while phase 2 is in flight. Heights are
  MEASURED (287px mobile / 218px desktop), not guessed — an over-reservation is
  not free, it shrinks to the real height when the slip lands.
  KEY LESSON: CLS is invisible without scrolling here. At-load CLS is 0.000 on
  every page; every real shift on this site is scroll-triggered lazy mount.
- **ORB-blocked thumbnails → monogram fallback** (`app/components/PlateImg.tsx`).
  `onError` covered only ONE of three failure modes; christies.com returns 200
  to curl but the browser silently drops it — no error event, no failed request,
  just `complete` with `naturalWidth === 0`. Now handled at attach, on load, and
  on error, and the dead img UNMOUNTS so it can never sit opaque over the
  letter. Applied at ComparableModal (comp thumb + hero plate), LotPage, and
  RefPage. Proven with a side-by-side control in one modal: old code leaves an
  empty black box, new code shows the monogram.
- **`useRayData`'s "~10MB across shards" comment corrected** to the measured 9
  shards / ~152MB raw / ~28MB brotli. It had been wrong since the corpus passed
  700K lots, and it masked the RR-archive leak.

### FINAL VERIFICATION on the rebuilt output (Aug 4, post-restamp)
- **Comp links: 81/85 200.** The only 4 non-200 are EXACTLY the four sales A2
  named as delisted on BOTH hosts (2025/03 design/264, 2008/06
  modern-art-design/276 + /277, 2018/09 modern-art-design/282) — deliberately
  not rewritten. Was 25 of 91 dead (27%) → now 4 of 85 (4.7%), zero fixable
  ones left. 21 ragoarts.com links now render in the modals.
- **At-load CLS, all 10 pages, iPhone 390×844:** / 0 · /value 0 · /makers 0 ·
  /makers/rolex **0** (was 0.319) · /makers/kaws **0.001** (was 0.346, C3
  baseline 0.222) · /analytics **0** (was 0.529) · /profile 0 ·
  /sub/rolex/daytona 0 · /ref **0** (was 0.635) · /blog 0.
- **0 horizontal overflow, 0 broken images** on all 10 pages.
- **SEO fix intact after the footer change:** 12 distinct route links still in
  the prerendered HTML of /, /art, /makers, with exactly one colophon.
- tsc clean, `npm run build` clean.

**Footer swap — FIXED, and the leftover shift RE-DIAGNOSED.** F4's Footer.tsx
stand-in unmounted (407px → 0) as TerminalHome's Colophon mounted. Fixed by
rendering ONE Colophon outside the loading gate (Footer.tsx deleted) — this
keeps the crawlable links in prerendered HTML AND removes the swap; home went
0.509 → 0.266. The REMAINING 0.266 is NOT the footer: high-frequency tracing
shows the footer never changes (1 footer, 836px, from t=207ms). The rects are
viewport-CLIPPED — prev top=437 h=407 (footer filling the viewport bottom,
437+407=844) → cur 0/0 (scrolled out of view). The real cause is late content
inserted ABOVE the footer at ~8.5s (docH 5837→6302 in one run, +0 in another)
as the phase-3 archive lands. Intermittent, at-load CLS is 0.000, and it only
bites a reader who scrolls to the very bottom while the archive still streams.
Same class as the /makers roster: late phase-2/3 content wants reserved space.
POST-GA.

**Footer CLS — original (superseded) characterization:** Could not be reproduced on demand
(3 runs steady at 836px); when it fires it is `315→780` at ~9s and it is the
footer's OWN height at the page bottom, so nothing above it moves. A hardcoded
min-height would leave a gap on the pages using the slim variant.

**SHIP-BLOCKERS (as first found — both now resolved above) — both were DATA, not code.** The crawler fixes are correct and in
the tree; the nightly ran OLD code, so nothing self-healed:
1. **Rago→Wright comp-link crosstalk.** 25 of 91 external comp links on /value
   404. 21 resolve if wright20.com→ragoarts.com (fingerprint: Rago sale slugs
   — modern-design, prints-multiples, modern-art-design,
   post-war-contemporary-art — under the wright20 host). Hits 10 of 13 ledger
   rows and the flagship comp ladders: the one surface where the product asks to
   be trusted on its evidence. 4 of 25 404 on both hosts (delisted, separate).
   Lives in the SOLD archive, not upcoming.json.
2. **brk_ = Bruun Rasmussen dead links.** 10 lots on PROD serve
   bonhams.com/auction/brk_*/lot/* which 404 live; 0 bruun-rasmussen.dk URLs.
   The 75-row R2 restamp was **re-stamped BACK to dead URLs by the Aug-4
   nightly's old crawler** — this does not self-heal, it self-breaks nightly.
   One of the ten hammers Aug 4.
Fix shape: a restamp that PROBE-VERIFIES each candidate (rewrite only where the
alternate host actually 200s), same pattern as the RR priceBasis restamp.

**HIGH, not ship-blocking:** /makers 39-name roster paints at **29.3s** Fast-4G
(above-fold 2.0s — the un-gate half-landed; it still pulls all 14 shards) ·
CLS /makers/kaws **0.222→0.346 (WORSE than baseline)**, /makers/rolex 0.319,
cause = RecordPlate vitrine growing 152→343px at ~1.5s · footer `.ray-close`
grows 315→780px on scroll → CLS 0.509 on home, sitewide component.

**VERIFIED GREEN:** A1 home 7/7 · all six C2 strips confirmed stripped IN THE
BUILD · modal back-button + market-switch fixes hold · comps pool+median match
the card on all 13 rows · ref-link gating works w/ positive control · **0 broken
images, 0 console errors across ~30 page-loads** · 0 horizontal overflow (10
pages × 2 devices) · /analytics 390px clip fixed 6/6 · vitrine dots 40×40 ·
/ref CLS 0.635→0.000, images 3,708,900→27,582 B.

**Blocker #4 (shard leak) STILL UNVERIFIED:** a local build-market run OOM'd —
local default heap 4GB vs CI's `NODE_OPTIONS=--max-old-space-size=10240`. Not a
code regression. Re-run locally with that flag to confirm (16 shards / 309MB
before; 9 written when it died).

**Before any push:** `git add` the 3 untracked source files —
app/components/Footer.tsx, app/lib/safe-href.ts, app/lot/[id]/layout.tsx (the
last keeps prerendered flagged lots indexable). And push AFTER a nightly
completes: committed deploy.yml still has cancel-in-progress:true.

## Verdict line
Every battalion returned GO or GO-after-fixes. No unfixed blocker remains open
as of this synthesis's last update (see Status column; F-fleet items marked ⏳
were in flight when written).

## BLOCKERS — found 12, all addressed
| # | Finding (report) | Status |
|---|---|---|
| 1 | Segment-pull fail-open could overwrite a house's last-good R2 corpus segment with a fresh-only subset — and publish (B5) | ✅ fixed 3-deep: listing-verified absence in pull_segment; seedless-crawl rethrow; zero-seed write refusal. Hardened again after a live stale-token repro. |
| 2 | Three workflows deployed to Pages in different concurrency groups — last-finisher wins, could silently revert a launch-day hotfix (B5) | ✅ one queue-not-cancel `deploy-collectr` lane across nightly/deploy/monolith + fast-forward-to-origin/main before nightly deploys |
| 3 | Sync job never received the corpus artifact — Supabase mirror, alerts, digests silently dead every normal night behind green CI (B5) | ✅ corpus-payload download + widened fallback condition |
| 4 | RR 252K-row sold archive leaked into phase-2 shards: ~290MB where ~10MB is promised (B6) | ✅ build-market archive predicate matches assemble's isArchiveTier; regenerates next build — VERIFY shard count/size post-nightly |
| 5 | Top /value ledger call's external link 404'd — Rago sale split-attributed to Wright by per-item house tags (A2) | ✅ session-level house resolution in crawler (ids re-namespaced at birth per invariant 6); live row self-heals on tonight's crawl |
| 6–11 | Six honesty-doctrine breaches: hero "Yearly ROI" green/red + false "verified" tooltip (regression, not yet on prod); OG card "prices up X%" colored; sparkline appr-est chip + line tint; rankings 12-mo column colored + mislabeled caption; "+1155% ttm" ungated on /makers/rolex; bids/lot count tinted (C2) | ✅ all six stripped: neutral ink + honest labels/tooltips; OG line now a sales count; ttm gated n≥20 & \|Δ\|≤100%; per-lens caption |
| 12 | /value + /makers gate first paint on the 32MB corpus — 31s mobile cold to real content (C3) | ✅ un-gated to phase-1 paint. **MEASURED Aug 4** (C3's exact profile: Pixel-8 emu, 4× CPU, Fast-4G 9Mbps/150ms, cold context, real-content paint = skeleton gone + money figures on screen): `/value` **30.9s → 2.0s**, `/makers` **30.6s → 1.9s**; wire-to-paint 33.8MB → 1.9MB. Before = live prod (pre-fix code), after = built tree. |

## PRE-GA — applied by orchestrator + fix agents
**Pipeline/ops (B5 P1–P9, B6):** sync sweep guard (zero-row/50% refusal) · RR
merge-carry-forward + shrink guard · RR priceBasis restamped end-to-end (crawler
stamp, 244,058 R2 archive rows etag-verified, local harvest checkpoint) · Goldin
partial-feed no-longer-marks-complete · 8-min budgets on both unbounded
enrichment passes · zero-byte pull-meta/backtest impossible (rm+retry helper) ·
digest emailed_at dedupe (+ graceful fallback until retention.sql runs) ·
PostgREST pagination in digest/matcher · build-market MARKETS derived from
ARTISTS (science-tech restored) · empty-subMarkets publish now throws ·
Bonhams brk_* (Bruun Rasmussen) URLs: crawler fixed + 75 existing rows restamped
in R2 (A2).

**Data layer (B1):** phase-3 archive waits for phase-1 (no more year-pinned
stale archive on cold sessions) · no force-cache/pinning when unversioned ·
orphan-alert badge fix (mark-seen on search delete) · explicit user_id scoping
on all five Supabase queries · alerts list no longer wipes on fetch error.

**Engine (B2):** demand index moved to hammer basis (was ~+20pts inflated vs its
own caption) · edition ×5 guard un-shadowed (unit-mix + skip bug) · card setName
year-slice fix (harness 5/5) · FATAL-1 day-granular (APAC same-day sales no
longer abort the publish).

**Security (C1):** XFO/frame-ancestors/HSTS headers · RLS schemas reconstructed
into supabase/retention.sql (idempotent; run in SQL editor) · safeHref scheme
guard at all 7 crawler-URL sinks (✅ verified 7/7 guarded, 0 unguarded) ·
next@14.2.35 + semver-safe audit
fixes; residual npm-audit highs are build-toolchain or Next-server CVEs
unreachable under output:'export' (no Next server in prod).

**SEO (C4):** sitemap emits all 613 /ref pages again (predicate bug) with the
correct ~-codec (43 dead URLs fixed) · /blog/corrections added · branded 404
title, /makers/[slug] metadata, first-HTML footer links, /lot-shell noindex
(⏳ F3/F4).

**UI (D1–D4 applied, orchestrator-reviewed):** ~2,400 dead CSS lines removed
across style.module.css + globals.css (pixel-identical verified) · MarketChart
deleted · culture/science mobile boards zero-rows fixed · retired /<slug> maker
routes fixed in ⌘K + ArtistNav · ⌘K tokenized AND-match + 94 sub-market entries
("rolex daytona" and "daytona" both land) · mobile analytics 390px clip fixed ·
dossier panel styling/labels · modal image fallback plates · pluralization/label
fixes · nested-main/a11y-name fixes.

## RECONCILIATION — Aug 4 session (F-fleet audited item-by-item against the tree)
Four verification agents re-derived each F-lane's task list from the source
reports and inspected the actual diff. Result: **21 of 26 items had landed**
before the session died. Closed since:

| Lane | Landed | Closed Aug 4 | Deferred |
|---|---|---|---|
| F1 value/lot/modal | 6/6 | — | — |
| F2 terminal | 5/7 | /ref CLS min-height | settled tape (below) |
| F3 makers/analytics | 6/7 | Bonhams thumb sizing | — |
| F4 chrome/SEO | 4/6 | blog figures, phase-1 preloads | — |

Aug-4 work beyond the F-list: `ComparableModal` tsc error (F1's `v` optional-
refactor left a `v.n` deref); **all five** phase-1 JSONs preloaded, not two —
`useRayData` awaits them in ONE `Promise.allSettled`, so first paint gates on the
slowest and preloading a subset merely moves the bottleneck (market.json 243KB br
was starting late); shared `sizedImg()` lifted to utils and applied at every
Bonhams slot incl. `LotPage`'s 40×40 comp thumb.

**Measured wins (real numbers, not estimates):** `/ref` images 3,708,900 →
27,582 bytes and CLS **0.637 → 0.000**; blocker #12 timings above.

**`q2-2026-watches` blog post** — the second half of C2 #8. Figures now derive
from market.json at build time with an explicit as-of date from meta.json, and
the post states outright that the quarter is fixed history while the index is
not. Claims that could not be honestly re-derived were DELETED, not restated
(house style, same as the engine post). Deriving also caught a real error: the
old hardcoded footnote said Patek abstains "at one" — it abstains at 1Y *and* 5Y.

**⚠️ METHOD WARNING for anyone verifying this app with headless browsers —
cost two false alarms on Aug 4:**
1. **Wright20's CDN 403s the headless UA token.** 15 of 28 home images read as
   broken; with a real Chrome UA, 0 broken. ALWAYS set a real UA.
2. **The maker-page Price history chart is visibility-gated** — it renders blank
   in a fullPage screenshot and draws correctly once scrolled into view. Verify
   charts by scrolling them into view and asserting on path geometry, not by
   eyeballing a full-page capture.

**Deferred by Collin (Aug 4):** the /value settled tape renders 0 rows (its gate
wants Below Market + priceUsd>0 + past sale day; nothing satisfies it while
`upcoming.json → tape.all` does carry rows). It renders nothing — an empty
section, not a false claim — so it goes POST-GA rather than taking a data-path
change on launch day.

**In flight (F1–F4), from A/B/C/D findings:** modal save payload + NaN filter +
button-in-Link · /value modal history + thin Today's-Call payload · ref-link
existence gating · one-sided estimates shown · evening-mode UTC fix ·
modal-history × market-switch fix · layer chips real toggle · reduced-motion
ring · feed-row a11y · dossier count-up fabricated-flash fix · +N-more links ·
vitrine pager dots (40px) · CLS min-heights · Bonhams &width=160 thumbs · brand
PNG diet · phase-1 preload · blog figures sourced from data · QuarterInsight
hairlines · settled-tape reconciliation.

## Deliberately deferred (POST-GA ledger)
Per-report POST-GA sections stand as the backlog: CSP nonce strategy · JSON-LD ·
comp-pool name-collision guard (A1's Andrew-Jackson-in-Scharf case) · Forward-
after-Back modal restore · menu-sheet/⌘K back-gesture history · sub-$10K
compact rounding · P10 zombie-reconcile pair-keying · fetch timeouts · fmt NaN
guards · dims/grade parsing edges · per-house assemble gate (P7 was applied;
this refers to the meta.json segment-count persistence variant) · payload diet
(poolIds extraction, per-market shards, supabase-js bundle) · wright20 sold-lot
outbound purges (house-side; needs archive-link policy).

## For Collin — go/no-go checklist
1. **Run supabase/retention.sql** in the SQL editor (RLS policies now in repo +
   `alerts.emailed_at` for digest dedupe). Until run, digests log a loud
   fallback line by design.
2. **Cloudflare: www.lectr.bid → apex 301** (Bulk Redirects or a redirect rule).
   Currently www serves the whole site as a duplicate with no canonicals.
3. **RESEND_API_KEY + RESEND_FROM secrets** (+ lectr.bid verified in Resend) —
   lights the digest loop; the pipeline behind it is now actually alive (blocker #3).
4. **Robots policy decision:** Cloudflare's managed AI-crawler block is on.
   Deliberate stance, or open it up? (C4)
5. Sign-off after: clean `npm run build` + screenshot review + smoke fleet
   (orchestrator runs these once F1–F4 land) and tonight's nightly is green.

## Deploy discipline
Nothing deploys until: F-fleet integrated → repo-wide tsc + full clean build →
orchestrator screenshot pass (the honesty strips + all visual fixes) → smoke
fleet re-runs A1/A2/A6 flows on the built output. Prod is currently CLEANER
than the working tree was this morning (two honesty regressions never shipped —
they are now stripped); the tree is strictly ahead again.

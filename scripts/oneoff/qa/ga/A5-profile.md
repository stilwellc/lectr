# A5 — PROFILE & ACCOUNT flows · GA-readiness live QA

Black-box QA, 2026-08-03 evening, playwright-core 1.62 (channel: chrome, headless, 1440×1000).
Two environments:
1. **PROD** `https://lectr.bid` — signed-out surfaces (sign-in wall, /saved redirect, nav entry, CommandK, save-from-card, follow).
2. **LOCAL auth-off** `next dev` with `NEXT_PUBLIC_SUPABASE_URL='' NEXT_PUBLIC_SUPABASE_ANON_KEY='' RAY_DEV_NO_EXPORT=1` — the full desk, seeded via `localStorage['ray-saved-lots']` with a realistic 12-entry mix: 2 Goldin velocity movers (+60/+28 bids per 24h), 2 Bonhams watches hammering in 48h (Patek Ellipse $40–50K, AP RO Offshore $110–120K), 2 quiet no-bid Goldin game-used lots, 4 settled Picasso prints (bonhams-32662-206/-203/-197/-204, sold 7/30, signalPct saved −14/−6/−18/+5), the owned Patek Calatrava bonhams-31991-49 (owned:true) + owned Picasso -197, and 1 fake orphan id; `lectr-lastvisit` stamped 30 days back (2026-07-04).

Scripts + evidence: `scratchpad/ga/` (`prod.js`, `local.js`, `local-triage.js`, `seed.json`, `prod-results.json`, `local-results.json`, `shots/prod-*.png`, `shots/local-*.png`).

**Result: 40 checks run, 0 blockers, 0 pre-GA defects. Every profile/account flow behaves as designed on both environments.** 2 post-GA polish items + 2 non-defect notes below.

---

## DEFECTS

### D1 [POST-GA] Settled ledger's Realized column rounds sub-$10K prices to whole $K — up to ~10% display distortion
`formatPrice` (`app/utils.ts:190`) renders `n >= 1000` as `toFixed(0)K`, so the track-record ledger shows **$4,608 → "$5K"** (+8.5%) and **$2,048 → "$2K"** (−2.3%). The adjacent "vs est" % is exact, so the doctrine holds on the measured figure, but this is the one ledger where the user audits *their own realized money* — a $392 phantom on a $4.6K print is visible to anyone who checks the house's result. Evidence: `shots/local-settled.png` (Dove of Peace row: est $3K–$5K, realized "$5K", vs est −10%). Suggest `$4.6K`-style one-decimal below $10K in the settled/collection ledgers only — the compact form is right everywhere else.

### D2 [POST-GA] Watching ledger hides the saved call when the engine abstains now
When `lotSignal` abstains on a watched lot (both seeded Bonhams watches: comp pool too thin), "Signal now" *and* "Δ saved" both render "—" even though `savedMeta.signalPct` exists (−12 / +8 at save). The saved call is invisible for the entire watch and only resurfaces after settlement as "Your call". Abstain-now is correct doctrine; losing the at-save read is an information gap, not dishonesty. Cell dump:
```
WATCH[0] Patek Philippe  est=$40K–$50K  signalNow=—  dSaved=—  hammers=in 2 days
WATCH[2] Sports Cards    est=$4K bid · 63 bids  signalNow=—  dSaved=— (+60 bids/24h)  hammers=in 4 days
```
Consider a faint "at save −12%" sub in Δ saved when current is abstained.

---

## NOTES (not defects)

- **N1 · dev-only:** after ~30+ min of `next dev` uptime with constant webpack recompile churn, fresh `/profile` loads intermittently stall pre-phase-2 (zero `/data/ray/` fetches) and once served the app-404. Unreproducible on a fresh server (first-load always clean) and **not reproducible on prod** — prod `/profile` loaded clean on every pass. Dev-env artifact of Fast Refresh + the 300MB corpus; no action for GA.
- **N2 ·** `/makers/michael-jordan` 404s (he's a player, not a maker) — that was this QA's own guessed URL, source of the lone console-404 in the prod session; `/makers/pablo-picasso` 200s and carries the Follow button. No product link points there; no action.

---

## CLEANS — PROD signed-out (all verified)

- **Sign-in wall** `/profile`: kicker "My profile", h1 "Your desk at the auction", lede "Watch lots to the hammer… Private to you, synced everywhere.", exactly one "Sign in with Google" button, "Free · one tap · nothing else on lectr is gated." — all present (`shots/prod-profile-signedout.png`). **Nothing gated leaks**: element-level sweep found 0 × `section[aria-label="Your collection"]`, 0 × `#settled`, 0 h2 ledger heads, 0 own-buttons, 0 ledger nodes. (Text-level "your collection" match is the wall's own lede copy — false positive, verified.)
- **/saved → /profile**: `HTTP/2 301`, `location: /profile` (curl, headers on file).
- **Nav "Sign in"** entry present; click opens the Google-only login sheet (`role=dialog aria-label="Sign in"`, "Sign in to save lots" + "Your saved lots follow you across devices — and only you can see them."); Escape closes it, focus/scroll-lock behave (`shots/prod-nav-signin-modal.png`).
- **CommandK**: `window.dispatchEvent(new Event('lectr:open-ck'))` opens the palette; typing "picasso" returns the maker row (art maker) + live-lot rows tagged with their markets (`shots/prod-ck-picasso.png`).
- **Save from a lot card signed-out** (`/value`, `.ray-save-btn`): **prompts login, does not silently fail** — the login sheet opens AND the intent survives: `localStorage['lectr-pending-save']` = the full saved-entry JSON (id rago-413597, estMid, signalPct, savedAt) for post-OAuth replay; `ray-saved-lots` stays null (no ghost local save under auth mode). `shots/prod-save-signedout.png`.
- **Follow signed-out** (`/makers/pablo-picasso`, "Follow Pablo Picasso"): opens the login sheet, no dead click, no error (`shots/prod-follow-signedout.png`).
- Zero page errors; zero 4xx/5xx across /profile, /value, / (re-verified in a dedicated pass).

## CLEANS — LOCAL auth-off full desk (all verified)

- **Masthead**: "Watching **$160K** to the hammer." (= seeded est-mids 45K+115K; Goldin no-estimate lots correctly excluded) · sub "Next hammer in 2 days · watching 6 live lots · since you saved · 38 new bids".
- **Since-your-last-visit strip**: "5 watched lots settled · your calls went **−10%** vs estimate, median" — exactly the 5 seeds settling after 07-04 (4 Picassos 7/30 + Calatrava 7/8); "See what happened" → `href="#settled"`, target exists, scrolls into view. StrictMode double-effect did NOT blank the diff (ref-guarded capture works).
- **The brief**: 6 rows — Most bids ×2 ("+60 bids in 24h · faster than 100% of live lots"), Quietest ×2 ("no bids yet · hammers in 6 days"), Lands soon ×2 ("hammers in 2 days · $40K–$50K est."); every row links `/lot?id=<id>`; facts only, no opinion ranking.
- **Desk strip**: 3 cells, only where data exists — `Watching $160K · 6 live lots` | `Collection $16K −28% · 2 pieces · bought $22K` | `Your record −10% · 5 settled · vs estimate, median · $35K realized`.
- **Watching ledger** (default view): 6 rows, cols Maker/Work/Est/Signal now/Δ saved/Hammers; velocity subs "+60 bids/24h", "+28 bids/24h" on the Goldin movers (velocity supersedes since-saved count as designed); Goldin est cells show "$4K bid · 63 bids"; every row → `/lot?id=`. **Cards view**: toggle flips grid (6 cards), persists `ray-savedview=cards`, card deltas render "23 new bids"/"15 new bids"; toggle back clean.
- **Collection**: "2 pieces · bought $22K · lectr appraisal $16K · **−28%**" — paired-basis honest (both pieces have paid; −28% = appraised-of-paid/paid). Exposure "Where it trades · the market's move, not your pieces'": `Calatrava · Patek Philippe → /sub/patek-philippe/calatrava (+2% vs estimate)`, `Prints & multiples → /sub/art/prints (+5% vs estimate)` — market reads labeled as the market's, mono+color only on measured deltas. Piece rows link `/lot?id=`; drill chips link `/sub/...`; per-piece basis lines name n ("24 comps", "3 comps"); appraisal footnote verbatim ("…not a formal appraisal… a reference range is context only and never enters a number."). `shots/local-collection.png`.
- **Settled ledger**: 5 rows, cols Maker/Work/Est/Your call/Realized/vs est/Own it; record line "5 judged · your picks went −10% vs estimate, median"; your-call colored green only at ≤−10 (the flag threshold); vs-est green/red on the measured hammer-basis delta; flagged/unflagged split correctly withheld (n-gate 3+3 not met). `shots/local-settled.png`.
- **Own-it prompt** renders while unowned settled lots exist: "Won any of these? Mark it **I won it**…" — asks, never presumes.
- **Own-it toggle**: click "I won it" on Dove of Peace → collection flips **2 → 3 pieces immediately** (no reload), Dove appears as a piece, desk-strip Collection cell recomputes, `ray-saved-lots` persists `owned:true`; button reads "Owned ✓". Un-own same row → **back to 2**, piece gone, LS reverted. `shots/local-own-toggled.png`.
- **Orphans**: fake seeded id renders "No longer on the block" with the snapshot line "was: QA Orphan — withdrawn test lot, Pablo Picasso · est. $1K · saved Jul 1, 2026"; **Remove** deletes the row and the LS entry.
- **Empty state**: fresh storage → honest hero "0", "Every collector starts by watching…", single CTA "Start with today's below-market lots" → `/value`. No fake activity. `shots/local-empty-state.png`.
- **Alerts inbox absent** when no saved searches (auth off): zero alerts UI text on the page; FollowButton correctly renders nothing in no-auth mode.
- **Honesty sweep**: no user-visible `undefined`/`NaN`/`[object Object]` (matches were Next flight-payload script text only); no % on descriptive reads; every appraisal names its n.

---

## COUNTS

- Checks: **40** (14 prod, 26 local) — 38 pass, 2 → the post-GA defects above.
- Defects: **0 [BLOCKER] · 0 [PRE-GA] · 2 [POST-GA]** (D1 realized-column rounding, D2 saved-call hidden under abstain).

## WORST 5 (nothing GA-gating)

1. **D1** Realized "$5K" for $4,608 in the user's own track record — the only place compact rounding reads as a wrong fact.
2. **D2** Saved call invisible in Watching while the engine abstains — information gap until settlement.
3. **N1** Dev-server long-uptime stall of /profile phase-2 — dev-only, clean on prod; worth a note in the dev runbook.
4. Cards-view lot images can sit on the letter-placeholder until CDN load completes (cosmetic, lazy-load; `shots/local-watching-cards.png`).
5. Collection appraisal accepts n=3 comp pools (Picasso print −56% on "3 comps") — honest (n disclosed) but thin; if a floor gate is ever added, this ledger is where it matters most.

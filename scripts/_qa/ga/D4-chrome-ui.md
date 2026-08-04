# D4 — GA UI production-readiness: chrome + profile + editorial + global consistency

Date: 2026-08-03 · Scope: ArtistNav/CommandK/AlertsInbox/SaveSearch/Masthead/Greeting/FollowButton,
app/profile/**, app/blog/**, app/about/**, app/not-found.tsx, app/layout.tsx, app/globals.css.
Method: dev server (auth-off + auth-on), seeded `ray-saved-lots` (8 live incl. velocity/quiet/signal
mix, 3 settled Picassos w/ save-time signalPct, 1 owned Patek), full-desk screenshots at 1440 + 390,
signed-out wall, blog index/engine post/corrections/quarter note, /about open, 404, plus /value,
/analytics, /makers for the cross-page sweep. `tsc --noEmit` clean after all edits.

## DIRECT FIXES SHIPPED — 9

1. **In-app maker links 404'd** — ArtistNav (filter-Enter, group list, sheet top-makers) and
   CommandK (maker rows + browse grouping) still navigated to the pre-migration `/<slug>`.
   `/andy-warhol` → 404 in-app (only Cloudflare `_redirects` saves a hard hit; client `router.push`
   lands on the 404 page). Rewrote all five sites to `/makers/<slug>`. Verified in situ: ⌘K →
   "nakashima" → Enter lands `http://…/makers/george-nakashima`, h1 "George Nakashima".
   *(app/components/ArtistNav.tsx:136,168,627 · CommandK.tsx:82,97)*
2. **Nested duplicate `<main id="main">`** — the root layout already wraps every page in
   `<main id="main">`; six owned files rendered a second one inside it (invalid nested `<main>`,
   duplicate id, ambiguous skip-link target). Inner tags → `<div>` with identical styles:
   app/about/page.tsx, app/blog/page.tsx, app/blog/how-we-built-the-pricing-engine/page.tsx,
   app/blog/corrections/page.tsx, app/components/blog/QuarterInsight.tsx, app/not-found.tsx.
3. **Mobile-sheet section order** — signed-in sheet ran …Analytics, **My profile**, Blog while the
   desktop bar (and the sheet's own signed-out state) run …Analytics, Blog, *identity last*. Moved
   the profile entry after Blog in `sections`. Verified: sheet now reads
   Overview | Value | Makers | Analytics | Blog | My profile. *(ArtistNav.tsx:110-120)*
4. **⌘K room order** — same inconsistency in the palette (My profile 5th, before Blog/About).
   Identity entry now last among the rooms, matching the bar. *(CommandK.tsx:56-64)*
5. **/about was the only notes-layer page not lighting the Blog tab** (`activeSlug="about"`, a value
   the nav never matches — corrections/engine/quarter notes all pass `"blog"`, and /about's own
   masthead + "All notes" back-link declare it part of the shelf). → `activeSlug="blog"`.
6. **/profile tab title said "Your watchlist"** while nav, masthead kicker and ⌘K all say
   "My profile". → `title: 'My profile'` (app/profile/layout.tsx; description unchanged).
7. **AlertsInbox delete button had no accessible name** (bare "×", title only) →
   `aria-label="Delete saved search: <name>"`.
8. **globals.css dead-rule purge — 296 lines deleted** (3171 → 2875). Every deleted selector was
   verified unreferenced across app/ + scripts/ with word-boundary grep (guards against prefix
   collisions like `.ray-hero` vs `.ray-hero2`, and against dynamic class construction — none found).
   Deleted, by family:
   - `.ray-nav`, `.ray-hero` (+ `.ray-hero .eyebrow`, `.ray-hero h1`, `.ray-hero-eyebrow`,
     `.ray-hero-stamp`, `.ray-divider-wrap`) — pre-restructure page-header skin
   - `.ray-board`, `.ray-board-demand` (all data-tone/data-neutral/recharts-scoped variants, the
     whole "MARKET OPEN" block), `.ray-pane` (+ scoped rules)
   - `.ray-demand-head/-label/-foot/-chartbox`, `.ray-demand .recharts-area-curve`
   - `.ray-proof`, `.ray-proofstrip`
   - `.ray-ranges2`, `.ray-range2` (incl. removal from the 44px tap-target selector lists — live
     neighbors `.ray-range-btn`/`.ray-seg-btn`/… untouched)
   - `.ray-numrow`, `.ray-numrow-delta/-aux/-aux-v/-aux-s`, `.ray-scrubchip`
   - `.ray-ledger`, `.ray-ledger-k/-v/-s` (dark board variant AND the `.ray-band` paper variant)
   - `.ray-deck` (grid only — `.ray-deckcall*` live in Terminal, kept)
   - `.ray-call`, `.ray-call-art` (containers only — `.ray-call-artist/-title/-ctas/-btn*` live, kept)
   - `.ray-artist-dropdown` (bare container; `-item/-label/-filter` live, kept)
   - `.text-balance` utility (h1 rule covers the live use)
   - `--color-bg-board` token (orphaned once the board/ledger rules left)
   Kept deliberately: `.recharts-area-curve/-area` rules under **live** parents
   (`.ray-hero2-chart`, `.ray-band` etc.) — Recharts emits those classes at runtime;
   `.ray-recordband` (used in app/preview). No uncertain leftovers.
   Regression-verified post-purge: home observatory hero, /value (Today's-call plate + paper record
   band), /analytics desk, /makers, blog, profile desk all pixel-identical; zero pageerrors.
9. **Stale comment** in globals (`.ray-hero2-value` referenced deleted `.ray-numrow`) reworded.

## WHAT THE PIXELS SAY (verified in situ)

- **Profile desk (1440 + 390)**: masthead certificate (butter kicker / serial No. / serif statement
  with one Accent) → since-your-last-visit strip → brief (dotted rows, microcap tags, honest facts:
  velocity "+2 bids in 24h · faster than 59%", "hammers tomorrow", direct comps, below-market with
  mono green %) → desk strip (Watching/Collection/Your record cells) → watching ledger (Est/Signal
  now/Δ saved in pp/Hammers; velocity subline) → **collection band on paper** (Fraunces "Your
  collection", WHERE IT TRADES exposure row → /sub/ dossier, bought/appraisal columns, honesty
  footnote) → settled track record (your call vs realized vs est, I-won-it/Owned ✓ pills; clean
  stacked rows at 390). Rhythm and register are coherent; ships.
- **Signed-out wall** (auth-on server): kicker + "Your desk at the auction" + Google button +
  "nothing else on lectr is gated" — correct and calm, desktop + 390.
- **Nav**: desktop bar active states correct on every page; Find-a-maker pill opens ⌘K; mobile
  sheet (Menu/Done, sections, FIND A MAKER, five busiest makers, All-makers disclosure) correct.
  Empty-browse ⌘K = rooms then grouped roster under microcap market headers; arrow highlight and
  Enter verified.
- **Focus-visible**: tabbed 25 stops on home — every one carries the butter 2px ring
  (`:focus-visible` global; paper bands re-ring in ink). Nothing invisible. Skip-link appears on
  first Tab.
- **Blog/about/corrections/404**: shelf lead + dated ledger ≥900px, card stack at 390; corrections'
  struck-claim → truth lines read exactly as designed; about's details-disclosure walk-through and
  flow diagrams intact; 404 branded with script mark + "Back to the market".
- **Sentence case**: no strays found anywhere in the audited surfaces (uppercase = kicker register
  only, by design).
- **Hairline grammar inventory** (solid 1px where dotted-soft exists elsewhere): profile ledger row
  separators (`.ray-savedrow`, `.ray-settled-mrow`, `.ray-coll-exposure-row`, collection piece
  rows), blog ledger entries, Masthead's two rules, corrections/standing-note rules, QuarterInsight
  table rows, about section clasps. All are *ruled-table/certificate* contexts — solid is the
  consistent register for them across every page; dotted is consistently the *enclosure/inbox*
  register (brief, since, desk cells, AlertsInbox rows, analytics stat cells). No page mixes both
  within one role, so nothing qualified as a mechanical conversion. One true token mix found →
  proposal 3.

## PROPOSALS (judgment calls — not touched)

1. **⌘K multi-word search is broken** — the needle is matched as one contiguous substring, so
   "nakashima table" → "Nothing matches." while "nakashima" works. Tokenize the query and require
   every token to hit `label+hint` (or `title+artist` for lots). Small change in CommandK's
   `filtered` memo; highest-value search fix available before GA.
2. **Auth-off dev recipe is unreliable** — with `.env.local` present, empty-string
   `NEXT_PUBLIC_SUPABASE_*` overrides lose to the dotenv values on fresh compiles; server and client
   can even disagree (observed hydration mismatch: Server "Sign in" / Client "My profile").
   Add an explicit `NEXT_PUBLIC_RAY_NO_AUTH=1` gate in app/lib/supabase.ts; QA scripts stop
   depending on env-loader precedence. (I had to park .env.local to shoot the desk; restored.)
3. **QuarterInsight tables mix hairline tokens** — `th` bottom rule uses `--color-border`, `td`
   uses `--hairline`, in the same table. Unify to `--hairline` (or bless the heavier head rule
   explicitly).
4. **Watching-ledger Est column repeats " est."** under an "Est" header (`formatEstimate` suffix).
   A ledger-context variant without the suffix would tighten the column.
5. **The brief can list the same lot twice** (seed showed "Amoeba nesting tables" under both
   Direct comps and Below market). Dedupe by lot id, first tag wins — the brief is a TLDR, eight
   rows max reads better than repeats.
6. **AlertsInbox rows (2px dotted) vs the desk's three ledgers (1px solid) on the same /profile
   page** — defensible as inbox-vs-ledger registers, but if the desk should read as one instrument,
   converting the inbox rows to `1px solid var(--hairline)` is the smallest unification. Wholesale
   dotted conversion the other way would touch every ledger — not recommended.
7. **`.ray-artist-count` has two competing definitions** — ArtistNav's inline block (light pill,
   dark text) is fully overridden by globals' `!important` (elevated bg, muted text). One source of
   truth: delete the component's stale declarations, or drop the globals override into the
   component.
8. **Signed-out wall right half is empty at 1440** — the certificate column caps at ~460px and the
   rest is void. A quiet preview of the desk (ghosted brief rows or the ledger head) would sell what
   sign-in buys without touching the copy.
9. **CommandK comment drift** — comment says "first 12 rendered", code slices 16; and Escape
   handling lives on a window listener that also fires while closed. Harmless, but tidy before the
   file calcifies.
10. **`.ray-hero2-chart .recharts-area-curve` base rule ships a 0%-alpha drop-shadow** (`color-mix
    … 0%`) — a no-op filter paid on every frame of every hero chart; the toned variants override
    it anyway. Delete the base filter (left in place since it's a live-value retune by the letter
    of the guardrail).

## Notes for the caller

- Sibling QA agents repeatedly killed dev servers (exit 144) and pruned the shared shots dir
  mid-run; all evidence re-captured under `scratchpad/shots/d4/`. No lectr code was affected.
- `.env.local` parked and restored during the auth-off shoots; final state verified present.
- `tsc --noEmit` clean; all dev servers stopped.

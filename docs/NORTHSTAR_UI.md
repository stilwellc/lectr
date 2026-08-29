# NORTH STAR UI — the ElevenLabs audit (Aug 29 2026)

Collin's mandate: elevenlabs.io is the north star for lectr's UI moving forward.
This document is the full audit — raw findings from a live crawl (desktop screenshots
of home, /pricing, /blog, /blog/procedures, /agents), a headless CSS/token extraction
of their served stylesheets, and design-lineage research — followed by the translation
map we implement in lectr. Keep this file current as the system evolves.

---

## PART 1 — WHAT ELEVENLABS ACTUALLY IS (raw findings)

### 1.1 The one-line identity
Warm eggshell `#FDFCFC` canvas · black ink + warm-gray ramp · cream `#F5F3F1` surfaces ·
hairline borders (0.5px token!) · pill (9999px) buttons with `scale(0.98)` press ·
**light-weight (300) grotesk display type** · Inter 17–18px body · 1304px container ·
150ms `cubic-bezier(.4,0,.2,1)` micro-motion · color lives ONLY in product art
(gradient orbs / Chladni patterns) — the chrome is entirely monochrome.

### 1.2 Lineage (why it looks like this)
- Mark: two vertical bars = "11" + pause button, in-house 2022, survived every redesign.
- 2023–24 **AREA 17**: brand + site, custom typeface commission, "Voice Signatures"
  morphing sound forms. Head of Brand Thomas Squire: "We deliberately avoided the
  AI-generated imagery and characters that saturate the space."
- 2025 **basement.studio**: visual rebrand on **Chladni patterns** (physical sound-vibration
  figures) blurred into atmospheric art; built them an internal generator so the team
  remixes its own brand art. Logotype untouched.
- Product-line color coding: ElevenAgents = blue orbs, ElevenCreative = orange Chladni,
  ElevenAPI = monochrome. Accents `#FF4704` / `#0447FF` appear ONLY inside that art —
  the crawl found each on exactly 2 DOM nodes on the whole homepage.
- Docs on Fern; public shadcn registry (ui.elevenlabs.io) — the design language is productized.

### 1.3 Type system (measured)
- Display face: **Waldenburg** (Kimera foundry, custom cut with single-story 'a').
  Licensed + custom — NOT available to us. The transferable idea is the deployment:
  - `heading-01`: Waldenburg **300**, 36→48→60px, lh 105%, ls −0.03em
  - `heading-02`: 300, 32→40→48px, lh 110%, ls −0.03em
  - `heading-03`: 300, 28→32→36px, lh 120%, ls −0.02em
  - `display-01/02`: WaldenburgFH 700 condensed, 48→100px, lh 95–100% (rare, hero-only)
  - The fingerprint: **impact through LIGHTNESS, never boldness.** H1 on home is
    48px weight 300. Commentators: "thin strokes that feel like audio waveforms."
- Body: Inter 400, 17px base / 18px ≥1024px, lh 140–160%. Paragraph ramp 18/16/14/12.
- Code: Geist Mono.
- Caps labels (`ui-01..08`): tiny, 10–14px, ls 0.02–0.05em — used sparingly in product UI,
  NOT as marketing eyebrows.
- Kickers above headlines are NOT uppercase mono: **16px Inter 400, warm gray
  `rgb(68,64,59)`, normal case** (measured on "ElevenAgents" kicker). Quiet, not shouty.
- Leading-trim (cap-height trim) tokens on every size — obsessive vertical rhythm.

### 1.4 Color system (measured)
- Page: `--eggshell #FDFCFC` (warm, 253/252/252 — barely off white).
- Warm gray ramp (stone-family): 25 `#FDFCFC`, 50 `#FAF8F8`, 100 `#F5F3F1` (= `--cream`),
  200 `#EBE8E4`, 300 `#D7D2CC`, 400 `#A59F97`, 500 `#777169`, 600 `#59544F`,
  700 `#44403B`, 800 `#292524`, 900 `#1C1917`, 950 `#0C0A09`.
- Homepage bg census (live DOM): white ×68, black ×53, rgba(0,0,0,.05) ×37,
  #FDFCFC ×36, #F5F3F1 ×34, #EBE8E4 ×12, `#FF4704` ×2, `#0447FF` ×2. That census IS
  the doctrine: two accent nodes on an entire homepage.
- Full 11-step accent scales exist (blue/cyan/green/teal/yellow/orange/red/magenta/purple)
  but are reserved for product visuals.
- Hairlines: `#EBE8E4` and `#E5E5E5`; a real `--hairline: 0.5px` token.

### 1.5 Component grammar (observed on-page)
- **Buttons**: pill 9999px. Primary = black bg/white text, hover `#44403B`. Secondary =
  white with a stacked ring-shadow `0 0 1px rgba(0,0,0,.4), 0 1px 1px rgba(0,0,0,.04),
  0 2px 4px rgba(0,0,0,.04)` (borderless). Tertiary = cream bg. Heights 44/40/36,
  text 16/15/14 weight 400 (not bold!). Press = `scale(0.98)`. Focus = 1.5px outline offset 2.
- **THE FRAME**: the content column is framed by vertical hairlines running the full page,
  section boundaries are horizontal hairlines that extend PAST the frame to the viewport
  edge, and every frame×section intersection carries a tiny dot/crop-mark (registration
  marks — print-sheet grammar). Sections feel like plates in a technical catalogue.
- **Split section head**: quiet gray kicker → huge light headline LEFT, 18px body copy
  RIGHT column (asymmetric two-col), pill CTA below left. Massive top padding inside
  each section (~120–200px) — whitespace is the luxury signal.
- **Feature cards**: cream `#F5F3F1` wells, radius ~16–20px, icon in a small white rounded
  chip top-left, then **title in GRAY 500 + body in BLACK** — inverted hierarchy: the
  category is quiet, the content is loud. No borders, no shadows on wells.
- **Ledger rows** (pricing features, API spec rows): label + value rows separated by
  DOTTED hairlines, tiny inline icons. Reads like an invoice/spec-sheet.
- **Pricing plates**: plan name top-left of a putty `#EBE8E4`-family plate, price bottom-left
  with a huge empty middle (confidence-through-emptiness), full-width black pill under
  the plate, then the dotted feature ledger. The ONE featured plan gets gradient-orb art.
- **Customer-proof strips**: 3 stacked logo chips + customer name + one-line outcome +
  pill CTA right — social proof as a ledger row, not a wall of cards.
- **Logo walls**: pure grayscale, generous spacing, inside the frame.
- **Geometric line-art plates**: solid + dotted 1px technical drawings (cones, wireframe
  cubes, nested circles, node diagrams) on cream wells — abstract concepts drawn like
  patent figures. No 3D, no blobs, no emoji.
- **Byline ledger** (blog): Written by / Published / Last updated as three columns of
  gray-label-over-black-value, closed by a dotted rule.
- **Media frames**: screenshots/video in 1px-hairline rounded (~16px) frames; grayscale
  photography with gradient scrims for text legibility; announcement cards = gradient-wave
  art strip on top, plain white title bar below.
- **Nav**: 64px, transparent over page, wordmark left, plain 14px links, pill CTAs right.
  On scroll the wordmark collapses to the "II" glyph and a contextual product subnav
  (product name + its sections) can dock under the main nav.
- **Footer**: plain multi-column list, gray column labels, black links, no decoration.

### 1.6 Motion (measured)
- Default: **150ms `cubic-bezier(.4,0,.2,1)`** (46 uses — THE house curve). Then 300/500/700ms.
- Press: `active:scale(0.98)` universally.
- Signature reveals: `text-reveal-word` (opacity + scaleY(.95) + blur(12px) → sharp,
  word by word), shimmer-text sweep, `tw-noise-drift` animated film grain (step-end, 200ms),
  slide-with-blur edges. `prefers-reduced-motion` honored.
- Nothing bounces, nothing floats, nothing glows.

### 1.7 Layout tokens (measured)
- Container `min(100%, 81.5rem)` = **1304px**. Outer gutter 20→40→64px.
- Section padding `--section-py-default: 5rem → 7.5rem` (80→120px), xl 120→160px.
- Breakpoints: 640/768/1024/1280/1536.
- Prose measure: 42–48rem.

---

## PART 2 — THE TRANSLATION (lectr, going forward)

lectr's porcelain already shares the soul (near-white ground, ink, hairlines, white cards,
one quiet accent, no glow). The north-star pass upgrades the porcelain from "light theme
done tastefully" to "technical catalogue sheet" — ElevenLabs' print-shop grammar fitted
to an auction-intelligence desk. Standing lectr laws that SURVIVE and are in fact
REINFORCED by the north star:
- **THE LAMP LAW**: red = down market, green = up market, nothing else borrows them.
  ElevenLabs' "color only in product art" maps perfectly: **on lectr, the market IS the
  product art.** Signals stay the only saturated voice; chrome goes even quieter.
- **No glow / flat identification** — ElevenLabs agrees (ring-shadows ≤ 4px blur only).
- **Honest reads, printed-bid gate, signed-signal law** — content laws, untouched.
- **NO EMAIL FEATURES** — untouched, forever.

Superseded old laws (north star overrides, tastefully): the blanket "no eyebrow kickers"
ban — ElevenLabs kickers are quiet gray sentence-case Inter, not tracked-uppercase slop;
we adopt THAT form only. ("CERTIFIED · HEDONIC"-style instrument data labels also remain.)

### 2.1 Ground: porcelain → eggshell (warm shift)
| token | was (porcelain) | now (north star) |
|---|---|---|
| page ground | `#F4F5F0` (cool bone) | `#FDFCFC` eggshell |
| well / plate | `#ECEDE6` | `#F5F3F1` cream; deep plate `#EBE8E4` putty |
| card | `#FFFFFF` | `#FFFFFF` (unchanged, but may sit borderless on cream) |
| ink | `#1D1D1B` | `#1C1917` warm ink (ramp: 800 `#292524`, 600 `#59544F`, 500 `#777169`, 400 `#A59F97`) |
| hairline | cool grays | `#EBE8E4` |
| signals | print green `#0F7C43` / brick `#C13E2C` | unchanged (the lamp) |
| accent gold | burnished `#8F6B1E` family | kept, demoted further — folio/FIG./seal only |

### 2.2 Type: lightness is the new authority
- Display/headlines: **Inter 300–350, larger sizes, ls −0.02/−0.03em, lh 105–120%**
  (we already own Inter; Waldenburg is licensed. Inter Light at 34–56px carries the
  same "drawn with a pen, not a marker" signal).
- Room heads move UP in size and DOWN in weight: 24/700 → 30–36/330.
- Body stays Inter; base bumps toward 14.5–15px where cramped; prose 17–18px.
- Numerals/mono registers keep IBM Plex Mono (that's lectr's own voice; Geist not needed).
- Kickers: 14–16px Inter 400 warm-gray 500, sentence case. Never uppercase-tracked.

### 2.3 The frame (biggest visible move)
Page content rails gain the registration frame: vertical hairlines bounding the container,
horizontal section rules breaking out to the viewport edge, crop-mark dots at intersections.
Sections become numbered plates in the catalogue — this fuses with the existing FIG./folio
system (which anticipated exactly this grammar).

### 2.4 Controls: the pill era
- All buttons/CTAs → pill radius; primary = ink bg + eggshell text (hover warm-700);
  secondary = white + stacked ring-shadow, borderless; tertiary/quiet = cream bg.
- Heights 44/36/30 (desktop density needs the 30). Weight 400–500, never 650+.
- Press scale(0.98); 150ms house curve; focus 1.5px outline offset 2.
- Chips/pills (market switch, sort pills, odds chips) inherit the same geometry.

### 2.5 Cards + ledgers
- Feature-ish cards → cream wells, borderless, radius 16, icon chip, gray-label/black-body
  inverted hierarchy.
- Stat/spec rows → dotted-hairline ledgers (fits: value engine spec rows, profile
  cost-basis rows, pricing-ish comparisons, method colophons).
- Byline-ledger pattern (gray label over black value in columns + dotted closing rule)
  becomes the standard header for data provenance (analytics abstract, lot dossiers,
  backtest record).
- Empty states + method cards may use geometric line-art plates (solid+dotted 1px,
  patent-figure style) — the Flick's family grows.

### 2.6 Motion
- House curve becomes 150ms `cubic-bezier(.4,0,.2,1)`; press scale on all interactive.
- Keep lectr's chart draw-in and CountUp (they ARE the product art in motion).
- No word-blur heroes for now (data desk ≠ marketing site) — grain drift optional later.

### 2.7 What we do NOT copy
- Gradient orbs / Chladni art (their brand, not ours — lectr's art is the market itself:
  charts, tape, receipts).
- WaldenburgFH condensed-caps display (no equivalent; our mono microlabels cover it).
- Marketing-scale 200px section paddings on data-dense desk pages (we scale to 96–128
  on editorial surfaces, keep desk density on cockpits).
- Voice-chat floating pill, cookie banners, etc.

### 2.8 Dark catalogue (the `?light=0` escape hatch)
Structural changes (pills, type weights, frames, ledgers) ship BOTH modes; the warm
re-ground and cream wells are light-scoped tokens. Dark stays the archive look.

---

## PART 3 — IMPLEMENTATION LEDGER
- Wave 1 (tokens + primitives, globals.css + shared components): re-ground, type roles,
  pill system, house curve, frame + crop marks, kicker/byline/ledger classes.
- Wave 2 (per-surface application, parallel disjoint-file agents): home, analytics,
  value, makers, profile, lot, blog/about, nav+footer.
- Wave 3 (verification): full-page screenshots desktop + 390px, both modes, then ship.
Record deviations and verdicts here as they land.

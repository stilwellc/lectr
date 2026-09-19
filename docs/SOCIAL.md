# The social desk

Automatic daily posting to X and Instagram, fed by the nightly. One post per
platform per day, rendered from the same served payload the site renders from,
posted after the deploy is live so every link resolves.

Nothing in a post is written by hand. If the data has no honest candidate for
tonight's post type, the rotation falls through to the next type; if nothing
qualifies, nothing posts. A silent night is correct behaviour.

## What posts, and when

| day (UTC) | post | the number | the link |
|---|---|---|---|
| Mon · Fri | **Tonight's call** | the best live lot flagged below its comparables: `pickCall()` from `app/components/Terminal.tsx` — live, close time ahead, confidence ≥ medium, ranked by `dealScore`, photographed. The gap is drawn as two bars to scale. | `/lot/<id>` |
| Tue | **The receipt** | the newest graded call from the comp-flag lane: called at $p, hammered at $r, drawn as two marks on a rail with the record's ±30% band painted. **Misses post exactly like hits.** | `/receipts` |
| Wed · Sat | **The board** | the whole desk in one frame: six photographed flags, one per maker so it reads as a market rather than one consignment, over the night's total flag count | `/value` |
| Thu | **The index** | one market's lead number by the site's honesty ladder, its 95% interval, and the series drawn and labelled at both ends | `/analytics` |
| Sun | **The record, replayed** | the backtest: flagged median vs unflagged, beat-the-high %, fail-to-sell % | `/receipts` |
| fallback | **What we won't publish** | an abstention, in the engine's own words, with the unresolved interval drawn straddling zero | `/analytics` |

Calls and the board carry the traffic and take two days each. The receipt is
the trust post. The index and the record take Thursday and Sunday. The
abstention has no fixed day — it fills in whenever a scheduled type has no
honest candidate, which is exactly when a post about restraint belongs.

**An item, always.** Every post carries a photograph, including the market
posts: the index, the record and the abstention each carry a strip of four
pieces from the market they describe, one per maker. A text-only card is a
bug. House photographs are auto-cropped to the object so it fills the plate.

The same key (lot id, receipt id, index horizon) is never posted twice inside
21 days. Only the comp-flag lane (`k: 'card'`) is ever posted as a receipt —
the bid-projection and gap lanes are still accruing receipts and the site does
not certify them (`app/lib/lanes.ts`).

## Voice

Desk voice. Short declaratives, real numbers, no adjectives, no hashtags, no
emoji. A post says what the record says and stops. Every post that names a
lot names the house. Every index prints its interval. Every caption ends with
the no-advice line.

## Platform mechanics that shaped this

**X bills per post, not per tier.** A plain post is $0.015; a post containing
a URL is $0.200 — thirteen times more. So the card post carries no link, and
the link rides in one reply. Two requests a day ≈ $6.50 a month.

**Instagram feed captions cannot carry a live link.** The caption ends with
the path (`lectr.bid/lot/…`) and the bio holds the domain. Feed posts are for
recall; the link in bio is the only traffic path the API gives us.

**Instagram will only publish from a public image URL, and only JPEG.** The
deploy job renders the cards *before* `next build`, so they ship inside the
static export at `lectr.bid/social/<date>-<type>-ig.jpg`. Free, and no third
host to trust.

**Every link carries UTM tags** (`utm_source=x|ig`, `utm_medium=social`,
`utm_campaign=<type>`). lectr has no analytics today; the day it does, the
source is already separable.

## The pieces

```
scripts/social/
  lib.ts        data loading, the four selectors (copied from the site's own),
                the flag memory, image fetch → data URI
  copy.ts       the words, per post type and platform
  render.tsx    the cards — next/og (satori) in the site's real faces, two
                sizes (1080×1350 IG, 1200×675 X), JPEG for Instagram
  post.ts       X (OAuth 1.0a, signed with node:crypto) + Instagram Graph,
                the ledger, DRY_RUN
  r2.ts         two tiny JSON documents in the private lectr-data bucket
  fonts/        Inter 400/500/600, IBM Plex Mono 400/500 (Google, latin subset)

.github/workflows/
  nightly.yml   deploy → "Render tonight's social cards" (continue-on-error,
                before next build) → artifact → `social` job (needs: deploy)
  social.yml    manual: dry_run (default true), force a type; cards → artifact
```

State lives in R2, never git:

- `social/ledger.json` — what was posted, by date and key. Makes the poster
  idempotent: a re-run after a partial failure only fills the gap.
- `social/flags.json` — id → {image, title, house, artist} for every lot the
  desk flagged, captured the night it was live. The served payload drops the
  photograph once a lot sells (`sold-ledger-*.json` is just id → [price, date]),
  so this is how a receipt weeks later still shows the piece. Forgets after a
  year.

## Setup — the part only a human can do

The code is complete and runs tonight in dry run: it renders the cards, prints
the exact copy, and posts nothing. Six repository secrets turn it on, with no
code change. Add them under **Settings → Secrets and variables → Actions**.
Either platform works alone; a platform whose secrets are absent stays dry.

These steps need you signed into your own developer accounts, so they cannot
be automated from here.

### X — four secrets

1. **developer.x.com → Developer Console → create a Project and an App.**
   The API Key and Secret are shown **once** at creation: *"we only display
   these credentials once, so make sure to save them in a password manager or
   somewhere secure."* If you lose them, regenerate from the app's **Keys and
   tokens** tab (Apps dropdown → your app).
2. **Set the app to Read and Write** under User authentication settings before
   generating any token. A token minted while the app is read-only stays
   read-only, and the failure looks like a permissions error at post time, not
   at setup. If you change the permission afterwards, regenerate the access
   token.
3. **Generate the Access Token and Secret for the @lectr account itself** from
   the same Keys and tokens tab. This is the app owner's own token — no
   three-legged OAuth flow is needed, because lectr is posting as itself.
4. **Buy credits** in the Developer Console. X is pay-per-use now: no plan, no
   subscription, but posting requires a positive credit balance.
5. Secrets: `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_SECRET`.

### Instagram — two secrets

1. The lectr Instagram account must be a **professional account** (Business or
   Creator). Personal accounts cannot publish through the API.
2. **developers.facebook.com → create an app, choosing the _Business_ app
   type**, then in the App Dashboard go to **Instagram → API setup with
   Instagram business login** and connect the lectr account.
3. Generate the token from **the App Dashboard**, not from the login flow.
   This matters: *"Access tokens from the business login flow are short-lived
   and valid for 1 hour. Access tokens from the App Dashboard are long-lived
   and are valid for 60 days."* The scope needed for posting is
   `instagram_business_content_publish`.
4. **The token expires every 60 days.** Refresh it before expiry and update
   the secret. When it lapses the poster does not crash — it logs the Graph
   API's own error and the X post still goes out. Put a calendar reminder at
   50 days.
5. Read the account id from `GET /me?fields=user_id,username` — the `user_id`
   field is what `IG_USER_ID` wants.
6. Secrets: `IG_USER_ID`, `IG_ACCESS_TOKEN`.
7. Put `lectr.bid` in the bio. It is the only clickable path Instagram gives a
   feed post.

### Preview before going live

Actions → **Social (X + Instagram)** → Run workflow, dry_run = true. Download
the `social-cards` artifact: both JPEGs and `today.json` with the exact copy.
Force a type to see the others.

## Costs

| | per day | per month |
|---|---|---|
| X: card post + link reply | $0.015 + $0.200 | ≈ $6.50 |
| Instagram | free | free |
| Render + post compute | GitHub Actions minutes | ≈ 3 min/day |

## What this deliberately does not do

- No engagement-bait, no polls, no "which would you pick", no threads for
  their own sake.
- No posting of the bid-projection or gap lanes as calls.
- No reposting the same lot within three weeks, however good it still looks.
- No stories, reels, or carousels yet. The Graph API supports them; the desk
  has nothing honest to say in that shape today.
- No follower or engagement readback. Reads cost X credits and there is
  nothing to do with the number yet.

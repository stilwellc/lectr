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
| Mon · Wed · Fri | **Tonight's call** | the best live lot flagged below its comparables: `pickCall()` from `app/components/Terminal.tsx` — live, close time ahead, confidence ≥ medium, ranked by `dealScore`, photographed | `/lot/<id>` |
| Tue · Sat | **The receipt** | the newest graded call from the comp-flag lane: called at $p, hammered at $r, and whether the hammer landed within the record's own ±30% band. **Misses post exactly like hits.** | `/receipts` |
| Thu | **The index** | one market's lead number by the site's honesty ladder (repeat-sale over hedonic, publishable horizons only) with its 95% interval and n | `/analytics` |
| Sun | **The record, replayed** | the backtest: flagged median vs unflagged, beat-the-high %, fail-to-sell % | `/receipts` |

Calls carry the traffic, so they take three days. The receipt is the trust post
and takes two. The two market posts take the weekend, when nothing is closing.

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

## Setup — the three things only a human can do

The code is complete and runs tonight in dry-run: it renders the cards, prints
the exact copy, and posts nothing. To go live, add these repository secrets.
Either platform works alone; a platform with no secrets stays dry.

### X

1. developer.x.com → create a project + app. Enable **Read and Write** under
   User authentication settings (OAuth 1.0a). Set any callback URL; it is
   unused.
2. Buy credits in the Developer Console (pay-per-use; no plan needed).
3. Keys and tokens → generate **API Key and Secret** and **Access Token and
   Secret** for the @lectr account. The access token must be generated *after*
   Read and Write is enabled, or it is read-only.
4. Secrets: `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_SECRET`.

### Instagram

1. The lectr Instagram account must be a **Professional** account (Business
   or Creator) and linked to a Facebook Page.
2. developers.facebook.com → app → add **Instagram** product → "API setup
   with Instagram login" → add the account as an Instagram tester and accept
   in the app.
3. Generate a token with `instagram_business_basic` and
   `instagram_business_content_publish`, then exchange it for a **long-lived**
   token (60 days; refresh via `GET /refresh_access_token` before expiry —
   the poster logs the expiry error plainly if it lapses).
4. Read the numeric **Instagram user id** from `GET /me?fields=id`.
5. Secrets: `IG_USER_ID`, `IG_ACCESS_TOKEN`.
6. Put `lectr.bid` in the bio.

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

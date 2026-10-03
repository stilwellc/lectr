# Retention: the return loop and how we measure it

Standing law: **no email features.** No address capture, no digests, no
waitlist mail. Everything below lives in the product (browser push, the
calendar, the in-app inbox) and every measurement is identity-free.

Schema: `supabase/migrations/0008_return_loop.sql`, tested locally on PGlite
with a Supabase-shaped auth shim. The test covers RLS, the RPC-only writes,
the caps, idempotent re-runs and the north-star view's arithmetic.

---

## 1. The north-star metric

**Watched lots reaching the hammer per week.**

A *watch* is a `saved_lots` row (owned or not) that was saved **before** the
lot's sale day ended. It *reaches the hammer* when the lot's row in
`public.lots` (settled nightly by `scripts/sync-lots-db.ts`) says
`status = 'sold'` with a positive `price_usd`. Weeks are ISO weeks (Monday
start, UTC) on the lot's `sale_date`.

Why this number: it moves only when people save lots *and* keep them until the
sale ends. That is the loop the product is for: watch, get told, show up at
the close. Sign-ups, page views and saves alone can all grow while nobody
comes back for the hammer.

It is computed by the view `public.north_star_weekly`. The view is
service-role only; anon and authenticated get `permission denied`.

```sql
create view public.north_star_weekly with (security_invoker = true) as
select date_trunc('week', l.sale_date)::date as week,
       count(*)                              as watched_lots_hammered,
       count(distinct s.user_id)             as watchers,
       count(*) filter (where s.owned)       as of_which_owned
from public.saved_lots s
join public.lots l on rtrim(l.id, '~') = rtrim(s.lot_id, '~')
where l.status = 'sold' and coalesce(l.price_usd, 0) > 0
  and l.sale_date is not null
  and s.saved_at < (l.sale_date + 1)::timestamptz
group by 1;
```

### The ops-numbers query

SQL editor:

```sql
select * from public.north_star_weekly order by week desc limit 12;
```

From a workflow (service key, aggregates only), add this step to
`.github/workflows/ops-numbers.yml` after "Count users and saved work":

```yaml
      - name: North star + product events + Pro interest
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
        run: |
          python3 - <<'PY'
          import json, os, urllib.request, datetime, collections
          base, key = os.environ['SUPABASE_URL'].rstrip('/'), os.environ['SUPABASE_SERVICE_KEY']
          def get(path):
              req = urllib.request.Request(base + '/rest/v1/' + path, headers={'apikey': key, 'Authorization': 'Bearer ' + key})
              with urllib.request.urlopen(req, timeout=60) as r:
                  return json.loads(r.read() or b'[]')

          print('north star: watched lots reaching the hammer, per ISO week')
          for r in get('north_star_weekly?select=*&order=week.desc&limit=12'):
              print(f"  {r['week']}  {r['watched_lots_hammered']:>5} lots  {r['watchers']:>4} watchers  ({r['of_which_owned']} owned)")

          since = (datetime.date.today() - datetime.timedelta(days=14)).isoformat()
          print('\nproduct events, last 14 days (anonymous daily counts)')
          for r in get(f'event_counts?select=day,event,n&day=gte.{since}&order=day.desc,event.asc'):
              print(f"  {r['day']}  {r['event']:<15} {r['n']}")

          rows = get('pro_interest?select=price_point')
          c = collections.Counter(r['price_point'] for r in rows)
          print(f'\npro interest (fake door): {len(rows)} accounts')
          for k in sorted(c, key=lambda x: (x is None, x or 0)):
              print(f"  {('$' + str(k) + '/mo') if k else 'no price':<9} {c[k]}")
          PY
```

### Caveats (the honest limits)

- **Unsave after the hammer erases the watch.** `saved_lots` has no
  tombstones, so a lot unsaved after it sold drops out of past weeks. Recent
  weeks are the most complete; read the trend, not one old week.
- **`public.lots` keeps 24 months.** Older weeks thin out as the sweep ages
  rows away.
- **Results land late.** A sale enters the count when the crawl publishes its
  result. The current week fills in over the following days.
- **Sold only.** Bought-in, withdrawn and unresolved lots don't count. Nobody
  saw a hammer fall on them.

---

## 2. Instrumentation

### Page views: Cloudflare Web Analytics (cookieless)

`app/components/retention/Analytics.tsx` renders the beacon **only** when
`NEXT_PUBLIC_CF_BEACON_TOKEN` is set at build time. When it is unset, the page
carries no analytics script and makes no analytics requests. The CSP in
`public/_headers` allows `script-src https://static.cloudflareinsights.com`
and `connect-src https://cloudflareinsights.com`. Those two entries do nothing
without the script. Use **either** the token **or** the Pages dashboard's
automatic injection, never both, or every view counts twice.

Cloudflare Web Analytics does **not** take custom events. It answers visits,
pages, referrers and Web Vitals, and nothing else.

### Product events: anonymous daily counts in Supabase

`app/lib/analytics.ts` exposes `track(event)`. It POSTs `{ p_event }` to the
`track_event` RPC **with the anon key, never the user's session token**. The
server therefore cannot tie a count to an account. Storage is
`public.event_counts (day, event, n)`: at most 7 rows a day, with no user id,
IP, lot id, session or device. Clients can neither read nor write the table.

| event | fired by |
| --- | --- |
| `save_lot` / `unsave_lot` | `toggle()` in `app/lib/account.tsx` (signed-in or localStorage mode) |
| `maxbid_view` | the lot page printed its **Max bid** row (once per lot per page-session). There is no "why panel" to open: the row is always visible on live lots with a gated floor, so this counts *displays*, not *expansions*. |
| `outbound_house` | any click on a "View at <house>" link (lot page and comps modal), caught by one delegated listener (`OutboundTracker`) |
| `push_optin` | notifications turned on for a device |
| `pro_interest` | the first "I'd pay for this" press on an account |
| `calendar_add` | an `.ics` handed to the calendar |

Abuse bounds: unknown names are dropped. Each page-session can send at most
25 of each event. The server accepts at most 600 events per minute globally
and caps each event at 20,000 per day. That means the counts are
**spam-bounded, not spam-proof**: a script can inflate a day up to those caps,
but it can never grow the table. Browsers sending **Global Privacy Control or
Do Not Track record nothing**, so every count undercounts by that share.

---

## 3. Browser push for watched lots

| piece | file |
| --- | --- |
| opt-in UI (profile, above the inbox) | `app/components/retention/PushOptIn.tsx` |
| subscribe / unsubscribe | `app/lib/push.ts` → RPCs `register_push_subscription` / `unregister_push_subscription` |
| service worker (push + click only, **no fetch handler, no cache**) | `public/sw.js` |
| web-app manifest (needed for iOS) | `app/manifest.ts` → `/manifest.webmanifest` |
| sender | `scripts/push-send.ts` (logic in `scripts/lib/push-plan.ts`, unit-tested) |

**What gets sent.** Each user hears each of these at most once per lot,
enforced by the `push_log` primary key:

- `close24`: the lot closes within 24h. A date-only sale gets "Sells
  today/tomorrow" and never a fake countdown.
- `close1`: a lot with a timed close is in its last 90 minutes.
- `hammer`: "Sold: <lot> / Sold for $X at <house> (lectr forecast $Y)." The
  forecast is the engine's `compValueUsd`, which push-send snapshots into
  `push_lot_snap` while the lot is live, because `sync-lots-db` nulls `value`
  when it settles a lot. The price is the realized price, premium-inclusive
  where the house publishes it, so the copy says "sold for" and never presents
  it as a bare hammer figure. If no snapshot exists, the message names no
  forecast. Hammers older than 7 days are never pushed.

A user gets at most 3 notifications per kind per run. Anything beyond that
collapses into one "N more watched lots…" summary that links to `/profile`.

**Subscription hygiene.** A 404 or 410 from the push service deletes the
subscription at once. A 429, a 5xx or a network error keeps it and adds to
`fail_count`, and the subscription is retired after 80 consecutive failures.
Any other 4xx is a warning, because it means a bug on our side. Each user can
register at most 10 devices. `push_log` rows older than 120 days and
snapshots older than 60 days are purged by the sender.

**Failures stay quiet.** push-send turns every failure into a `::warning::`
and exits 0. A push-service hiccup must never turn the close-board deploy or
the nightly sync red. Use `--strict` when debugging by hand, and `--dry-run`
to print the plan without sending.

**iOS.** Safari delivers web push only to a site added to the Home Screen
(iOS 16.4+) and opened from that icon. In a Safari tab the Push API does not
exist. The opt-in tells iPhone and iPad users exactly that (Share → Add to
Home Screen) instead of showing a dead button.

**Timing.** close-board runs every 4h, so `close24` lands somewhere between
20 and 24 hours out. At a 4h cadence, `close1` fires only when a run happens
to land inside a lot's last 90 minutes. A punctual `close1` needs an hourly
runner (below). The UI says "about a day" and "about an hour" for this reason.

### Workflow steps to add

1. **close-board.yml**: append to the `board` job, after "Hand the overlay to
   the deploy". It must not be gated on `built`, since alerts are due even
   when no overlay was built:

```yaml
      - name: Push close alerts (watched lots closing ≤24h / ≤90m)
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
          VAPID_PRIVATE_KEY: ${{ secrets.VAPID_PRIVATE_KEY }}
          NEXT_PUBLIC_VAPID_PUBLIC_KEY: ${{ vars.NEXT_PUBLIC_VAPID_PUBLIC_KEY }}
        run: npx tsx scripts/push-send.ts --kinds close24,close1
```

   This step reads the served `upcoming.json` from lectr.bid, because the
   board job has no local copy.

2. **nightly.yml**: append to the `sync` job, after "Match signal alerts".
   The job's freshly settled `lots` table and its local `upcoming.json` feed
   both the forecast snapshot and the hammer:

```yaml
      - name: Push hammer results (watched lots that sold)
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
          VAPID_PRIVATE_KEY: ${{ secrets.VAPID_PRIVATE_KEY }}
          NEXT_PUBLIC_VAPID_PUBLIC_KEY: ${{ vars.NEXT_PUBLIC_VAPID_PUBLIC_KEY }}
        run: npx tsx scripts/push-send.ts --kinds hammer,close24
```

3. *(Optional, for a punctual 1-hour alert.)* Add a tiny hourly workflow with
   `cron: '11 * * * *'`, a checkout, `npm ci --ignore-scripts`, and the same
   step with `--kinds close1`. It costs one upcoming.json fetch plus a few
   PostgREST reads per hour.

4. **deploy.yml / nightly.yml build steps**: pass
   `NEXT_PUBLIC_VAPID_PUBLIC_KEY: ${{ vars.NEXT_PUBLIC_VAPID_PUBLIC_KEY }}` and
   `NEXT_PUBLIC_CF_BEACON_TOKEN: ${{ vars.NEXT_PUBLIC_CF_BEACON_TOKEN }}` to
   every `npm run build` env, next to the Supabase vars. They are inlined at
   build time.

---

## 4. Calendar

The card's old "Remind me" downloaded a file without saying so and then
claimed "Added to calendar". It is now an explicit **Add to calendar** button
(`app/components/retention/AddToCalendar.tsx`). On iPhone and iPad the `.ics`
opens and iOS offers "Add to Calendar". Everywhere else a named file
downloads. Either way a visible confirmation says what happened and what the
alarms are: 1 day and 1 hour before a timed close, or reminders ahead of the
sale day for a date-only sale.

**Out of scope: a subscribable per-user watchlist calendar** (a `webcal://`
feed that updates as you save). A feed is a URL a calendar app polls
anonymously. It would need either a server that authenticates a per-user
secret token and renders the user's saves on request, or a scheduled job that
writes every user's private feed to a public, unguessable URL. lectr is a pure
static export on Cloudflare Pages with no server. The second option would
publish private watchlists behind nothing but obscurity. It is not built.

---

## 5. Pro fake door

`app/components/retention/ProCard.tsx` sits at the foot of `/profile`. It
lists three tools that do not exist (alert ladders, max-bid ladders, CSV
export) and offers an optional price point of $10, $20 or $40 a month, plus
**I'd pay for this**.

- Signed in: one row per account in `public.pro_interest` (`user_id`,
  `price_point`, timestamps). The UI immediately says *"Not built yet. We're
  measuring interest."* and that nothing is charged or emailed. Changing the
  price later updates the same row.
- Signed out: the sign-in sheet opens, and the press completes after the
  OAuth round trip.
- There is no email column and no waitlist.

Read it with the ops step above, or with
`select price_point, count(*) from pro_interest group by 1;`.

---

## 6. What stays inert until Collin adds…

| to switch on | add |
| --- | --- |
| all of the schema | run `supabase/migrations/0008_return_loop.sql` in the SQL editor (idempotent) |
| page views | Cloudflare dashboard → Web Analytics → add site `lectr.bid` (manual JS snippet) → copy the token → GitHub repo **Variable** `NEXT_PUBLIC_CF_BEACON_TOKEN` + Cloudflare Pages env var of the same name. Do NOT also enable the Pages automatic injection. |
| product events | nothing new: they ride the existing Supabase vars once 0008 is applied |
| push | `npx web-push generate-vapid-keys` → public key as repo **Variable** `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (+ Pages env var), private key as repo **Secret** `VAPID_PRIVATE_KEY`; add the workflow steps in §3 |
| Pro fake door | nothing new: visible once 0008 is applied (it hides when auth is off) |

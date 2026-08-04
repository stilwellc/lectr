# C1 — GA-Readiness Security Audit · lectr (lectr.bid)

Date: 2026-08-03 · Reviewer: automated defensive review (owner's product) · Repo: github.com/stilwellc/lectr (public) · Prod: https://lectr.bid (Cloudflare Pages, pure static export)

## Verdict

**No BLOCKERS.** Ships-tomorrow posture is acceptable. Core auth/RLS boundary is sound and no secrets leak. The gaps are hardening (headers) and one defense-in-depth XSS de-fang. Fix the 5 PRE-GA items today; the 2 POST-GA can wait.

**Counts:** BLOCKER 0 · PRE-GA 5 · POST-GA 2 · Verified-secure 8

### Worst 5
1. **[PRE-GA]** `href={lot.url}` has no scheme allowlist — crawler-derived URL could carry `javascript:`/`data:` and React does not sanitize href.
2. **[PRE-GA]** No `X-Frame-Options` / CSP `frame-ancestors` — clickjacking risk against the Google-OAuth login modal.
3. **[PRE-GA]** RLS policies for `saved_searches`, `alerts`, `collection_snapshots` are NOT in version control (enforced in prod, but unauditable/unreproducible).
4. **[PRE-GA]** No HSTS (`Strict-Transport-Security`) at origin.
5. **[PRE-GA]** `next@14.1.0` is outdated (many CVEs flagged; runtime impact minimal because static export — see §5).

---

## 1. Supabase / RLS — VERIFIED SECURE (one policy-in-VCS gap)

Anon key (public by design, RLS-gated): `NEXT_PUBLIC_SUPABASE_ANON_KEY`, project `tiwrdomqydtnmgljsqsi`. Live PostgREST probes with that key:

| Table | anon SELECT `*` | count (HEAD) | anon INSERT |
|---|---|---|---|
| `lots` | rows returned (public read by design; no PII) | — | `401 / 42501 RLS violation` (write-blocked) |
| `saved_lots` | `[]` | `content-range: */0` | `401 / 42501 "new row violates row-level security policy"` |
| `saved_searches` | `[]` | — | (blocked by same policy family) |
| `alerts` | `[]` | — | (blocked) |
| `collection_snapshots` | `[]` | — | (blocked) |

- **Cross-user read: NOT possible.** Every user table returns `[]`/`*/0` for an unauthenticated anon caller — RLS `using (auth.uid() = user_id)` filters the set to empty. A made-up `user_id` filter changes nothing.
- **Write to another user: NOT possible.** Single INSERT probe to `saved_lots` with `user_id=00000000-...` → `401`, code `42501`. INSERT to `lots` → `401 / 42501` (service-key-only; `scripts/sync-lots-db.ts` uses `SUPABASE_SERVICE_KEY`).
- **DELETE `lots` (anon, non-matching filter)** returned `204` affecting 0 rows. Because INSERT proves RLS is *enabled* on `lots` with no anon write policy, the deletable set is empty — the 204 is standard PostgREST "0 rows", not a delete capability. (A destructive confirm was out of scope by design.)

**[PRE-GA] RLS policies not fully in version control.** Only `supabase/saved-lots.sql` + `supabase/add-owned-column.sql` are checked in. The policies for `saved_searches`, `alerts`, `collection_snapshots` (and the `saved_title`/`saved_artist`/`last_matched` columns referenced in `alerts.ts`, `account.tsx`, `match-alerts.ts`) exist only in the live DB (created via management API). They are *enforced* in prod (probed above) but not auditable/reproducible.
Fix: dump and commit the complete schema + all RLS policies (`supabase db dump` or hand-write the CREATE POLICY blocks) so a rebuild can't silently ship an unprotected table.

## 2. Secrets — VERIFIED SECURE

- `.env.local` is git-ignored (`.env*.local`) and **never committed** (`git log --all -- .env.local` empty). `.env.local.example` holds empty placeholders only.
- Git history scan (50 commits, full diffs) for `service_role`, CF tokens, `re_…` (Resend), `eyJ…` JWTs, cookies, `sk_live`, `AKIA`, hex40: **only** hit is `CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}` — a proper Actions secret reference, not a value. hex40 hits were commit SHAs.
- Workflows (`deploy.yml`, `nightly.yml`, `ray-crawl.yml`) inject all secrets via `env:` `${{ secrets.* }}` (SUPABASE_SERVICE_KEY, RESEND_API_KEY, SOTHEBYS_COOKIE, CF token). Error strings reference secret **names**, never values — no `echo $SECRET`.
- The service key never reaches the client — only build/crawl scripts read `SUPABASE_SERVICE_KEY`; the browser bundle uses the anon key only. Correct separation.

## 3. XSS / Injection

- **`dangerouslySetInnerHTML` (30+ sites):** all are `<style>{__html: STATIC_CSS}` (module-level CSS constants), plus one inline theme `<script>` in `app/layout.tsx:70` with **no interpolated/untrusted input**. No crawler string is ever placed in an HTML sink. **Safe.**
- **`document.title = ${craftTitle(lot.title)} — lectr`** (`LotPage.tsx:321`, `market.tsx`): title assignment is plain-text, not parsed as HTML/script. **Safe** even with a hostile crawled title.
- **Images:** `src={httpsImg(lot.imageUrl)}` (`app/utils.ts:144` forces `http→https`), comps use `referrerPolicy="no-referrer"` + `onError` removal. `img src` is not a script vector; no mixed content, no referrer leak. **Safe.**
- **⌘K / CommandK.tsx:** no `dangerouslySetInnerHTML`/`href=` sinks; renders via `next/link`/router. **Safe.**
- **[PRE-GA] `href={lot.url}` — no scheme allowlist.** `lot.url` is arbitrary crawler-derived text. React does **not** sanitize `href`, so a `javascript:`/`data:` URL executes on click. Sinks: `LotCard.tsx:243`, `LotPage.tsx:737` & `:798`, `Terminal.tsx:262`, `ComparableModal.tsx:949` & `:1125`, `PastResults.tsx:349`. Most crawlers build URLs from hardcoded `https://…` bases or a `.startsWith('http')` guard (which de-fangs `javascript:` by prefixing the base), but several sinks assign `lot.url` straight from page/JSON (`ray-crawl.ts` lotUrl direct assigns; Sotheby's/Christie's JSON `lot.url`) with no guarantee. Low likelihood, trivial fix.
  Fix: `const safeHref = (u?: string|null) => (u && /^https?:\/\//i.test(u) ? u : undefined);` and use it at every `href={lot.url}` / `href={comp.url}`.

## 4. Headers / Platform

`curl -sI https://lectr.bid`:
- Present: `x-content-type-options: nosniff`, `referrer-policy: strict-origin-when-cross-origin` (CF Pages defaults).
- **[PRE-GA] Missing `X-Frame-Options` / CSP `frame-ancestors`** → clickjacking. The app ships a Google-OAuth login modal; framing enables UI-redress. Fix in `public/_headers`:
  ```
  /*
    X-Frame-Options: DENY
    Content-Security-Policy: frame-ancestors 'none'
  ```
- **[PRE-GA] Missing HSTS.** No `Strict-Transport-Security` at origin. Fix: add `Strict-Transport-Security: max-age=31536000; includeSubDomains` to the `/*` block (or enable HSTS at the CF edge).
- **[POST-GA] No Content-Security-Policy.** A full CSP is awkward here (inline `<style>`/`<script>` need `'unsafe-inline'` or nonces, and `output:'export'` can't inject per-request nonces). Even a baseline `default-src 'self'; img-src https: data:; connect-src 'self' https://*.supabase.co; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'` would harden meaningfully. Deferred for the inline-style friction.
- `access-control-allow-origin: *` on static HTML is the CF Pages default and harmless for a public static site (Supabase is cross-origin with its own CORS+RLS; there's no credentialed same-origin API). Note only.
- Third-party client surface is small: same-origin `/data/*` (CF), Supabase (`*.supabase.co`), Google OAuth (via Supabase), and auction-CDN images (`cloudfront.net`, `dist.phillips.com`, forced https). `public/_headers` currently sets only content-type/cache for the OG image + data shards — that's the file to add security headers to.
- No app-set cookies; auth session is Supabase JS (localStorage) — no CSRF cookie surface.

## 5. Supply chain

- **[PRE-GA] `next@14.1.0` (Feb 2024) is outdated.** `npm audit` flags ~10 Next advisories, but the app is **`output: 'export'` pure static** (`next.config.js`) served by CF Pages — no server, middleware, Server Actions, Image Optimization API, or runtime rewrites. That makes SSRF, DoS-Server-Actions, middleware/i18n bypass, image-opt DoS, cache-confusion, and server-function-disclosure CVEs **unreachable**. The beforeInteractive-XSS advisory needs untrusted `<Script>` input — not present. Real runtime exposure: minimal. Still recommend `npm audit fix --force` → `next@14.2.35` before/soon after GA (also clears postcss).
- **[POST-GA] `postcss` critical+high** (XSS via unescaped `</style>`, source-map arbitrary file read). Build-time dependency processing only first-party authored CSS inside CI — not runtime-reachable by any visitor. Resolved by the same Next bump.
- Other deps (`@supabase/supabase-js ^2.110`, `react 18`, `recharts`, `framer-motion`, `cheerio`, `playwright`, `tsx`) — current-ish, no notable advisories. `npm audit`: 2 vulnerabilities (1 high postcss, 1 critical postcss), both build-time.

---

## Verified-secure list
1. RLS blocks anon cross-user READ on `saved_lots`/`saved_searches`/`alerts`/`collection_snapshots` (`[]`, `*/0`).
2. RLS blocks anon WRITE to user tables and to `lots` (`401 / 42501`).
3. Service key is server-only (crawl/build), never in the client bundle.
4. `.env.local` git-ignored and never committed; example has empty placeholders.
5. No secrets in 50-commit history; workflows use `${{ secrets.* }}` with no value echoes.
6. All `dangerouslySetInnerHTML` are static CSS / no-input inline script; `document.title` is text-only.
7. Images forced to https via `httpsImg`, `referrerPolicy=no-referrer` on comps.
8. ⌘K command palette renders via router/Link — no HTML/href injection sink.

## Fix checklist (PRE-GA, do today)
- [ ] Add `safeHref()` scheme allowlist to all `href={lot.url}`/`{comp.url}` sinks.
- [ ] Add `X-Frame-Options: DENY` + `frame-ancestors 'none'` + HSTS to `public/_headers` `/*`.
- [ ] Commit full schema + RLS policies for `saved_searches`, `alerts`, `collection_snapshots`.
- [ ] `npm audit fix --force` → `next@14.2.35` (clears postcss too); re-verify build + static export.

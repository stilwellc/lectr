// DATA VERSION STAMP (Sep 2 2026): bake the served meta.json's lastCrawl into
// the HTML build as NEXT_PUBLIC_DATA_VERSION. The client (useRayData) compares
// it to the meta.json it fetches at runtime: a mismatch means the CDN handed
// the page one crawl and the data another (a stale-cached meta.json after a
// deploy, or a deploy that baked older data than prod already served) — it
// re-fetches meta with a cache-bust and logs a console warning. Read with fs
// at config time so it costs nothing at runtime; '' when no data is present
// (a data-less checkout) so the skew check simply stays dormant.
const dataVersion = (() => {
  try {
    const meta = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'public', 'data', 'ray', 'meta.json'), 'utf8'));
    return typeof meta.lastCrawl === 'string' ? meta.lastCrawl : '';
  } catch { return ''; }
})();

// STATIC ENTITY ALIASES (W12, Oct 11 2026): the /p/<player>, /e/<name> pages
// this build prerenders (app/lib/seo-entities — TS, so scripts/entity-aliases
// prints them) inlined into the bundle, so every in-app entity link
// (app/lib/entity/aliases) lands on the page with its own share card, the
// same on the prerendered HTML and after hydration. Computed once: the value
// is parked in process.env so build workers that reload this config inherit
// it. '[]' when it cannot be read — links stay on their query routes.
const entityAliases = (() => {
  if (process.env.NEXT_PUBLIC_ENTITY_ALIASES) return process.env.NEXT_PUBLIC_ENTITY_ALIASES;
  let out = '[]';
  try {
    out = require('child_process').execFileSync(
      process.execPath, ['--import', 'tsx', require('path').join(__dirname, 'scripts', 'entity-aliases.ts')],
      { cwd: __dirname, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], timeout: 60000 },
    ).trim() || '[]';
  } catch (e) {
    console.warn('[next.config] entity aliases unavailable — entity links use their query routes:', e && e.message);
  }
  process.env.NEXT_PUBLIC_ENTITY_ALIASES = out;
  return out;
})();

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: { NEXT_PUBLIC_DATA_VERSION: dataVersion, NEXT_PUBLIC_ENTITY_ALIASES: entityAliases },
  // Pure static export — the whole site prerenders to files (Cloudflare Pages
  // hosting; no server anywhere, which is what the Vercel fair-use block
  // taught us the hard way).
  // RAY_DEV_NO_EXPORT=1 (dev only): `next dev` refuses a dynamic route under
  // output:'export' (it wants generateStaticParams on the page itself, though
  // the layout's satisfies the build) — unset output so hydration can be
  // debugged locally with unminified React errors. Builds are unaffected.
  output: process.env.RAY_DEV_NO_EXPORT ? undefined : 'export',
  reactStrictMode: true,
  images: {
    unoptimized: true,
  },
  // Next 16 builds with Turbopack by default. The old webpack hook (browser
  // fallbacks for fs/path) is gone: fs/path are only imported by server-side
  // build-time modules (generateStaticParams / metadata / sitemap / OG), never
  // by a client component, so no browser alias is needed.
  compress: true,
  generateEtags: true,
};

module.exports = nextConfig;

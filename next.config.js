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

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: { NEXT_PUBLIC_DATA_VERSION: dataVersion },
  // Pure static export — the whole site prerenders to files (Cloudflare Pages
  // hosting; no server anywhere, which is what the Vercel fair-use block
  // taught us the hard way).
  // RAY_DEV_NO_EXPORT=1 (dev only): `next dev` refuses /[artist] under
  // output:'export' (it wants generateStaticParams on the page itself, though
  // the layout's satisfies the build) — unset output so hydration can be
  // debugged locally with unminified React errors. Builds are unaffected.
  output: process.env.RAY_DEV_NO_EXPORT ? undefined : 'export',
  reactStrictMode: true,
  images: {
    unoptimized: true,
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
      };
    }
    return config;
  },
  optimizeFonts: true,
  swcMinify: true,
  compress: true,
  generateEtags: true,
};

module.exports = nextConfig;

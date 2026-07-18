/** @type {import('next').NextConfig} */
const nextConfig = {
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

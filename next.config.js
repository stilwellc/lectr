/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pure static export — the whole site prerenders to files (Cloudflare Pages
  // hosting; no server anywhere, which is what the Vercel fair-use block
  // taught us the hard way).
  output: 'export',
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

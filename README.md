# Ray

Auction intelligence for the art market. Ray tracks 21 artists across the major
auction houses (Phillips, Sotheby's, Christie's, Wright, Rago, Heritage, Bonhams,
Hindman), crawling realized and upcoming lots automatically and rendering them as
a market view — portfolio performance, price distributions, comparables, and
per-artist histories.

Extracted from the [co.stil](https://github.com/stilwellc/Mobi) studio site into
its own project; the studio site links to it as a standalone product.

## Stack

- **Next.js 14** (App Router) · **TypeScript** · **Recharts**
- Data is static JSON in `public/data/ray/`, refreshed by a scheduled crawl
- Deployed on **Vercel**

## Develop

```bash
npm install
npm run dev        # http://localhost:3000
```

## Data crawl

The crawler fetches auction results/listings and writes
`public/data/ray/{lots,stats,meta}.json`.

```bash
npm run crawl
```

A GitHub Action (`.github/workflows/ray-crawl.yml`) runs it daily at 13:00 UTC and
commits any changes back to the repo, which triggers a Vercel redeploy.

## Routes

- `/` — the market: upcoming lots + recent results
- `/[artist]` — a single artist's history
- `/analytics` — portfolio-wide charts and rankings
- `/saved` — locally bookmarked lots

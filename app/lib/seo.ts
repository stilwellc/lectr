/**
 * seo.ts — THE head block of every route that names itself (SEO wave, Oct 11
 * 2026). Pure: no I/O, imported by server metadata exports only.
 *
 * Why one helper: Next merges metadata SHALLOWLY, so a route that sets
 * `openGraph` or `twitter` replaces the root's block wholesale. Routes that
 * named only a title + description shared as the generic site card (og:title
 * "lectr — auction intelligence" on /about, every blog post, /value/<m>);
 * routes that named an openGraph title but no image (/art, every /ref and
 * /sub dossier) unfurled with NO image at all, and their twitter card fell
 * back to `summary`. seoMeta always emits the full set — title, description,
 * self canonical, og:url, og:image (+ size + alt), twitter — so a share
 * preview and the crawler read the same page facts.
 */
import type { Metadata } from 'next';

export const SITE_URL = 'https://lectr.bid';
export const SITE_NAME = 'lectr';
/** the site card (app/opengraph-image.tsx, statically rendered at build) */
export const SITE_CARD = '/opengraph-image';
const CARD = { width: 1200, height: 630 };

export interface SeoInput {
  /** the page title BEFORE the root '%s — lectr' template */
  title: string;
  /** true: `title` is already the full document title (no template) */
  absolute?: boolean;
  description: string;
  /** the route's own path — its canonical and og:url ('/makers/kaws') */
  path: string;
  /** the share card (a site-relative png); the site card when omitted */
  image?: string;
  imageAlt?: string;
  type?: 'website' | 'article' | 'profile';
  /** article dates (blog posts) */
  publishedTime?: string;
  noindex?: boolean;
  /** false on a QUERY shell (/player, /entity, /sub, /ref): one HTML serves
   *  every ?id=, so a canonical (or og:url) would collapse every dossier onto
   *  the bare index — the audit-urls bug the root layout's comment records */
  canonical?: boolean;
}

/** the full document title a route prints */
export function fullTitle(title: string, absolute?: boolean): string {
  return absolute ? title : `${title} — ${SITE_NAME}`;
}

/** our own cards are re-rendered every deploy at the SAME path — the build's
 *  data stamp rides the URL so iMessage / Slack / X re-fetch a fresh card
 *  instead of serving last week's numbers from their unfurl caches (the root
 *  file-convention card carried Next's content hash for the same reason) */
const CARD_V = (process.env.NEXT_PUBLIC_DATA_VERSION || '').replace(/\D/g, '').slice(0, 12);
export const cardUrl = (p: string) => (/^https?:/.test(p) || !CARD_V ? p : `${p}${p.includes('?') ? '&' : '?'}v=${CARD_V}`);

export function seoMeta(o: SeoInput): Metadata {
  const t = fullTitle(o.title, o.absolute);
  const image = cardUrl(o.image || SITE_CARD);
  const alt = o.imageAlt || t;
  return {
    title: o.absolute ? { absolute: o.title } : o.title,
    description: o.description,
    ...(o.canonical === false ? {} : { alternates: { canonical: o.path } }),
    ...(o.noindex ? { robots: { index: false, follow: true } } : {}),
    openGraph: {
      title: t,
      description: o.description,
      ...(o.canonical === false ? {} : { url: o.path }),
      siteName: SITE_NAME,
      locale: 'en_US',
      type: o.type || 'website',
      ...(o.publishedTime ? { publishedTime: o.publishedTime } : {}),
      // our own cards are 1200×630; a lot's house photo is whatever size it is
      images: [{ url: image, ...(/^https?:/.test(image) ? {} : CARD), alt }],
    },
    twitter: { card: 'summary_large_image', title: t, description: o.description, images: [{ url: image, alt }] },
  };
}

/** a site-relative path → absolute URL (JSON-LD wants absolute ids) */
export const abs = (p: string) => (/^https?:\/\//.test(p) ? p : `${SITE_URL}${p.startsWith('/') ? '' : '/'}${p}`);

/** a display name → a path slug ('Apollo 11' → 'apollo-11', 'Pokémon' → 'pokemon') */
export function slugify(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/&/g, ' and ').replace(/[.'’]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/* ── JSON-LD (schema.org) ──────────────────────────────────────────────────
   What ships, and why only this (Google rich-result rules, Oct 2026):
   • Organization + WebSite on every page (root layout): the site's name and
     logo for the knowledge panel / site name in results.
   • BreadcrumbList on every dossier: an eligible rich result, and every
     crumb is a real page.
   • BlogPosting on the notes: headline, dates, author.
   • Dataset on the reference + sub-market dossiers: they ARE tables of
     settled auction results (Dataset Search).
   • WebPage + `about` (Person / Organization / Thing) on maker, player and
     entity dossiers.
   NOT shipped: Product/Offer on lots — Google requires a real offer price
   (or reviews); a house estimate is not an offer and lectr sells nothing,
   so a Product would either fail validation or invent a price. Event on
   lots — Google's event policy excludes sales/promotions dressed as events. */

export type Ld = Record<string, unknown>;

export const ORG_ID = `${SITE_URL}/#organization`;
export const SITE_ID = `${SITE_URL}/#website`;

export function siteLd(description: string): Ld {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': ORG_ID,
        name: SITE_NAME,
        url: SITE_URL,
        logo: { '@type': 'ImageObject', url: abs('/brand/lectr-ink-lg.png') },
        description,
      },
      {
        '@type': 'WebSite',
        '@id': SITE_ID,
        name: SITE_NAME,
        alternateName: 'lectr.bid',
        url: SITE_URL,
        description,
        publisher: { '@id': ORG_ID },
        inLanguage: 'en-US',
      },
    ],
  };
}

/** crumbs: [name, path][] — the last is the page itself */
export function breadcrumbLd(crumbs: [string, string][]): Ld {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: abs(path) })),
  };
}

export function webPageLd(o: { path: string; name: string; description: string; image?: string; about?: Ld; type?: string }): Ld {
  return {
    '@context': 'https://schema.org',
    '@type': o.type || 'WebPage',
    '@id': `${abs(o.path)}#page`,
    url: abs(o.path),
    name: o.name,
    description: o.description,
    isPartOf: { '@id': SITE_ID },
    publisher: { '@id': ORG_ID },
    inLanguage: 'en-US',
    ...(o.image ? { primaryImageOfPage: { '@type': 'ImageObject', url: abs(o.image) } } : {}),
    ...(o.about ? { about: o.about } : {}),
  };
}

export function datasetLd(o: { path: string; name: string; description: string; keywords?: string[]; temporal?: string | null; measured?: string[] }): Ld {
  return {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    '@id': `${abs(o.path)}#dataset`,
    url: abs(o.path),
    name: o.name,
    // Dataset requires 50–5000 characters of description
    description: o.description.length >= 50 ? o.description : `${o.description} Settled auction results tracked by lectr, read nightly.`,
    creator: { '@type': 'Organization', '@id': ORG_ID, name: SITE_NAME, url: SITE_URL },
    publisher: { '@id': ORG_ID },
    isAccessibleForFree: true,
    ...(o.keywords?.length ? { keywords: o.keywords } : {}),
    ...(o.temporal ? { temporalCoverage: o.temporal } : {}),
    ...(o.measured?.length ? { variableMeasured: o.measured } : {}),
  };
}

export function blogPostingLd(o: { path: string; headline: string; description: string; date: string; image?: string }): Ld {
  return {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    '@id': `${abs(o.path)}#article`,
    mainEntityOfPage: abs(o.path),
    url: abs(o.path),
    // Google truncates past ~110 characters
    headline: o.headline.length > 110 ? `${o.headline.slice(0, 107).trimEnd()}…` : o.headline,
    description: o.description,
    datePublished: o.date,
    dateModified: o.date,
    image: [abs(o.image || SITE_CARD)],
    author: { '@type': 'Organization', '@id': ORG_ID, name: SITE_NAME, url: SITE_URL },
    publisher: { '@id': ORG_ID },
    inLanguage: 'en-US',
  };
}

/** serialise for a <script type="application/ld+json"> body — '<' escaped so
 *  a title can never close the tag */
export function ldJson(data: Ld | Ld[]): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

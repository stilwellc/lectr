'use client';

/* ============================================================
   THE CATALOG — client-only helpers + curated data.
   Self-contained: this whole directory owns its own hooks,
   formatters, and record data so it collides with nothing.
   Every window / matchMedia access is guarded → static-export
   safe (renders to inert HTML at build, wakes on the client).
   ============================================================ */

import { useEffect, useRef, useState } from 'react';

/** SSR-safe media query. Returns `initial` on the server + first
    paint, then resolves on mount. The DESKTOP composition is the
    static fallback; mobile hydrates in without a layout flash. */
export function useMediaQuery(query: string, initial = false): boolean {
  const [match, setMatch] = useState(initial);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}

/** Honors the OS reduced-motion switch. When true every reveal /
    line-draw / parallax resolves to its FINAL state, no animation. */
export function useReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)', false);
}

/** True once mounted on the client — gates choreography so the
    server HTML is already the resolved state (no hydration flash). */
export function useMounted(): boolean {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}

/** IntersectionObserver reveal. Returns a ref + whether it has
    entered the viewport (latched — reveals once, never re-hides).
    Falls back to `true` where IO is unavailable. */
export function useInView<T extends HTMLElement>(
  opts: IntersectionObserverInit = { threshold: 0.18, rootMargin: '0px 0px -8% 0px' },
): [React.RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !('IntersectionObserver' in window)) {
      setSeen(true);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          setSeen(true);
          io.disconnect();
          break;
        }
      }
    }, opts);
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return [ref, seen];
}

/** Normalized 0→1 scroll progress of an element through the viewport,
    for image parallax. Guarded; returns 0.5 (rest) until mounted. */
export function useParallax<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [p, setP] = useState(0.5);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      // 0 when the element's top hits the bottom of the viewport,
      // 1 when its bottom leaves the top — clamped.
      const raw = (vh - r.top) / (vh + r.height);
      setP(Math.max(0, Math.min(1, raw)));
    };
    const onScroll = () => { if (!raf) raf = window.requestAnimationFrame(update); };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, []);
  return [ref, p];
}

/* ── Formatters — tabular, catalogue-grade ─────────────────── */

/** 195040000 → "$195,040,000". The full grouped figure — the
    catalogue prints the whole number, not a compacted one. */
export function fmtMoneyFull(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

/** 195040000 → "$195.04M" / "$1.23B". Compact, for tight rails. */
export function fmtMoneyCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(abs >= 1e8 ? 2 : 2)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

/** Full grouped integer, e.g. 507107 → "507,107". */
export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/** Signed percentage with a fixed sign glyph, e.g. +12.4% / −3.1%. */
export function fmtDelta(n: number, digits = 1): string {
  const s = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${s}${Math.abs(n).toFixed(digits)}%`;
}

/* ============================================================
   THE RECORD BOARD — curated cross-category all-time hammer
   records. Per the data contract these live in the full/stats
   tier (not the eager top-realized), so they are CURATED and
   hardcoded here. #1 (the $195.04M Warhol) is corroborated by
   our own stats.json (andy-warhol.recordPrice). Each row carries
   a source flag — authority with a number behind it. Prices are
   the widely-reported all-in results at the time of sale.
   ============================================================ */

export interface RecordEntry {
  usd: number;
  /** display object title (italicised in the catalogue) */
  title: string;
  /** maker / consignor / subject */
  maker: string;
  category: 'Art' | 'Watches' | 'Design' | 'Sports' | 'Science' | 'Culture';
  /** auction house + year */
  house: string;
  /** short source flag surfaced on the row */
  source: string;
}

export const RECORD_BOARD: RecordEntry[] = [
  {
    usd: 195_040_000,
    title: 'Shot Sage Blue Marilyn',
    maker: 'Andy Warhol',
    category: 'Art',
    house: "Christie's · 2022",
    source: "Christie's, May 2022",
  },
  {
    usd: 179_365_000,
    title: 'Les Femmes d’Alger (Version “O”)',
    maker: 'Pablo Picasso',
    category: 'Art',
    house: "Christie's · 2015",
    source: "Christie's, May 2015",
  },
  {
    usd: 50_130_000,
    title: '“Stan” — Tyrannosaurus rex',
    maker: 'Late Cretaceous · ~67M yrs',
    category: 'Science',
    house: "Christie's · 2020",
    source: "Christie's, Oct 2020",
  },
  {
    usd: 31_186_000,
    title: 'Grandmaster Chime Ref. 6300A-010',
    maker: 'Patek Philippe',
    category: 'Watches',
    house: "Only Watch / Christie's · 2019",
    source: "Christie's, Nov 2019",
  },
  {
    usd: 12_600_000,
    title: 'T206 Honus Wagner',
    maker: 'Honus Wagner · 1909',
    category: 'Sports',
    house: 'Goldin · 2022',
    source: 'Reported sale, 2022',
  },
  {
    usd: 9_269_100,
    title: 'Himalaya Niloticus Crocodile Birkin',
    maker: 'Hermès',
    category: 'Design',
    house: "Sotheby's · 2021",
    source: "Sotheby's HK, reported",
  },
  {
    usd: 6_250_000,
    title: '“Paul Newman” Daytona Ref. 6239',
    maker: 'Rolex · Paul Newman’s own',
    category: 'Watches',
    house: "Phillips · 2017",
    source: 'Phillips, Oct 2017',
  },
  {
    usd: 5_640_000,
    title: 'Codex Leicester',
    maker: 'Leonardo da Vinci',
    category: 'Science',
    house: "Christie's · 1994",
    source: "Christie's, 1994",
  },
  {
    usd: 3_930_000,
    title: '“Happy Birthday, Mr. President” gown',
    maker: 'worn by Marilyn Monroe · 1962',
    category: 'Culture',
    house: 'Julien’s · 2016',
    source: 'Julien’s, Nov 2016',
  },
  {
    usd: 2_880_000,
    title: 'Rookie-Season Locker',
    maker: 'Kobe Bryant · game-used',
    category: 'Sports',
    house: "Sotheby's · 2023",
    source: "Sotheby's, reported",
  },
];

/* ── The hero record object — a REAL live lot from the eager
   corpus (upcoming.json). It is a Warhol Marilyn screenprint at
   Christie's: a deliberate rhyme with the Record Board's #1
   (the $195.04M "Shot Sage Blue Marilyn"). The image is verified
   to load; a graceful CSS fallback covers a dead link. ── */
export interface HeroObject {
  maker: string;
  title: string;         // italicised
  year: string;
  house: string;
  medium: string;
  /** the caption figure — an estimate here (live lot, unsold) */
  figureLabel: string;
  figure: string;
  imageUrl: string;
}

export const HERO_OBJECT: HeroObject = {
  maker: 'Andy Warhol',
  title: 'Marilyn Monroe (Marilyn), one print',
  year: '1967',
  house: "Christie's · New York",
  medium: 'Screenprint in colours, on wove paper',
  figureLabel: 'Estimate',
  figure: '$150,000 – $180,000',
  imageUrl:
    'https://www.christies.com/img/lotimages/2026/NYR/2026_NYR_24247_0008_000(andy_warhol_marilyn_monroe_one_print110618).jpg?mode=max',
};

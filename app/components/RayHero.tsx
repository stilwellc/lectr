'use client';

import React from 'react';
import Horizon from './Horizon';

/**
 * RayHero — the one hero for all four Ray pages.
 * Sequence (CSS animations on mount, both fill — no-JS lands on the
 * final frame, reduced motion collapses via the global override):
 *   1. eyebrow fades in
 *   2. h1 reveals through a single-line overflow mask
 *   3. sub rises 12px + fades
 *   4. mono timestamp fades alone ~350ms later — the closing beat
 * The bespoke gradient divider is replaced by the shared Horizon (wine).
 *
 * NOTE: keep the style block below free of quotes, apostrophes and
 * angle brackets — React escapes them server-side and hydration of
 * raw-text elements then fails.
 */
export default function RayHero({
  eyebrow,
  title,
  sub,
  timestamp,
}: {
  eyebrow: string;
  title: React.ReactNode;
  sub: React.ReactNode;
  timestamp?: string;
}) {
  return (
    <>
      <section className="ray-hero rail">
        <style>{`
          @keyframes rayHeroFade {
            from { opacity: 0; }
            to { opacity: 1; }
          }
          @keyframes rayHeroLine {
            from { transform: translateY(120%); }
            to { transform: translateY(0); }
          }
          @keyframes rayHeroSub {
            from { opacity: 0; transform: translateY(12px); }
            to { opacity: 1; transform: none; }
          }
          .ray-hero-eyebrow { animation: rayHeroFade 600ms var(--ease-signature) both; }
          .ray-hero-mask {
            display: block;
            overflow: hidden;
            /* room for italic descenders inside the mask */
            padding-bottom: 0.14em;
            margin-bottom: -0.14em;
          }
          .ray-hero-line {
            display: block;
            animation: rayHeroLine 600ms var(--ease-signature) 90ms both;
          }
          .ray-hero-sub { animation: rayHeroSub 600ms var(--ease-signature) 180ms both; }
          .ray-hero-stamp { animation: rayHeroFade 600ms var(--ease-signature) 530ms both; }
        `}</style>

        <span
          className="eyebrow ray-hero-eyebrow"
          style={{ display: 'inline-block', marginBottom: 16 }}
        >
          {eyebrow}
        </span>
        <h1 style={{
          fontFamily: 'var(--font-serif), serif',
          fontSize: 'clamp(40px, 6vw, 72px)',
          fontWeight: 300,
          letterSpacing: '-0.03em',
          lineHeight: 0.95,
          marginBottom: 16,
        }}>
          <span className="ray-hero-mask">
            <span className="ray-hero-line">{title}</span>
          </span>
        </h1>
        <p className="ray-hero-sub" style={{
          fontSize: 14,
          lineHeight: 1.7,
          color: 'var(--color-text-muted)',
          fontWeight: 400,
          maxWidth: 500,
        }}>
          {sub}
        </p>

        {timestamp && (
          <span className="ray-hero-stamp" style={{
            display: 'inline-block',
            marginTop: 14,
            fontFamily: 'var(--font-mono), monospace',
            fontSize: 12,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--color-text-faint)',
            fontWeight: 400,
          }}>
            Updated {timestamp}
          </span>
        )}
      </section>

      <div className="ray-divider-wrap rail">
        <Horizon variant="wine" />
      </div>
    </>
  );
}

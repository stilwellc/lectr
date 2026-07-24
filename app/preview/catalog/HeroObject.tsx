'use client';

import React, { useState } from 'react';
import { LazyMotion, domAnimation, m } from 'framer-motion';
import s from './style.module.css';
import { HERO_OBJECT, useParallax, useReducedMotion, useMounted } from './lib';

const EASE = [0.23, 1, 0.32, 1] as const;

/* ============================================================
   The oversized hero record object. A real live lot (Warhol
   Marilyn screenprint, Christie's) — chroma comes ONLY from
   this photo. Slow scale(0.95) reveal, gentle scroll parallax
   on the image, a disciplined provenance caption. Graceful
   fallback if the lot image fails to load.
   ============================================================ */

export function HeroObjectDesktop() {
  const [pRef, p] = useParallax<HTMLDivElement>();
  const reduce = useReducedMotion();
  const mounted = useMounted();
  const [failed, setFailed] = useState(false);
  // parallax travel: ~ -10px → +10px across the scroll window
  const shift = reduce ? 0 : (p - 0.5) * -20;

  return (
    <LazyMotion features={domAnimation} strict>
      <div className={s.heroObject}>
        <m.div
          ref={pRef}
          className={s.objectFrame}
          initial={reduce ? false : { opacity: 0, scale: 0.95 }}
          animate={mounted ? { opacity: 1, scale: 1 } : undefined}
          transition={{ duration: 1.1, ease: EASE, delay: 0.15 }}
        >
          {failed ? (
            <div className={s.objectFallback}>
              <span>{HERO_OBJECT.title}</span>
              <span className={s.num}>{HERO_OBJECT.maker} · {HERO_OBJECT.year}</span>
            </div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className={s.objectImg}
              src={HERO_OBJECT.imageUrl}
              alt={`${HERO_OBJECT.maker}, ${HERO_OBJECT.title}, ${HERO_OBJECT.year}`}
              loading="eager"
              onError={() => setFailed(true)}
              style={{ transform: `translateY(${shift}px)` }}
            />
          )}
        </m.div>

        <m.div
          className={s.caption}
          initial={reduce ? false : { opacity: 0, y: 12 }}
          animate={mounted ? { opacity: 1, y: 0 } : undefined}
          transition={{ duration: 0.8, ease: EASE, delay: 0.55 }}
        >
          <div className={s.captionText}>
            <div className={s.capMaker}>{HERO_OBJECT.maker}</div>
            <div className={s.capTitle}>{HERO_OBJECT.title}, {HERO_OBJECT.year}</div>
            <div className={s.capMeta}>{HERO_OBJECT.medium}<br />{HERO_OBJECT.house}</div>
          </div>
          <div className={s.capFigure}>
            <div className={s.capFigureLabel}>{HERO_OBJECT.figureLabel}</div>
            <div className={s.capFigureNum}>{HERO_OBJECT.figure}</div>
          </div>
        </m.div>
      </div>
    </LazyMotion>
  );
}

export function HeroObjectMobile() {
  const [pRef, p] = useParallax<HTMLDivElement>();
  const reduce = useReducedMotion();
  const [failed, setFailed] = useState(false);
  const shift = reduce ? 0 : (p - 0.5) * -26;

  return (
    <div className={s.mHeroImgWrap} ref={pRef}>
      {failed ? (
        <div className={s.objectFallback}>
          <span>{HERO_OBJECT.title}</span>
          <span className={s.num}>{HERO_OBJECT.maker} · {HERO_OBJECT.year}</span>
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className={s.mHeroImg}
          src={HERO_OBJECT.imageUrl}
          alt={`${HERO_OBJECT.maker}, ${HERO_OBJECT.title}, ${HERO_OBJECT.year}`}
          loading="eager"
          onError={() => setFailed(true)}
          style={{ transform: `translateY(${shift}px)` }}
        />
      )}
      <div className={s.mHeroScrim} />
    </div>
  );
}

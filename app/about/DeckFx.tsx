'use client';

import { useLayoutEffect } from 'react';

/**
 * DECK MOTION — every moving part of /about, wired imperatively so the page
 * itself stays a build-time server component with the figures baked in.
 *
 * Four jobs, all attribute-driven from the server markup:
 *
 *   .dk-s          stagger container: direct children reveal on scroll with a
 *                  70ms cascade (IO adds .on; CSS owns the transition)
 *   [data-count]   a numeral counts up once. The server renders the REAL
 *                  final value; JS parses it out of the DOM, animates toward
 *                  it, and restores the exact original string at the end —
 *                  so no-JS readers and the animation can never disagree.
 *   .dk-draw       an SVG stroke draws itself (measured length, --ease-draw)
 *   .dk-rail       fixed chapter rail: active chapter + the progress bar
 *
 * The hidden initial state only exists under the .dk-anim class this
 * component arms (useLayoutEffect, before paint) — no JS means no hiding,
 * and prefers-reduced-motion never arms anything at all.
 */
export default function DeckFx() {
  useLayoutEffect(() => {
    const root = document.querySelector<HTMLElement>('.deck-scope');
    if (!root) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const staggers = Array.from(root.querySelectorAll<HTMLElement>('.dk-s'));
    const draws = Array.from(root.querySelectorAll<SVGGeometryElement>('.dk-draw'));

    /* cascade delays, assigned before anything is hidden */
    staggers.forEach((el) => {
      Array.from(el.children).forEach((c, i) => {
        (c as HTMLElement).style.transitionDelay = `${Math.min(i, 10) * 70}ms`;
      });
    });

    /* prime strokes so the first armed paint is already blank */
    const lengths = new Map<SVGGeometryElement, number>();
    draws.forEach((el) => {
      try {
        const L = el.getTotalLength();
        lengths.set(el, L);
        el.style.strokeDasharray = `${L}`;
        el.style.strokeDashoffset = `${L}`;
      } catch { /* non-geometry: leave it drawn */ }
    });

    root.classList.add('dk-anim');

    const runCount = (el: HTMLElement) => {
      if (el.dataset.done) return;
      el.dataset.done = '1';
      const finalText = el.textContent || '';
      const target = Number(finalText.replace(/[^0-9.]/g, ''));
      if (!Number.isFinite(target) || target === 0) return;
      const decimals = (finalText.split('.')[1] || '').replace(/[^0-9]/g, '').length;
      const grouped = finalText.includes(',');
      const t0 = performance.now();
      const dur = 1150;
      const tick = (t: number) => {
        const k = Math.min(1, (t - t0) / dur);
        const e = 1 - Math.pow(1 - k, 3);
        const v = target * e;
        el.textContent = grouped
          ? Math.round(v).toLocaleString('en-US')
          : v.toFixed(decimals);
        if (k < 1) requestAnimationFrame(tick);
        else el.textContent = finalText; // the server's figure is the truth
      };
      requestAnimationFrame(tick);
    };

    const runDraw = (el: SVGGeometryElement) => {
      if (el.dataset.done) return;
      el.dataset.done = '1';
      const L = lengths.get(el);
      if (L == null) return;
      const dur = Number(el.dataset.drawDur || 1400);
      const delay = Number(el.dataset.drawDelay || 0);
      el.style.transition = `stroke-dashoffset ${dur}ms cubic-bezier(0.65, 0, 0.35, 1) ${delay}ms`;
      el.style.strokeDashoffset = '0';
    };

    /* reveals + the counters that live inside them */
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (!en.isIntersecting) return;
          const el = en.target as HTMLElement;
          io.unobserve(el);
          el.classList.add('on');
          el.querySelectorAll<HTMLElement>('[data-count]').forEach(runCount);
        });
      },
      { threshold: 0.15, rootMargin: '0px 0px -6% 0px' },
    );
    staggers.forEach((el) => io.observe(el));

    /* strokes watch their own SVG — a chart draws when the CHART arrives,
       not when its section's top edge did */
    const drawIo = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (!en.isIntersecting) return;
          drawIo.unobserve(en.target);
          en.target.querySelectorAll<SVGGeometryElement>('.dk-draw').forEach(runDraw);
        });
      },
      { threshold: 0.35 },
    );
    const svgs = new Set<Element>();
    draws.forEach((el) => { if (el.ownerSVGElement) svgs.add(el.ownerSVGElement); });
    svgs.forEach((s) => drawIo.observe(s));

    /* counters outside any stagger container (the cover headline) */
    const looseCounts = Array.from(root.querySelectorAll<HTMLElement>('[data-count]'))
      .filter((el) => !el.closest('.dk-s'));
    const countIo = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (!en.isIntersecting) return;
          countIo.unobserve(en.target);
          runCount(en.target as HTMLElement);
        });
      },
      { threshold: 0.4 },
    );
    looseCounts.forEach((el) => countIo.observe(el));

    /* chapter rail: which chapter owns the viewport, plus reading progress */
    const chapters = Array.from(root.querySelectorAll<HTMLElement>('[data-ch]'));
    const links = Array.from(root.querySelectorAll<HTMLElement>('.dk-rail a'));
    const chIo = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (!en.isIntersecting) return;
          const id = (en.target as HTMLElement).dataset.ch;
          links.forEach((a) => a.classList.toggle('act', a.dataset.for === id));
        });
      },
      { rootMargin: '-42% 0px -52% 0px' },
    );
    chapters.forEach((s) => chIo.observe(s));

    const prog = root.querySelector<HTMLElement>('.dk-prog');
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const doc = document.documentElement;
        const p = doc.scrollTop / Math.max(1, doc.scrollHeight - doc.clientHeight);
        if (prog) prog.style.transform = `scaleX(${p})`;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    return () => {
      io.disconnect();
      drawIo.disconnect();
      countIo.disconnect();
      chIo.disconnect();
      window.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
      root.classList.remove('dk-anim');
    };
  }, []);

  return null;
}

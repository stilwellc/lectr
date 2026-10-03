'use client';

/**
 * Term — a desk word that explains itself. Renders the word inline with a
 * dotted underline; hover, keyboard focus or a tap shows its plain-language
 * definition from app/lib/glossary.ts.
 *
 *   <Term id="odds" />                 prints the glossary's own word
 *   <Term id="gap">the Gap lane</Term> prints your words, same definition
 *
 * Accessibility: the word is a real <button> (Tab reaches it, Enter/Space
 * toggles the definition, Escape closes it); the definition is wired with
 * aria-describedby so a screen reader announces it on focus without opening
 * anything. The tip is position:fixed and measured on open, so it is never
 * clipped by an overflow-hidden panel and never runs off a phone screen.
 */
import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { glossaryEntry } from '../lib/glossary';

const TERM_CSS = `
.lx-term{display:inline;font:inherit;color:inherit;letter-spacing:inherit;background:none;border:0;padding:0;margin:0;
  border-bottom:1px dotted var(--color-text-faint);cursor:help;text-align:inherit;line-height:inherit;border-radius:0}
.lx-term:hover{border-bottom-color:var(--color-fg)}
.lx-term:focus-visible{outline:2px solid var(--color-fg);outline-offset:2px;border-radius:2px}
.lx-term-tip{position:fixed;z-index:1000;max-width:min(300px,calc(100vw - 32px));width:max-content;
  background:var(--color-surface,#fff);color:var(--color-fg);border:1px solid var(--color-border-mid);
  border-radius:10px;padding:10px 13px;box-shadow:0 8px 28px rgba(0,0,0,.14);
  font-family:var(--font-inter),var(--font-sans),sans-serif;font-size:12.5px;font-weight:400;line-height:1.55;
  letter-spacing:0;text-align:left;text-transform:none;font-variant-numeric:normal;white-space:normal;
  pointer-events:none;opacity:0;visibility:hidden;transition:opacity 120ms ease}
.lx-term-tip[data-open=true]{opacity:1;visibility:visible}
.lx-term-tip b{font-weight:600}
@media (prefers-reduced-motion:reduce){.lx-term-tip{transition:none}}
`;

export default function Term({ id, children }: { id: string; children?: React.ReactNode }) {
  const entry = glossaryEntry(id);
  const tipId = useId();
  const btn = useRef<HTMLButtonElement>(null);
  const tip = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  // a tap pins the tip open; hover/focus show it transiently
  const [pinned, setPinned] = useState(false);
  const shown = open || pinned;

  const place = useCallback(() => {
    const b = btn.current, t = tip.current;
    if (!b || !t) return;
    const r = b.getBoundingClientRect();
    const w = t.offsetWidth, h = t.offsetHeight, vw = window.innerWidth;
    const left = Math.max(16, Math.min(vw - 16 - w, r.left + r.width / 2 - w / 2));
    // above the word when there is room, else below it
    const top = r.top - h - 8 >= 8 ? r.top - h - 8 : r.bottom + 8;
    t.style.left = `${Math.round(left)}px`;
    t.style.top = `${Math.round(top)}px`;
  }, []);

  useLayoutEffect(() => { if (shown) place(); }, [shown, place]);

  useEffect(() => {
    if (!shown) return;
    const close = () => { setOpen(false); setPinned(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    const onDown = (e: PointerEvent) => { if (btn.current && !btn.current.contains(e.target as Node)) close(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    // follow the word on scroll/resize (focus itself can scroll the word into
    // view — closing on scroll would hide the tip the moment Tab reached it)
    window.addEventListener('scroll', place, { passive: true, capture: true });
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('scroll', place, { capture: true });
      window.removeEventListener('resize', place);
    };
  }, [shown, place]);

  if (!entry) return <>{children}</>;
  return (
    <>
      <style href="lx-term" precedence="default">{TERM_CSS}</style>
      <button
        ref={btn}
        type="button"
        className="lx-term"
        aria-describedby={tipId}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => { setOpen(false); setPinned(false); }}
        onClick={() => setPinned(p => !p)}
      >
        {children ?? entry.term}
      </button>
      <span ref={tip} id={tipId} role="tooltip" className="lx-term-tip" data-open={shown}>
        <b>{entry.term.charAt(0).toUpperCase() + entry.term.slice(1)}.</b> {entry.short}
      </span>
    </>
  );
}

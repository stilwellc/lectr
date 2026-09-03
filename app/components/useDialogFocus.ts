'use client';

import { useEffect, type RefObject } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Focus discipline for a modal surface — the LoginModal pattern
 * (app/lib/account.tsx) shared by every dialog: remember where focus was,
 * move it inside (first focusable, or the container itself when the surface
 * must not pop the keyboard over a list), keep Tab/Shift-Tab cycling inside
 * the surface while it is open, and hand focus back to the opener on close.
 * Escape stays with each dialog's own handler.
 *
 *   useDialogFocus(open, ref, { initial: 'first' | 'container' | 'none' })
 */
export function useDialogFocus(
  open: boolean,
  ref: RefObject<HTMLElement | null>,
  opts: { initial?: 'first' | 'container' | 'none'; restoreTo?: RefObject<HTMLElement | null> } = {},
) {
  const { initial = 'first', restoreTo } = opts;
  useEffect(() => {
    if (!open) return;
    const prevFocus = document.activeElement as HTMLElement | null;
    const restoreEl = restoreTo?.current ?? null; // captured now — the ref may be gone by cleanup
    const root = ref.current;
    if (root) {
      if (initial === 'first') {
        (root.querySelector<HTMLElement>(FOCUSABLE) ?? root).focus({ preventScroll: true });
      } else if (initial === 'container') {
        if (!root.hasAttribute('tabindex')) root.setAttribute('tabindex', '-1');
        root.focus({ preventScroll: true });
      }
    }
    const onKey = (e: KeyboardEvent) => {
      const el = ref.current;
      if (e.key !== 'Tab' || !el) return;
      const f = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(n => n.offsetParent !== null || n === document.activeElement);
      if (!f.length) { e.preventDefault(); return; }
      const first = f[0], last = f[f.length - 1], active = document.activeElement;
      const inside = active instanceof Node && el.contains(active);
      if (e.shiftKey ? (active === first || !inside) : (active === last || !inside)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      const back = restoreEl ?? prevFocus;
      if (back && typeof back.focus === 'function' && document.contains(back)) back.focus({ preventScroll: true });
    };
  }, [open, ref, initial, restoreTo]);
}

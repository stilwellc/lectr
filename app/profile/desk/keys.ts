'use client';
/**
 * INPUT CRAFT — the /value grammar on the desk (lifted from page.tsx, plus
 * the chords): j/k walks every [data-nav-row] on the page, Enter/Space
 * toggles the row's dossier (native on links and buttons); `g` then a
 * section's key jumps to it (./sections — the letters are documented in the
 * rail's (?)); `?` opens that legend. Typing surfaces and overlays keep
 * their own keys.
 *
 * (pass 6) Enter on a walked row opens its lot (the title link's own
 * Enter); Shift+Enter or `o` opens the row's Details where it has them
 * (the DeskRow's [data-expand] row, its .dk-expand button).
 *
 * (Oct 11 review) THE CURSOR FOLLOWS THE JUMP: a jump (rail, g-chord, deep
 * link) focuses the section, so j continues from the first row of THAT room
 * instead of the row the reader left behind — "where am I" is the row that
 * contains focus, else the first row after the focused element in document
 * order. A row that is not itself focusable (the Watching ledger row, whose
 * title is a link and whose expand control is a button) hands focus to its
 * [data-nav-focus] control.
 */
import { useEffect, useRef } from 'react';
import { jump } from '../rail';
import { sectionByKey } from './sections';

/** how long after `g` the second key still counts */
export const CHORD_MS = 1500;

/** the element j/k should focus for a row: the row when it is focusable,
 *  else its [data-nav-focus] control, else its first button / link */
export function focusTargetOf(row: HTMLElement): HTMLElement {
  if (row.hasAttribute('data-pick') || !(row.hasAttribute('tabindex') || /^(A|BUTTON)$/.test(row.tagName))) {
    return row.querySelector<HTMLElement>('[data-nav-focus]') ?? row.querySelector<HTMLElement>('button, a[href]') ?? row;
  }
  return row;
}

/** the row j/k lands on: from the row containing focus, the next / previous
 *  row; from anywhere else (a section a jump just focused), j = the first
 *  row after the focused element in document order, k = the last row before
 *  it; with nothing focused j = the first row, k = the last */
export function nextRowIndex(rows: readonly HTMLElement[], active: Element | null, dir: 1 | -1): number {
  const last = rows.length - 1;
  if (!active || active === document.body) return dir > 0 ? 0 : last;
  const cur = rows.findIndex(r => r === active || r.contains(active));
  if (cur >= 0) return Math.max(0, Math.min(last, cur + dir));
  let firstAfter = rows.length;
  for (let i = 0; i < rows.length; i++) {
    if (active.compareDocumentPosition(rows[i]) & Node.DOCUMENT_POSITION_FOLLOWING) { firstAfter = i; break; }
  }
  return dir > 0 ? Math.min(last, firstAfter) : Math.max(0, firstAfter - 1);
}

export function useDeskKeys(): void {
  const pending = useRef(0);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (t?.closest('[role="dialog"],[role="listbox"],[role="menu"]')) return;
      if (document.querySelector('.ray-ck-overlay, .ray-maker-sheet')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // the chord: `g` arms it; the next key (inside CHORD_MS) names a section
      if (pending.current && Date.now() - pending.current < CHORD_MS) {
        pending.current = 0;
        const s = sectionByKey(e.key);
        // jump() opens the room's tab first when it lives under another one
        if (s) { jump(s.id); e.preventDefault(); }
        return;
      }
      pending.current = 0;
      if (e.key === 'g') { pending.current = Date.now(); e.preventDefault(); return; }
      // `?` opens the keys legend (the same chip the (?) button toggles — at the
      // desk's foot since the tab bar went, Oct 29; it scrolls into view with the strip)
      if (e.key === '?') {
        const btn = document.querySelector<HTMLElement>('.dk-keys .ck-helpbtn, .ck-account .ck-helpbtn, .dt-help .ck-helpbtn');
        if (btn) { btn.click(); btn.focus(); btn.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); e.preventDefault(); }
        return;
      }
      // Details on the row under the cursor: Shift+Enter or `o`
      if ((e.key === 'Enter' && e.shiftKey) || e.key === 'o') {
        const row = t?.closest<HTMLElement>('[data-nav-row][data-expand]');
        const btn = row?.querySelector<HTMLElement>('.dk-expand');
        if (btn) { btn.click(); e.preventDefault(); }
        return;
      }
      if (e.key !== 'j' && e.key !== 'k') return;
      const rowEls = Array.from(document.querySelectorAll<HTMLElement>('[data-nav-row]'));
      if (!rowEls.length) return;
      // a pick (data-pick) is a wrapper: its card / row button takes focus,
      // so "where am I" is the row that CONTAINS focus (signed-out j/k, R4 P3-14)
      const row = rowEls[nextRowIndex(rowEls, document.activeElement, e.key === 'j' ? 1 : -1)];
      if (!row) return;
      focusTargetOf(row).focus();
      row.scrollIntoView({ block: 'nearest' });
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

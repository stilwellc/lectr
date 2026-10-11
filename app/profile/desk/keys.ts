'use client';
/**
 * INPUT CRAFT — the /value grammar on the desk (lifted from page.tsx, plus
 * the chords): j/k walks every [data-nav-row] on the page, Enter/Space
 * toggles the row's dossier (native on links); `g` then a section's key
 * jumps to it (./sections — the letters are documented in the rail's (?)).
 * Typing surfaces and overlays keep their own keys.
 */
import { useEffect, useRef } from 'react';
import { jump } from '../rail';
import { sectionByKey } from './sections';

/** how long after `g` the second key still counts */
export const CHORD_MS = 1500;

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
        if (s && document.getElementById(s.id)) { jump(s.id); e.preventDefault(); }
        return;
      }
      pending.current = 0;
      if (e.key === 'g') { pending.current = Date.now(); e.preventDefault(); return; }
      if (e.key !== 'j' && e.key !== 'k') return;
      const rowEls = Array.from(document.querySelectorAll<HTMLElement>('[data-nav-row]'));
      if (!rowEls.length) return;
      // a pick (data-pick) is a wrapper: its card / row button takes focus,
      // so "where am I" is the row that CONTAINS focus (signed-out j/k, R4 P3-14)
      const active = document.activeElement as HTMLElement | null;
      const cur = rowEls.findIndex(r => r === active || (!!active && r.contains(active)));
      const next = e.key === 'j' ? Math.min(cur + 1, rowEls.length - 1) : Math.max(cur - 1, 0);
      const row = rowEls[next];
      const target = row?.hasAttribute('data-pick') ? row.querySelector<HTMLElement>('button, a[href]') ?? row : row;
      target?.focus();
      row?.scrollIntoView({ block: 'nearest' });
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

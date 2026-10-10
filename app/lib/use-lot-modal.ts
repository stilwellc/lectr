'use client';
/**
 * useLotModal — the comps modal's open lot, JOINED TO HISTORY (audit-navbugs
 * defect 1): opening a lot pushes a history entry, so the browser Back (and
 * the mobile back-gesture) CLOSES the lot instead of throwing the reader off
 * the page. Closing via the X pops the entry we pushed — but ONLY while that
 * entry is still the live one: a market switch while the modal is open
 * pushStates the new path ON TOP of ours, and a blind history.back() would
 * then step into the stale modal entry and revert the URL/market under the
 * reader (B3 finding 1). Each entry we push carries a monotonically
 * increasing token in state.lectrLot, so we always know whose entry we're
 * standing on.
 *
 * Lifted verbatim out of the home feed (TerminalHome) so the shared lot
 * browser (components/LotBrowser) opens lots the same way on every page.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export function useLotModal<L>(): [L | null, (lot: L | null) => void] {
  const [lot, setLotRaw] = useState<L | null>(null);
  const modalToken = useRef<number | null>(null); // token of the open modal's own entry
  const tokenSeq = useRef(0);
  const pendingClose = useRef(false);             // our history.back() is in flight
  const reopenAfterPop = useRef(false);           // a modal reopened during that flight
  const setLot = useCallback((next: L | null) => {
    if (next) {
      if (pendingClose.current) {
        // rapid close → reopen: the close's back() hasn't landed yet. Don't
        // push now — the pending pop would eat the fresh entry and self-close
        // the new modal (B3 finding 2). onPop re-pushes once it lands.
        reopenAfterPop.current = true;
      } else if (modalToken.current == null) {
        const t = ++tokenSeq.current;
        try { window.history.pushState({ ...window.history.state, lectrLot: t }, ''); modalToken.current = t; } catch { /* ignore */ }
      }
      setLotRaw(next);
    } else {
      const t = modalToken.current;
      modalToken.current = null;
      reopenAfterPop.current = false;
      setLotRaw(null);
      // pop our entry only if it's still the top of the stack — otherwise
      // leave history alone (closing must never navigate to a stale entry).
      if (t != null && window.history.state?.lectrLot === t) {
        pendingClose.current = true;
        try { window.history.back(); } catch { pendingClose.current = false; }
      }
    }
  }, []);
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      if (pendingClose.current) {
        // our own close-pop landing — never treat it as a user Back
        pendingClose.current = false;
        if (reopenAfterPop.current) {
          reopenAfterPop.current = false;
          const t = ++tokenSeq.current;
          try { window.history.pushState({ ...window.history.state, lectrLot: t }, ''); modalToken.current = t; } catch { /* ignore */ }
        }
        return;
      }
      // a user Back/Forward: close the modal unless the destination IS the
      // open modal's own entry (e.g. Back from a market switch made over it)
      const dest = (e.state as { lectrLot?: number } | null)?.lectrLot;
      if (modalToken.current != null && dest !== modalToken.current) {
        modalToken.current = null;
        setLotRaw(null);
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return [lot, setLot];
}

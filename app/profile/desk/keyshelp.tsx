'use client';
/** THE KEYS LEGEND — the (?) on the Account head's row (desk pass 6: it used
 *  to float alone under the foot). The legend is kept in step with
 *  desk/sections; `?` opens it (keys.ts). The chip mounts INTO the Account
 *  head's row (a portal into rooms/account.tsx's RoomHead row — the room's
 *  own file stays the rows agent's) and falls back to the foot's own row
 *  until that row exists. */
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { HelpChip } from '../help';
import { useDesk, useDeskInternals } from './provider';
import { SECTIONS, keysLegend, mountedSections } from './sections';

export function KeysChip() {
  const { desk } = useDesk();
  const i = useDeskInternals();
  const mounted = React.useMemo(() => new Set(mountedSections(desk, i).map(s => s.id)), [desk, i]);
  const legend = keysLegend(SECTIONS.filter(s => mounted.has(s.id)));
  // the Account head's row, found once it exists (and again if the foot re-renders it)
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const find = () => setHost(document.querySelector<HTMLElement>('.ck-account .ck-head-row'));
    find();
    const foot = document.querySelector('.dt-band-foot');
    if (!foot || typeof MutationObserver === 'undefined') return;
    const mo = new MutationObserver(find);
    mo.observe(foot, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, []);
  const chip = (
    <HelpChip name="Keys">
      <b>j</b>/<b>k</b> walk the rows; <b>Enter</b> opens the row&rsquo;s lot; <b>Shift+Enter</b> (or <b>o</b>) opens its Details where a row has them &mdash; the dossier takes focus, and Close hands it back.
      Press <b>g</b> then a letter to open that room and land on it:{' '}
      {legend.map((k, idx) => (
        <React.Fragment key={k.key}>
          {idx > 0 && ' · '}
          <b>{k.key}</b> {k.label}{!k.live && <span style={{ color: 'var(--color-text-faint)' }}> (not on this desk yet)</span>}
        </React.Fragment>
      ))}
      . A folded room opens when you land in it; every landing writes the address bar, so a reload or a shared link opens the same place. <b>?</b> opens this legend.
    </HelpChip>
  );
  return host ? createPortal(chip, host) : <div className="rail dk-keys">{chip}</div>;
}

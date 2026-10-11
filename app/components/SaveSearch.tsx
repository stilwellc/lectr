'use client';

import { useEffect, useRef, useState } from 'react';
import type { FeedFilters } from './FeedToolbar';
import { useAuth } from '../lib/account';
import { useSavedSearches, describeQuery } from '../lib/alerts';
import { savedQueryOf, hasCriteria } from '../lib/saved-query';
import { readLocalSearches, writeLocalSearches, toggleLocalSearch, queryKey, LOCAL_SEARCHES_KEY } from '../lib/local-searches';
import { track } from '../lib/analytics';
import { CAT_LABEL, subLabel, type CatKey } from '../lib/taxonomy';
import { FACET_LABEL } from '../lib/facets';
import { ARTIST_LABEL, MARKETS } from '../constants';
import { categoryLabels } from '../utils';

/**
 * "Save this search" — turns the toolbar's current filter state into a saved
 * search; the nightly crawl then flags every new lot that matches it (the
 * inbox lives on My profile). Renders only with an actual criterion dialed
 * in — saving "everything" is not a search.
 * The query (app/lib/saved-query) carries the triage row too — closing
 * window, clean category / sub, house, value floor, facets — and the nightly
 * matcher honors every field it carries.
 *
 * (Oct 11 2026) Signed out it is one tap too: the search is kept on this
 * device (app/lib/local-searches) and carried into the account on sign-in.
 * The label says the honest difference — the nightly check starts then.
 */
export default function SaveSearch({ filters, market }: { filters: FeedFilters; market: string }) {
  const { user, authEnabled } = useAuth();
  const { save } = useSavedSearches();
  const [state, setState] = useState<'idle' | 'busy' | 'saved' | 'exists' | 'error' | 'device' | 'removed'>('idle');
  const revert = useRef<number | null>(null);
  // signed out: is this exact query already kept on the device?
  const [deviceKeys, setDeviceKeys] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    const sync = () => setDeviceKeys(new Set(readLocalSearches().map(s => queryKey(s.query))));
    sync();
    window.addEventListener(LOCAL_SEARCHES_KEY, sync);
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener(LOCAL_SEARCHES_KEY, sync); window.removeEventListener('storage', sync); };
  }, []);

  const query = savedQueryOf(filters, market);
  // no auth in this build: nothing would ever match it — stay out of the way
  if (!authEnabled || !hasCriteria(query)) return null;

  const cat = query.cat as CatKey | undefined;
  const name = describeQuery(query, {
    maker: query.maker ? ARTIST_LABEL[query.maker] || query.maker : undefined,
    category: query.category ? categoryLabels[query.category] || query.category : undefined,
    market: query.market ? MARKETS.find(m => m.key === query.market)?.label : undefined,
    cat: cat && CAT_LABEL[cat] ? (query.sub ? `${CAT_LABEL[cat]} · ${subLabel(cat, query.sub)}` : CAT_LABEL[cat]) : undefined,
    fx: query.fx?.length ? query.fx.map(k => FACET_LABEL[k] || k).join(' · ') : undefined,
  });
  const onDevice = !user && deviceKeys.has(queryKey(query));

  const settle = (s: typeof state) => {
    setState(s);
    if (revert.current) window.clearTimeout(revert.current);
    revert.current = window.setTimeout(() => setState('idle'), 4000);
  };

  async function onSave() {
    if (state === 'busy') return;
    if (!user) {
      // the device list — toggled, so a second tap takes it back
      writeLocalSearches(toggleLocalSearch(readLocalSearches(), name, query, new Date().toISOString()));
      if (!onDevice) track('save_search');
      settle(onDevice ? 'removed' : 'device');
      return;
    }
    setState('busy');
    const r = await save(name, query);
    if (r === 'saved') track('save_search');
    settle(r === 'saved' ? 'saved' : r === 'exists' ? 'exists' : 'error');
  }

  return (
    <button
      className="ray-toolbar-reset"
      style={{ color: state === 'saved' || state === 'device' || (state === 'idle' && onDevice) ? 'var(--color-fg)' : state === 'error' ? 'var(--color-text-secondary)' : 'var(--color-butter-text)' }}
      title={user
        ? `Watch for new lots matching: ${name}`
        : onDevice
          ? `Kept on this device: ${name} — tap to remove. Sign in and lectr checks it every night.`
          : `Keep this search on this device: ${name}. Sign in and lectr checks it every night.`}
      aria-pressed={!user ? onDevice : undefined}
      onClick={onSave}
      disabled={state === 'busy'}
    >
      {state === 'saved' ? 'Saved — watching for new lots'
        : state === 'device' ? 'Saved on this device — sign in for nightly matches'
        : state === 'removed' ? 'Removed'
        : state === 'exists' ? 'Already watching this'
        : state === 'busy' ? 'Saving…'
        : state === 'error' ? 'Couldn’t save — try again'
        : onDevice ? 'Search saved on this device'
        : 'Save this search'}
    </button>
  );
}

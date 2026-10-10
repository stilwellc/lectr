'use client';

import { useRef, useState } from 'react';
import type { FeedFilters } from './FeedToolbar';
import { useAuth } from '../lib/account';
import { useSavedSearches, describeQuery } from '../lib/alerts';
import { savedQueryOf, hasCriteria } from '../lib/saved-query';
import { CAT_LABEL, subLabel, type CatKey } from '../lib/taxonomy';
import { FACET_LABEL } from '../lib/facets';
import { ARTIST_LABEL, MARKETS } from '../constants';
import { categoryLabels } from '../utils';

/**
 * "Save this search" — turns the toolbar's current filter state into a saved
 * search; the nightly crawl then flags every new lot that matches it (the
 * inbox lives on My profile). Renders only for signed-in readers with an
 * actual criterion dialed in — saving "everything" is not a search.
 * The query (app/lib/saved-query) carries the triage row too — closing
 * window, clean category / sub, house, value floor, facets — and the nightly
 * matcher honors every field it carries.
 */
export default function SaveSearch({ filters, market }: { filters: FeedFilters; market: string }) {
  const { user } = useAuth();
  const { save } = useSavedSearches();
  const [state, setState] = useState<'idle' | 'busy' | 'saved' | 'exists' | 'error'>('idle');
  const revert = useRef<number | null>(null);

  const query = savedQueryOf(filters, market);
  if (!user || !hasCriteria(query)) return null;

  const cat = query.cat as CatKey | undefined;
  const name = describeQuery(query, {
    maker: query.maker ? ARTIST_LABEL[query.maker] || query.maker : undefined,
    category: query.category ? categoryLabels[query.category] || query.category : undefined,
    market: query.market ? MARKETS.find(m => m.key === query.market)?.label : undefined,
    cat: cat && CAT_LABEL[cat] ? (query.sub ? `${CAT_LABEL[cat]} · ${subLabel(cat, query.sub)}` : CAT_LABEL[cat]) : undefined,
    fx: query.fx?.length ? query.fx.map(k => FACET_LABEL[k] || k).join(' · ') : undefined,
  });

  async function onSave() {
    if (state === 'busy') return;
    setState('busy');
    const r = await save(name, query);
    setState(r === 'saved' ? 'saved' : r === 'exists' ? 'exists' : 'error');
    if (revert.current) window.clearTimeout(revert.current);
    revert.current = window.setTimeout(() => setState('idle'), 4000);
  }

  return (
    <button
      className="ray-toolbar-reset"
      style={{ color: state === 'saved' ? 'var(--color-fg)' : state === 'error' ? 'var(--color-text-secondary)' : 'var(--color-butter-text)' }}
      title={`Watch for new lots matching: ${name}`}
      onClick={onSave}
      disabled={state === 'busy'}
    >
      {state === 'saved' ? 'Saved — watching for new lots'
        : state === 'exists' ? 'Already watching this'
        : state === 'busy' ? 'Saving…'
        : state === 'error' ? 'Couldn’t save — try again'
        : 'Save this search'}
    </button>
  );
}

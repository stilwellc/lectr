'use client';

import { useRef, useState } from 'react';
import type { FeedFilters } from './FeedToolbar';
import { useAuth } from '../lib/account';
import { useSavedSearches, SavedQuery, describeQuery } from '../lib/alerts';
import { ARTIST_LABEL, MARKETS } from '../constants';
import { categoryLabels } from '../utils';

/**
 * "Save this search" — turns the toolbar's current filter state into a saved
 * search; the nightly crawl then flags every new lot that matches it (the
 * inbox lives on My profile). Renders only for signed-in readers with an
 * actual criterion dialed in — saving "everything" is not a search.
 */
export default function SaveSearch({ filters, market }: { filters: FeedFilters; market: string }) {
  const { user } = useAuth();
  const { save } = useSavedSearches();
  const [state, setState] = useState<'idle' | 'busy' | 'saved' | 'exists'>('idle');
  const revert = useRef<number | null>(null);

  const query: SavedQuery = {
    market: market !== 'all' ? market : null,
    maker: filters.maker,
    sport: filters.sport,
    category: filters.category,
    text: filters.query.trim() || null,
    belowOnly: filters.belowOnly || undefined,
  };
  const hasCriteria = !!(query.market || query.maker || query.sport || query.category || query.text || query.belowOnly);
  if (!user || !hasCriteria) return null;

  const name = describeQuery(query, {
    maker: query.maker ? ARTIST_LABEL[query.maker] || query.maker : undefined,
    category: query.category ? categoryLabels[query.category] || query.category : undefined,
    market: query.market ? MARKETS.find(m => m.key === query.market)?.label : undefined,
  });

  async function onSave() {
    if (state === 'busy') return;
    setState('busy');
    const r = await save(name, query);
    setState(r === 'saved' ? 'saved' : r === 'exists' ? 'exists' : 'idle');
    if (revert.current) window.clearTimeout(revert.current);
    revert.current = window.setTimeout(() => setState('idle'), 4000);
  }

  return (
    <button
      className="ray-toolbar-reset"
      style={{ color: state === 'saved' ? 'var(--color-up)' : 'var(--color-butter-text)' }}
      title={`Watch for new lots matching: ${name}`}
      onClick={onSave}
      disabled={state === 'busy'}
    >
      {state === 'saved' ? 'Saved — watching for new lots'
        : state === 'exists' ? 'Already watching this'
        : state === 'busy' ? 'Saving…'
        : 'Save this search'}
    </button>
  );
}

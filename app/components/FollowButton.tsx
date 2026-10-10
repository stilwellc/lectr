'use client';

/**
 * FollowButton — "Follow Michael Jordan" / "Follow KAWS". A follow is a saved
 * search keyed to a person (a players.json slug OR an artist/maker slug); the
 * nightly matcher alerts on every new lot for them. Collectors think in
 * people, not query strings — this is that hook. Reuses the saved-search
 * plumbing entirely; unfollow deletes the row.
 */
import React, { useMemo, useState } from 'react';
import { useSavedSearches } from '../lib/alerts';
import { useAuth } from '../lib/account';
import { useFollows, type Follow } from '../lib/follows';

/** the one look: a quiet call pill, + → ✓ */
function FollowPill({ on, busy, name, onClick }: { on: boolean; busy: boolean; name: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-pressed={on}
      className="ray-call-btn ray-call-btn-quiet"
      style={{
        cursor: busy ? 'default' : 'pointer',
        background: on ? 'var(--color-bg-elevated)' : 'var(--color-bg)',
        color: on ? 'var(--color-fg)' : 'var(--color-butter-text)',
        display: 'inline-flex', alignItems: 'center', gap: 7,
      }}
    >
      <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        {on
          ? <path d="M2.5 7.5l3 3 6-7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          : <path d="M7 1.5v11M1.5 7h11" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />}
      </svg>
      {on ? 'Following' : `Follow ${name}`}
    </button>
  );
}

/** a subject / set / category follow (app/lib/follows): kept on the device
 *  signed out, in the account signed in — the /makers follows' plumbing */
function FollowsPill({ follow, name }: { follow: Follow; name: string }) {
  const { isFollowing, toggle } = useFollows();
  const [busy, setBusy] = useState(false);
  const on = isFollowing(follow);
  return <FollowPill on={on} busy={busy} name={name} onClick={async () => { setBusy(true); try { await toggle(follow); } finally { setBusy(false); } }} />;
}

export default function FollowButton({ slug, name, follow }: { slug?: string; name: string; follow?: Follow }) {
  if (follow) return <FollowsPill follow={follow} name={name} />;
  return <PersonFollow slug={slug || ''} name={name} />;
}

function PersonFollow({ slug, name }: { slug: string; name: string }) {
  const { authEnabled, user, openLogin } = useAuth();
  const { searches, save, remove } = useSavedSearches();
  const [busy, setBusy] = useState(false);

  const existing = useMemo(
    () => searches.find(s => (s.query as { player?: string }).player === slug),
    [searches, slug],
  );

  // auth unconfigured → the whole feature is off; render nothing rather than a dead button
  if (!authEnabled) return null;

  const onClick = async () => {
    if (!user) { openLogin(); return; }
    setBusy(true);
    try {
      if (existing) await remove(existing.id);
      else await save(`Following ${name}`, { player: slug, playerName: name });
    } finally { setBusy(false); }
  };

  return <FollowPill on={!!existing} busy={busy} name={name} onClick={onClick} />;
}

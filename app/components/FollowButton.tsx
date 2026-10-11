'use client';

/**
 * FollowButton — "Follow Michael Jordan" / "Follow KAWS". A follow is a saved
 * search keyed to a person (a players.json slug OR an artist/maker slug); the
 * nightly matcher alerts on every new lot for them. Collectors think in
 * people, not query strings — this is that hook. Reuses the saved-search
 * plumbing entirely; unfollow deletes the row.
 */
import React, { useState } from 'react';
import { useFollows, makerFollow, type Follow } from '../lib/follows';
import { track } from '../lib/analytics';

/** the one look: a quiet call pill, + → ✓ */
function FollowPill({ on, busy, name, onClick, short }: { on: boolean; busy: boolean; name: string; onClick: () => void; short?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-pressed={on}
      // short (the lot page's CTA row, where the name prints just above):
      // the visible word is "Follow", the name rides the accessible label
      aria-label={short ? (on ? `Following ${name}` : `Follow ${name}`) : undefined}
      title={short ? (on ? `Stop following ${name}` : `Follow ${name} — new lots for them shape your For you`) : undefined}
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
      {on ? 'Following' : short ? 'Follow' : `Follow ${name}`}
    </button>
  );
}

/** a subject / set / category follow (app/lib/follows): kept on the device
 *  signed out, in the account signed in — the /makers follows' plumbing */
function FollowsPill({ follow, name, short }: { follow: Follow; name: string; short?: boolean }) {
  const { isFollowing, toggle } = useFollows();
  const [busy, setBusy] = useState(false);
  const on = isFollowing(follow);
  return <FollowPill on={on} busy={busy} name={name} short={short} onClick={async () => { track(on ? 'unfollow' : 'follow'); setBusy(true); try { await toggle(follow); } finally { setBusy(false); } }} />;
}

/** (Oct 11) a maker / player follows on the device signed out too — the
 *  same { player, playerName } row once the reader signs in (app/lib/follows
 *  carries it over); no more sign-in wall in front of the first follow */
export default function FollowButton({ slug, name, follow, short }: { slug?: string; name: string; follow?: Follow; short?: boolean }) {
  return <FollowsPill follow={follow ?? makerFollow(slug || '', name)} name={name} short={short} />;
}

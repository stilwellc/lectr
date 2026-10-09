'use client';
/**
 * FollowChip — "+ Follow Sports Cards · Baseball" / "✓ Following Phillips".
 * Shown next to an active category or house filter. Works signed out (the
 * follow is kept on this device) and signed in (synced; app/lib/follows).
 */
import { useState } from 'react';
import { useFollows, type Follow } from '../lib/follows';

export default function FollowChip({ follow }: { follow: Follow }) {
  const { isFollowing, toggle } = useFollows();
  const [busy, setBusy] = useState(false);
  const on = isFollowing(follow);
  return (
    <button
      type="button"
      className="ray-toolbar-pill"
      data-active={on || undefined}
      aria-pressed={on}
      disabled={busy}
      title={on ? `Stop following ${follow.label}` : `Follow ${follow.label} — it shapes your "For you" list`}
      onClick={async () => { setBusy(true); try { await toggle(follow); } finally { setBusy(false); } }}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
    >
      <svg width="11" height="11" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        {on
          ? <path d="M2.5 7.5l3 3 6-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          : <path d="M7 1.5v11M1.5 7h11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />}
      </svg>
      {on ? `Following ${follow.label}` : `Follow ${follow.label}`}
    </button>
  );
}

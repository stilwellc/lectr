'use client';

import { useEffect } from 'react';

/** Root error boundary — a last resort so an uncaught client exception shows a
 *  branded, recoverable screen instead of Next's unstyled "Application error"
 *  white page. Must render its own <html>/<body> (it replaces the layout). */
export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  // Surface the crash instead of swallowing it — the only place we'd learn a
  // real user hit a fatal error. (Wire to a RUM beacon here when one is added.)
  useEffect(() => { console.error('[lectr] fatal:', error?.message, error?.stack); }, [error]);
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#0F0E0A', color: '#F2EEE3', fontFamily: 'Inter, system-ui, sans-serif' }}>
        <main style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, padding: 24, textAlign: 'center' }}>
          <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>Something went sideways</h1>
          <p style={{ fontSize: 14, color: '#A19B8D', margin: '10px 0 22px', maxWidth: 400 }}>
            The desk hit an unexpected error. Reloading usually clears it.
          </p>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => reset()} style={{ background: '#F2EEE3', color: '#0F0E0A', border: 'none', padding: '9px 18px', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              Try again
            </button>
            <a href="/" style={{ display: 'inline-flex', alignItems: 'center', padding: '9px 18px', borderRadius: 8, fontSize: 14, border: '1px solid rgba(242,238,227,0.18)', color: '#F2EEE3', textDecoration: 'none' }}>
              Back to the market
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}

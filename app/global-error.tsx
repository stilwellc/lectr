'use client';

/** Root error boundary — a last resort so an uncaught client exception shows a
 *  branded, recoverable screen instead of Next's unstyled "Application error"
 *  white page. Must render its own <html>/<body> (it replaces the layout). */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#08090B', color: '#F4F6FF', fontFamily: 'Inter, system-ui, sans-serif' }}>
        <main style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, padding: 24, textAlign: 'center' }}>
          <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>Something went sideways</h1>
          <p style={{ fontSize: 14, color: '#8A9099', margin: '10px 0 22px', maxWidth: 400 }}>
            The desk hit an unexpected error. Reloading usually clears it.
          </p>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => reset()} style={{ background: '#F4F6FF', color: '#08090B', border: 'none', padding: '9px 18px', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              Try again
            </button>
            <a href="/" style={{ display: 'inline-flex', alignItems: 'center', padding: '9px 18px', borderRadius: 8, fontSize: 14, border: '1px solid rgba(244,246,255,0.18)', color: '#F4F6FF', textDecoration: 'none' }}>
              Back to the market
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}

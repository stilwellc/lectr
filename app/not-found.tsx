import Link from 'next/link';

/** Branded 404 — replaces Next's bare default so an unknown URL is never a dead
 *  end. Renders inside the root layout (dark theme + fonts already applied). */
export default function NotFound() {
  return (
    <main
      id="main"
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        padding: '24px',
        textAlign: 'center',
        fontFamily: 'var(--font-sans), sans-serif',
      }}
    >
      <img src="/brand/lectr.png" alt="lectr" style={{ height: 40, opacity: 0.9, marginBottom: 20 }} />
      <h1 style={{ fontSize: 34, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>
        This page isn&rsquo;t on the block
      </h1>
      <p style={{ fontSize: 14, color: 'var(--color-text-muted)', margin: '10px 0 24px', maxWidth: 420 }}>
        The address didn&rsquo;t match anything the desk tracks. It may have moved, or never existed.
      </p>
      <Link href="/" className="ray-call-btn ray-call-btn-primary" style={{ textDecoration: 'none', display: 'inline-block' }}>
        Back to the market
      </Link>
    </main>
  );
}

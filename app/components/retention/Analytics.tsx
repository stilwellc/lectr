import React from 'react';
import OutboundTracker from './OutboundTracker';

/**
 * Site-wide instrumentation mount (app/layout.tsx renders it once).
 *
 *  - the Cloudflare Web Analytics beacon — ONLY when NEXT_PUBLIC_CF_BEACON_TOKEN
 *    is set at build time. Unset → no <script>, no request, nothing. It is an
 *    external script (src=), so the strict script-src needs only its origin
 *    (public/_headers), never a hash or 'unsafe-inline'.
 *  - the outbound "View at <house>" click counter (delegated; renders nothing).
 */
const BEACON_TOKEN = (process.env.NEXT_PUBLIC_CF_BEACON_TOKEN || '').trim();

export default function Analytics() {
  return (
    <>
      {/^[A-Za-z0-9]{8,64}$/.test(BEACON_TOKEN) && (
        <script
          defer
          src="https://static.cloudflareinsights.com/beacon.min.js"
          data-cf-beacon={JSON.stringify({ token: BEACON_TOKEN })}
        />
      )}
      <OutboundTracker />
    </>
  );
}

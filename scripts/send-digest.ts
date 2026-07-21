/**
 * send-digest.ts — the nightly alert email. Runs right after match-alerts:
 * for every user whose saved searches matched fresh lots tonight, send ONE
 * email listing the matches, each linking to its /lot page.
 *
 * Cadence guard: only alerts CREATED inside the freshness window (26h — one
 * nightly, with slack) are emailed, so an alert emails exactly once and the
 * `seen` flag stays what it is: the in-app read state, never touched here.
 *
 * Needs SUPABASE_URL + SUPABASE_SERVICE_KEY + RESEND_API_KEY (skips silently
 * without them — the in-app inbox keeps working regardless). RESEND_FROM
 * overrides the sender (default digest@lectr.bid; the domain must be verified
 * in Resend or sends will 403).
 */

const url = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const key = process.env.SUPABASE_SERVICE_KEY || '';
const resendKey = process.env.RESEND_API_KEY || '';
const FROM = process.env.RESEND_FROM || 'lectr <digest@lectr.bid>';
const SITE = 'https://lectr.bid';
const WINDOW_MS = 26 * 3600 * 1000;

async function sb(path: string): Promise<any> {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`[digest] ${path.split('?')[0]}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function userEmail(userId: string): Promise<string | null> {
  const res = await fetch(`${url}/auth/v1/admin/users/${userId}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) return null;
  const u = await res.json() as { email?: string };
  return u.email || null;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const money = (n: number | null | undefined) =>
  n ? '$' + (n >= 1000 ? Math.round(n).toLocaleString('en-US') : String(Math.round(n))) : null;

interface Row { lotId: string; title: string; house: string; saleDate: string | null; est: string | null; searchName: string }

function emailHtml(rows: Row[]): string {
  const items = rows.map(r => `
    <tr>
      <td style="padding:14px 0;border-top:1px solid #e5e2d9;">
        <a href="${SITE}/lot?id=${encodeURIComponent(r.lotId)}" style="color:#1a1a1a;text-decoration:none;font-weight:600;font-size:15px;line-height:1.4;">${esc(r.title)}</a>
        <div style="color:#6f6a5e;font-size:12.5px;margin-top:3px;">
          ${esc(r.house)}${r.saleDate ? ` · hammers ${esc(r.saleDate)}` : ''}${r.est ? ` · ${esc(r.est)} est.` : ''}
          <span style="color:#a39d8e;"> · matched “${esc(r.searchName)}”</span>
        </div>
      </td>
    </tr>`).join('');
  return `<!doctype html><html><body style="margin:0;background:#faf8f3;font-family:Inter,-apple-system,Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:36px 20px 44px;">
    <div style="font-size:13px;font-weight:700;letter-spacing:0.08em;color:#1a1a1a;">lectr</div>
    <h1 style="font-size:20px;font-weight:700;color:#1a1a1a;margin:18px 0 4px;">${rows.length === 1 ? 'One new lot matches' : `${rows.length} new lots match`} your saved searches</h1>
    <p style="font-size:13.5px;color:#6f6a5e;margin:0 0 10px;">Caught by last night&rsquo;s crawl. Estimates are the house&rsquo;s, hammer-basis.</p>
    <table style="width:100%;border-collapse:collapse;">${items}</table>
    <p style="font-size:12px;color:#a39d8e;border-top:1px solid #e5e2d9;padding-top:14px;margin-top:2px;">
      You get this because you saved a search on lectr.
      <a href="${SITE}/saved" style="color:#6f6a5e;">Manage searches</a> — deleting a search stops its alerts.
    </p>
  </div></body></html>`;
}

async function main() {
  if (!url || !key) { console.log('[digest] SUPABASE_URL / SUPABASE_SERVICE_KEY not set — skipping'); return; }
  if (!resendKey) { console.log('[digest] RESEND_API_KEY not set — skipping (in-app inbox unaffected)'); return; }

  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  const alerts = await sb(`alerts?select=user_id,search_id,lot_id,created_at&created_at=gte.${since}`) as
    { user_id: string; search_id: string; lot_id: string }[];
  if (!alerts.length) { console.log('[digest] no fresh alerts — nothing to send'); return; }

  const searches = await sb('saved_searches?select=id,name') as { id: string; name: string }[];
  const nameOf = new Map(searches.map(s => [s.id, s.name]));

  // lot details from the lots mirror, one IN query (slim lot lives in `data`)
  const ids = Array.from(new Set(alerts.map(a => a.lot_id)));
  const lotRows: { id: string; data: any }[] = [];
  for (let i = 0; i < ids.length; i += 80) {
    const chunk = ids.slice(i, i + 80).map(id => `"${id}"`).join(',');
    lotRows.push(...await sb(`lots?select=id,data&id=in.(${encodeURIComponent(chunk)})`) as { id: string; data: any }[]);
  }
  const lotOf = new Map(lotRows.map(r => [r.id, r.data || {}]));

  const byUser = new Map<string, Row[]>();
  for (const a of alerts) {
    const lot = lotOf.get(a.lot_id);
    if (!lot) continue;
    const est = lot.estimateLow && lot.estimateHigh
      ? `${money(lot.estimateLow)}–${money(lot.estimateHigh)}`
      : money(lot.estimateLow || lot.estimateHigh);
    (byUser.get(a.user_id) || byUser.set(a.user_id, []).get(a.user_id)!).push({
      lotId: a.lot_id,
      title: String(lot.title || 'Untitled lot').slice(0, 120),
      house: String(lot.auctionHouse || ''),
      saleDate: lot.saleDate ? String(lot.saleDate).slice(0, 10) : null,
      est: est || null,
      searchName: nameOf.get(a.search_id) || 'saved search',
    });
  }

  let sent = 0, skipped = 0;
  for (const [userId, rows] of Array.from(byUser.entries())) {
    const email = await userEmail(userId);
    if (!email) { skipped++; continue; }
    rows.sort((a, b) => (a.saleDate || '9') < (b.saleDate || '9') ? -1 : 1);
    const capped = rows.slice(0, 30);
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM,
        to: [email],
        subject: capped.length === 1
          ? `1 new lot matches your saved search`
          : `${capped.length} new lots match your saved searches`,
        html: emailHtml(capped),
      }),
    });
    if (res.ok) sent++;
    else console.error(`[digest] send failed for ${userId}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  console.log(`[digest] sent ${sent} digests (${alerts.length} fresh alerts, ${byUser.size} users, ${skipped} no-email)`);
}

main().catch(e => { console.error(e); process.exit(1); });

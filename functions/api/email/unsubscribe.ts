/**
 * /api/email/unsubscribe — the Daily Desk email's way out (Oct 21 2026).
 *
 *   GET  ?t=<token>  a one-button page (a link scanner's GET never unsubscribes)
 *   POST ?t=<token>  flips email_prefs.daily off — the page's button and the
 *                    RFC 8058 List-Unsubscribe-Post one-click both land here
 *
 * The flip is public.email_unsubscribe(token) (migration 0011), callable with
 * the PUBLIC anon key: a token can only ever turn email OFF. SUPABASE_URL and
 * SUPABASE_ANON_KEY are plain vars (wrangler.toml) — no secret lives here.
 */
interface Env { SUPABASE_URL?: string; SUPABASE_ANON_KEY?: string }
interface Ctx { request: Request; env: Env }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function page(title: string, body: string, status = 200): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title} — lectr</title>
<style>body{margin:0;background:#F5F3F1;color:#1A1714;font:16px/1.5 Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif}main{max-width:480px;margin:12vh auto;padding:32px 28px;background:#FDFCFC;border-radius:16px}h1{font-weight:300;font-size:28px;letter-spacing:-.02em;margin:0 0 10px}p{color:#6F6A63;margin:0 0 18px}button,a.b{display:inline-block;border:0;border-radius:999px;background:#1A1714;color:#fff;font:500 15px/1 inherit;padding:13px 22px;cursor:pointer;text-decoration:none}a{color:#1A1714}</style></head>
<body><main><h1>${title}</h1>${body}</main></body></html>`;
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });
}

function tokenOf(req: Request): string | null {
  const t = new URL(req.url).searchParams.get('t') || '';
  return UUID.test(t) ? t : null;
}

export async function onRequestGet({ request }: Ctx): Promise<Response> {
  const t = tokenOf(request);
  if (!t) return page('Link not recognised', '<p>This unsubscribe link is incomplete. You can turn the Daily Desk off any time under Account on <a href="/profile#account">your desk</a>.</p>', 400);
  return page('Stop the Daily Desk email?', `<p>You&rsquo;ll stop getting the morning email of your desk. Your watches, follows and record stay as they are.</p>
<form method="post" action="/api/email/unsubscribe?t=${t}"><button type="submit">Unsubscribe</button></form>`);
}

export async function onRequestPost({ request, env }: Ctx): Promise<Response> {
  const t = tokenOf(request);
  if (!t) return page('Link not recognised', '<p>This unsubscribe link is incomplete.</p>', 400);
  const sb = (env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = env.SUPABASE_ANON_KEY || '';
  if (!sb || !key) return page('Try again shortly', '<p>We couldn&rsquo;t reach the account service. You can also turn the email off under Account on <a href="/profile#account">your desk</a>.</p>', 503);
  const r = await fetch(`${sb}/rest/v1/rpc/email_unsubscribe`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: t }),
  });
  if (!r.ok) return page('Try again shortly', '<p>Something went wrong on our side. You can also turn the email off under Account on <a href="/profile#account">your desk</a>.</p>', 502);
  return page('You&rsquo;re unsubscribed', '<p>No more Daily Desk emails. Changed your mind? Turn it back on under Account on your desk.</p><a class="b" href="/profile">Open your desk</a>');
}

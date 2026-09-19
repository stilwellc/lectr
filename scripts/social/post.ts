/**
 * The poster. Reads public/social/today.json (written by render.tsx in the
 * deploy job, so the JPEGs are already live at lectr.bid/social/…) and puts
 * tonight's post on X and Instagram.
 *
 * Idempotent by construction: a ledger in R2 (social/ledger.json, private
 * bucket lectr-data) records every post by date and key. The same key is
 * never posted twice inside 21 days and a date is never posted twice, so a
 * re-run of the job after a partial failure only fills the gap.
 *
 * DRY_RUN=1, or any platform's secrets missing → that platform is skipped
 * with the exact text printed. Nothing here throws on a platform error; the
 * other platform still posts and the ledger records what actually landed.
 *
 * X    OAuth 1.0a user context, signed here with node:crypto (no SDK).
 *      v2 media upload (multipart) → v2 create post → v2 reply with the link.
 *      The link rides in the reply because X bills a URL post 13× a plain one.
 * IG   Graph API two-step: create a container from the public JPEG URL, poll
 *      until FINISHED, publish. Captions carry no live link (IG strips them),
 *      so the caption ends with the path and the bio holds the domain.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { OUT } from './lib';
import { getJson, putJson } from './r2';

const DRY = process.env.DRY_RUN === '1';

// ── ledger in R2 ────────────────────────────────────────────────────────────
interface Entry { date: string; type: string; key: string; x?: { id: string; reply?: string } | null; ig?: { id: string } | null }
interface Ledger { posted: Entry[] }
const readLedger = () => getJson<Ledger>('ledger', { posted: [] });
const writeLedger = (l: Ledger) => (DRY ? Promise.resolve() : putJson('ledger', l));

// ── X: OAuth 1.0a ───────────────────────────────────────────────────────────
const XK = { key: process.env.X_API_KEY || '', secret: process.env.X_API_SECRET || '', token: process.env.X_ACCESS_TOKEN || '', tokenSecret: process.env.X_ACCESS_SECRET || '' };
const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());

function oauthHeader(method: string, url: string, query: Record<string, string> = {}): string {
  const o: Record<string, string> = {
    oauth_consumer_key: XK.key,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: XK.token,
    oauth_version: '1.0',
  };
  const all = { ...query, ...o };
  const params = Object.keys(all).sort().map(k => `${enc(k)}=${enc(all[k])}`).join('&');
  const base = `${method}&${enc(url)}&${enc(params)}`;
  const key = `${enc(XK.secret)}&${enc(XK.tokenSecret)}`;
  o.oauth_signature = crypto.createHmac('sha1', key).update(base).digest('base64');
  return 'OAuth ' + Object.keys(o).sort().map(k => `${enc(k)}="${enc(o[k])}"`).join(', ');
}

async function xUploadMedia(file: string, alt: string): Promise<string> {
  const url = 'https://api.x.com/2/media/upload';
  const form = new FormData();
  form.append('media', new Blob([fs.readFileSync(file)], { type: 'image/jpeg' }), path.basename(file));
  form.append('media_category', 'tweet_image');
  const r = await fetch(url, { method: 'POST', headers: { Authorization: oauthHeader('POST', url) }, body: form });
  const j = (await r.json()) as { data?: { id?: string }; media_id_string?: string; errors?: unknown; detail?: string };
  const id = j.data?.id || j.media_id_string;
  if (!r.ok || !id) throw new Error(`media upload ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
  // alt text — accessibility, and the card's numbers survive as text
  const mu = 'https://api.x.com/2/media/metadata';
  await fetch(mu, { method: 'POST', headers: { Authorization: oauthHeader('POST', mu), 'Content-Type': 'application/json' }, body: JSON.stringify({ id, metadata: { alt_text: { text: alt.slice(0, 1000) } } }) }).catch(() => {});
  return id;
}

async function xPost(text: string, mediaId?: string, replyTo?: string): Promise<string> {
  const url = 'https://api.x.com/2/tweets';
  const body: Record<string, unknown> = { text };
  if (mediaId) body.media = { media_ids: [mediaId] };
  if (replyTo) body.reply = { in_reply_to_tweet_id: replyTo };
  const r = await fetch(url, { method: 'POST', headers: { Authorization: oauthHeader('POST', url), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = (await r.json()) as { data?: { id?: string }; detail?: string; errors?: unknown };
  if (!r.ok || !j.data?.id) throw new Error(`post ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
  return j.data.id;
}

// ── Instagram Graph ─────────────────────────────────────────────────────────
const IG = { user: process.env.IG_USER_ID || '', token: process.env.IG_ACCESS_TOKEN || '' };
const G = 'https://graph.instagram.com/v21.0';

async function igPublish(imageUrl: string, caption: string, alt: string): Promise<string> {
  const q = new URLSearchParams({ image_url: imageUrl, caption, alt_text: alt.slice(0, 1000), access_token: IG.token });
  const c = await fetch(`${G}/${IG.user}/media?${q}`, { method: 'POST' });
  const cj = (await c.json()) as { id?: string; error?: { message?: string } };
  if (!c.ok || !cj.id) throw new Error(`container ${c.status}: ${cj.error?.message || JSON.stringify(cj).slice(0, 200)}`);
  // the container fetches the JPEG from lectr.bid; wait for it
  for (let i = 0; i < 20; i++) {
    const s = await fetch(`${G}/${cj.id}?fields=status_code,status&access_token=${IG.token}`);
    const sj = (await s.json()) as { status_code?: string; status?: string };
    if (sj.status_code === 'FINISHED') break;
    if (sj.status_code === 'ERROR' || sj.status_code === 'EXPIRED') throw new Error(`container ${sj.status_code}: ${sj.status || ''}`);
    await new Promise(r => setTimeout(r, 3000));
  }
  const p = await fetch(`${G}/${IG.user}/media_publish?creation_id=${cj.id}&access_token=${IG.token}`, { method: 'POST' });
  const pj = (await p.json()) as { id?: string; error?: { message?: string } };
  if (!p.ok || !pj.id) throw new Error(`publish ${p.status}: ${pj.error?.message || JSON.stringify(pj).slice(0, 200)}`);
  return pj.id;
}

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  const planPath = path.join(OUT, 'today.json');
  if (!fs.existsSync(planPath)) { console.log('[social] no today.json — render did not produce a post; nothing to do'); return; }
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8')) as {
    date: string; type: string; key: string; files: { ig: string; x: string }; publicUrls: { ig: string }; copy: { x: string; xReply: string; ig: string; alt: string };
  };

  const ledger = await readLedger();
  const cutoff = new Date(Date.now() - 21 * 864e5).toISOString().slice(0, 10);
  const already = ledger.posted.find(e => e.date === plan.date);
  const recent = ledger.posted.find(e => e.key === plan.key && e.date >= cutoff);
  if (recent && recent.x && recent.ig) { console.log(`[social] ${plan.key} already posted on ${recent.date} — skipping`); return; }
  const entry: Entry = already || { date: plan.date, type: plan.type, key: plan.key, x: null, ig: null };
  if (!already) ledger.posted.push(entry);

  const xReady = !DRY && XK.key && XK.secret && XK.token && XK.tokenSecret;
  const igReady = !DRY && IG.user && IG.token;
  console.log(`[social] ${plan.date} · ${plan.type} · ${plan.key} · X ${xReady ? 'live' : 'dry'} · IG ${igReady ? 'live' : 'dry'}`);

  // X
  if (entry.x) console.log('[social] X already posted this entry');
  else if (!xReady) console.log('\n[dry] X post:\n' + plan.copy.x + '\n[dry] X reply:\n' + plan.copy.xReply);
  else {
    try {
      const media = await xUploadMedia(path.join(OUT, plan.files.x), plan.copy.alt);
      const id = await xPost(plan.copy.x, media);
      let reply: string | undefined;
      try { reply = await xPost(plan.copy.xReply, undefined, id); } catch (e) { console.warn('[social] X reply failed:', (e as Error).message); }
      entry.x = { id, reply };
      console.log(`[social] X posted ${id}${reply ? ' + reply ' + reply : ''}`);
    } catch (e) { console.error('[social] X failed:', (e as Error).message); }
  }

  // Instagram
  if (entry.ig) console.log('[social] IG already posted this entry');
  else if (!igReady) console.log('\n[dry] IG caption:\n' + plan.copy.ig + '\n[dry] IG image: ' + plan.publicUrls.ig);
  else {
    try {
      // the JPEG must be live on the site before IG can fetch it
      const head = await fetch(plan.publicUrls.ig, { method: 'HEAD' });
      if (!head.ok) throw new Error(`card not live at ${plan.publicUrls.ig} (${head.status})`);
      const id = await igPublish(plan.publicUrls.ig, plan.copy.ig, plan.copy.alt);
      entry.ig = { id };
      console.log(`[social] IG published ${id}`);
    } catch (e) { console.error('[social] IG failed:', (e as Error).message); }
  }

  ledger.posted = ledger.posted.filter(e => e.date >= new Date(Date.now() - 400 * 864e5).toISOString().slice(0, 10));
  await writeLedger(ledger);
  if (xReady && !entry.x) process.exitCode = 1;
  if (igReady && !entry.ig) process.exitCode = 1;
}

main().catch(e => { console.error(e); process.exit(1); });

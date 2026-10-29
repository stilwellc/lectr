/**
 * daily-desk-send — THE DAILY DESK email (Oct 21 2026), the morning send.
 *
 * Who: every reader who turned the Daily Desk ON in Account (public.email_prefs,
 * migration 0011 — opt-in, off by default) with a confirmed address.
 * What: their own desk — bids past their max, watches closing in 36h, results
 * since the last email, below-market watches, and three picks from the
 * recommender over their watches + follows (scripts/lib/daily-desk.ts, pure).
 * Never an empty email: a reader with nothing to say is skipped.
 * Once a day per reader (email_prefs.last_sent_on, the New York day) and a
 * Resend Idempotency-Key, so a retried run never double-sends.
 *
 * INERT without keys: needs SUPABASE_URL + SUPABASE_SERVICE_KEY (+ RESEND_API_KEY
 * to send). With no Resend key it renders and logs (and writes --preview-dir).
 * QUIET FAILURE like push-send: a failure is a ::warning:: and exit 0
 * (--strict exits 1).
 *
 *   npx tsx scripts/daily-desk-send.ts [--dry-run] [--preview-dir out/dd] [--only-user <uuid>]
 *                                      [--force] [--strict] [--upcoming public/data/ray/upcoming.json]
 */
import fs from 'fs';
import path from 'path';
import type { AuctionLot } from '../app/types';
import { isOnBlock } from '../app/utils';
import { buildTaste, recommend, recNote, type SavedInput, type RecLot } from '../app/lib/recs';
import { followOf, type Follow } from '../app/lib/follows';
import { baseId } from './lib/push-plan';
import { planDesk, type WatchRow, type SoldRow } from './lib/daily-desk';
import { renderDesk } from './lib/daily-desk-html';

const SB = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
const KEY = process.env.SUPABASE_SERVICE_KEY || '';
const RESEND = (process.env.RESEND_API_KEY || '').trim();
const FROM = process.env.DAILY_DESK_FROM || 'lectr <desk@lectr.bid>';
const ORIGIN = (process.env.SITE_ORIGIN || 'https://lectr.bid').replace(/\/$/, '');
const TZ = 'America/New_York';

const arg = (n: string, d: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const flag = (n: string) => process.argv.includes(`--${n}`);
const DRY = flag('dry-run') || !RESEND;
const STRICT = flag('strict');
const FORCE = flag('force');
const ONLY = arg('only-user', '');
const PREVIEW = arg('preview-dir', '');
const warn = (m: string) => console.log(`::warning title=daily-desk::${m}`);

async function rest(p: string, init: RequestInit = {}): Promise<Response> {
  let last: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise(r => setTimeout(r, 1500 * 2 ** attempt));
    try {
      const res = await fetch(`${SB}/rest/v1/${p}`, {
        ...init,
        headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
        signal: AbortSignal.timeout(45_000),
      });
      if (res.ok) return res;
      const msg = `${init.method || 'GET'} ${p.split('?')[0]} → ${res.status} ${(await res.text()).slice(0, 200)}`;
      if (res.status < 500 && res.status !== 408 && res.status !== 429) throw Object.assign(new Error(msg), { fatal: true, status: res.status });
      last = new Error(msg);
    } catch (e) {
      if ((e as { fatal?: boolean }).fatal) throw e;
      last = e;
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}
async function restAll<T>(p: string): Promise<T[]> {
  const out: T[] = [];
  for (let off = 0; ; off += 1000) {
    const page = (await (await rest(`${p}${p.includes('?') ? '&' : '?'}limit=1000&offset=${off}`)).json()) as T[];
    out.push(...page);
    if (page.length < 1000) return out;
  }
}
const inList = (ids: string[]) => encodeURIComponent(`(${ids.map(i => `"${i.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')})`);
const chunks = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

async function loadLive(): Promise<AuctionLot[]> {
  const local = arg('upcoming', path.join(process.cwd(), 'public', 'data', 'ray', 'upcoming.json'));
  if (fs.existsSync(local)) return (JSON.parse(fs.readFileSync(local, 'utf8')).lots || []) as AuctionLot[];
  const r = await fetch(`${ORIGIN}/data/ray/upcoming.json?cb=${Date.now()}`, { signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`upcoming.json → ${r.status}`);
  return ((await r.json()).lots || []) as AuctionLot[];
}

interface Recipient { user_id: string; email: string; unsub_token: string; last_sent_on: string | null }

async function send(to: string, subject: string, html: string, text: string, unsubUrl: string, idem: string): Promise<boolean> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND}`, 'Content-Type': 'application/json', 'Idempotency-Key': idem },
    body: JSON.stringify({
      from: FROM, to: [to], subject, html, text,
      headers: { 'List-Unsubscribe': `<${unsubUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      tags: [{ name: 'kind', value: 'daily_desk' }],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) { warn(`resend ${res.status} ${(await res.text()).slice(0, 200)}`); return false; }
  return true;
}

async function main() {
  if (!SB || !KEY) { console.log('[daily-desk] no SUPABASE_URL/SUPABASE_SERVICE_KEY — skipping (inert)'); return; }
  const now = Date.now();
  const today = new Date(now).toLocaleDateString('en-CA', { timeZone: TZ });
  const dateLabel = new Date(now).toLocaleDateString('en-US', { timeZone: TZ, weekday: 'long', month: 'short', day: 'numeric' });

  // 1 · who asked for it
  let rcpt = (await (await rest('rpc/email_daily_recipients', { method: 'POST', body: '{}' })).json()) as Recipient[];
  if (ONLY) rcpt = rcpt.filter(r => r.user_id === ONLY);
  if (!FORCE) rcpt = rcpt.filter(r => r.last_sent_on !== today);
  if (!rcpt.length) { console.log('[daily-desk] 0 recipients due today'); return; }
  const users = rcpt.map(r => r.user_id);

  // 2 · their watches (max_usd arrives with migration 0010 — fall back without it)
  const watches: (WatchRow & { user_id: string })[] = [];
  for (const c of chunks(users, 100)) {
    try {
      watches.push(...await restAll<WatchRow & { user_id: string }>(`saved_lots?select=user_id,lot_id,saved_title,max_usd,owned,est_mid&user_id=in.${inList(c)}`));
    } catch (e) {
      if ((e as { status?: number }).status !== 400) throw e;
      watches.push(...await restAll<WatchRow & { user_id: string }>(`saved_lots?select=user_id,lot_id,saved_title,owned,est_mid&user_id=in.${inList(c)}`));
    }
  }
  // 3 · their follows (saved_searches → Follow)
  const follows = new Map<string, Follow[]>();
  for (const c of chunks(users, 100)) {
    for (const r of await restAll<{ user_id: string; query: Parameters<typeof followOf>[0] }>(`saved_searches?select=user_id,query&user_id=in.${inList(c)}`)) {
      const f = followOf(r.query);
      if (f) follows.set(r.user_id, [...(follows.get(r.user_id) || []), f]);
    }
  }
  // 4 · the live book + the block's pool for picks
  const book = await loadLive();
  const live = new Map(book.map(l => [baseId(l.id), l]));
  const pool = book.filter(l => isOnBlock(l, today, now)) as (AuctionLot & RecLot)[];
  // 5 · settled results for watched lots off the block
  const offBlock = Array.from(new Set(watches.map(w => baseId(w.lot_id)).filter(id => !live.has(id))));
  const sold = new Map<string, SoldRow>();
  const since = new Date(now - 4 * 86_400_000).toISOString().slice(0, 10);
  for (const c of chunks(offBlock, 100)) {
    const ids = c.flatMap(id => [id, `${id}~`]);
    for (const r of await restAll<SoldRow>(`lots?select=id,title,house,price_usd,sale_date,image_url&status=eq.sold&sale_date=gte.${since}&id=in.${inList(ids)}`)) sold.set(baseId(r.id), r);
  }
  console.log(`[daily-desk] ${rcpt.length} recipient(s) · ${watches.length} watch(es) · ${pool.length} live lots · ${sold.size} recent result(s)${DRY ? ' · DRY (no send)' : ''}`);
  if (PREVIEW) fs.mkdirSync(PREVIEW, { recursive: true });

  let sent = 0, skipped = 0, failed = 0;
  for (const r of rcpt) {
    try {
      const mine = watches.filter(w => w.user_id === r.user_id);
      const saved: SavedInput[] = mine.map(w => ({ id: w.lot_id, lot: (live.get(baseId(w.lot_id)) as RecLot | undefined) ?? null, owned: !!w.owned, title: w.saved_title ?? null, estMid: w.est_mid ?? null }));
      const taste = buildTaste({ saved, follows: follows.get(r.user_id) || [], nowMs: now });
      const picks = recommend(pool, taste, { nowMs: now, n: 8 }).map(p => ({ lot: p.lot as AuctionLot, note: recNote(p) }));
      const mySold = mine.map(w => sold.get(baseId(w.lot_id))).filter((s): s is SoldRow => !!s);
      const desk = planDesk({ now, tz: TZ, watches: mine, live, sold: mySold, picks, lastSentOn: r.last_sent_on });
      if (!desk) { skipped++; continue; }
      const unsubUrl = `${ORIGIN}/api/email/unsubscribe?t=${encodeURIComponent(r.unsub_token)}`;
      const { html, text } = renderDesk(desk, { origin: ORIGIN, unsubUrl, dateLabel });
      if (PREVIEW) fs.writeFileSync(path.join(PREVIEW, `${r.user_id}.html`), html);
      if (DRY) { console.log(`[daily-desk] would send "${desk.subject}" to ${r.email.replace(/^(.).*(@.*)$/, '$1…$2')}`); continue; }
      if (await send(r.email, desk.subject, html, text, unsubUrl, `daily-desk/${r.user_id}/${today}`)) {
        sent++;
        await rest(`email_prefs?user_id=eq.${r.user_id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ last_sent_on: today }) });
      } else {
        failed++;
      }
    } catch (e) {
      failed++;
      warn(`user ${r.user_id.slice(0, 8)}: ${(e as Error).message}`);
    }
  }
  console.log(`[daily-desk] sent ${sent} · skipped ${skipped} (nothing to say) · failed ${failed}`);
  // a send that Resend refused (unverified domain, bad key) turns the job red instead of passing quietly
  if (failed && !sent) process.exitCode = 1;
}

main().catch(e => {
  warn((e as Error).message);
  process.exit(STRICT ? 1 : 0);
});

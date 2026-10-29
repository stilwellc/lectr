/**
 * daily-desk-send — THE DAILY DESK email (Oct 21 2026), the morning send.
 *
 * Who: every reader who turned the Daily Desk ON in Account (public.email_prefs,
 * migration 0011 — opt-in, off by default) with a confirmed address.
 * What: THE NEWSPAPER (Oct 29) — their own desk, every morning: what needs
 * them (bids past their max, closes in 36h, results), every live watch with
 * its movement since the save, the week's calendar, what's new for their
 * follows, the recommender's laned picks, a ledger line per followed name
 * (live lots + the last settled hammer from the entity detail buckets), and
 * the market read off receipts.json / backtest.json / the live book
 * (scripts/lib/daily-desk.ts, pure). A paper publishes daily: only a reader
 * with nothing on the desk at all (no watch, no follow) is skipped.
 * Once a day per reader (email_prefs.last_sent_on, the New York day) and a
 * Resend Idempotency-Key, so a retried run never double-sends.
 *
 * INERT without keys: needs SUPABASE_URL + SUPABASE_SERVICE_KEY (+ RESEND_API_KEY
 * to send). With no Resend key it renders and logs (and writes --preview-dir).
 * QUIET FAILURE like push-send: a failure is a ::warning:: and exit 0
 * (--strict exits 1).
 *
 *   npx tsx scripts/daily-desk-send.ts [--dry-run] [--preview-dir out/dd] [--only <email or uuid>]
 *                                      [--force] [--strict] [--upcoming public/data/ray/upcoming.json]
 * --preview-dir writes <user_id>.html + .txt per recipient (the workflow's
 * dry_run uploads them as the daily-desk-preview artifact); --only takes
 * the recipient's address or user id (--only-user still works); --force
 * sends even to a reader already sent today.
 */
import fs from 'fs';
import path from 'path';
import type { AuctionLot } from '../app/types';
import { isOnBlock } from '../app/utils';
import { buildTaste, recommend, recNote, type SavedInput, type RecLot } from '../app/lib/recs';
import { followOf, type Follow } from '../app/lib/follows';
import { marketNamesOf } from '../app/lib/your-market';
import { bucketOf } from '../app/lib/page-data';
import type { EntityDetail } from '../app/lib/entity/model';
import { baseId } from './lib/push-plan';
import { makerLineOf } from '../app/lib/lot-labels';
import { lotFollowOf } from '../app/lib/lot-follow';
import { planDesk, laneOf, lastSaleOf, recentOf, leadingNameOf, ownedMakerOf, type WatchRow, type SoldRow, type LastSale, type ReceiptsIn, type BacktestIn } from './lib/daily-desk';
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
const ONLY = arg('only', '') || arg('only-user', '');
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

/** a served data file: the local payload when the checkout carries one, else prod */
async function loadServed<T>(rel: string, required = false): Promise<T | null> {
  const local = path.join(path.dirname(arg('upcoming', path.join(process.cwd(), 'public', 'data', 'ray', 'upcoming.json'))), rel);
  if (fs.existsSync(local)) return JSON.parse(fs.readFileSync(local, 'utf8')) as T;
  try {
    const r = await fetch(`${ORIGIN}/data/ray/${rel}?cb=${Date.now()}`, { signal: AbortSignal.timeout(60_000) });
    if (!r.ok) throw new Error(`${rel} → ${r.status}`);
    return (await r.json()) as T;
  } catch (e) {
    if (required) throw e;
    warn(`${rel}: ${(e as Error).message} — section skipped`);
    return null;
  }
}
async function loadLive(): Promise<AuctionLot[]> {
  const j = await loadServed<{ lots?: AuctionLot[] }>('upcoming.json', true);
  return j?.lots || [];
}
/** the followed names' settled side (last hammer + recent rows): one detail bucket per name, each bucket read once */
async function loadNameSold(ids: ReadonlySet<string>): Promise<{ sold: Map<string, LastSale | null>; recent: Map<string, LastSale[]> }> {
  const sold = new Map<string, LastSale | null>();
  const recent = new Map<string, LastSale[]>();
  const buckets = new Map<string, string[]>();
  for (const id of Array.from(ids)) { const b = bucketOf(id); buckets.set(b, [...(buckets.get(b) || []), id]); }
  for (const [b, list] of Array.from(buckets)) {
    const file = await loadServed<Record<string, EntityDetail>>(`pages/entity-${b}.json`);
    for (const id of list) { sold.set(id, lastSaleOf(file?.[id])); recent.set(id, recentOf(file?.[id])); }
  }
  return { sold, recent };
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
  if (ONLY) {
    const who = ONLY.trim().toLowerCase();
    rcpt = rcpt.filter(r => r.user_id === who || (r.email || '').toLowerCase() === who);
    if (!rcpt.length) warn(`--only ${ONLY.replace(/^(.).*(@.*)$/, '$1…$2')} matched no opted-in, confirmed recipient`);
  }
  if (!FORCE) rcpt = rcpt.filter(r => r.last_sent_on !== today);
  if (!rcpt.length) { console.log('[daily-desk] 0 recipients due today'); return; }
  const users = rcpt.map(r => r.user_id);

  // 2 · their watches (max_usd arrives with migration 0010, result_dismissed with 0012 — fall back without them; bid_count is the save's baseline)
  type Watch = WatchRow & { user_id: string; result_dismissed?: boolean | null };
  const watches: Watch[] = [];
  const SELECTS = ['user_id,lot_id,saved_title,saved_artist,paid_usd,max_usd,owned,est_mid,bid_count,result_dismissed', 'user_id,lot_id,saved_title,saved_artist,paid_usd,max_usd,owned,est_mid,bid_count', 'user_id,lot_id,saved_title,owned,est_mid,bid_count'];
  let sel = 0;
  for (const c of chunks(users, 100)) {
    for (;;) {
      try { watches.push(...await restAll<Watch>(`saved_lots?select=${SELECTS[sel]}&user_id=in.${inList(c)}`)); break; } catch (e) {
        if ((e as { status?: number }).status !== 400 || sel === SELECTS.length - 1) throw e;
        sel++;
      }
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
  // 4 · the live book + the block's pool for picks; the market's files; the names' last hammers
  const book = await loadLive();
  const live = new Map(book.map(l => [baseId(l.id), l]));
  const pool = book.filter(l => isOnBlock(l, today, now)) as (AuctionLot & RecLot)[];
  const receipts = await loadServed<ReceiptsIn>('receipts.json');
  const backtest = await loadServed<BacktestIn>('backtest.json');
  const nameIds = new Set<string>();
  for (const fs_ of Array.from(follows.values())) for (const n of marketNamesOf(fs_, [])) if (n.id) nameIds.add(n.id);
  // the owned pieces' makers too: Your collection prints each maker's latest settled hammer
  for (const w of watches) if (w.owned) { const id = ownedMakerOf(w, live.get(baseId(w.lot_id)) ?? null).id; if (id) nameIds.add(id); }
  const { sold: nameSold, recent: nameRecent } = await loadNameSold(nameIds);
  // 5 · settled results for watched lots off the block — every sold one (planDesk prints the ones since the last
  //     Desk; the rest count as results still waiting on the desk: sold, not owned, not dismissed)
  const offBlock = Array.from(new Set(watches.map(w => baseId(w.lot_id)).filter(id => !live.has(id))));
  const sold = new Map<string, SoldRow>();
  for (const c of chunks(offBlock, 100)) {
    const ids = c.flatMap(id => [id, `${id}~`]);
    for (const r of await restAll<SoldRow>(`lots?select=id,title,house,artist,price_usd,sale_date,image_url&status=eq.sold&id=in.${inList(ids)}`)) sold.set(baseId(r.id), r);
  }
  // the name behind a pick's saved-lot seed, for its lane head: the live lot's entity, else the snapshot title's leading name
  const titleById = new Map(watches.map(w => [baseId(w.lot_id), w.saved_title || '']));
  const whoFor = (seed: { lotId?: string }): string | null => {
    if (!seed.lotId) return null;
    const l = live.get(baseId(seed.lotId));
    return l ? makerLineOf(l).name || lotFollowOf(l)?.label || leadingNameOf(l.title) : leadingNameOf(titleById.get(baseId(seed.lotId)));
  };
  console.log(`[daily-desk] ${rcpt.length} recipient(s) · ${watches.length} watch(es) · ${pool.length} live lots · ${sold.size} recent result(s) · ${nameIds.size} name(s)${DRY ? ' · DRY (no send)' : ''}`);
  if (PREVIEW) fs.mkdirSync(PREVIEW, { recursive: true });

  let sent = 0, skipped = 0, failed = 0;
  for (const r of rcpt) {
    try {
      const mine = watches.filter(w => w.user_id === r.user_id);
      const saved: SavedInput[] = mine.map(w => ({ id: w.lot_id, lot: (live.get(baseId(w.lot_id)) as RecLot | undefined) ?? null, owned: !!w.owned, title: w.saved_title ?? null, estMid: w.est_mid ?? null }));
      const myFollows = follows.get(r.user_id) || [];
      const taste = buildTaste({ saved, follows: myFollows, nowMs: now });
      const picks = recommend(pool, taste, { nowMs: now, n: 12 }).map(p => ({ lot: p.lot as AuctionLot, note: recNote(p), lane: laneOf(p, whoFor(p.seed)) }));
      const mySold = mine.map(w => sold.get(baseId(w.lot_id))).filter((s): s is SoldRow => !!s);
      const pendingResults = mine.filter(w => !w.owned && !w.result_dismissed && sold.has(baseId(w.lot_id))).length;
      const desk = planDesk({ now, tz: TZ, watches: mine, live, sold: mySold, picks, lastSentOn: r.last_sent_on, follows: myFollows, book, nameSold, nameRecent, receipts, backtest, pendingResults });
      if (!desk) { skipped++; continue; }
      const unsubUrl = `${ORIGIN}/api/email/unsubscribe?t=${encodeURIComponent(r.unsub_token)}`;
      const { html, text } = renderDesk(desk, { origin: ORIGIN, unsubUrl, dateLabel });
      if (PREVIEW) { fs.writeFileSync(path.join(PREVIEW, `${r.user_id}.html`), html); fs.writeFileSync(path.join(PREVIEW, `${r.user_id}.txt`), text); }
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
  console.log(`[daily-desk] sent ${sent} · skipped ${skipped} (nothing on the desk) · failed ${failed}`);
  // a send that Resend refused (unverified domain, bad key) turns the job red instead of passing quietly
  if (failed && !sent) process.exitCode = 1;
}

main().catch(e => {
  warn((e as Error).message);
  process.exit(STRICT ? 1 : 0);
});

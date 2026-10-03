/**
 * push-send — Web Push for watched lots (the server half of app/lib/push.ts).
 *
 *   close24  ~24h before a watched lot closes     (close-board cadence, every 4h)
 *   close1   ~1h before a watched TIMED lot closes (needs an hourly runner to
 *            be punctual — see docs/RETENTION.md; at 4h cadence a lot is only
 *            caught when a run lands inside its last 90 minutes)
 *   hammer   "Sold for $X (lectr forecast $Y)" after the nightly settles it
 *
 * Rules (scripts/lib/push-plan.ts, unit-tested): one push per user × lot ×
 * kind EVER (public.push_log), ≤ 3 per user per kind per run with the rest
 * collapsed into one summary, 404/410 subscriptions pruned on the spot.
 *
 * INERT without keys: needs SUPABASE_URL + SUPABASE_SERVICE_KEY +
 * VAPID_PRIVATE_KEY + NEXT_PUBLIC_VAPID_PUBLIC_KEY (or VAPID_PUBLIC_KEY).
 * Missing any → prints why and exits 0.
 *
 * QUIET FAILURE: a push service hiccup is never the pipeline's emergency.
 * Every failure is a ::warning:: and the process exits 0 — the close-board
 * deploy and the nightly sync must not go red because FCM had a bad minute.
 * --strict exits 1 on a Supabase/data failure instead (for manual debugging).
 *
 *   npx tsx scripts/push-send.ts [--kinds close24,close1,hammer] [--source https://lectr.bid]
 *                                [--upcoming public/data/ray/upcoming.json] [--dry-run] [--strict]
 *
 * NO EMAIL FEATURES: the VAPID subject is the site URL, not a mailto.
 */
import fs from 'fs';
import path from 'path';
import webpush from 'web-push';
import {
  planSends, classifyPushError, shouldRetire, baseId, dedupeKey, closeKindFor,
  type Kind, KINDS, type LiveLot, type SettledLot, type Watch, HAMMER_FRESH_DAYS,
} from './lib/push-plan';

const SB = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
const KEY = process.env.SUPABASE_SERVICE_KEY || '';
const VAPID_PUB = (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || process.env.VAPID_PUBLIC_KEY || '').trim();
const VAPID_PRIV = (process.env.VAPID_PRIVATE_KEY || '').trim();
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'https://lectr.bid';

const arg = (n: string, d: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const flag = (n: string) => process.argv.includes(`--${n}`);
const DRY = flag('dry-run');
const STRICT = flag('strict');
const warn = (m: string) => console.log(`::warning title=push-send::${m}`);

// ── PostgREST (service key) with bounded retry ──────────────────────────────
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
      if (res.status < 500 && res.status !== 408 && res.status !== 429) throw Object.assign(new Error(msg), { fatal: true });
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
/** PostgREST in.() list with quoting (lot ids carry '-', '~', ':' …) */
const inList = (ids: string[]) => encodeURIComponent(`(${ids.map(i => `"${i.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')})`);
const chunks = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

interface SubRow { id: number; user_id: string; endpoint: string; p256dh: string; auth: string; fail_count: number }

async function loadLive(): Promise<LiveLot[]> {
  const local = arg('upcoming', path.join(process.cwd(), 'public', 'data', 'ray', 'upcoming.json'));
  let j: { lots?: LiveLot[] } | null = null;
  if (fs.existsSync(local)) j = JSON.parse(fs.readFileSync(local, 'utf8'));
  else {
    const src = arg('source', 'https://lectr.bid');
    const r = await fetch(`${src}/data/ray/upcoming.json?cb=${Date.now()}`, { signal: AbortSignal.timeout(60_000) });
    if (!r.ok) throw new Error(`upcoming.json → ${r.status}`);
    j = await r.json();
  }
  return (j?.lots || []) as LiveLot[];
}

async function main() {
  if (!SB || !KEY) { console.log('[push-send] no SUPABASE_URL/SUPABASE_SERVICE_KEY — skipping (inert)'); return; }
  if (!VAPID_PUB || !VAPID_PRIV) { console.log('[push-send] no VAPID keys — skipping (inert)'); return; }
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUB, VAPID_PRIV);
  const kinds = new Set(arg('kinds', KINDS.join(',')).split(',').map(s => s.trim()).filter((k): k is Kind => (KINDS as string[]).includes(k)));
  const now = Date.now();

  // 1 · who can hear us
  const subs = await restAll<SubRow>('push_subscriptions?select=id,user_id,endpoint,p256dh,auth,fail_count&order=id');
  if (!subs.length) { console.log('[push-send] 0 push subscriptions — nothing to do'); return; }
  const subsByUser = new Map<string, SubRow[]>();
  for (const s of subs) subsByUser.set(s.user_id, [...(subsByUser.get(s.user_id) || []), s]);
  const users = Array.from(subsByUser.keys());

  // 2 · what they watch
  const watches: Watch[] = [];
  for (const c of chunks(users, 100)) {
    watches.push(...await restAll<Watch>(`saved_lots?select=user_id,lot_id,saved_title&user_id=in.${inList(c)}`));
  }
  const watchedIds = Array.from(new Set(watches.map(w => baseId(w.lot_id))));
  console.log(`[push-send] ${subs.length} subscription(s) · ${users.length} user(s) · ${watchedIds.length} watched lot(s) · kinds ${Array.from(kinds).join(',')}`);
  if (!watchedIds.length) return;
  const watchedSet = new Set(watchedIds);

  // 3 · live state (close kinds) + forecast snapshots for the hammer message
  const live = new Map<string, LiveLot>();
  if (kinds.has('close24') || kinds.has('close1') || kinds.has('hammer')) {
    for (const l of await loadLive()) if (l?.id && watchedSet.has(baseId(l.id))) live.set(baseId(l.id), l);
  }
  const snaps = Array.from(live.values())
    .filter(l => (l.value?.compValueUsd ?? 0) > 0)
    .map(l => ({
      lot_id: baseId(l.id), forecast_usd: Math.round(l.value!.compValueUsd!),
      closes_at: l.saleDateTime && Number.isFinite(Date.parse(l.saleDateTime)) ? new Date(l.saleDateTime).toISOString() : null,
      title: (l.title || '').slice(0, 500) || null, updated_at: new Date(now).toISOString(),
    }));
  if (snaps.length && !DRY) {
    for (const c of chunks(snaps, 500)) {
      await rest('push_lot_snap?on_conflict=lot_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(c) });
    }
  }
  const forecasts = new Map<string, number>();
  const notLive = watchedIds.filter(id => !live.has(id));
  if (kinds.has('hammer') && notLive.length) {
    for (const c of chunks(notLive, 150)) {
      for (const r of await restAll<{ lot_id: string; forecast_usd: number | null }>(`push_lot_snap?select=lot_id,forecast_usd&lot_id=in.${inList(c)}`)) {
        if (r.forecast_usd && r.forecast_usd > 0) forecasts.set(r.lot_id, Number(r.forecast_usd));
      }
    }
  }

  // 4 · settled outcomes (hammer) — public.lots, both id spellings
  const settled = new Map<string, SettledLot>();
  if (kinds.has('hammer') && notLive.length) {
    const since = new Date(now - (HAMMER_FRESH_DAYS + 1) * 86_400_000).toISOString().slice(0, 10);
    for (const c of chunks(notLive, 100)) {
      const ids = c.flatMap(id => [id, `${id}~`]);
      for (const r of await restAll<SettledLot>(`lots?select=id,title,house,status,price_usd,sale_date&status=eq.sold&sale_date=gte.${since}&id=in.${inList(ids)}`)) {
        settled.set(baseId(r.id), r);
      }
    }
  }

  // 5 · the ledger: what each user already heard
  const sent = new Set<string>();
  for (const c of chunks(users, 100)) {
    for (const r of await restAll<{ user_id: string; lot_id: string; kind: Kind }>(`push_log?select=user_id,lot_id,kind&user_id=in.${inList(c)}`)) {
      sent.add(dedupeKey(r.user_id, r.lot_id, r.kind));
    }
  }

  // 6 · plan
  const plan = planSends({ usersWithSubs: new Set(users), watches, live, settled, sent, forecasts, now })
    .filter(p => kinds.has(p.kind));
  const liveInWindow = Array.from(live.values()).filter(l => closeKindFor(l, now)).length;
  console.log(`[push-send] ${live.size} watched lot(s) live (${liveInWindow} in a close window) · ${settled.size} freshly sold · ${plan.length} notification(s) planned`);
  if (DRY) { for (const p of plan) console.log(`  [dry] ${p.kind} → user …${p.userId.slice(-4)}: ${p.payload.title} | ${p.payload.body}`); return; }

  // 7 · send — per notification, to every device of that user
  const pruned: number[] = [];
  const okSubs = new Set<number>();
  const failed = new Map<number, number>();
  const logRows: { user_id: string; lot_id: string; kind: Kind }[] = [];
  let delivered = 0, errors = 0;
  for (const p of plan) {
    const devices = (subsByUser.get(p.userId) || []).filter(s => !pruned.includes(s.id));
    let anyOk = false, anyTransient = false;
    for (const s of devices) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(p.payload),
          { TTL: p.kind === 'close1' ? 3600 : p.kind === 'close24' ? 6 * 3600 : 24 * 3600, urgency: p.kind === 'close1' ? 'high' : 'normal', timeout: 15_000 },
        );
        anyOk = true; okSubs.add(s.id); delivered++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        const what = classifyPushError(code);
        if (what === 'prune') pruned.push(s.id);
        else {
          failed.set(s.id, (failed.get(s.id) || 0) + 1);
          if (what === 'retry') anyTransient = true;
          else { errors++; warn(`push ${code} for sub ${s.id}: ${String((e as { body?: string }).body || (e as Error).message).slice(0, 160)}`); }
        }
      }
    }
    // logged when ANY device took it, or when nothing transient is left to
    // retry (every device pruned / permanently refused) — never re-nag
    if (anyOk || !anyTransient) for (const lotId of p.lotIds) logRows.push({ user_id: p.userId, lot_id: lotId, kind: p.kind });
  }

  // 8 · book-keeping (each step best-effort)
  try {
    for (const c of chunks(logRows, 500)) {
      await rest('push_log?on_conflict=user_id,lot_id,kind', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify(c) });
    }
  } catch (e) { warn(`push_log write failed (pushes may repeat next run): ${(e as Error).message}`); }
  try {
    for (const c of chunks(pruned, 200)) await rest(`push_subscriptions?id=in.(${c.join(',')})`, { method: 'DELETE' });
    const nowIso = new Date().toISOString();
    for (const c of chunks(Array.from(okSubs), 200)) {
      await rest(`push_subscriptions?id=in.(${c.join(',')})`, { method: 'PATCH', body: JSON.stringify({ last_ok_at: nowIso, fail_count: 0 }) });
    }
    const retire: number[] = [];
    for (const [id, n] of Array.from(failed)) {
      if (okSubs.has(id)) continue;
      const total = (subs.find(s => s.id === id)?.fail_count || 0) + n;
      if (shouldRetire(total)) retire.push(id);
      else await rest(`push_subscriptions?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ fail_count: Math.min(total, 1000) }) });
    }
    for (const c of chunks(retire, 200)) await rest(`push_subscriptions?id=in.(${c.join(',')})`, { method: 'DELETE' });
    // the ledger only needs to outlive a lot's close; keep it small
    await rest(`push_log?sent_at=lt.${new Date(now - 120 * 86_400_000).toISOString()}`, { method: 'DELETE' });
    await rest(`push_lot_snap?updated_at=lt.${new Date(now - 60 * 86_400_000).toISOString()}`, { method: 'DELETE' });
    if (retire.length) console.log(`[push-send] retired ${retire.length} subscription(s) after repeated failures`);
  } catch (e) { warn(`subscription book-keeping failed: ${(e as Error).message}`); }

  console.log(`[push-send] delivered ${delivered} · pruned ${pruned.length} gone subscription(s) · ${failed.size} transient-failing device(s) · ${errors} hard error(s) · logged ${logRows.length}`);
}

main().catch(e => {
  if (STRICT) { console.error('[push-send] fatal', e); process.exit(1); }
  warn(`push-send skipped this run: ${(e as Error).message}`);
});

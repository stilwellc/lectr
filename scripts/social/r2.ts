/**
 * Tiny JSON documents in the private lectr-data bucket — the social desk's
 * only mutable state. Two keys:
 *
 *   social/ledger.json   what was posted, by date and key   (post.ts)
 *   social/flags.json    id → {image, title, house, artist} for every lot the
 *                        desk flagged, captured the night it was live, so a
 *                        receipt weeks later can still show the photograph
 *                        the served payload no longer carries (render.tsx)
 *
 * Same REST endpoint data-store.sh uses, same token. With no token (a local
 * run) both fall back to public/social/.<name>.json so nothing here needs
 * the cloud to be exercised.
 */

import fs from 'node:fs';
import path from 'node:path';

const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID || '5bcc5f43136c9ba6b6cb7f949813f473';
const TOKEN = process.env.CLOUDFLARE_API_TOKEN || '';
const url = (name: string) => `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/r2/buckets/lectr-data/objects/${encodeURIComponent(`social/${name}.json`)}`;
const local = (name: string) => path.join(process.cwd(), 'public', 'social', `.${name}.json`);

export async function getJson<T>(name: string, fallback: T): Promise<T> {
  if (!TOKEN) {
    const p = local(name);
    return fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, 'utf8')) as T) : fallback;
  }
  try {
    const r = await fetch(url(name), { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (r.status === 404) return fallback;
    if (!r.ok) { console.warn(`[social] r2 get ${name} ${r.status}`); return fallback; }
    return (await r.json()) as T;
  } catch (e) {
    console.warn(`[social] r2 get ${name}:`, (e as Error).message);
    return fallback;
  }
}

export async function putJson(name: string, value: unknown): Promise<void> {
  const body = JSON.stringify(value);
  if (!TOKEN) {
    fs.mkdirSync(path.dirname(local(name)), { recursive: true });
    fs.writeFileSync(local(name), body);
    return;
  }
  try {
    const r = await fetch(url(name), { method: 'PUT', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body });
    if (!r.ok) console.warn(`[social] r2 put ${name} ${r.status}`);
  } catch (e) {
    console.warn(`[social] r2 put ${name}:`, (e as Error).message);
  }
}

'use client';
/**
 * lot-resolve — will a sold row's /lot link open a lot? (r8, QA3 Q2 residue)
 *
 * An entity page's results link every sold row to /lot?id=. The lot page
 * resolves an id from the live book, the Supabase lots table, or the build's
 * lot index (pages/lot-idx-XX.json → one served shard). A row in none of
 * them opened "This lot isn't on the book" — six such rows on the 1952
 * Topps and Yankees results (Oct 10: REA's Sept sale rea-1972xx… and two
 * Huggins & Scott season ids).
 *
 *   - ALIAS: Huggins & Scott rows filed under a season id
 *     ("hugginsscott-2026-summer-315") are the same lots the lots table keys
 *     by the house's own lot number — the number its image is filed under
 *     (".../2026-Summer/18820-1.jpg" → "hugginsscott-18820"; title-checked
 *     on a sample). The alias is linked only once the table confirms it.
 *   - DEAD: an id the lot index answers "not on the book" for AND the lots
 *     table lacks renders unlinked. Unknown (an index that didn't load, a
 *     failed request) stays linked — never unlink on a guess.
 *
 * Same lookups the lot page makes (one batched table read, the cached index
 * buckets), so a click afterwards costs nothing new.
 */
import { useEffect, useMemo, useState } from 'react';
import { loadLotShardCode } from './page-data';

/** the lots-table id a Huggins & Scott season row is keyed under, from its
 *  image's lot number (null: not that shape) */
export function lotAliasOf(id: string, img: string | null | undefined): string | null {
  if (!/^hugginsscott-\d{4}-[a-z]+-\d+$/.test(id)) return null;
  const m = (img || '').match(/\/(\d{3,})-\d+\.(?:jpe?g|png|webp)(?:$|\?)/i);
  return m ? `hugginsscott-${m[1]}` : null;
}

async function tableHas(ids: string[]): Promise<Set<string> | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon || !ids.length) return ids.length ? null : new Set();
  try {
    const list = ids.map(i => `"${i.replace(/"/g, '')}"`).join(',');
    const r = await fetch(`${url}/rest/v1/lots?select=id&id=in.(${encodeURIComponent(list)})`, {
      headers: { apikey: anon, Authorization: `Bearer ${anon}` },
    });
    if (!r.ok) return null;
    const rows = (await r.json()) as { id: string }[];
    return new Set(rows.map(x => x.id));
  } catch { return null; }
}

const verdicts = new Map<string, Promise<string | null | undefined>>();
/** id → the id to link (itself or its alias), null = dead, undefined = unknown */
async function resolveAll(rows: { id: string; img?: string | null }[]): Promise<Map<string, string | null | undefined>> {
  const out = new Map<string, string | null | undefined>();
  const todo = rows.filter(r => !verdicts.has(r.id));
  if (todo.length) {
    const aliases = todo.map(r => lotAliasOf(r.id, r.img)).filter((a): a is string => !!a);
    const table = tableHas([...todo.map(r => r.id), ...aliases]);
    for (const r of todo) {
      verdicts.set(r.id, (async () => {
        const have = await table;
        if (have?.has(r.id)) return r.id;
        const alias = lotAliasOf(r.id, r.img);
        if (alias && have?.has(alias)) return alias;
        const code = await loadLotShardCode(r.id);
        if (typeof code === 'number') return r.id;
        // the index answered "not on the book" and the table answered too
        return code === null && have ? null : undefined;
      })());
    }
  }
  await Promise.all(rows.map(async r => out.set(r.id, await verdicts.get(r.id))));
  return out;
}

/** the link target per row id: the id (or its alias) to link, null = render
 *  the row unlinked; an id not yet answered links as itself */
export function useLotLinks(rows: readonly { id: string; img?: string | null }[]): (id: string) => string | null {
  const key = rows.map(r => r.id).join('|');
  const [got, setGot] = useState<Map<string, string | null | undefined>>(() => new Map());
  const list = useMemo(() => rows.filter(r => r.id), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!list.length) return;
    let on = true;
    resolveAll(list).then(m => { if (on) setGot(prev => { const next = new Map(prev); m.forEach((v, k) => next.set(k, v)); return next; }); });
    return () => { on = false; };
  }, [list]);
  return (id: string) => {
    const v = got.get(id);
    return v === undefined ? id : v;
  };
}

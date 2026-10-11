/**
 * display.ts — how an entity's name and document title print (pure; shared
 * by the client EntityPage and the static /p, /e aliases' build metadata, so
 * the tab title the page sets after hydration is the one the HTML shipped).
 */

/** houses print names as they shout them (Goldin: "MICKEY MANTLE") — a
 *  shouting name is re-cased for display; a cased one is left alone */
const SMALL = new Set(['de', 'da', 'del', 'della', 'di', 'la', 'le', 'van', 'von', 'y']);
export function displayName(raw: string): string {
  const name = (raw || '').trim();
  const letters = name.replace(/[^a-zA-Z]/g, '');
  if (letters.length < 3) return name;
  const shouting = name.replace(/[^A-Z]/g, '').length / letters.length > 0.85;
  if (!shouting) return name;
  return name.toLowerCase().split(/\s+/).map((w, i) => {
    const bare = w.replace(/[.,]/g, '');
    if (/^(ii|iii|iv|jr|sr)$/.test(bare)) return bare === 'jr' || bare === 'sr' ? `${bare.charAt(0).toUpperCase()}${bare.slice(1)}.` : bare.toUpperCase();
    if (i > 0 && SMALL.has(bare)) return w;
    let out = w.replace(/(^|['’-])([a-z])/g, (_, a, b) => a + b.toUpperCase());
    out = out.replace(/^Mc([a-z])/, (_, b) => `Mc${b.toUpperCase()}`);
    return out;
  }).join(' ');
}

export const KIND_NOUN: Record<string, string> = {
  maker: 'maker', player: 'player', set: 'set', sub: 'collection',
  pokemon: 'Pokémon', person: 'person', film: 'film', franchise: 'franchise',
  mission: 'mission', team: 'team', band: 'band', brand: 'brand',
};

/** the dossier's document title — the same grammar as /makers/<slug>
 *  ('KAWS — maker dossier · lectr') and /sub, /ref ('X — sub-market · lectr') */
export function entityDocTitle(name: string, kind: string | null | undefined): string {
  const word = kind === 'player' ? 'player dossier' : kind === 'maker' ? 'maker dossier' : 'dossier';
  return `${name} — ${word} · lectr`;
}

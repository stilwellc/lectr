import type { AuctionLot } from '../../app/types';
import { readWatchReference } from '../../app/lib/watch-ref';

/* ═══════════════════════════════════════════════════════════════════════════
   identity-enrich.ts — two greenfield identity keyers for lectr.

   Both directly expand price-index coverage:

   1. objectFingerprint(lot) — a COARSE blocking key that groups likely-same
      physical objects across houses/dates, feeding the repeat-sales engine.
      NOT an exact-match verdict: it's a candidate bucket. The same-vs-similar
      decision lives downstream (scored % over titleTokens + attributes). The
      corpus field `objectFingerprint` is populated 0/~800k times today, so
      this is entirely new coverage.

   2. extractReference(lot) — for watch makers, recover the ref/model from
      titles the current watchKey() missed. Only ~65% of sold watch lots carry
      a reference today; the other 35% are uncontrolled noise dragging the
      hedonic. The single biggest miss is that the live regex accepts "Ref."
      and "Reference" but NOT the very common "Ref:" (colon) form, and drops
      hyphen-suffixed refs like "4936G-001".

   This module is self-contained: it re-implements the small normalization
   helpers it needs rather than importing from app/lib (which is not edited).
   The token/normalize logic is kept byte-compatible in spirit with
   app/lib/comps.ts + app/lib/normalize.ts so keys line up with the engine.
   ═══════════════════════════════════════════════════════════════════════════ */

/** The five watch makers the hedonic controls. Slugs match lot.artist. */
const WATCH_MAKERS = new Set<string>([
  'rolex', 'patek-philippe', 'cartier', 'audemars-piguet', 'omega',
]);

/** stable non-cryptographic 32-bit FNV-1a → 8-hex. Deterministic across
    runtimes — same construction as normalize.ts so fingerprints are stable. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return ('00000000' + h.toString(16)).slice(-8);
}

function norm(s: string | null | undefined): string {
  return (s || '').toLowerCase().trim();
}

/* ── title normalization (mirrors comps.normalizeTitle) ──────────────────── */
function normalizeTitle(t: string | null | undefined): string {
  return (t || '')
    .toLowerCase()
    .replace(/["“”'’]/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ── modelKey (mirrors comps.modelKey) — furniture code / named series ────── */
const CODE_BLACKLIST = new Set(['no', 'ca', 'vol', 'lot', 'est', 'circa', 'in', 'of', 'at', 'to', 'by', 'as', 'for', 'and', 'the']);
const MODEL_STOPWORDS = new Set([
  'a', 'an', 'the', 'pair', 'set', 'two', 'three', 'four', 'six', 'his', 'her',
  'walnut', 'teak', 'oak', 'rosewood', 'pine', 'maple', 'cherry', 'burl', 'laurel',
  'custom', 'rare', 'early', 'important', 'fine', 'exceptional', 'monumental',
  'large', 'small', 'long', 'low', 'high', 'tall', 'double', 'single', 'grand',
  'occasional', 'freeform', 'free-form', 'upholstered', 'illuminated', 'unique',
  'special', 'signed', 'vintage', 'original',
]);
const FORM_NOUNS = /(sofa|couch|settee|bench|daybed|stool|ottoman|chair|rocker|table|cabinet|chest|dresser|sideboard|credenza|desk|bed|headboard|lamp|sconce|chandelier|mirror|shelf|shelves|bookcase)/;

function modelKey(title: string | null | undefined): string | null {
  const t = (title || '').toLowerCase();
  const code = t.match(/\b([a-z]{1,3})[-. ]?(\d{1,4})[a-z]?\b/);
  if (code && !CODE_BLACKLIST.has(code[1]) && !/^(19|20)\d\d$/.test(code[2])) {
    return `${code[1]}${code[2]}`;
  }
  const modelNo = t.match(/\bmodel\s+(?:no\.?\s*)?([a-z0-9-]{1,10})\b/);
  if (modelNo) return modelNo[1].replace(/-/g, '');
  const named = t.match(new RegExp('\\b([a-z][a-z-]{2,})\\s+' + FORM_NOUNS.source + 's?\\b'));
  if (named && !MODEL_STOPWORDS.has(named[1])) return named[1];
  return null;
}

/* ═══════════════════════════════════════════════════════════════════════════
   1 · objectFingerprint — coarse blocking key for repeat-sales.

   Groups likely-same physical objects across houses/dates. Built ONLY from
   stable identity attributes; DELIBERATELY excludes condition, grade, and
   price (a repeat sale of the same object may re-grade / re-price). Returns
   null when the discriminators are too thin to form a useful block — never
   fabricate exact identity from a generic title.

   Two paths:
     watch      = [maker, reference || modelLine, yearBand]            (w:)
     art/design = [maker, modelKey || titleTokens, yearNum, sizeBand, edition]
                                                                        (a:)

   A watch path is used when the lot is one of the five watch makers, because
   for watches the reference IS the object identity (a Daytona is never a
   Datejust) and dims are unreliable. Everything else takes the art/design
   path keyed on maker + title/model + year + a coarse size band.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Coarse size band from max linear cm — a bucket, not an exact dim, so two
    listings of the same object that round differently still co-block. */
function sizeBand(h?: number | null, w?: number | null, d?: number | null): string {
  const max = Math.max(h ?? 0, w ?? 0, d ?? 0);
  if (max <= 0) return '';
  if (max < 20) return 's';       // small object / book / photo
  if (max < 40) return 'm';
  if (max < 100) return 'l';
  if (max < 200) return 'xl';
  return 'xxl';
}

/** Year band: exact 4-digit year when present. Editions/production runs of the
    same object share a year, so exact year is a fair block; circa noise is
    absorbed because we take the field's yearNum (already canonicalized). */
function yearBand(y?: number | null): string {
  return y != null && y >= 1700 && y <= 2100 ? String(y) : '';
}

const FP_TOKEN_STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'with', 'in', 'on', 'for', 'to', 'from',
  'by', 'at', 'his', 'her', 'its', 'lot', 'no', 'circa', 'c', 'edition', 'ed',
  'untitled', 'style', 'after', 'signed', 'numbered', 'set', 'pair',
]);

/** Distinctive title tokens for the block, maker-name words dropped so a pool
    of one maker isn't merged on their own name. Sorted + deduped so word order
    across houses doesn't fragment the block. */
function fpTitleKey(title: string | null | undefined, makerWords: Set<string>): string {
  const nt = normalizeTitle(title);
  const toks = nt.split(' ')
    .filter(w => w.length >= 3 && !FP_TOKEN_STOPWORDS.has(w) && !makerWords.has(w))
    // light singularization to collapse prints/print
    .map(w => (w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));
  const uniq = Array.from(new Set(toks)).sort();
  return uniq.join(' ');
}

function makerNameWords(maker: string): Set<string> {
  return new Set(norm(maker).split(/[-\s]+/).filter(Boolean));
}

/** Parse an N/M edition from a title when the corpus hasn't stamped one.
    "Edition 12/50", "No.6/50", "12 of 50", "one of 50". */
function parseEdition(title: string | null | undefined): { of: number; total: number } | null {
  const t = (title || '').toLowerCase();
  let m = t.match(/\b(?:ed(?:ition)?|no|number|numbered)\.?\s*#?\s*(\d{1,4})\s*\/\s*(\d{1,4})\b/);
  if (!m) m = t.match(/\b(\d{1,4})\s*\/\s*(\d{1,4})\b/);
  if (!m) m = t.match(/\b(\d{1,4})\s+of\s+(\d{1,4})\b/);
  if (m) {
    const of = parseInt(m[1], 10), total = parseInt(m[2], 10);
    if (total > 0 && of > 0 && of <= total && total <= 5000) return { of, total };
  }
  return null;
}

/** Watch model line — for a watch lot with no ref, the named line is the block
    (Daytona / Nautilus / Tank …). Same vocabulary as comps.watchKey. */
const WATCH_MODELS = /(submariner|daytona|datejust|day[- ]date|gmt[- ]master(?:\s*ii)?|explorer(?:\s*ii)?|sea[- ]dweller|yacht[- ]master|milgauss|air[- ]king|oyster perpetual|oysterdate|oyster|cellini|nautilus|aquanaut|calatrava|ellipse|gondolo|twenty[~-]?4|world time|royal oak(?: offshore)?|millenary|jules audemars|speedmaster|seamaster|constellation|de ville|railmaster|tank|santos|panth[eè]re|ballon bleu|pasha|crash|baignoire|tortue|reverso|memovox|polaris|navitimer|superocean|chronomat|monaco|carrera|autavia|el primero|defy|portugieser|portofino|ingenieur|aquatimer|luminor|radiomir|overseas|patrimony|fifty ?fathoms|villeret|must de cartier|must)/;

export function objectFingerprint(lot: AuctionLot): string | null {
  const makerRaw = lot.makerSlug ?? lot.artist ?? '';
  const maker = norm(makerRaw);
  if (!maker) return null;

  // ── WATCH PATH ────────────────────────────────────────────────────────
  // For watch makers the reference (or model line) is the physical identity.
  if (WATCH_MAKERS.has(maker)) {
    const ref = extractReference(lot);            // recovers Ref: forms too
    const yb = yearBand(lot.yearNum);
    // A shared REFERENCE is itself a valid coarse block (a ref pins the model +
    // production run; the downstream scorer separates individual pieces). A
    // ref that also carries a year is tighter still.
    if (ref && /\d/.test(ref)) {
      return 'w:' + fnv1a([maker, 'r:' + ref, yb].join('|'));
    }
    // No usable reference: a bare model LINE (Datejust, Panthère …) is far too
    // broad to block on alone — it would merge hundreds of unrelated pieces.
    // Only accept a model line when a year band is present to tighten it; and
    // even then it is a loose block. Otherwise the lot is left unblocked
    // (null) — honesty over coverage.
    const model = ((lot.title || '').toLowerCase().match(WATCH_MODELS) || [])[1];
    if (model && yb) {
      return 'w:' + fnv1a([maker, 'l:' + model.replace(/[-~ ]/g, ''), yb].join('|'));
    }
    return null;
  }

  // ── ART / DESIGN PATH ─────────────────────────────────────────────────
  const makerWords = makerNameWords(makerRaw);
  // modelKey is a FURNITURE keyer (LC2, PK22, Conoid). Only trust it on design
  // categories — on art prints it misreads catalogue-raisonné codes ("Bb1",
  // "B. 1690") as model codes and collapses an entire print series into one
  // false block (the Picasso "Séries 347" over-merge).
  const isDesignCat = lot.category === 'design' || lot.category === 'object' || lot.category === 'sculpture';
  const model = isDesignCat ? modelKey(lot.title) : null;
  const titleKey = fpTitleKey(lot.title, makerWords);
  const nt = normalizeTitle(lot.title);
  const isUntitled = !nt || nt === 'untitled' || nt.startsWith('untitled ') || nt.length < 4;

  const yb = yearBand(lot.yearNum);
  const band = sizeBand(lot.heightCm, lot.widthCm, lot.depthCm);
  const ed = parseEdition(lot.title);
  const edKey = ed ? `${ed.of}/${ed.total}` : '';

  // ROBUST title identity: count only tokens ≥4 chars. Heavily-accented
  // French auction titles ("Flûtiste", "Célestine") shred into sub-4-char
  // fragments once non-ASCII is normalized away, leaving just a shared series
  // marker ("347") — which false-merges an entire print series into one block.
  // Requiring ≥2 robust tokens rejects those shredded titles.
  const tokenList = titleKey.split(' ').filter(Boolean);
  const robustTokens = tokenList.filter(w => w.length >= 4).length;
  const hasTitleIdentity = !isUntitled && robustTokens >= 2;
  const hasCore = !!model || hasTitleIdentity || !!edKey;
  if (!hasCore) return null;

  // Secondary discriminator rules — a title alone, even robust, is a weak
  // block, so:
  //   • a MODEL code or an EDITION number may block with just a year (they are
  //     production-run identities), but
  //   • a TITLE-ONLY block (no model, no edition) requires a DIMENSION band —
  //     year + title tokens alone still over-merges (a maker reworks the same
  //     subject across a year), whereas a shared physical size pins the object.
  if (!model && !edKey) {
    if (!band) return null;                 // title-only needs real dims
  } else {
    const secondaryCount = [yb, band, edKey].filter(Boolean).length;
    if (secondaryCount === 0) return null;  // model/edition need year|size|edition
  }

  const coreKey = model ? 'm:' + model : 't:' + titleKey;

  return 'a:' + fnv1a([maker, coreKey, yb, band, edKey].join('|'));
}

/* ═══════════════════════════════════════════════════════════════════════════
   2 · extractReference — recover a watch ref/model the pipeline missed.

   Only fires on the five watch makers. Delegates to app/lib/watch-ref.ts (the
   ONE reader, shared with comps.watchKey), in order:

     1. a LABELLED reference — "Ref.", "Ref:", "Réf.", "Reference No." with
        slash/dot suffixes ("5711/1A", "145.022", "311.30.42.30"), Omega case
        prefixes (ST/BA…) and Cartier W-refs
     2. a BARE ref only in the maker's distinctive shape (116500LN, 26240ST,
        5711/1A, 145.022, W51002Q3) and never after a movement / case /
        serial / "No." label — a bare 5–6-digit number is a serial (Sep 28:
        ~2.5K rows had stored "Case No. 68594" / "Movement No. 341662")
     3. the maker's OWN model line (word-bounded; no bare "oyster"/"must")

   Grade / condition / price are never read. A pure metal/quartz description
   with no ref and no model → null (correctly uncontrolled).
   ═══════════════════════════════════════════════════════════════════════════ */

export function extractReference(lot: AuctionLot): string | null {
  const maker = norm(lot.makerSlug ?? lot.artist ?? '');
  return readWatchReference(lot.title, maker);
}

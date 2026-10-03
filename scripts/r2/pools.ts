/**
 * pools.ts — how comp CANDIDATES are partitioned in R2 (writer) and which
 * partitions an ANCHOR lot reads (API). Shared by scripts/emit-r2-index.ts
 * and functions/_lib/comps-api.ts; both sides MUST agree.
 *
 * Every pool function in app/lib/comps.ts filters its candidates itself, so a
 * partition only has to be a SUPERSET of what that function can admit:
 *
 *   compPoolRead / signalWithPool / appraiseLot / makerReferenceBand /
 *   areComparable  — same artist AND same formOf()          → f|artist|form
 *     (watch forms are ~20k rows per maker, so they split: the reference
 *      gate (comparableTo) needs same watchKeyOf → w|artist|form|wk, the
 *      edition path needs same normalizeTitle → t|artist|form|bucket; an
 *      anchor reads BOTH, whose union covers both paths exactly)
 *   soldCompBand    — same artist AND same objectIdentityKey → i|artist|id
 *   scienceReferenceBand — same artist, form ∈ SCI_SLUG_FORMS → f|artist|<each form>
 *   cultureReferenceBand — culture slugs: same cleaned title (tier E) → ct|bucket,
 *                          same itemClass + a shared subject (tier R) → cs|class|subject
 *   provenance      — same repeatSaleGroupId                 → g|id
 *
 * Candidates are SOLD rows with a positive priceUsd (every pool function
 * requires both) — except g| (provenance lists every sale of the object).
 */
import type { AuctionLot } from '../../app/types';
import { classifyForm, normalizeTitle, cleanGoldinTitle, isSportsScienceObject, watchKey } from '../../app/lib/comps';
import { fnv1a } from '../../functions/_lib/format';

// mirrors of comps.ts module constants (not exported there) — keep in step
export const WATCH_FORMS = new Set(['wristwatch', 'pocket-watch']);
export const CULTURE_SLUGS = new Set(['movie-tv', 'music-memorabilia', 'entertainment-memorabilia']);
export const SCI_SLUG_FORMS: Record<string, string[]> = {
  meteorites: ['meteorite'],
  fossils: ['fossil'],
  'scientific-instruments': ['instrument', 'tech'],
  'space-exploration': ['space'],
};
const SPORTS_ID_SLUGS = new Set(['sports-cards', 'game-used', 'trophies-awards', 'tickets-passes', 'sports-memorabilia']);

const TITLE_BUCKETS = 256;
const CULTURE_TITLE_BUCKETS = 1024;

export function formOf(l: AuctionLot): string {
  return (l.formKey as string | undefined) ?? classifyForm(l);
}
function watchKeyOf(l: AuctionLot): string | null {
  return l.reference !== undefined ? (l.reference as string | null) : watchKey(l);
}
/** comps.ts objectIdentityKey, mirrored */
export function identityKeyOf(l: AuctionLot): string | null {
  if (SPORTS_ID_SLUGS.has(l.artist)) return (l as AuctionLot & { playerSlug?: string | null }).playerSlug || null;
  return l.entity ? l.entity.toLowerCase().trim() : null;
}
const enc = (s: string) => s.replace(/\|/g, '/');

function formKeys(l: AuctionLot): string[] {
  const form = formOf(l);
  if (form === 'unknown') return [];
  if (WATCH_FORMS.has(form)) {
    const wk = watchKeyOf(l);
    return [
      `w|${l.artist}|${form}|${enc(wk ?? '-')}`,
      `t|${l.artist}|${form}|${fnv1a(normalizeTitle(l.title)) % TITLE_BUCKETS}`,
    ];
  }
  return [`f|${l.artist}|${form}`];
}

function cultureTitleKey(l: AuctionLot): string {
  return `ct|${fnv1a(normalizeTitle(cleanGoldinTitle(l.title || ''))) % CULTURE_TITLE_BUCKETS}`;
}
function cultureSubjectKeys(l: AuctionLot): string[] {
  const x = l as AuctionLot & { subjectKeys?: string[]; itemClass?: string };
  if (!x.itemClass || !x.subjectKeys?.length) return [];
  return Array.from(new Set(x.subjectKeys)).map(s => `cs|${enc(x.itemClass!)}|${enc(s)}`);
}

export const isCandidate = (l: AuctionLot) => l.status === 'sold' && (l.priceUsd || 0) > 0;

/** WRITER: the maker-book partitions a candidate row belongs to. */
export function bookPartitionsOf(l: AuctionLot): string[] {
  if (!isCandidate(l)) return [];
  const out = formKeys(l);
  if (isSportsScienceObject(l)) {
    const id = identityKeyOf(l);
    if (id) out.push(`i|${l.artist}|${enc(id)}`);
  }
  return out;
}
/** WRITER: the culture-pool partitions (main tier only — the culture band
    pools the served main book, never the archive tier). */
export function culturePartitionsOf(l: AuctionLot): string[] {
  if (!isCandidate(l) || !CULTURE_SLUGS.has(l.artist)) return [];
  return [cultureTitleKey(l), ...cultureSubjectKeys(l)];
}

/** API: the partitions an anchor lot's reads need. */
export function anchorPartitions(lot: AuctionLot): {
  form: string[]; identity: string | null; science: string[]; culture: string[]; group: string | null;
} {
  const form = formKeys(lot);
  const id = isSportsScienceObject(lot) ? identityKeyOf(lot) : null;
  const sciForms = SCI_SLUG_FORMS[lot.artist];
  return {
    form,
    identity: id ? `i|${lot.artist}|${enc(id)}` : null,
    science: sciForms ? sciForms.map(f => `f|${lot.artist}|${f}`) : [],
    culture: CULTURE_SLUGS.has(lot.artist) ? [cultureTitleKey(lot), ...cultureSubjectKeys(lot)] : [],
    group: lot.repeatSaleGroupId ? `g|${enc(String(lot.repeatSaleGroupId))}` : null,
  };
}

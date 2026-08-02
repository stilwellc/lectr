/**
 * ref-path.ts — the path-safe codec for reference keys.
 *
 * refs.json keys are '<maker>:<ref>' (exactly one ':', all lower-case), but
 * 42 of the 613 ref halves contain '/' (Patek slash-suffix references,
 * '3800/1' &c.) and one contains a non-ASCII 'è' ('cartier:panthère' — which
 * coexists with a DISTINCT 'cartier:panthere', so diacritics cannot be
 * stripped). A raw '/' would splinter the [key] segment into extra path
 * segments, and '%2F' percent-escapes are normalized inconsistently by CDNs —
 * so the codec is percent-encoding with '~' (an RFC 3986 unreserved byte that
 * never appears in any key) standing in for '%':
 *
 *   '3800/1'   → '3800~2f1'        'panthère' → 'panth~c3~a8re'
 *
 * Output charset is [a-z0-9~-] — filename-safe for the static export, byte-
 * stable through every proxy. Verified bijective over all 613 keys (zero
 * collisions, zero round-trip failures). Pure strings, no fs — safe to import
 * from client and server alike.
 */

/** '3800/1' → '3800~2f1' — the [key] param / URL segment for a ref half. */
export function encodeRefPath(ref: string): string {
  // keys are already lower-case, so lowering only touches the hex digits
  return encodeURIComponent(ref).replace(/%/g, '~').toLowerCase();
}

/** '3800~2f1' → '3800/1' — back to the refs.json ref half. */
export function decodeRefPath(part: string): string {
  try {
    return decodeURIComponent(part.replace(/~/g, '%'));
  } catch {
    return part; // malformed escape — fall through to the not-found state
  }
}

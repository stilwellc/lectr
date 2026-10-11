/** $6.5K / $18K / $1.2M / $850 — one decimal under $10K so close numbers
    stay distinguishable (formatPrice rounds $6,548 and $7,400 both to $7K).
    THE face formatter (lot-face fmtFace, verdict fmtUsd, priority reasonOf):
    a module of its own so the ranker can print with it without importing
    the verdict (verdict → lanes → priority would be a cycle). */
export function fmtUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 1 : 2)}M`;
  if (n >= 10_000) return `$${Math.round(n / 1000)}K`;
  if (n >= 1_000) return `$${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return `$${Math.round(n).toLocaleString()}`;
}

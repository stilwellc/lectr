/** SIGNED-SIGNAL LAW: the glyph and the ink agree. A rounded 0 is flat —
    no sign, no color; only a real up wears '+' and green, a real down '−'
    and red. Shared by every surface that prints a signed read (sub-market
    rows, the /makers group heads, the entity context, analytics legends). */
export const signedPct = (v: number): string => {
  const r = Math.round(v);
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r)}%`;
};
export const dirOf = (v: number): 'up' | 'down' | undefined => {
  const r = Math.round(v);
  return r > 0 ? 'up' : r < 0 ? 'down' : undefined;
};

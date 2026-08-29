'use client';

/**
 * FigCap — the figure furniture of THE CATALOGUE (light mode only; dark
 * renders nothing and keeps its exact composition). Every serious chart
 * signs itself the way a lab figure does: an auto-numbered FIG. folio in
 * gold ink, then the basis line — what was measured, over what n, from
 * which source. The numbering is a CSS counter scoped to the shell, so
 * figures number themselves in reading order per page.
 */
export default function FigCap({ children }: { children: React.ReactNode }) {
  return (
    <figcaption className="ray-figcap" aria-hidden>
      <span className="ray-figcap-no" />
      <span className="ray-figcap-body">{children}</span>
    </figcaption>
  );
}

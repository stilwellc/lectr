import FigCap from '../FigCap';

/* ── THE EDITORIAL LAYER (blog-scoped) — NORTH STAR magazine grammar
   (docs/NORTHSTAR_UI.md): feature notes open on a designed initial and
   carry one lifted sentence between paragraphs. No serif, no new fonts,
   no new colors — the drop cap is Inter at low weight seated on the
   cream cell-chip plate, the pull is light and tight behind a 2px ink
   rule. Injected via __html per the blog index's convention (raw-text
   <style> children with quotes break hydration on prerendered pages). ── */
const EDITORIAL_CSS = `
/* THE DROP CAP — first letter of the opening paragraph as a large light
   initial on a cream plate with a 1px hairline (the cell-chip voice).
   Impact through lightness: weight 320, never bold, never serif. */
.lectr-dropcap::first-letter{
  float:left;
  font-family:var(--font-sans),sans-serif;
  font-weight:320;
  font-size:58px;
  line-height:1;
  letter-spacing:-0.02em;
  color:var(--color-fg);
  background:var(--color-bg-deep);
  border:1px solid var(--hairline);
  border-radius:10px;
  padding:10px 14px 12px;
  margin:5px 14px 0 0;
}
/* THE PULL — one existing sentence, lifted verbatim between paragraphs:
   Inter 330, tight leading, a 2px ink left rule. Ink only — the lamp
   stays with the market. */
.lectr-pull{
  margin:30px 0 28px;
  padding:2px 0 2px 22px;
  border-left:2px solid var(--color-fg);
  font-family:var(--font-sans),sans-serif;
  font-size:clamp(21px,2.4vw,25px);
  font-weight:330;
  letter-spacing:-0.018em;
  line-height:1.32;
  color:var(--color-fg);
}
/* FIG. duality — FigCap is light-mode furniture (it renders nothing in
   dark), so every plate that adopts the numbered folio keeps a plain
   twin carrying the same words for the dark archive. */
html[data-lectr-light] .lectr-fig-dark{display:none}
/* mobile — the initial drops to two lines tall, the pull runs full width */
@media (max-width:768px){
  .lectr-dropcap::first-letter{font-size:36px;padding:6px 10px 8px;margin:4px 10px 0 0;border-radius:8px}
  .lectr-pull{margin:26px 0 24px;padding-left:16px;font-size:20px}
}
`;

/** One <style> per feature page — the engine post and QuarterInsight both mount it. */
export function EditorialStyle() {
  return <style dangerouslySetInnerHTML={{ __html: EDITORIAL_CSS }} />;
}

/** A key sentence lifted from the prose below/above it — verbatim, never new
 *  copy. aria-hidden: the sentence already exists in the reading order. */
export function PullQuote({ children }: { children: React.ReactNode }) {
  return <aside className="lectr-pull" aria-hidden>{children}</aside>;
}

export { FigCap };

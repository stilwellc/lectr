/**
 * lotpage-css.ts — the catalogue-page stylesheet (moved out of LotPage.tsx,
 * perf wave W27): the entity, ref, book and sub pages print LOTPAGE_CSS for
 * the comp-row ledger grammar, and importing it from LotPage pulled the
 * whole lot page (and what it imports) into their bundles. Pure move.
 */

/* The copy button styles itself (id-guarded head injection, LotCard's
   pattern) — it mounts inside ComparableModal too, where LOTPAGE_CSS never
   renders. Also concatenated into LOTPAGE_CSS so the prerendered flagged
   pages carry it in their first HTML. */
export const COPY_BTN_STYLE_ID = 'lectr-lot-copy-style';
export const COPY_BTN_CSS = `
.lectr-lot-copy{display:inline-flex;align-items:center;gap:7px;background:none;border:1px solid var(--color-butter-deep);color:var(--color-butter-text);border-radius:12px;padding:10px 18px;font-family:var(--font-sans);font-size:13.5px;font-weight:600;letter-spacing:-0.01em;cursor:pointer;transition:background var(--duration-fast) var(--ease-signature),color var(--duration-fast) var(--ease-signature)}
.lectr-lot-copy:hover{background:var(--color-butter-subtle)}
.lectr-lot-copy[data-copied=true]{background:var(--color-butter-subtle);color:var(--color-butter)}
`;

/* The catalogue-page layout. Injected via dangerouslySetInnerHTML — raw-text
   <style> children with quotes break hydration on prerendered pages
   (see RecordBand/ComparableModal); __html serializes raw, deterministic. */
// exported for RefPage, which reuses the comp-row ledger grammar
export const LOTPAGE_CSS = COPY_BTN_CSS + `
.lectr-lot{padding-block:26px 64px}
.lectr-lot-grid{display:grid;grid-template-columns:minmax(0,42%) minmax(0,1fr);column-gap:44px;row-gap:26px;align-items:start}
/* ≥900px the two columns are independent flows: the certificate column
   carries the comps ledger under the leader rows, and provenance / the grade
   ladder ride the plate column — no dead space under the plate, no
   full-width band below the certificate. ≤899px the wrappers dissolve
   (display:contents) and CSS order restores the single-column reading order:
   plate → certificate → provenance → ladder → comps. */
.lectr-lot-cola,.lectr-lot-colb{min-width:0}
/* ≥900px the plate column is STICKY: the certificate + comp ledger run
   2–3× the plate's height, and the column sat empty under the photograph
   for most of the scroll. align-items:start on the grid lets the column
   keep its own height, so sticky rides it down until the row ends. */
@media (min-width:900px){
  .lectr-lot-cola{position:sticky;top:84px;align-self:start}
}
/* the plate head — north star: quiet gray sentence case over a single
   hairline with crop-mark dots at the rule ends (registration grammar);
   the old tracked-uppercase form is retired on this surface */
.lectr-lot-head{position:relative;padding-top:14px;border-top:1px solid var(--hairline);font-size:13.5px;font-weight:400;letter-spacing:0.01em;color:var(--color-text-muted);display:flex;justify-content:space-between;gap:8px 18px;flex-wrap:wrap;margin-bottom:14px}
.lectr-lot-head::before,.lectr-lot-head::after{content:"";position:absolute;top:-2px;width:3px;height:3px;border-radius:50%;background:var(--color-border-mid)}
.lectr-lot-head::before{left:-1.5px}
.lectr-lot-head::after{right:-1.5px}
.lectr-lot-head .no{color:var(--color-text-faint);font-weight:400;font-variant-numeric:tabular-nums}
/* the lot's name goes light-display — authority through lightness */
.lectr-lot-title{font-size:clamp(28px,4vw,42px);font-weight:330;letter-spacing:-0.02em;line-height:1.08;color:var(--color-fg);margin:0 0 6px}
.lectr-lot-medium{font-size:13px;color:var(--color-text-muted);line-height:1.5;margin:2px 0 0}
.lectr-lot-leaders{margin-top:16px;border-top:1px solid var(--hairline);padding-top:4px}
.lectr-lot-row{display:flex;align-items:baseline;gap:10px;padding:10px 0;font-size:13.5px}
.lectr-lot-k{color:var(--color-text-muted)}
.lectr-lot-fill{flex:1;border-bottom:1px dotted var(--color-border-mid);transform:translateY(-3px)}
.lectr-lot-v{font-weight:700;font-variant-numeric:tabular-nums;color:var(--color-fg);white-space:nowrap}
.lectr-lot-v.up{color:var(--color-up)}
.lectr-lot-v.down{color:var(--color-down)}
.lectr-lot-sub{font-size:11px;font-weight:500;color:var(--color-text-muted);margin-right:2px;white-space:nowrap}
.lectr-lot-mono{display:flex;align-items:center;justify-content:center;background:var(--color-bg-elevated)}
.lectr-lot-monorules{position:absolute;top:10px;left:12px;right:12px;height:5px;background:linear-gradient(to bottom,var(--color-fg) 0,var(--color-fg) 2px,transparent 2px,transparent 4px,var(--color-border-mid) 4px,var(--color-border-mid) 5px)}
.lectr-lot-monoglyph{font-size:64px;font-weight:700;color:var(--color-text-faint);letter-spacing:0.02em;line-height:1}
.lectr-lot .ray-plate-mat{padding:18px;margin-bottom:0}
.lectr-lot .ray-plate-img{height:380px;background:var(--color-bg-elevated)}
.lectr-lot .ray-plate-img img{object-fit:contain}
.lectr-lot .ray-plate-cap{margin-top:12px;border-top:1px solid var(--hairline);padding-top:9px;font-size:11px;color:var(--color-text-muted);text-align:left}
.lectr-lot-ctas{display:flex;flex-wrap:wrap;gap:10px;margin-top:20px;padding-top:16px;border-top:1px dotted var(--color-border-mid)}
.lectr-lot-comps{margin-top:44px}
.lectr-lot-comps-head{position:relative;padding-top:9px;border-top:2px dotted var(--hairline);font-size:10.5px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:var(--color-butter-text);display:flex;justify-content:space-between;gap:8px 18px;flex-wrap:wrap}
.lectr-lot-comps-head::before{content:"";position:absolute;top:2px;left:0;right:0;border-top:1px solid var(--hairline)}
.lectr-lot-comps-head .ctx{color:var(--color-text-muted);font-weight:600}
.lectr-lot-comp{display:flex;align-items:center;gap:14px;padding:11px 2px;border-bottom:1px solid var(--hairline-soft);text-decoration:none;color:inherit;transition:background var(--duration-fast) var(--ease-signature)}
.lectr-lot-comp:hover{background:var(--color-hover-item)}
.lectr-lot-comp-i{font-size:12px;color:var(--color-text-faint);font-variant-numeric:tabular-nums;width:18px;text-align:right;flex-shrink:0}
.lectr-lot-comp-thumb{width:40px;height:40px;flex-shrink:0;position:relative;overflow:hidden;border-radius:8px;background:var(--color-bg-elevated);border:1px solid color-mix(in srgb, var(--color-butter) 13%, transparent);display:flex;align-items:center;justify-content:center}
.lectr-lot-comp-thumb span{font-family:var(--font-serif), serif;font-style:normal;font-weight:500;font-size:17px;line-height:1;color:color-mix(in srgb, var(--color-butter) 55%, var(--color-text-faint))}
.lectr-lot-comp-thumb img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.lectr-lot-comp-t{flex:1;min-width:0}
.lectr-lot-comp-title{font-size:13.5px;font-weight:600;color:var(--color-fg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lectr-lot-comp-meta{font-size:11.5px;color:var(--color-text-faint);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lectr-lot-comp-p{font-size:13.5px;font-weight:700;font-variant-numeric:tabular-nums;color:var(--color-fg);flex-shrink:0}
.lectr-lot-quiet{padding:34px 0;text-align:center;color:var(--color-text-faint);font-size:13px}
.lectr-lot-skel-block{background:var(--color-bg-elevated);border-radius:4px}
@media (prefers-reduced-motion: no-preference){
  .lectr-lot-skel-block{animation:lectrLotPulse 1.4s ease-in-out infinite}
  @keyframes lectrLotPulse{0%,100%{opacity:1}50%{opacity:0.45}}
}
.lectr-lot-noimg .ray-plate-img{height:220px}
/* ── NORTH STAR, lot-only additions — every rule below is scoped under
   .lectr-lot (or an -lk/-lval/-read/-shead class only this page renders),
   so the shared comp-ledger grammar Ref/Sub/Player reuse is untouched.
   The .lectr-lot-row/-k/-v/-fill/-sub family above now serves PlayerPage;
   this page's spec rows speak .ns-ledger-row. ── */
.lectr-lot-byline{margin:18px 0 2px}
.lectr-lot .ns-byline .s{font-size:11px;line-height:1.45;color:var(--color-text-faint);margin-top:3px;max-width:230px}
.lectr-lot .lectr-lot-leaders{border-top:none;padding-top:0;margin-top:8px}
.lectr-lot-lk{font-size:13px;color:var(--color-text-muted);flex:none}
.lectr-lot-lval{display:flex;align-items:baseline;justify-content:flex-end;gap:10px;min-width:0;text-align:right}
.lectr-lot-lsub{font-size:11px;font-weight:500;color:var(--color-text-muted);white-space:nowrap}
.lectr-lot-lv{font-size:13.5px;font-weight:600;font-variant-numeric:tabular-nums;color:var(--color-fg);white-space:nowrap}
.lectr-lot-lv.up{color:var(--color-up)}
.lectr-lot-lv.down{color:var(--color-down)}
/* (W23) a long sub WRAPS IN PLACE — the value line ("expected hammer ·
   likely $13K–$32K · from 2 sales of this card & grade in the last year")
   ran nowrap under the label at 1024–1280 and orphaned the figure on its own
   line on a phone. The sub takes the room left between label and figure and
   wraps there (same 11px); the figure never wraps away from it. */
.lectr-lot .ns-ledger-row>.lectr-lot-lval{flex:0 1 auto}
.lectr-lot-lsub{white-space:normal;min-width:0;text-wrap:pretty}
.lectr-lot-lv{flex:none}
/* the read as color — compact ns-cell-color face; ground = the signal */
.lectr-lot-read{min-height:0;padding:20px 22px;border-radius:16px;margin:18px 0 4px}
.lectr-lot-read-stat{font-family:var(--font-mono),monospace;font-size:clamp(30px,3.2vw,40px);font-weight:500;letter-spacing:-0.02em;line-height:1;font-variant-numeric:tabular-nums;margin:10px 0 8px}
.lectr-lot-read .ns-cell-label{font-size:13px}
.lectr-lot-read .ns-cell-body{font-size:13px;font-weight:450;line-height:1.5;max-width:40ch}
/* section heads — quiet kicker + light headline on a registration plate */
.lectr-lot-shead{display:flex;justify-content:space-between;align-items:flex-end;gap:8px 18px;flex-wrap:wrap;padding-top:14px}
.lectr-lot-shead .ns-kicker{margin-bottom:4px}
.lectr-lot-h2{font-size:clamp(19px,2.2vw,23px);font-weight:350;letter-spacing:-0.02em;line-height:1.15;color:var(--color-fg);margin:0}
.lectr-lot-shctx{font-size:11.5px;color:var(--color-text-faint);padding-bottom:2px}
.lectr-lot .lectr-lot-comp{border-bottom:1px dotted var(--color-border-mid)}
/* (W29) the engine's other works, after the comparables — the section's own kicker */
.lectr-lot-ow{padding-top:22px}
.lectr-lot-ow:first-child{padding-top:10px}
.lectr-lot-ow .ns-kicker{margin-bottom:2px}
.lectr-lot .lectr-lot-note{padding:14px 16px;margin-top:14px}
/* (W11) the head's catalogue id holds one line (a Goldin uuid ran two) */
.lectr-lot-cert .lectr-lot-head{flex-wrap:nowrap}
.lectr-lot-cert .lectr-lot-head>span:first-child{flex:none;max-width:70%}
.lectr-lot-head .no{min-width:0;flex:0 1 auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* (W11) the decision line, at the certificate's reading size — the feed's
   mono price-line grammar (DecisionLine), one step up */
.lectr-lot-decision{margin:18px 0 0}
.lectr-lot-decision .ray-feedrow-price{margin-top:0;font-size:12.5px;color:var(--color-text-muted);row-gap:4px}
.lectr-lot-decision .ray-feedrow-price b{font-size:15px}
.lectr-lot-cert .lectr-lot-decision + .lectr-lot-ctas{margin-top:14px}
.lectr-lot-cert .lectr-lot-ctas{gap:8px}
/* a catalogue sentence in the title field (RR runs 120 characters) steps down a size so the decision stays on the first screen */
.lectr-lot-title.lectr-lot-title-long{font-size:clamp(23px,2.6vw,30px);line-height:1.15}
.lectr-lot-cert .lectr-lot-byline + .lectr-lot-ctas{border-top:none;padding-top:0;margin-top:18px}
.lectr-lot-cert .lectr-lot-ctas + .lectr-lot-leaders{margin-top:14px}
/* the quiet "more" under a paper-trail section (ladder fold, dossier link) */
.lectr-lot-more{display:inline-flex;align-items:center;gap:4px;margin-top:10px;padding:4px 0;background:none;border:none;font:inherit;font-size:12.5px;font-weight:500;color:var(--color-butter-text);cursor:pointer;text-decoration:underline;text-underline-offset:3px}
.lectr-lot-comp[aria-current] .lectr-lot-comp-title{color:var(--color-fg)}
.lectr-lot-comp[aria-current]{background:var(--color-hover-item)}
@media (max-width:899px){
  .lectr-lot{padding-block-start:14px}
  .lectr-lot-grid{grid-template-columns:minmax(0,1fr)}
  .lectr-lot-cola,.lectr-lot-colb{display:contents}
  /* dissolved wrappers make the sections grid items — kill the auto
     min-content floor or a nowrap comp title widens the page */
  .lectr-lot-grid>*{min-width:0}
  .lectr-lot-cola>.ray-plate-mat{order:1}
  .lectr-lot-cert{order:2}
  .lectr-lot-prov,.lectr-lot-record{order:3}
  .lectr-lot-ladder{order:4}
  .lectr-lot-pool{order:5}
  /* inside the grid the 26px row-gap already separates the sections — trim
     the section margin so the total stays the original 44px */
  .lectr-lot-grid .lectr-lot-comps{margin-top:18px}
  .lectr-lot .ray-plate-img{height:210px}
  .lectr-lot-noimg .ray-plate-img{height:160px}
  .lectr-lot-monoglyph{font-size:44px}
  /* narrow screens: subs wrap, rows may stack, values ellipsize — the
     desktop nowrap pair otherwise forces a >390px page render */
  .lectr-lot-row{flex-wrap:wrap}
  .lectr-lot-sub{white-space:normal}
  .lectr-lot-v{max-width:100%;overflow:hidden;text-overflow:ellipsis}
  /* north-star rows: same wrap doctrine on the new ledger grammar — the
     sub wraps beside its figure (W23), the figure ellipsizes before it
     ever pushes the page wide */
  .lectr-lot-lv{max-width:100%;overflow:hidden;text-overflow:ellipsis}
  .lectr-lot .ns-byline .s{max-width:100%}
  .lectr-lot-read-stat{font-size:30px}
}
/* tablet band only — under 641px the byline rides the global 2-up grid
   and its own gap rhythm; this flex-era tightening must not override it */
@media (min-width:641px) and (max-width:899px){
  .lectr-lot .ns-byline{gap:8px 28px}
}
/* (W23) phone: a row with a sentence-long sub reads label + figure on one
   line and the sub under them as its caption — never the figure alone on a
   third line */
@media (max-width:640px){
  .lectr-lot .ns-ledger-row.lectr-lot-lrow-long{display:grid;grid-template-columns:auto minmax(0,1fr);column-gap:16px;row-gap:3px;align-items:baseline}
  .lectr-lot-lrow-long>.lectr-lot-lval{display:contents}
  .lectr-lot-lrow-long .lectr-lot-lv{grid-column:2;grid-row:1;justify-self:end}
  .lectr-lot-lrow-long .lectr-lot-lsub{grid-column:1/-1;grid-row:2;margin:0}
}
`;

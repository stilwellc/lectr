/**
 * first-paint-gate.ts — the inline gate a first-paint copy carries (perf
 * wave W27; the contract is app/lib/first-paint.ts). Read only at build time
 * (scripts/first-paint-postbuild.ts) and by the tests — never bundled.
 */
import { FP_VIEWPORTS } from './first-paint';

/** IANA aliases a reader's browser may name, read as the zone they share
 *  every offset and abbreviation with */
export const FP_ZONE_ALIAS: Record<string, string> = {
  'America/Detroit': 'America/New_York', 'America/Toronto': 'America/New_York',
  'America/Indiana/Indianapolis': 'America/New_York', 'America/Kentucky/Louisville': 'America/New_York',
  'US/Eastern': 'America/New_York', 'US/Central': 'America/Chicago', 'US/Mountain': 'America/Denver',
  'US/Pacific': 'America/Los_Angeles', 'US/Arizona': 'America/Phoenix', 'America/Winnipeg': 'America/Chicago',
  'America/Edmonton': 'America/Denver', 'America/Boise': 'America/Denver', 'America/Vancouver': 'America/Los_Angeles',
  'Etc/UTC': 'UTC', 'Etc/GMT': 'UTC', 'GMT': 'UTC', 'Universal': 'UTC', 'Zulu': 'UTC',
};
/** device storage a fresh reader may carry without changing a first screen
 *  (the theme is CSS-only) */
export const FP_STORAGE_OK = ['lectr-dark', 'costil-theme', 'mobi-theme'];
/** URL params that never change a page's view */
export const FP_PARAMS_OK = ['light', 'nogreet', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'ref', 'fbclid', 'gclid'];

/**
 * The slot kinds, as the gate computes them (plain ES5 — this source is
 * inlined into the gate verbatim). '' = this clock prints no such phrase:
 * the copy is not the page's any more, and the gate drops it.
 *
 *   r|<closeMs>|<timed 0/1>|<saleDate>   priority.reasonOf's timing part
 */
export const FP_SLOT_JS = `function(p,n){var k=p[0];if(k==='r'){var c=+p[1],h;if(p[2]==='0'&&p[3]){var t=new Date(n),d=Math.round((Date.parse(p[3].slice(0,10)+'T00:00:00Z')-Date.UTC(t.getFullYear(),t.getMonth(),t.getDate()))/864e5);return d===0?'Sells today':d===1?'Sells tomorrow':d>1&&d<=14?'Sells in '+d+' days':''}h=(c-n)/36e5;return h>0&&h<1?'Closes within the hour':h>0&&h<24?'Closes in '+Math.round(h)+'h':h>0&&h<48?'Closes tomorrow':h>0&&h<360?'Closes in '+Math.round(h/24)+' days':''}return ''}`;

/**
 * The gate — runs inline, as the parser reaches the end of the copy, so the
 * decision lands before the copy can paint. ONE constant body (its sha256 is
 * in public/_headers' script-src); everything per page rides data-attributes
 * on the island: data-z (zone → last proved ms), data-t0, data-loc.
 */
export const FP_GATE_JS = `(function(){var s=document.currentScript,f=s&&s.parentNode;if(!f)return;var ok=false;try{var Z=JSON.parse(f.getAttribute('data-z')||'{}'),A=${JSON.stringify(FP_ZONE_ALIAS)},z=Intl.DateTimeFormat().resolvedOptions().timeZone,u=Z[A[z]||z],n=Date.now(),i,k,w,K=${JSON.stringify(FP_STORAGE_OK)},P=${JSON.stringify(FP_PARAMS_OK)},q=new URLSearchParams(location.search),S=${FP_SLOT_JS},v=matchMedia('${FP_VIEWPORTS.m}').matches?'m':matchMedia('${FP_VIEWPORTS.d}').matches?'d':'';ok=!!u&&!!v&&n>=+f.getAttribute('data-t0')&&n<=u&&new Intl.NumberFormat().resolvedOptions().locale===f.getAttribute('data-loc')&&!(navigator.serviceWorker&&navigator.serviceWorker.controller)&&!sessionStorage.length;for(i=0;ok&&i<localStorage.length;i++)if(K.indexOf(localStorage.key(i))<0)ok=false;q.forEach(function(x,y){if(P.indexOf(y)<0)ok=false});if(ok){k=f.querySelectorAll(':scope>[data-v]');for(i=0;i<k.length;i++)if(k[i].getAttribute('data-v')!==v)f.removeChild(k[i]);k=f.querySelectorAll('[data-fpr]');for(i=0;ok&&i<k.length;i++){w=S(k[i].getAttribute('data-fpr').split('|'),n);if(w)k[i].textContent=w;else ok=false}}if(ok)f.removeAttribute('hidden')}catch(e){ok=false}if(!ok)f.textContent=''})();`;

/** the island's own CSS (inside the copy, so a dropped copy takes it along):
 *  the wrappers are layout-transparent, and a shown copy hides the loading
 *  line the page renders right after it */
export const FP_CSS = `[data-fsi]:not([hidden]),[data-fsi]>[data-v]{display:contents}[data-fsi]:not([hidden])+*{display:none!important}`;


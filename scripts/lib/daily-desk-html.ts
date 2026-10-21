/**
 * daily-desk-html — render THE DAILY DESK model as an email (HTML + text).
 * Email-client law: tables, inline styles, no web fonts required (Inter
 * first, system sans after), images with fixed width/height and alt, no JS,
 * no CSS the clients strip. Color stays the market's (green under, red over).
 */
import type { DeskEmail, DeskItem, PickItem, ResultItem } from './daily-desk';

const INK = '#1A1714', MUTED = '#6F6A63', FAINT = '#A39E96', LINE = '#EBE8E4', BG = '#F5F3F1', CARD = '#FDFCFC';
const UP = '#0F7C43', DOWN = '#C13E2C';
const FONT = `Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif`;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const lotUrl = (origin: string, id: string) => `${origin}/lot?id=${encodeURIComponent(id)}&utm_source=daily-desk&utm_medium=email`;

function pill(text: string, dir: 'up' | 'down' | 'ink') {
  const bg = dir === 'up' ? UP : dir === 'down' ? DOWN : INK;
  return `<span style="display:inline-block;padding:3px 9px;border-radius:999px;background:${bg};color:#fff;font:500 12px/1.2 ${FONT};white-space:nowrap">${esc(text)}</span>`;
}
function photo(img: string | null, alt: string, size = 72) {
  if (!img) return `<div style="width:${size}px;height:${size}px;border-radius:12px;background:${LINE}"></div>`;
  return `<img src="${esc(img)}" width="${size}" height="${size}" alt="${esc(alt)}" style="display:block;width:${size}px;height:${size}px;border-radius:12px;object-fit:cover;background:${LINE};border:0">`;
}
function section(title: string, body: string) {
  return `<tr><td style="padding:26px 0 6px;font:500 13px/1.3 ${FONT};color:${MUTED}">${esc(title)}</td></tr>
<tr><td style="border-top:1px solid ${LINE}"></td></tr>${body}`;
}
function row(origin: string, i: DeskItem | PickItem, extra = '') {
  const meta = [i.maker, i.house, i.est].filter(Boolean).join(' · ');
  const chips = [
    i.when ? `<span style="font:600 12.5px/1.3 ${FONT};color:${INK}">${esc(i.when)}</span>` : '',
    i.sig ? pill(i.sig.text, i.sig.dir) : '',
    i.over ? pill(`bid ${i.bid} passed your max`, 'down') : i.max ? `<span style="font:500 12.5px/1.3 ${FONT};color:${MUTED}">your max ${esc(i.max)}</span>` : '',
  ].filter(Boolean).join('&nbsp;&nbsp;');
  return `<tr><td style="padding:14px 0;border-bottom:1px solid ${LINE}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td width="72" valign="top"><a href="${lotUrl(origin, i.id)}">${photo(i.img, i.title)}</a></td>
<td valign="top" style="padding-left:14px">
<a href="${lotUrl(origin, i.id)}" style="font:500 15px/1.35 ${FONT};color:${INK};text-decoration:none">${esc(i.title)}</a>
<div style="font:400 13px/1.45 ${FONT};color:${MUTED};padding-top:3px">${esc(meta)}</div>
${chips ? `<div style="padding-top:7px">${chips}</div>` : ''}${extra}
</td></tr></table></td></tr>`;
}
function resultRow(origin: string, r: ResultItem) {
  const tone = r.inReach == null ? 'ink' : r.inReach ? 'up' : 'down';
  return `<tr><td style="padding:14px 0;border-bottom:1px solid ${LINE}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td width="72" valign="top"><a href="${lotUrl(origin, r.id)}">${photo(r.img, r.title)}</a></td>
<td valign="top" style="padding-left:14px">
<a href="${lotUrl(origin, r.id)}" style="font:500 15px/1.35 ${FONT};color:${INK};text-decoration:none">${esc(r.title)}</a>
<div style="font:400 13px/1.45 ${FONT};color:${MUTED};padding-top:3px">${esc(r.house)} · hammered <b style="color:${INK}">${esc(r.hammer)}</b>${r.vsEst ? ` · ${esc(r.vsEst)}` : ''}</div>
${r.vsMax ? `<div style="padding-top:7px">${pill(r.inReach ? `in reach · ${r.vsMax}` : `past you · ${r.vsMax}`, tone)}</div>` : ''}
<div style="padding-top:8px"><a href="${origin}/profile#settled" style="font:500 13px/1.3 ${FONT};color:${INK}">Did you win it? Mark it on your desk →</a></div>
</td></tr></table></td></tr>`;
}

export function renderDesk(e: DeskEmail, o: { origin: string; unsubUrl: string; dateLabel: string }): { html: string; text: string } {
  const { origin } = o;
  const body = [
    e.overMax.length ? section('Bids past your max', e.overMax.map(i => row(origin, i)).join('')) : '',
    e.closing.length ? section('Closing soon', e.closing.map(i => row(origin, i)).join('')) : '',
    e.results.length ? section('Your results', e.results.map(r => resultRow(origin, r)).join('')) : '',
    e.below.length ? section('Below market on your watchlist', e.below.map(i => row(origin, i)).join('')) : '',
    e.picks.length ? section('For you', e.picks.map(i => row(origin, i, `<div style="font:400 12.5px/1.45 ${FONT};color:${MUTED};padding-top:6px">${esc(i.note)}</div>`)).join('')) : '',
  ].join('');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${esc(e.subject)}</title></head>
<body style="margin:0;padding:0;background:${BG}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(e.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:${CARD};border-radius:16px">
<tr><td style="padding:28px 28px 8px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="font:400 13px/1.3 ${FONT};color:${MUTED}">lectr · your desk · ${esc(o.dateLabel)}</td></tr>
<tr><td style="padding-top:10px;font:300 30px/1.15 ${FONT};color:${INK};letter-spacing:-0.02em">${esc(e.headline)}</td></tr>
${e.preheader ? `<tr><td style="padding-top:8px;font:400 14px/1.5 ${FONT};color:${MUTED}">${esc(e.preheader)}</td></tr>` : ''}
${body}
<tr><td style="padding:28px 0 6px" align="left"><a href="${origin}/profile?utm_source=daily-desk&utm_medium=email" style="display:inline-block;padding:12px 20px;border-radius:999px;background:${INK};color:#fff;font:500 14px/1 ${FONT};text-decoration:none">Open your desk</a></td></tr>
</table></td></tr>
<tr><td style="padding:18px 28px 26px;font:400 12px/1.6 ${FONT};color:${FAINT};border-top:1px solid ${LINE}">
You get this because you turned on the Daily Desk email on lectr. Figures are lectr&rsquo;s reads from public auction data, not appraisals.<br>
<a href="${esc(o.unsubUrl)}" style="color:${MUTED}">Unsubscribe</a> · <a href="${origin}/profile#account" style="color:${MUTED}">Email settings</a>
</td></tr></table></td></tr></table></body></html>`;

  const t: string[] = [`lectr · your desk · ${o.dateLabel}`, '', e.headline, e.preheader, ''];
  const lines = (title: string, items: (DeskItem | PickItem)[]) => {
    if (!items.length) return;
    t.push(title.toUpperCase());
    for (const i of items) t.push(`- ${i.title}${i.when ? ` (${i.when})` : ''}${i.sig ? ` · ${i.sig.text}` : ''}${i.over ? ` · bid ${i.bid} passed your max` : i.max ? ` · your max ${i.max}` : ''}\n  ${lotUrl(origin, i.id)}`);
    t.push('');
  };
  lines('Bids past your max', e.overMax);
  lines('Closing soon', e.closing);
  if (e.results.length) {
    t.push('YOUR RESULTS');
    for (const r of e.results) t.push(`- ${r.title} · hammered ${r.hammer}${r.vsMax ? ` · ${r.vsMax}` : ''}\n  ${lotUrl(origin, r.id)}`);
    t.push('');
  }
  lines('Below market on your watchlist', e.below);
  lines('For you', e.picks);
  t.push(`Open your desk: ${origin}/profile`, '', `Unsubscribe: ${o.unsubUrl}`);
  return { html, text: t.join('\n') };
}

/**
 * daily-desk-html — render THE DAILY DESK model as an email (HTML + text).
 * Email-client law: tables, inline styles (Gmail strips <style>), no web
 * fonts required (Inter first, system sans after), images with fixed
 * width/height and alt, no JS. A 600px card that reads on a 390px phone:
 * every row is one table, every strip wraps or shrinks, nothing is fixed
 * wider than 72px. Color stays the market's (green under, red over); the
 * chrome is the north star's — eggshell ground, hairlines, dotted ledgers,
 * pills, sentence case, lightness over boldness (docs/NORTHSTAR_UI.md).
 */
import { SEND_HOUR, type DeskEmail, type DeskItem, type DeskRow, type PickItem, type ResultItem, type CollectionItem, type WeekCalendar, type NameLine, type MarketLine } from './daily-desk';

const INK = '#1C1917', MUTED = '#777169', FAINT = '#A59F97', LINE = '#EBE8E4', BG = '#F5F3F1', CARD = '#FDFCFC', WELL = '#F5F3F1';
const UP = '#0F7C43', DOWN = '#C13E2C';
const FONT = `Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif`;
const UTM = 'utm_source=daily-desk&utm_medium=email';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const lotUrl = (origin: string, id: string) => `${origin}/lot?id=${encodeURIComponent(id)}&${UTM}`;
/** a lectr page with the email's utm, the query ahead of any #anchor (a "/profile#results?utm=…" link lost its anchor) */
const pageUrl = (origin: string, path: string) => { const i = path.indexOf('#'); const p = i < 0 ? path : path.slice(0, i), h = i < 0 ? '' : path.slice(i); return `${origin}${p}${p.includes('?') ? '&' : '?'}${UTM}${h}`; };
const n2 = (n: number) => n.toLocaleString('en-US');

/** a lamp pill: a solid background (never a gradient or a variable, so a dark-mode client has nothing to
 *  invert past the ink), white text, a radius Outlook drops to a square — fine */
function pill(text: string, dir: 'up' | 'down' | 'ink') {
  const bg = dir === 'up' ? UP : dir === 'down' ? DOWN : INK;
  return `<span style="display:inline-block;padding:3px 9px;border-radius:999px;background:${bg};background-color:${bg};color:#ffffff;font:500 12px/1.2 ${FONT};mso-line-height-rule:exactly;white-space:nowrap">${esc(text)}</span>`;
}
const quiet = (text: string) => `<span style="font:400 12.5px/1.3 ${FONT};color:${MUTED}">${esc(text)}</span>`;
const strong = (text: string) => `<span style="font:600 12.5px/1.3 ${FONT};color:${INK}">${esc(text)}</span>`;
function photo(img: string | null, alt: string, size = 64) {
  // no photo: the lot's initial on a tile (the desk's Thumb fallback), never a blank box
  if (!img) return `<div style="width:${size}px;height:${size}px;border-radius:12px;background:${LINE};color:${FAINT};font:300 ${Math.round(size * 0.42)}px/${size}px ${FONT};text-align:center">${esc((alt.trim()[0] || '·').toUpperCase())}</div>`;
  return `<img src="${esc(img)}" width="${size}" height="${size}" alt="${esc(alt)}" border="0" style="display:block;width:${size}px;height:${size}px;border-radius:12px;object-fit:cover;background:${LINE};border:0">`;
}
/** a section: a quiet sentence-case title over a hairline, an optional sub-line, then its body */
function section(title: string, body: string, sub?: string | null) {
  return `<tr><td style="padding:30px 0 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="padding:0 0 8px;font:500 15px/1.3 ${FONT};color:${INK};letter-spacing:-0.01em">${esc(title)}</td></tr>
<tr><td style="border-top:1px solid ${INK}"></td></tr>
${sub ? `<tr><td style="padding:8px 0 0;font:400 12.5px/1.5 ${FONT};color:${MUTED}">${sub}</td></tr>` : ''}
${body}</table></td></tr>`;
}
/** a quiet group label inside a section (needs-you's three kinds, the picks' lanes) */
const group = (label: string) => `<tr><td style="padding:16px 0 2px;font:400 13px/1.3 ${FONT};color:${MUTED}">${esc(label)}</td></tr>`;
const empty = (text: string) => `<tr><td style="padding:14px 0 4px;font:400 14px/1.5 ${FONT};color:${MUTED}">${esc(text)}</td></tr>`;
const more = (origin: string, text: string, path: string) => `<tr><td style="padding:12px 0 0"><a href="${pageUrl(origin, path)}" style="font:500 13px/1.3 ${FONT};color:${INK};text-decoration:none">${esc(text)} →</a></td></tr>`;

/** a lot row: photo · title · meta · a line of facts · chips */
function row(origin: string, i: DeskItem | PickItem | DeskRow, o: { facts?: string[]; note?: string | null; chips?: string[] } = {}) {
  const meta = [i.maker, i.house, i.est].filter(Boolean).join(' · ');
  const chips = (o.chips ?? [
    i.when ? strong(i.when) : '',
    i.sig ? pill(i.sig.text, i.sig.dir) : '',
    i.over ? pill(`bid ${i.bid} passed your max`, 'down') : i.max ? quiet(`your max ${i.max}`) : '',
  ]).filter(Boolean).join('&nbsp;&nbsp;');
  const facts = (o.facts || []).filter(Boolean).join(' · ');
  return `<tr><td style="padding:14px 0;border-bottom:1px solid ${LINE}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td width="64" valign="top"><a href="${lotUrl(origin, i.id)}" style="text-decoration:none">${photo(i.img, i.title)}</a></td>
<td valign="top" style="padding-left:14px">
<a href="${lotUrl(origin, i.id)}" style="font:500 15px/1.35 ${FONT};color:${INK};text-decoration:none">${esc(i.title)}</a>
<div style="font:400 13px/1.45 ${FONT};color:${MUTED};padding-top:3px">${esc(meta)}</div>
${facts ? `<div style="font:400 13px/1.45 ${FONT};color:${INK};padding-top:4px">${esc(facts)}</div>` : ''}
${chips ? `<div style="padding-top:7px">${chips}</div>` : ''}
${o.note ? `<div style="font:400 12.5px/1.45 ${FONT};color:${MUTED};padding-top:6px">${esc(o.note)}</div>` : ''}
</td></tr></table></td></tr>`;
}
function deskRow(origin: string, r: DeskRow) {
  const roomTone = r.room == null ? '' : r.over ? pill(r.room, 'down') : quiet(r.room);
  // a bid-auction lot's meta line already says "$1.6K bid · 43 bids" (formatEstimate); say it once
  const bidSaid = /\bbid\b/.test(r.est);
  return row(origin, r, {
    facts: [bidSaid ? '' : [r.bid ? `bid ${r.bid}` : '', r.bids || ''].filter(Boolean).join(' · '), r.moved || ''],
    chips: [r.when ? strong(r.when) : '', r.sig ? pill(r.sig.text, r.sig.dir) : '', roomTone],
  });
}
function resultRow(origin: string, r: ResultItem) {
  const tone = r.inReach == null ? 'ink' : r.inReach ? 'up' : 'down';
  return `<tr><td style="padding:14px 0;border-bottom:1px solid ${LINE}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td width="64" valign="top"><a href="${lotUrl(origin, r.id)}" style="text-decoration:none">${photo(r.img, r.title)}</a></td>
<td valign="top" style="padding-left:14px">
<a href="${lotUrl(origin, r.id)}" style="font:500 15px/1.35 ${FONT};color:${INK};text-decoration:none">${esc(r.title)}</a>
<div style="font:400 13px/1.45 ${FONT};color:${MUTED};padding-top:3px">${esc(r.house)} · hammered <b style="color:${INK};font-weight:600">${esc(r.hammer)}</b>${r.vsEst ? ` · ${esc(r.vsEst)}` : ''}</div>
${r.vsMax ? `<div style="padding-top:7px">${pill(r.inReach ? `in reach · ${r.vsMax}` : `past you · ${r.vsMax}`, tone)}</div>` : ''}
<div style="padding-top:8px"><a href="${pageUrl(origin, '/profile')}#results" style="font:500 13px/1.3 ${FONT};color:${INK}">Did you win it? Mark it on your desk →</a></div>
</td></tr></table></td></tr>`;
}

/** an owned piece: photo · title · maker · bought $X · the maker's latest hammer (linked) */
function collectionRow(origin: string, c: CollectionItem) {
  const meta = [c.maker, c.house, c.paid ? `bought ${c.paid}` : null].filter(Boolean).join(' · ');
  const latest = c.latest
    ? `<div style="font:400 13px/1.45 ${FONT};color:${INK};padding-top:4px">${esc(c.maker ? `${c.maker}’s` : 'The maker’s')} latest hammer <b style="font-weight:600">${esc(c.latest.hammer)}</b> · <a href="${lotUrl(origin, c.latest.id)}" style="color:${MUTED};text-decoration:none">${esc(c.latest.day)} at ${esc(c.latest.house)}</a></div>`
    : '';
  return `<tr><td style="padding:14px 0;border-bottom:1px solid ${LINE}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td width="64" valign="top"><a href="${lotUrl(origin, c.id)}" style="text-decoration:none">${photo(c.img, c.title)}</a></td>
<td valign="top" style="padding-left:14px">
<a href="${lotUrl(origin, c.id)}" style="font:500 15px/1.35 ${FONT};color:${INK};text-decoration:none">${esc(c.title)}</a>
${meta ? `<div style="font:400 13px/1.45 ${FONT};color:${MUTED};padding-top:3px">${esc(meta)}</div>` : ''}
${latest}
</td></tr></table></td></tr>`;
}

/** THE GLANCE — four figures as a 2×2 of hairline-parted cells (the desk's
 *  cockpit). Two rows always: a four-across strip was cramped at 390px and
 *  Gmail strips the media queries that would have folded it. */
function glance(origin: string, g: DeskEmail['glance']) {
  const cell = (k: string, v: string, b: string, href: string, first: boolean) =>
    `<td valign="top" width="50%" style="padding:12px ${first ? '14px 12px 0' : '0 12px 14px'};${first ? '' : `border-left:1px solid ${LINE}`}">
<div style="font:400 12px/1.3 ${FONT};color:${MUTED};white-space:nowrap">${esc(k)}</div>
<a href="${href}" style="display:block;padding-top:4px;font:300 26px/1.1 ${FONT};color:${INK};letter-spacing:-0.02em;text-decoration:none">${esc(v)}</a>
<div style="padding-top:4px;font:400 12px/1.4 ${FONT};color:${MUTED}">${b}</div></td>`;
  const desk = pageUrl(origin, '/profile');
  const nextHref = g.next ? lotUrl(origin, g.next.id) : `${desk}#tab-watching`;
  // the next-hammer lot already printed under needs-you: its clock, not a third mention of the title
  const nextLine = g.next
    ? `${g.next.time ? `<b style="color:${INK};font-weight:500">${esc(g.next.time)}</b> · ` : ''}${g.next.above ? 'first under Needs you' : esc(g.next.title)}`
    : 'no watch on a clock';
  return `<tr><td style="padding:18px 0 4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${LINE};border-bottom:1px solid ${LINE}">
<tr>${cell('Watching', n2(g.watching), g.est ? `${esc(g.est)} at estimate midpoint${g.estBasis ? ` · ${esc(g.estBasis)}` : ''}` : g.watching ? 'live lots' : 'nothing live', `${desk}#tab-watching`, true)}${cell('Next hammer', g.next ? g.next.when : '—', nextLine, nextHref, false)}</tr>
<tr><td colspan="2" style="border-top:1px solid ${LINE};font-size:0;line-height:0">&nbsp;</td></tr>
<tr>${cell('This week', n2(g.week), g.week ? `${n2(g.weekWatches)} ${g.weekWatches === 1 ? 'watch' : 'watches'} + ${n2(g.weekPicks)} ${g.weekPicks === 1 ? 'pick' : 'picks'} closing` : 'nothing of yours closing', `${desk}#tab-week`, true)}${cell('Picks', n2(g.picks), g.picks ? 'for you' : 'none today', `${desk}#tab-for-you`, false)}</tr>
</table></td></tr>`;
}

/** THE WEEK — seven day columns: yours (watches + picks) large, your names' lots small; today on a cream well */
function calendar(origin: string, w: WeekCalendar) {
  const cells = w.days.map(d => {
    const yours = d.watches + d.picks;
    // seven cells share ~330px on a phone: short words, no wrapping, the names count as "89 n."
    return `<td valign="top" width="14%" style="padding:10px 0;text-align:center;white-space:nowrap;${d.today ? `background:${WELL};border-radius:10px;` : ''}">
<div style="font:500 12px/1.3 ${FONT};color:${d.today ? INK : MUTED}">${esc(d.today ? 'Today' : d.dow)}</div>
<div style="font:400 10.5px/1.3 ${FONT};color:${FAINT}">${esc(d.date.replace(/^(\w{3})\w* /, '$1 '))}</div>
<div style="padding-top:6px;font:300 24px/1.1 ${FONT};color:${yours ? INK : LINE};letter-spacing:-0.02em">${yours || '·'}</div>
<div style="padding-top:3px;font:400 10.5px/1.3 ${FONT};color:${d.names ? MUTED : 'transparent'}">${d.names ? `${n2(d.names)} n.` : '–'}</div>
</td>`;
  }).join('');
  const sub = w.watches + w.picks + w.names
    ? `${n2(w.watches)} ${w.watches === 1 ? 'watch' : 'watches'} · ${n2(w.picks)} ${w.picks === 1 ? 'pick' : 'picks'} · ${n2(w.names)} by your names — the large figure is yours (watches + picks), “n.” your names’ lots`
    : 'nothing of yours or your names’ closes in the next seven days';
  return section('Closing this week', `<tr><td style="padding:12px 0 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${cells}</tr></table></td></tr>${more(origin, 'Your week on the desk', '/profile#tab-week')}`, sub);
}

/** YOUR NAMES — a dotted ledger: name · live · soonest, then the last hammer */
function namesLedger(origin: string, names: NameLine[], quiet: string[]) {
  const rows = names.map(n => {
    const live = n.live
      ? `<b style="color:${INK};font-weight:500">${n2(n.live)} live</b>${n.soonest ? ` · soonest ${esc(n.soonest.when)} at ${esc(n.soonest.house)}` : ''}`
      : 'nothing live';
    const last = n.last
      ? `Last hammer <b style="color:${INK};font-weight:500">${esc(n.last.hammer)}</b> · ${esc(n.last.day)} at ${esc(n.last.house)} · <a href="${lotUrl(origin, n.last.id)}" style="color:${MUTED}">${esc(n.last.title)}</a>`
      : n.note ? esc(n.note) : 'no settled sale on file';
    return `<tr><td style="padding:11px 0;border-bottom:1px dotted #D7D2CC">
<div style="font:400 14px/1.4 ${FONT};color:${MUTED}"><a href="${pageUrl(origin, n.href)}" style="font-weight:500;color:${INK};text-decoration:none">${esc(n.label)}</a>&nbsp; ${live}</div>
<div style="font:400 12.5px/1.5 ${FONT};color:${MUTED};padding-top:2px">${last}</div></td></tr>`;
  }).join('');
  const quietLine = quiet.length
    ? `<tr><td style="padding:11px 0;border-bottom:1px dotted #D7D2CC;font:400 13px/1.5 ${FONT};color:${MUTED}">${names.length ? `${n2(quiet.length)} more ${quiet.length === 1 ? 'name' : 'names'} with nothing live` : `Nothing live for your ${n2(quiet.length)} ${quiet.length === 1 ? 'name' : 'names'}`}: ${esc(quiet.join(', '))}</td></tr>`
    : '';
  return section('Your names', rows + quietLine + more(origin, 'Every name you follow', '/profile#names'), `${n2(names.length + quiet.length)} followed · ${n2(names.length)} with lots on the block · the last hammer is the newest settled sale on file`);
}

/** THE MARKET — one dotted ledger line per fact, each linked into lectr */
function marketLedger(origin: string, lines: MarketLine[]) {
  const rows = lines.map(m => `<tr><td style="padding:11px 0;border-bottom:1px dotted #D7D2CC">
<a href="${pageUrl(origin, m.href)}" style="text-decoration:none"><div style="font:400 14px/1.4 ${FONT};color:${INK}">${m.strong ? `<span style="font-weight:500">${esc(m.strong)}</span>` : ''}${m.strong && m.text ? ' — ' : ''}<span style="color:${MUTED}">${esc(m.text)}</span></div></a></td></tr>`).join('');
  return section('The market', rows, 'read off today’s build: the engine’s record, the block tonight, what’s new');
}

/** Gmail clips a message over ~102 KB (the rest sits behind "View entire message"): the HTML stays under this */
export const SIZE_CAP = 95_000;
/** what a fat edition gives up, in order, until it fits: picks to 6, New for you to 3 groups, the desk to 8 rows, names to 6 */
const TRIMS: ((e: DeskEmail) => DeskEmail)[] = [
  e => ({ ...e, picks: e.picks.slice(0, 6) }),
  e => (e.fresh ? { ...e, fresh: { ...e.fresh, moreGroups: e.fresh.moreGroups + Math.max(0, e.fresh.groups.length - 3), groups: e.fresh.groups.slice(0, 3) } } : e),
  e => ({ ...e, deskMore: e.deskMore + Math.max(0, e.desk.length - 8), desk: e.desk.slice(0, 8) }),
  e => ({ ...e, quietNames: [...e.names.slice(6).map(n => n.label), ...e.quietNames], names: e.names.slice(0, 6) }),
];

export interface RenderOpts {
  origin: string; unsubUrl: string; dateLabel: string;
  /** the size guard's cap in bytes (tests lower it) */
  sizeCap?: number;
  /** the on-desk edition sits in a sandboxed iframe: every link opens the page itself (<base target="_top">) */
  linkTarget?: '_top';
  /** the on-desk frame: html and body fill it and the body scrolls (iOS Safari sizes a srcdoc frame to its content otherwise) */
  frame?: boolean;
}
export function renderDesk(e: DeskEmail, o: RenderOpts): { html: string; text: string; trimmed: boolean } {
  const cap = o.sizeCap ?? SIZE_CAP;
  let html = renderHtml(e, o, false);
  // the size guard: trim, in order, until the page fits the inbox
  let trimmed = false;
  for (let k = 0; html.length > cap && k < TRIMS.length; k++) {
    e = TRIMS[k](e);
    trimmed = true;
    html = renderHtml(e, o, true);
  }
  return { html, text: renderText(e, o), trimmed };
}

function renderHtml(e: DeskEmail, o: RenderOpts, trimmed: boolean): string {
  const { origin } = o;

  // NEEDS YOU
  // results spanning days group by their sale day; RESULT_ROWS then "and N more"
  const days = new Set(e.results.map(r => r.day));
  let day = '\u0000';
  const resultRows = e.results.map(r => { const h = days.size > 1 && r.day !== day ? `<tr><td style="padding:12px 0 0;font:500 12.5px/1.3 ${FONT};color:${INK}">${esc(r.day)}</td></tr>` : ''; day = r.day; return h + resultRow(origin, r); }).join('');
  const needs = [
    e.overMax.length ? group('Bids past your max') + e.overMax.map(i => row(origin, i)).join('') : '',
    e.closing.length ? group('Closing before tomorrow night') + e.closing.map(i => row(origin, i)).join('') : '',
    e.results.length ? group(`Results to confirm${e.resultsMore ? ` · ${n2(e.results.length + e.resultsMore)}` : ''}`) + resultRows + (e.resultsMore ? more(origin, `and ${n2(e.resultsMore)} more ${e.resultsMore === 1 ? 'result' : 'results'}`, '/profile#results') : '') : '',
  ].join('');
  // results older than the last Desk are not reprinted, but the desk still holds them: say how many wait
  const pending = e.pendingResults ? more(origin, `${n2(e.pendingResults)} ${e.pendingResults === 1 ? 'result' : 'results'} still waiting on your desk`, '/profile#results') : '';
  const needsSection = needs
    ? section('Needs you', needs + pending, 'bids past your max · your watches closing in the next 36 hours · results to confirm')
    : e.watched ? section('Needs you', empty(e.pendingResults ? 'Nothing new today — no bid has passed your max, nothing of yours closes before tomorrow night.' : 'Nothing today — no bid has passed your max, nothing of yours closes before tomorrow night, no result waits on you.') + pending) : '';

  // YOUR DESK TODAY
  const above = e.deskAbove ? `<tr><td style="padding:12px 0 0;font:400 13px/1.4 ${FONT};color:${MUTED}">+ the ${n2(e.deskAbove)} above under Needs you</td></tr>` : '';
  // the watches that are no longer on the block — the count the runner saw, said once, under Record
  const settled = e.deskSettled ? `<tr><td style="padding:${e.desk.length || e.deskAbove ? 8 : 12}px 0 0;font:400 13px/1.4 ${FONT};color:${MUTED}">${n2(e.deskSettled)} ${e.desk.length || e.deskAbove ? 'more ' : ''}of your watches ${e.deskSettled === 1 ? 'has' : 'have'} settled — <a href="${pageUrl(origin, '/profile')}#record" style="color:${INK};text-decoration:none">under Record →</a></td></tr>` : '';
  const deskBody = (e.desk.length
    ? e.desk.map(r => deskRow(origin, r)).join('') + (e.deskMore ? more(origin, `and ${n2(e.deskMore)} more on your desk`, '/profile#tab-watching') : '') + above
    : e.deskAbove ? empty(`All ${n2(e.deskAbove)} of your live ${e.deskAbove === 1 ? 'watch is' : 'watches are'} under Needs you.`)
      : empty(e.watched ? 'Nothing of yours is live right now.' : 'You’re not watching anything yet. Save a lot on lectr and it reports here every morning.')) + settled;
  const deskSection = section('Your desk today', deskBody, e.desk.length ? `${n2(e.glance.watching)} live ${e.glance.watching === 1 ? 'watch' : 'watches'}, soonest close first · bid, bids added since you saved it, the engine’s read, the room to your max` : null);

  // NEW FOR YOU
  // YOUR COLLECTION — the owned pieces, each with its maker's latest settled hammer (never an appraisal)
  const collectionSection = e.collection.length
    ? section('Your collection', e.collection.map(c => collectionRow(origin, c)).join('') + (e.collectionMore ? more(origin, `and ${n2(e.collectionMore)} more ${e.collectionMore === 1 ? 'piece' : 'pieces'} you own`, '/profile#owned') : ''),
      `${n2(e.collection.length + e.collectionMore)} ${e.collection.length + e.collectionMore === 1 ? 'piece' : 'pieces'} you own · what you paid, and the maker’s latest settled hammer on file — a read of the market, not an appraisal`)
    : '';

  // NEW FOR YOU — grouped by the follow that reaches each lot, three rows a group, "+N more →" to the name's page or the feed's new tab
  const freshGroups = e.fresh?.groups.map(g =>
    group(`${g.label} · ${n2(g.total)}`) + g.items.map(i => row(origin, i)).join('') + (g.more ? more(origin, `+${n2(g.more)} more ${g.label.replace(/^By /, 'by ')}`, g.href) : '')).join('') ?? '';
  const freshSection = e.fresh
    ? section('New for you', e.fresh.groups.length
      ? freshGroups + (e.fresh.moreGroups ? more(origin, `and ${n2(e.fresh.moreGroups)} more of your follows with new lots`, '/?tab=new') : '')
      : empty(`Nothing first seen ${e.fresh.window} by a name or category you follow.`), e.fresh.total ? `${n2(e.fresh.total)} new · ${esc(e.fresh.since)}` : null)
    : '';

  // THE PICKS, laned
  let lane = '\u0000';
  const pickRows = e.picks.map(p => {
    const l = p.lane?.label ?? 'For you';
    const head = l !== lane ? group(l) : '';
    lane = l;
    return head + row(origin, p, { note: p.note });
  }).join('');
  const picksSection = e.picks.length
    ? section('The picks', pickRows + more(origin, 'All your picks', '/profile#tab-for-you'), `${n2(e.picks.length)} from the recommender, by what you follow and save — none already on your desk`)
    : '';

  const body = [
    needsSection,
    deskSection,
    collectionSection,
    calendar(origin, e.week),
    freshSection,
    picksSection,
    e.names.length || e.quietNames.length ? namesLedger(origin, e.names, e.quietNames) : '',
    e.market.length ? marketLedger(origin, e.market) : '',
  ].join('');

  // the first edition: two lines under the masthead on what arrives and how to stop it, never again after
  const welcome = e.welcome
    ? `<tr><td style="padding-top:12px;font:400 13.5px/1.5 ${FONT};color:${MUTED};border-top:1px dotted #D7D2CC;border-bottom:1px dotted #D7D2CC;padding-bottom:12px;margin-top:12px">Welcome to the Daily Desk — your first edition. Every morning at ${SEND_HOUR} AM it brings what needs you, your watches and collection, the week, what&rsquo;s new for the names you follow, the picks and the market.<br>Turn it off any time in <a href="${origin}/profile#account" style="color:${INK}">Email settings</a> or with the unsubscribe link at the foot.</td></tr>`
    : '';
  // the head: light only, said every way a client reads it (Apple Mail reads the meta, Gmail the style);
  // the <style> carries nothing a layout depends on
  const html = `<!doctype html><html lang="en" xmlns:o="urn:schemas-microsoft-com:office:office"${o.frame ? ' style="height:100%"' : ''}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only">${o.linkTarget ? `<base target="${o.linkTarget}">` : ''}<title>${esc(e.subject)}</title><style>:root{color-scheme:light only;supported-color-schemes:light only}</style><!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]--></head>
<body style="margin:0;padding:0;background:${BG};background-color:${BG};mso-line-height-rule:exactly${o.frame ? ';height:100%;overflow:auto;-webkit-overflow-scrolling:touch' : ''}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(e.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};background-color:${BG}"><tr><td align="center" style="padding:24px 12px">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" align="center"><tr><td width="600"><![endif]-->
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:${CARD};background-color:${CARD};border-radius:16px">
<tr><td style="padding:28px 24px 8px;mso-line-height-rule:exactly">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="font:400 13px/1.3 ${FONT};color:${MUTED}"><b style="color:${INK};font-weight:600">lectr</b> · The Daily Desk · ${esc(o.dateLabel)}</td></tr>
${welcome}
<tr><td style="padding-top:12px;font:300 32px/1.12 ${FONT};color:${INK};letter-spacing:-0.025em">${esc(e.headline)}</td></tr>
${e.preheader ? `<tr><td style="padding-top:8px;font:400 14px/1.5 ${FONT};color:${MUTED}">${esc(e.preheader)}</td></tr>` : ''}
${glance(origin, e.glance)}
${e.edition.length ? `<tr><td style="padding:10px 0 0;font:400 12.5px/1.5 ${FONT};color:${MUTED}">In this edition: ${e.edition.map(esc).join(' · ')}</td></tr>` : ''}
${body}
<tr><td style="padding:30px 0 6px" align="left"><a href="${pageUrl(origin, '/profile')}" style="display:inline-block;padding:12px 20px;border-radius:999px;background:${INK};color:#fff;font:500 14px/1 ${FONT};text-decoration:none">Open your desk</a></td></tr>
</table></td></tr>
<tr><td style="padding:18px 24px 26px;font:400 12px/1.6 ${FONT};color:${FAINT};border-top:1px solid ${LINE}">
You get this because you turned on the Daily Desk email on lectr. Figures are lectr&rsquo;s reads from public auction data, not appraisals.${trimmed ? ' Trimmed for your inbox &mdash; the whole desk is on lectr.' : ''}<br>
<a href="${esc(o.unsubUrl)}" style="color:${MUTED}">Unsubscribe</a> · <a href="${origin}/profile#account" style="color:${MUTED}">Email settings</a>
</td></tr></table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>`;

  return html;
}

/** THE PLAIN-TEXT EDITION — every section the HTML prints, in the same order */
function renderText(e: DeskEmail, o: RenderOpts): string {
  const { origin } = o;
  const g = e.glance;
  const t: string[] = [`lectr · The Daily Desk · ${o.dateLabel}`,
    ...(e.welcome ? ['', `Welcome to the Daily Desk — your first edition. Every morning at ${SEND_HOUR} AM it brings what needs you, your watches and collection, the week, what’s new for the names you follow, the picks and the market.`, `Turn it off any time: ${origin}/profile#account`] : []),
    '', e.headline, e.preheader, '',
    `Watching ${g.watching}${g.est ? ` (${g.est} at estimate midpoint${g.estBasis ? ` · ${g.estBasis}` : ''})` : ''} · Next hammer ${g.next ? `${g.next.when}${g.next.time ? ` ${g.next.time}` : ''} — ${g.next.above ? 'first under needs you' : g.next.title}` : '—'} · This week ${g.week} (${g.weekWatches} watches + ${g.weekPicks} picks) · ${g.picks} picks`,
    ...(e.edition.length ? [`In this edition: ${e.edition.join(' · ')}`] : []), ''];
  const metaOf = (i: DeskItem) => [i.maker, i.house, i.est].filter(Boolean).join(' · ');
  const line = (i: DeskItem | PickItem) => `- ${i.title}${i.when ? ` (${i.when})` : ''}${metaOf(i) ? ` · ${metaOf(i)}` : ''}${i.sig ? ` · ${i.sig.text}` : ''}${i.over ? ` · bid ${i.bid} passed your max` : i.max ? ` · your max ${i.max}` : ''}${'note' in i && i.note ? `\n  ${i.note}` : ''}\n  ${lotUrl(origin, i.id)}`;
  const head = (title: string, sub?: string | null) => { t.push(title.toUpperCase()); if (sub) t.push(sub); };
  const lines = (title: string, items: (DeskItem | PickItem)[]) => {
    if (!items.length) return;
    t.push(title);
    for (const i of items) t.push(line(i));
    t.push('');
  };
  if (e.overMax.length || e.closing.length || e.results.length) head('Needs you');
  else if (e.watched) head('Needs you', `Nothing ${e.pendingResults ? 'new ' : ''}today — no bid past your max, nothing of yours closing before tomorrow night${e.pendingResults ? '' : ', no result to confirm'}.`);
  lines('Bids past your max', e.overMax);
  lines('Closing before tomorrow night', e.closing);
  if (e.results.length) {
    t.push(`Results to confirm${e.resultsMore ? ` · ${e.results.length + e.resultsMore}` : ''}`);
    const days = new Set(e.results.map(r => r.day));
    let day = '\u0000';
    for (const r of e.results) {
      if (days.size > 1 && r.day !== day) { t.push(r.day); day = r.day; }
      t.push(`- ${r.title} · ${r.house} · hammered ${r.hammer}${r.vsEst ? ` · ${r.vsEst}` : ''}${r.vsMax ? ` · ${r.inReach ? 'in reach' : 'past you'} · ${r.vsMax}` : ''}\n  Did you win it? ${origin}/profile#results\n  ${lotUrl(origin, r.id)}`);
    }
    if (e.resultsMore) t.push(`  and ${e.resultsMore} more: ${origin}/profile#results`);
    t.push('');
  }
  if (e.pendingResults && e.watched) t.push(`${e.pendingResults} ${e.pendingResults === 1 ? 'result' : 'results'} still waiting on your desk: ${origin}/profile#results`, '');
  head('Your desk today');
  if (e.desk.length) {
    for (const r of e.desk) t.push(`- ${r.title}${r.when ? ` (${r.when})` : ''}${metaOf(r) ? ` · ${metaOf(r)}` : ''}${[/\bbid\b/.test(r.est) ? '' : [r.bid ? `bid ${r.bid}` : '', r.bids].filter(Boolean).join(' · '), r.moved, r.room, r.sig?.text].filter(Boolean).map(x => ` · ${x}`).join('')}\n  ${lotUrl(origin, r.id)}`);
    if (e.deskMore) t.push(`  and ${e.deskMore} more: ${origin}/profile#tab-watching`);
    if (e.deskAbove) t.push(`  + the ${e.deskAbove} above under needs you`);
  } else if (e.deskAbove) t.push(`All ${e.deskAbove} of your live ${e.deskAbove === 1 ? 'watch is' : 'watches are'} under needs you.`);
  else t.push(e.watched ? 'Nothing of yours is live right now.' : 'You’re not watching anything yet. Save a lot on lectr and it reports here every morning.');
  if (e.deskSettled) t.push(`${e.deskSettled} ${e.desk.length || e.deskAbove ? 'more ' : ''}of your watches ${e.deskSettled === 1 ? 'has' : 'have'} settled — under Record: ${origin}/profile#record`);
  t.push('');
  if (e.collection.length) {
    head('Your collection', `${e.collection.length + e.collectionMore} pieces you own · what you paid, and the maker’s latest settled hammer on file — not an appraisal`);
    for (const c of e.collection) t.push(`- ${c.title}${c.maker ? ` · ${c.maker}` : ''}${c.house ? ` · ${c.house}` : ''}${c.paid ? ` · bought ${c.paid}` : ''}${c.latest ? ` · ${c.maker ? `${c.maker}’s` : 'the maker’s'} latest hammer ${c.latest.hammer}, ${c.latest.day}, ${c.latest.house}` : ''}\n  ${lotUrl(origin, c.id)}`);
    if (e.collectionMore) t.push(`  and ${e.collectionMore} more: ${origin}/profile#owned`);
    t.push('');
  }
  head('Closing this week', `${e.week.watches} watches · ${e.week.picks} picks · ${e.week.names} by your names`);
  t.push(e.week.days.map(d => `${d.today ? 'Today' : d.dow} ${d.date}: ${d.watches + d.picks}${d.names ? ` (+${d.names} names)` : ''}`).join(' · '), `${origin}/profile#tab-week`, '');
  if (e.fresh) {
    head('New for you', e.fresh.total ? `${e.fresh.total} new · ${e.fresh.since}` : null);
    if (!e.fresh.groups.length) t.push(`Nothing first seen ${e.fresh.window} by a name or category you follow.`);
    for (const gr of e.fresh.groups) {
      t.push(`${gr.label} · ${gr.total}`);
      for (const i of gr.items) t.push(line(i));
      if (gr.more) t.push(`  +${gr.more} more: ${pageUrl(origin, gr.href)}`);
    }
    if (e.fresh.moreGroups) t.push(`and ${e.fresh.moreGroups} more of your follows with new lots: ${origin}/?tab=new`);
    t.push('');
  }
  if (e.picks.length) {
    head('The picks', `${e.picks.length} from the recommender, by what you follow and save`);
    let lane = '\u0000';
    for (const p of e.picks) {
      const l = p.lane?.label ?? 'For you';
      if (l !== lane) { t.push(l); lane = l; }
      t.push(line(p));
    }
    t.push('');
  }
  if (e.names.length || e.quietNames.length) {
    head('Your names', `${e.names.length + e.quietNames.length} followed · ${e.names.length} with lots on the block · the last hammer is the newest settled sale on file`);
    for (const n of e.names) t.push(`- ${n.label}: ${n.live} live${n.soonest ? ` · soonest ${n.soonest.when} at ${n.soonest.house}` : ''}${n.last ? ` · last hammer ${n.last.hammer} ${n.last.day} at ${n.last.house} — ${n.last.title}` : n.note ? ` · ${n.note}` : ' · no settled sale on file'}\n  ${pageUrl(origin, n.href)}`);
    if (e.quietNames.length) t.push(`${e.names.length ? `${e.quietNames.length} more ${e.quietNames.length === 1 ? 'name' : 'names'} with nothing live` : `Nothing live for your ${e.quietNames.length} ${e.quietNames.length === 1 ? 'name' : 'names'}`}: ${e.quietNames.join(', ')}`);
    t.push('');
  }
  if (e.market.length) {
    head('The market', 'read off today’s build: the engine’s record, the block tonight, what’s new');
    for (const m of e.market) t.push(`- ${m.strong ? `${m.strong} — ` : ''}${m.text}\n  ${pageUrl(origin, m.href)}`);
    t.push('');
  }
  t.push(`Open your desk: ${origin}/profile`, '', 'You get this because you turned on the Daily Desk email on lectr. Figures are lectr’s reads from public auction data, not appraisals.', `Unsubscribe: ${o.unsubUrl}`, `Email settings: ${origin}/profile#account`);
  return t.join('\n');
}

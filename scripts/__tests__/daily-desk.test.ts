import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AuctionLot } from '../../app/types';
import { planDesk, whenText, laneOf, lastSaleOf, PICKS_N, DESK_ROWS, FRESH_ROWS, NAME_ROWS, WEEK_DAYS_N } from '../lib/daily-desk';
import { renderDesk } from '../lib/daily-desk-html';

const NOW = Date.parse('2026-10-21T12:20:00Z');
const TODAY = '2026-10-21', YESTERDAY = '2026-10-20';
const H = 3600_000;
const lot = (id: string, closeIn: number | null, extra: Partial<AuctionLot> = {}): AuctionLot => ({
  id, title: `Lot ${id}`, artist: 'kaws', auctionHouse: 'Goldin', status: 'upcoming', currency: 'USD',
  saleDate: closeIn == null ? '' : new Date(NOW + closeIn).toISOString().slice(0, 10),
  saleDateTime: closeIn == null ? null : new Date(NOW + closeIn).toISOString(),
  estimateLow: 1000, estimateHigh: 2000, hammerPrice: null, premiumPrice: null, priceUsd: null,
  ...extra,
} as unknown as AuctionLot);
const liveMap = (ls: AuctionLot[]) => new Map(ls.map(l => [l.id, l]));
const render = (d: NonNullable<ReturnType<typeof planDesk>>) => renderDesk(d, { origin: 'https://lectr.bid', unsubUrl: 'https://lectr.bid/api/email/unsubscribe?t=x', dateLabel: 'Wednesday, Oct 21' });
const warhol = (id: string, closeIn: number, extra: Partial<AuctionLot> = {}) => lot(id, closeIn, { artist: 'andy-warhol', auctionHouse: "Christie's", ek: 'mk:andy-warhol', title: `Warhol ${id}`, ...extra } as Partial<AuctionLot>);
const FOLLOW_WARHOL = { kind: 'maker' as const, key: 'andy-warhol', label: 'Andy Warhol' };

test('an empty desk → no email; any watch or follow → a paper', () => {
  assert.equal(planDesk({ now: NOW, watches: [], live: new Map(), sold: [], picks: [] }), null);
  // a watch closing in 10 days used to be "nothing to say"; the paper publishes
  const l = lot('a', 240 * H);
  const d = planDesk({ now: NOW, watches: [{ lot_id: 'a' }], live: liveMap([l]), sold: [], picks: [] });
  assert.ok(d);
  assert.equal(d.desk.length, 1);
  assert.match(d.subject, /a quiet day on your desk/);
  // a settled watch (not in the live book) still gets its paper
  assert.ok(planDesk({ now: NOW, watches: [{ lot_id: 'gone' }], live: new Map(), sold: [], picks: [] }));
  // a follow alone is a reason
  assert.ok(planDesk({ now: NOW, watches: [], live: new Map(), sold: [], picks: [], follows: [FOLLOW_WARHOL], book: [] }));
});

test('closing within 36h, soonest first; a bid past your max leads its own section', () => {
  const a = lot('a', 20 * H), b = lot('b', 5 * H), c = lot('c', 8 * H, { currentBid: 5000 });
  const d = planDesk({ now: NOW, watches: [{ lot_id: 'a' }, { lot_id: 'b' }, { lot_id: 'c', max_usd: 4000 }], live: liveMap([a, b, c]), sold: [], picks: [] })!;
  assert.deepEqual(d.overMax.map(i => i.id), ['c']);
  assert.deepEqual(d.closing.map(i => i.id), ['b', 'a']);   // c is not repeated
  assert.match(d.subject, /passed your max/);
});

test('results since the last email grade the hammer against your max', () => {
  const d = planDesk({
    now: NOW, watches: [{ lot_id: 'x', max_usd: 10_000, est_mid: 8_000 }], live: new Map(),
    sold: [{ id: 'x', title: 'Card', house: 'REA', price_usd: 12_000, sale_date: '2026-10-20' }], picks: [], lastSentOn: '2026-10-20',
  })!;
  assert.equal(d.results.length, 1);
  assert.equal(d.results[0].inReach, false);
  assert.match(d.results[0].vsMax!, /\+20% vs your max/);
  assert.match(d.subject, /1 of your watches sold/);
  // a result older than the last email is not repeated
  const d2 = planDesk({ now: NOW, watches: [{ lot_id: 'x' }], live: new Map(), sold: [{ id: 'x', price_usd: 1, sale_date: '2026-10-19' }], picks: [], lastSentOn: '2026-10-20' })!;
  assert.equal(d2.results.length, 0);
  const { html } = render(d);
  assert.ok(html.includes('Did you win it?'));
  assert.ok(html.includes('/profile?utm_source=daily-desk&amp;utm_medium=email#results') || html.includes('/profile?utm_source=daily-desk&utm_medium=email#results'));
});

test('your desk today: every live watch, soonest first, with movement since the save and the room to your max', () => {
  const a = lot('a', 50 * H, { currentBid: 1200, bidCount: 9 }), b = lot('b', 5 * H, { currentBid: 300, bidCount: 4 }), c = lot('c', null);
  const d = planDesk({
    now: NOW, watches: [{ lot_id: 'a', max_usd: 2000, bid_count: 5 }, { lot_id: 'b', max_usd: 250, bid_count: 4 }, { lot_id: 'c' }],
    live: liveMap([a, b, c]), sold: [], picks: [],
  })!;
  assert.deepEqual(d.desk.map(r => r.id), ['b', 'a', 'c']);   // an undated lot last
  const ra = d.desk[1], rb = d.desk[0], rc = d.desk[2];
  assert.equal(ra.moved, '+4 bids since you saved it');
  assert.equal(ra.room, '$800 under your max $2K');
  assert.equal(ra.bids, '9 bids');
  assert.equal(rb.moved, 'no new bids since you saved it');
  assert.equal(rb.room, 'past your max $250 by $50');
  assert.equal(rb.over, true);
  assert.equal(rc.moved, null);   // no baseline, no claim
  assert.equal(rc.room, null);
  assert.equal(d.deskMore, 0);
  const { html, text } = render(d);
  assert.ok(html.includes('Your desk today'));
  assert.ok(html.includes('+4 bids since you saved it'));
  assert.ok(text.includes('YOUR DESK TODAY'));
});

test('the desk caps at DESK_ROWS and says how many more', () => {
  const ls = Array.from({ length: DESK_ROWS + 3 }, (_, k) => lot(`l${k}`, (k + 2) * H));
  const d = planDesk({ now: NOW, watches: ls.map(l => ({ lot_id: l.id })), live: liveMap(ls), sold: [], picks: [] })!;
  assert.equal(d.desk.length, DESK_ROWS);
  assert.equal(d.deskMore, 3);
  assert.ok(render(d).html.includes('and 3 more on your desk'));
});

test('the week is a 7-day calendar of watches, picks and your names’ lots, a lot counted once', () => {
  const w1 = lot('w1', 5 * H), w2 = lot('w2', 3 * 24 * H), far = lot('far', 9 * 24 * H);
  const p1 = lot('p1', 2 * 24 * H);
  const n1 = warhol('n1', 3 * 24 * H), n2 = warhol('n2', 3 * 24 * H + H);
  const d = planDesk({
    now: NOW, tz: 'America/New_York', watches: [{ lot_id: 'w1' }, { lot_id: 'w2' }, { lot_id: 'far' }, { lot_id: 'n1' }],
    live: liveMap([w1, w2, far, n1, n2]), sold: [], picks: [{ lot: p1, note: 'Like your prints' }],
    follows: [FOLLOW_WARHOL], book: [w1, w2, far, n1, n2, p1],
  })!;
  assert.equal(d.week.days.length, WEEK_DAYS_N);
  assert.equal(d.week.days[0].today, true);
  assert.equal(d.week.days[0].watches, 1);
  assert.equal(d.week.watches, 3);   // w1, w2, n1 (watched Warhol counts as a watch, not a name)
  assert.equal(d.week.picks, 1);
  assert.equal(d.week.names, 1);     // n2 only
  assert.equal(d.week.days.reduce((s, x) => s + x.watches + x.picks + x.names, 0), 5);   // far is beyond the week
  assert.equal(d.glance.week, 3);    // the glance counts watched closes inside 7 days (n1 is watched)
  const { html, text } = render(d);
  assert.ok(html.includes('Closing this week'));
  assert.ok(html.includes('>Today<'));
  assert.ok(text.includes('CLOSING THIS WEEK'));
});

test('new for you reads firstSeen since the last Desk, by a followed name, and says what new means', () => {
  const fresh1 = warhol('f1', 48 * H, { firstSeen: TODAY } as Partial<AuctionLot>);
  const fresh2 = warhol('f2', 72 * H, { firstSeen: YESTERDAY } as Partial<AuctionLot>);
  const old = warhol('old', 48 * H, { firstSeen: '2026-10-10' } as Partial<AuctionLot>);
  const other = lot('o', 48 * H, { firstSeen: TODAY } as Partial<AuctionLot>);   // new, but not yours
  const watched = warhol('wt', 48 * H, { firstSeen: TODAY } as Partial<AuctionLot>);
  const book = [fresh1, fresh2, old, other, watched];
  const d = planDesk({ now: NOW, watches: [{ lot_id: 'wt' }], live: liveMap(book), sold: [], picks: [], follows: [FOLLOW_WARHOL], book, lastSentOn: '2026-10-19' })!;
  assert.ok(d.fresh);
  assert.deepEqual(d.fresh.items.map(i => i.id).sort(), ['f1', 'f2']);
  assert.match(d.fresh.since, /first seen on lectr since your last Desk \(Mon, Oct 19\)/);
  assert.match(d.subject, /2 new lots for the names you follow/);
  // no last send: the first paper reads since yesterday (the watched lot is never "new for you")
  const d2 = planDesk({ now: NOW, watches: [{ lot_id: 'wt' }], live: liveMap(book), sold: [], picks: [], follows: [FOLLOW_WARHOL], book })!;
  assert.deepEqual(d2.fresh!.items.map(i => i.id).sort(), ['f1', 'f2']);
  assert.match(d2.fresh!.since, /since yesterday,/);
  // a Desk sent yesterday: only today's first-seen lots are new
  const d4 = planDesk({ now: NOW, watches: [], live: liveMap(book), sold: [], picks: [], follows: [FOLLOW_WARHOL], book, lastSentOn: YESTERDAY })!;
  assert.deepEqual(d4.fresh!.items.map(i => i.id).sort(), ['f1', 'wt']);
  // a book without firstSeen stamps makes no "new" claim at all
  const bare = book.map(l => ({ ...l, firstSeen: undefined })) as AuctionLot[];
  assert.equal(planDesk({ now: NOW, watches: [], live: liveMap(bare), sold: [], picks: [], follows: [FOLLOW_WARHOL], book: bare })!.fresh, null);
  // the cap
  const many = Array.from({ length: FRESH_ROWS + 2 }, (_, k) => warhol(`m${k}`, (k + 30) * H, { firstSeen: TODAY } as Partial<AuctionLot>));
  const d3 = planDesk({ now: NOW, watches: [], live: liveMap(many), sold: [], picks: [], follows: [FOLLOW_WARHOL], book: many })!;
  assert.equal(d3.fresh!.items.length, FRESH_ROWS);
  assert.equal(d3.fresh!.more, 2);
  assert.ok(render(d).html.includes('New for you'));
});

test('picks skip lots you already watch, cap at PICKS_N and sit in lanes: follow, saved, new to you', () => {
  const mk = (id: string, lane: { kind: 'follow' | 'saved' | 'new'; label: string }) => ({ lot: lot(id, 72 * H), note: 'Like your prints', lane });
  const ps = [
    { lot: lot('a', 72 * H), note: 'x' },
    mk('n1', { kind: 'new', label: 'New to you' }),
    mk('s1', { kind: 'saved', label: 'Because you saved Companion' }),
    mk('f1', { kind: 'follow', label: 'Because you follow KAWS' }),
    mk('f2', { kind: 'follow', label: 'Because you follow Warhol' }),
    mk('f3', { kind: 'follow', label: 'Because you follow KAWS' }),
    ...Array.from({ length: PICKS_N }, (_, k) => mk(`x${k}`, { kind: 'new', label: 'New to you' })),
  ];
  const d = planDesk({ now: NOW, watches: [{ lot_id: 'a' }], live: liveMap([]), sold: [], picks: ps })!;
  assert.equal(d.picks.length, PICKS_N);
  assert.ok(!d.picks.some(p => p.id === 'a'));
  assert.deepEqual(d.picks.slice(0, 4).map(p => p.id), ['f1', 'f3', 'f2', 's1']);   // lanes grouped, first-seen label order kept
  assert.equal(d.picks[4].lane?.kind, 'new');
  const { html } = render(d);
  assert.ok(html.includes('Because you follow KAWS'));
  assert.ok(html.indexOf('Because you follow KAWS') < html.indexOf('Because you saved Companion'));
  assert.ok(html.indexOf('Because you saved Companion') < html.indexOf('New to you'));
});

test('laneOf reads the recommender seed; lastSaleOf takes the newest settled row', () => {
  assert.deepEqual(laneOf({ seed: { kind: 'follow', label: 'Andy Warhol', follow: {} } }), { kind: 'follow', label: 'Because you follow Andy Warhol' });
  assert.deepEqual(laneOf({ seed: { kind: 'saved', label: 'Companion (Flayed)' } }), { kind: 'saved', label: 'Because you saved Companion (Flayed)' });
  assert.deepEqual(laneOf({ seed: { kind: 'owned', label: 'Chair' } }), { kind: 'saved', label: 'Because you own Chair' });
  assert.equal(laneOf({ seed: { kind: 'follow', label: 'TCG', market: 'tcg' } }).kind, 'new');
  assert.equal(laneOf({ seed: { kind: 'follow', label: 'KAWS', follow: {} }, tier: 2 }).kind, 'new');
  const row = (id: string, d: string, p = 100) => ({ id, p, d, h: 'Phillips', t: `T ${id}` });
  assert.equal(lastSaleOf({ recent: [row('r1', '2026-10-01'), row('r2', '2026-10-14')], top: [row('t1', '2025-01-01', 9e6)] })?.id, 'r2');
  assert.equal(lastSaleOf({ recent: [], top: [] }), null);
  assert.equal(lastSaleOf(null), null);
});

test('your names: one ledger line per followed name — live count, soonest sale, last hammer; houses are not names', () => {
  const n1 = warhol('n1', 30 * H), n2 = warhol('n2', 60 * H, { auctionHouse: 'Phillips' } as Partial<AuctionLot>);
  const book = [n1, n2, lot('o', 20 * H, { artist: 'tom-sachs' } as Partial<AuctionLot>)];
  const d = planDesk({
    now: NOW, tz: 'America/New_York', watches: [], live: liveMap(book), sold: [], picks: [],
    follows: [FOLLOW_WARHOL, { kind: 'maker', key: 'kaws', label: 'KAWS' }, { kind: 'house', key: 'Goldin', label: 'Goldin' }, { kind: 'cat', key: 'fine-art:prints', label: 'Fine art · Prints' }],
    book, nameSold: new Map([['mk:andy-warhol', { id: 'sold-1', p: 48_000, d: '2026-10-14', h: "Christie's", t: 'Flowers' }]]),
  })!;
  assert.equal(d.names.length, 3);                         // the house follow is not a name
  assert.equal(d.names[0].label, 'Andy Warhol');
  assert.equal(d.names[0].live, 2);
  assert.equal(d.names[0].soonest?.house, "Christie's");
  assert.match(d.names[0].soonest?.when ?? '', /^tomorrow /);
  assert.deepEqual(d.names[0].last, { id: 'sold-1', hammer: '$48K', day: 'Oct 14', house: "Christie's", title: 'Flowers' });
  assert.equal(d.names[0].href, '/makers/andy-warhol');
  const kaws = d.names.find(n => n.label === 'KAWS')!;
  assert.equal(kaws.live, 0);
  assert.equal(kaws.last, null);                           // nothing on file: no claim
  const cat = d.names.find(n => n.label.startsWith('Fine art'))!;
  assert.match(cat.note ?? '', /category follow/);
  assert.match(d.subject, /1 of your names is on the block/);
  const { html, text } = render(d);
  assert.ok(html.includes('Your names'));
  assert.ok(html.includes('Last hammer'));
  assert.ok(text.includes('last hammer $48K Oct 14'));
});

test('names cap at NAME_ROWS, live names first', () => {
  const follows = Array.from({ length: NAME_ROWS + 2 }, (_, k) => ({ kind: 'maker' as const, key: `maker-${k}`, label: `Maker ${k}` }));
  const live = lot('z', 20 * H, { artist: 'maker-9', ek: 'pl:maker-9' } as unknown as Partial<AuctionLot>);
  const d = planDesk({ now: NOW, watches: [], live: liveMap([live]), sold: [], picks: [], follows, book: [live] })!;
  assert.equal(d.names.length, NAME_ROWS);
  assert.equal(d.names[0].label, 'Maker 9');
  assert.equal(d.names[0].live, 1);
});

test('the market: every line is derived from the served files, each linked into lectr', () => {
  const tonight = lot('hot', 6 * H, { bidCount: 76, currentBid: 6500, title: '2004 Upper Deck patch auto', artist: 'sports-cards' } as Partial<AuctionLot>);
  const flagged = lot('flag', 40 * H, { signal: { label: 'Below Market', pct: 40, basis: 6, kind: 'form', confidence: 'low' } } as unknown as Partial<AuctionLot>);
  const seen = lot('seen', 40 * H, { firstSeen: TODAY } as Partial<AuctionLot>);
  const book = [tonight, flagged, seen];
  const rows = [
    ...Array.from({ length: 6 }, (_, k) => ({ id: `r${k}`, k: 'card', d: '2026-10-10', sd: '2026-10-18', p: 1000, r: k < 3 ? 900 : 1100, m: 'sports', t: `Row ${k}`, h: 'REA' })),
    { id: 'big', k: 'card', d: '2026-10-10', sd: YESTERDAY, p: 20_000, r: 28_290, m: 'sports', t: '1961 Topps #415 Hank Aaron PSA 9', h: 'REA' },
    { id: 'bigger-art', k: 'card', d: '2026-10-10', sd: YESTERDAY, p: 50_000, r: 90_000, m: 'art', t: 'A print', h: 'Phillips' },
    { id: 'stale', k: 'card', d: '2026-09-01', sd: '2026-09-20', p: 10, r: 10, m: 'sports' },
  ];
  const d = planDesk({
    now: NOW, tz: 'America/New_York', watches: [{ lot_id: 'hot' }], live: liveMap(book), sold: [], picks: [],
    follows: [{ kind: 'maker', key: 'mickey-mantle', label: 'Mickey Mantle' }], book,
    receipts: { rows }, backtest: { flagged: { n: 2903, medianPerfPct: 44 }, unflagged: { n: 14906, medianPerfPct: 20 } },
  })!;
  const texts = d.market.map(m => `${m.strong} — ${m.text}`);
  assert.equal(d.market.length, 5);
  assert.match(texts[0], /^8 calls graded this week — the median hammer landed at 110% of what the engine said/);   // 6 + 2 yesterday; the stale row is out
  assert.equal(d.market[0].href, '/receipts');
  assert.match(texts[1], /^Below-market flags hammered \+44% vs estimate — all-in, median of 2,903 settled flags, against \+20% unflagged/);
  assert.equal(d.market[1].href, '/analytics');
  // the biggest hammer yesterday IN YOUR MARKETS (sports, from the Mantle follow) — the $90K art hammer is not yours
  assert.match(texts[2], /^\$28K — the biggest hammer yesterday in your markets — 1961 Topps #415 Hank Aaron PSA 9 at REA/);
  assert.equal(d.market[2].href, '/lot?id=big');
  assert.match(texts[3], /^76 bids on the most-bid lot closing tonight — 2004 Upper Deck patch auto at Goldin, \$6.5K bid/);
  assert.match(texts[4], /^1 lot on the block the engine reads below market — of 3 live/);
  assert.equal(d.market[4].href, '/value');
  const { html, text } = render(d);
  assert.ok(html.includes('The market'));
  assert.ok(html.includes('https://lectr.bid/receipts?utm_source=daily-desk'));
  assert.ok(text.includes('THE MARKET'));
  // no files, no market claims; the record needs RECORD_MIN_N graded calls
  const d2 = planDesk({ now: NOW, watches: [{ lot_id: 'hot' }], live: liveMap([tonight]), sold: [], picks: [], book: [tonight], receipts: { rows: rows.slice(0, 2) } })!;
  assert.ok(!d2.market.some(m => m.href === '/receipts'));
  assert.ok(!d2.market.some(m => m.href === '/analytics'));
});

test('the lead picks the richest fact: needs you, closing, results, new, the week, the names, the market', () => {
  const far = lot('far', 4 * 24 * H);
  const d1 = planDesk({ now: NOW, watches: [{ lot_id: 'far' }], live: liveMap([far]), sold: [], picks: [] })!;
  assert.equal(d1.subject, 'Your desk: 1 of yours closes this week');
  const soon = lot('soon', 3 * H);
  const d2 = planDesk({ now: NOW, watches: [{ lot_id: 'soon' }, { lot_id: 'far' }], live: liveMap([soon, far]), sold: [], picks: [] })!;
  assert.equal(d2.subject, 'Your desk: 1 of yours closes today');
  const flagged = lot('flag', 400 * H, { signal: { label: 'Below Market', pct: 40, basis: 6, kind: 'form', confidence: 'low' } } as unknown as Partial<AuctionLot>);
  const d3 = planDesk({ now: NOW, watches: [], live: liveMap([flagged]), sold: [], picks: [], follows: [{ kind: 'house', key: 'Goldin', label: 'Goldin' }], book: [flagged] })!;
  assert.equal(d3.subject, 'Your desk: 1 below-market flag on the block');
});

test('whenText reads the reader clock', () => {
  assert.match(whenText(NOW + 2 * H, NOW, 'America/New_York')!, /^today /);
  assert.match(whenText(NOW + 26 * H, NOW, 'America/New_York')!, /^tomorrow /);
  assert.equal(whenText(null, NOW, 'America/New_York'), null);
});

test('the email carries an unsubscribe link, the masthead, honest empty states, and escapes titles', () => {
  const l = lot('a', 5 * H, { title: 'A <b>bold</b> lot' } as Partial<AuctionLot>);
  const d = planDesk({ now: NOW, watches: [{ lot_id: 'a' }], live: liveMap([l]), sold: [], picks: [] })!;
  const { html, text } = render(d);
  assert.ok(html.includes('https://lectr.bid/api/email/unsubscribe?t=x'));
  assert.ok(html.includes('The Daily Desk · Wednesday, Oct 21'));
  assert.ok(!html.includes('<b>bold</b>'));
  assert.ok(text.includes('Unsubscribe: https://lectr.bid/api/email/unsubscribe?t=x'));
  // a reader with watches but nothing live: the desk says so instead of printing nothing
  const d2 = planDesk({ now: NOW, watches: [{ lot_id: 'gone' }, { lot_id: 'gone2' }], live: new Map(), sold: [], picks: [] })!;
  const h2 = render(d2).html;
  assert.ok(h2.includes('Nothing of yours is live right now — your 2 watched lots have settled'));
  assert.ok(h2.includes('Nothing today — no bid has passed your max'));
  assert.ok(h2.includes('nothing of yours or your names’ closes in the next seven days'));
  // no watches at all, a follow only: the invitation, no "needs you" block
  const d3 = planDesk({ now: NOW, watches: [], live: new Map(), sold: [], picks: [], follows: [FOLLOW_WARHOL], book: [] })!;
  const h3 = render(d3).html;
  assert.ok(h3.includes('You’re not watching anything yet'));
  assert.ok(!h3.includes('Needs you'));
});

test('the glance counts the desk: watching, the next hammer, the week, the picks', () => {
  const soon = lot('s', 5 * H), d3 = lot('d3', 3 * 24 * H), d5 = lot('d5', 5 * 24 * H), d9 = lot('d9', 9 * 24 * H);
  const d = planDesk({ now: NOW, tz: 'America/New_York', watches: ['s', 'd3', 'd5', 'd9'].map(lot_id => ({ lot_id })), live: liveMap([soon, d3, d5, d9]), sold: [], picks: [] })!;
  assert.deepEqual(d.closing.map(i => i.id), ['s']);
  assert.equal(d.glance.watching, 4);
  assert.equal(d.glance.est, '$6K');
  assert.equal(d.glance.next?.id, 's');
  assert.equal(d.glance.next?.when, 'today');
  assert.match(d.glance.next?.time ?? '', /\d:\d\d [AP]M/);
  assert.equal(d.glance.week, 3);
  const { html, text } = render(d);
  assert.ok(html.includes('Next hammer'));
  assert.ok(text.includes('Watching 4 ($6K at estimate midpoint)'));
});

test('an RR lot without a crawled photo prints its CDN preview; a lot with none prints its initial', () => {
  const rr = lot('rrauction-753-351893607530536', 5 * H, { auctionHouse: 'RR Auction', title: 'Charles Schulz Signed Sketch of Snoopy' } as Partial<AuctionLot>);
  const none = lot('goldin-1', 6 * H, { title: 'Zion Williamson rookie' } as Partial<AuctionLot>);
  const d = planDesk({ now: NOW, watches: [{ lot_id: rr.id }, { lot_id: 'goldin-1' }], live: liveMap([rr, none]), sold: [], picks: [] })!;
  assert.equal(d.closing[0].img, 'https://cdn.rrauction.com/auction/753/preview/3518936_1.jpg');
  assert.equal(d.closing[1].img, null);
  const { html } = render(d);
  assert.ok(html.includes('preview/3518936_1.jpg'));
  assert.ok(html.includes('>Z</div>'));
});

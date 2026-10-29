import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AuctionLot } from '../../app/types';
import { planDesk, whenText, laneOf, lastSaleOf, leadingNameOf, SUBJECT_MAX, PICKS_N, DESK_ROWS, FRESH_PER_GROUP, FRESH_GROUPS, NAME_ROWS, WEEK_DAYS_N } from '../lib/daily-desk';
import { renderDesk, SIZE_CAP } from '../lib/daily-desk-html';

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
  assert.match(d.subject, /^Your desk: 1 bid past your max$/);
  assert.match(d.headline, /passed your max/);
});

test('results since the last email grade the hammer against your max', () => {
  const d = planDesk({
    now: NOW, watches: [{ lot_id: 'x', max_usd: 10_000, est_mid: 8_000 }], live: new Map(),
    sold: [{ id: 'x', title: 'Card', house: 'REA', price_usd: 12_000, sale_date: '2026-10-20' }], picks: [], lastSentOn: '2026-10-20',
  })!;
  assert.equal(d.results.length, 1);
  assert.equal(d.results[0].inReach, false);
  assert.match(d.results[0].vsMax!, /\+20% vs your max/);
  assert.match(d.subject, /1 watch of yours sold/);
  assert.equal(d.results[0].day, 'Tue, Oct 20');
  // a result older than the last email is not repeated
  const d2 = planDesk({ now: NOW, watches: [{ lot_id: 'x' }], live: new Map(), sold: [{ id: 'x', price_usd: 1, sale_date: '2026-10-19' }], picks: [], lastSentOn: '2026-10-20' })!;
  assert.equal(d2.results.length, 0);
  const { html } = render(d);
  assert.ok(html.includes('Did you win it?'));
  assert.ok(html.includes('/profile?utm_source=daily-desk&amp;utm_medium=email#results') || html.includes('/profile?utm_source=daily-desk&utm_medium=email#results'));
});

test('your desk today: every live watch not already under needs-you, soonest first, with movement since the save and the room to your max', () => {
  const a = lot('a', 50 * H, { currentBid: 1200, bidCount: 9 }), b = lot('b', 60 * H, { currentBid: 300, bidCount: 4 }), c = lot('c', null, { bidCount: 7 });
  const over = lot('over', 70 * H, { currentBid: 500, bidCount: 3 });
  const d = planDesk({
    now: NOW, watches: [{ lot_id: 'a', max_usd: 2000, bid_count: 5 }, { lot_id: 'b', max_usd: 350, bid_count: 4 }, { lot_id: 'c' }, { lot_id: 'over', max_usd: 400, bid_count: 1 }],
    live: liveMap([a, b, c, over]), sold: [], picks: [],
  })!;
  assert.deepEqual(d.overMax.map(i => i.id), ['over']);
  assert.deepEqual(d.desk.map(r => r.id), ['a', 'b', 'c']);   // the over-max lot prints once, above; an undated lot last
  assert.equal(d.deskAbove, 1);
  const [ra, rb, rc] = d.desk;
  assert.equal(ra.moved, '+4 bids since you saved it');
  assert.equal(ra.room, '$800 under your max $2K');
  assert.equal(ra.bids, '9 bids');
  assert.equal(rb.moved, 'no new bids since you saved it');   // a baseline that equals today's count is a fact
  assert.equal(rb.room, '$50 under your max $350');
  assert.equal(rc.moved, null);   // no baseline → no claim, the count alone
  assert.equal(rc.bids, '7 bids');
  assert.equal(rc.room, null);
  assert.equal(d.deskMore, 0);
  const { html, text } = render(d);
  assert.ok(html.includes('Your desk today'));
  assert.ok(html.includes('+4 bids since you saved it'));
  assert.ok(html.includes('+ the 1 above under Needs you'));
  assert.equal(html.split('Lot over').length - 1, 1);   // the title prints once in the whole paper
  assert.ok(text.includes('YOUR DESK TODAY'));
  // every live watch under needs-you: the desk says so instead of repeating them
  const d2 = planDesk({ now: NOW, watches: [{ lot_id: 'over', max_usd: 400 }], live: liveMap([over]), sold: [], picks: [] })!;
  assert.equal(d2.desk.length, 0);
  assert.equal(d2.deskAbove, 1);
  assert.ok(render(d2).html.includes('All 1 of your live watch is under Needs you.'));
});

test('the desk caps at DESK_ROWS and says how many more', () => {
  const ls = Array.from({ length: DESK_ROWS + 3 }, (_, k) => lot(`l${k}`, (k + 2) * 24 * H));
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
  assert.equal(d.glance.week, 4);    // the glance counts what the calendar counts: watches (w1, w2, n1) + picks (p1)
  const { html, text } = render(d);
  assert.ok(html.includes('Closing this week'));
  assert.ok(html.includes('>Today<'));
  assert.ok(html.includes('1 n.'));   // the names count abbreviated so seven cells fit a phone
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
  const ids = (f: NonNullable<typeof d.fresh>) => f.groups.flatMap(g => g.items.map(i => i.id)).sort();
  assert.deepEqual(ids(d.fresh), ['f1', 'f2']);
  assert.equal(d.fresh.total, 2);
  assert.deepEqual(d.fresh.groups.map(g => [g.label, g.href, g.total, g.more]), [['By Andy Warhol', '/makers/andy-warhol', 2, 0]]);
  assert.match(d.fresh.since, /first seen on lectr since your last Desk \(Mon, Oct 19\)/);
  assert.match(d.subject, /2 new lots for the names you follow/);
  // no last send: the first paper reads since yesterday (the watched lot is never "new for you")
  const d2 = planDesk({ now: NOW, watches: [{ lot_id: 'wt' }], live: liveMap(book), sold: [], picks: [], follows: [FOLLOW_WARHOL], book })!;
  assert.deepEqual(ids(d2.fresh!), ['f1', 'f2']);
  assert.match(d2.fresh!.since, /since yesterday,/);
  // a Desk sent yesterday: only today's first-seen lots are new
  const d4 = planDesk({ now: NOW, watches: [], live: liveMap(book), sold: [], picks: [], follows: [FOLLOW_WARHOL], book, lastSentOn: YESTERDAY })!;
  assert.deepEqual(ids(d4.fresh!), ['f1', 'wt']);
  // a book without firstSeen stamps makes no "new" claim at all
  const bare = book.map(l => ({ ...l, firstSeen: undefined })) as AuctionLot[];
  assert.equal(planDesk({ now: NOW, watches: [], live: liveMap(bare), sold: [], picks: [], follows: [FOLLOW_WARHOL], book: bare })!.fresh, null);
  // groups: one per follow that reaches the lot (a name before a category), FRESH_PER_GROUP rows each, "+N more" to the name's page / the feed's new tab
  const many = Array.from({ length: FRESH_PER_GROUP + 2 }, (_, k) => warhol(`m${k}`, (k + 30) * H, { firstSeen: TODAY } as Partial<AuctionLot>));
  const zard = Array.from({ length: 2 }, (_, k) => lot(`z${k}`, (k + 40) * H, { artist: 'pokemon', ek: 'sj:tcg|k:charizard', title: `Charizard ${k}`, firstSeen: TODAY } as unknown as Partial<AuctionLot>));
  const prints = Array.from({ length: 3 }, (_, k) => lot(`p${k}`, (k + 50) * H, { artist: 'kaws', subCat: 'prints', category: 'print', firstSeen: TODAY } as unknown as Partial<AuctionLot>));
  const book3 = [...many, ...zard, ...prints];
  const d3 = planDesk({
    now: NOW, watches: [], live: liveMap(book3), sold: [], picks: [], book: book3,
    follows: [FOLLOW_WARHOL, { kind: 'entity' as const, key: 'sj:tcg|k:charizard', label: 'Charizard' }, { kind: 'cat' as const, key: 'fine-art:prints', label: 'Fine art · Prints & multiples' }],
  })!;
  assert.deepEqual(d3.fresh!.groups.map(g => [g.label, g.total, g.items.length, g.more]), [['By Andy Warhol', 5, FRESH_PER_GROUP, 2], ['Fine Art · Prints & Multiples', 3, 3, 0], ['Charizard', 2, 2, 0]]);   // a category's label comes from the taxonomy
  assert.equal(d3.fresh!.groups[1].href, '/?cat=fine-art&sub=prints&tab=new');
  assert.equal(d3.fresh!.total, 10);
  assert.equal(d3.fresh!.moreGroups, 0);
  assert.ok(d3.fresh!.groups.length <= FRESH_GROUPS);
  const h3 = render(d3).html;
  assert.ok(h3.includes('By Andy Warhol · 5'));
  assert.ok(h3.includes('+2 more by Andy Warhol'));
  assert.ok(h3.includes('/makers/andy-warhol?utm_source=daily-desk'));
  assert.ok(render(d3).text.includes('By Andy Warhol · 5'));
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
  assert.deepEqual(laneOf({ seed: { kind: 'saved', label: 'Companion (Flayed)' } }), { kind: 'saved', label: 'Because you saved Companion (Flayed)', who: null });
  // the recommender's discover lane is new to you whatever seed priced it
  assert.equal(laneOf({ seed: { kind: 'follow', label: 'Jalen Hurts', follow: {} }, lane: 'discover' }).kind, 'new');
  // a saved lot's handle: maker · short title, closed at a whole word inside 48 chars; the maker is not repeated when the title already says it
  assert.deepEqual(laneOf({ seed: { kind: 'saved', label: 'Deux buveurs catalans (Two Catalan Drinkers), pl. 12, from La Suite Vollard', who: 'Pablo Picasso' } }), { kind: 'saved', label: 'Because you saved Pablo Picasso · Deux buveurs catalans…', who: 'Pablo Picasso' });
  assert.deepEqual(laneOf({ seed: { kind: 'saved', label: 'Shohei Ohtani bat', who: 'Shohei Ohtani' } }), { kind: 'saved', label: 'Because you saved Shohei Ohtani · bat', who: 'Shohei Ohtani' });   // a title that opens on the name splits there
  assert.deepEqual(laneOf({ seed: { kind: 'owned', label: 'Chair' } }), { kind: 'saved', label: 'Because you own Chair', who: null });
  assert.equal(laneOf({ seed: { kind: 'follow', label: 'TCG', market: 'tcg' } }).kind, 'new');
  assert.equal(laneOf({ seed: { kind: 'follow', label: 'KAWS', follow: {} }, tier: 2 }).kind, 'new');
  const row = (id: string, d: string, p = 100) => ({ id, p, d, h: 'Phillips', t: `T ${id}` });
  assert.equal(lastSaleOf({ recent: [row('r1', '2026-10-01'), row('r2', '2026-10-14')], top: [row('t1', '2025-01-01', 9e6)] })?.id, 'r2');
  assert.equal(lastSaleOf({ recent: [], top: [] }), null);
  assert.equal(lastSaleOf(null), null);
});

test('your names: one ledger line per followed name — live count, soonest sale, last hammer; houses are not names', () => {
  const n1 = warhol('n1', 30 * H), n2 = warhol('n2', 60 * H, { auctionHouse: 'Phillips' } as Partial<AuctionLot>);
  const book = [n1, n2, lot('o', 20 * H, { artist: 'tom-sachs', subCat: 'prints', category: 'print' } as unknown as Partial<AuctionLot>)];
  const d = planDesk({
    now: NOW, tz: 'America/New_York', watches: [], live: liveMap(book), sold: [], picks: [],
    follows: [FOLLOW_WARHOL, { kind: 'maker', key: 'kaws', label: 'KAWS' }, { kind: 'house', key: 'Goldin', label: 'Goldin' }, { kind: 'cat', key: 'fine-art:prints', label: 'Fine art · Prints' }],
    book, nameSold: new Map([['mk:andy-warhol', { id: 'sold-1', p: 48_000, d: '2026-10-14', h: "Christie's", t: 'Flowers' }]]),
  })!;
  assert.equal(d.names.length + d.quietNames.length, 3);   // the house follow is not a name
  assert.equal(d.names[0].label, 'Andy Warhol');
  assert.equal(d.names[0].live, 2);
  assert.equal(d.names[0].soonest?.house, "Christie's");
  assert.match(d.names[0].soonest?.when ?? '', /^tomorrow /);
  assert.deepEqual(d.names[0].last, { id: 'sold-1', hammer: '$48K', day: 'Oct 14', house: "Christie's", title: 'Flowers' });
  assert.equal(d.names[0].href, '/makers/andy-warhol');
  assert.deepEqual(d.quietNames, ['KAWS']);                // nothing live: collapsed into the quiet line, no hammer claim
  const cat = d.names.find(n => n.label.startsWith('Fine Art'))!;
  assert.equal(cat.live, 1);
  assert.match(cat.note ?? '', /category follow/);
  assert.match(d.subject, /2 of your names are on the block/);
  const { html, text } = render(d);
  assert.ok(html.includes('Your names'));
  assert.ok(html.includes('1 more name with nothing live: KAWS'));
  assert.ok(text.includes('1 more name with nothing live: KAWS'));
  assert.ok(html.includes('Last hammer'));
  assert.ok(text.includes('YOUR NAMES'));
  assert.ok(text.includes('- Andy Warhol: 2 live · soonest tomorrow'));
  assert.ok(text.includes('last hammer $48K Oct 14 at Christie\'s — Flowers'));
  assert.ok(text.includes('https://lectr.bid/makers/andy-warhol?utm_source=daily-desk'));
  assert.ok(text.includes('category follow · live lots only'));
});

test('names cap at NAME_ROWS, live names first', () => {
  const follows = Array.from({ length: NAME_ROWS + 2 }, (_, k) => ({ kind: 'maker' as const, key: `maker-${k}`, label: `Maker ${k}` }));
  const live = lot('z', 20 * H, { artist: 'maker-9', ek: 'pl:maker-9' } as unknown as Partial<AuctionLot>);
  const d = planDesk({ now: NOW, watches: [], live: liveMap([live]), sold: [], picks: [], follows, book: [live] })!;
  assert.deepEqual(d.names.map(n => n.label), ['Maker 9']);
  assert.equal(d.names[0].live, 1);
  assert.equal(d.quietNames.length, NAME_ROWS + 1);
  assert.ok(render(d).html.includes(`${NAME_ROWS + 1} more names with nothing live: Maker 0, Maker 1`));
  // every name quiet: one line, no ledger rows
  const d2 = planDesk({ now: NOW, watches: [], live: new Map(), sold: [], picks: [], follows: follows.slice(0, 2), book: [] })!;
  assert.equal(d2.names.length, 0);
  assert.ok(render(d2).html.includes('Nothing live for your 2 names: Maker 0, Maker 1'));
});

test('a settled-seed lane head reads the title’s leading name; leadingNameOf knows where a name stops', () => {
  assert.equal(leadingNameOf('Thomas Edison Autograph Letter Signed on the Phonograph, 1888'), 'Thomas Edison');
  assert.equal(leadingNameOf('Charles Lindbergh: Donald Albert Hall\'s Spirit of St. Louis Time Sheet'), 'Charles Lindbergh');
  assert.equal(leadingNameOf('Neil A. Armstrong Signed Photograph'), 'Neil A. Armstrong');
  assert.equal(leadingNameOf('1961 Topps #415 Hank Aaron PSA 9'), null);   // opens on a year
  assert.equal(leadingNameOf('Flowers'), null);                             // one word is a title, not a name
  assert.equal(leadingNameOf('Deux buveurs catalans (Two Catalan Drinkers)'), null);
  // the seed of a settled watch carries no `who`: the runner's read (or the title) leads the lane head
  assert.deepEqual(laneOf({ seed: { kind: 'saved', label: 'Thomas Edison Autograph Letter Signed on the Phonograph, 1888' } }), { kind: 'saved', label: 'Because you saved Thomas Edison · Autograph Letter Signed on the…', who: 'Thomas Edison' });
  assert.deepEqual(laneOf({ seed: { kind: 'saved', label: 'Autograph Letter Signed, 1888' } }, 'Thomas Edison'), { kind: 'saved', label: 'Because you saved Thomas Edison · Autograph Letter Signed, 1888', who: 'Thomas Edison' });
  assert.deepEqual(laneOf({ seed: { kind: 'saved', label: 'Flowers' } }), { kind: 'saved', label: 'Because you saved Flowers', who: null });
  // the name runs straight into a slash: no split ("Tom Brady · /Patrick Mahomes" read wrong)
  assert.deepEqual(laneOf({ seed: { kind: 'saved', label: 'Tom Brady/Patrick Mahomes II Dual-Signed Ticket', who: 'Tom Brady' } }), { kind: 'saved', label: 'Because you saved Tom Brady/Patrick Mahomes II Dual-Signed Ticket', who: 'Tom Brady' });
});

test('the desk says how many watches have settled, and how many results still wait, regardless of date', () => {
  const a = lot('a', 50 * H);
  const d = planDesk({ now: NOW, watches: [{ lot_id: 'a' }, { lot_id: 'old1' }, { lot_id: 'old2' }, { lot_id: 'old3' }], live: liveMap([a]), sold: [], picks: [], pendingResults: 83 })!;
  assert.equal(d.deskSettled, 3);
  assert.equal(d.pendingResults, 83);
  const { html, text } = render(d);
  assert.ok(html.includes('3 more of your watches have settled — <a href="https://lectr.bid/profile?utm_source=daily-desk&utm_medium=email#record"'));
  assert.ok(html.includes('83 results still waiting on your desk →'));
  assert.ok(!html.includes('#results?utm'));   // the utm sits ahead of the anchor on every page link
  assert.ok(!/#[\w-]+\?utm_source/.test(html));
  assert.ok(html.includes('/profile?utm_source=daily-desk&utm_medium=email#results'));
  assert.ok(html.includes('Nothing new today — no bid has passed your max'));
  assert.ok(text.includes('3 more of your watches have settled — under Record: https://lectr.bid/profile#record'));
  assert.ok(text.includes('83 results still waiting on your desk: https://lectr.bid/profile#results'));
  // nothing live, nothing pending: the plain lines
  const d2 = planDesk({ now: NOW, watches: [{ lot_id: 'old1' }], live: new Map(), sold: [], picks: [] })!;
  const h2 = render(d2).html;
  assert.ok(h2.includes('Nothing of yours is live right now.'));
  assert.ok(h2.includes('1 of your watches has settled — '));
  assert.ok(!h2.includes('still waiting'));
  assert.ok(h2.includes('no result waits on you'));
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
  assert.equal(d.market.length, 6);
  // r / p: 3 × 0.9, 3 × 1.1, 1.41, 1.8 → median 1.1 → hammers ran 10% over; the stale row is out
  assert.match(texts[0], /^Hammers ran 10% over the engine’s calls this week — median of 8 calls graded against the hammer, realized vs the call, both all-in/);
  assert.equal(d.market[0].href, '/receipts');
  assert.match(texts[1], /^Below-market flags hammered \+44% vs estimate — all-in, median of 2,903 settled flags, against \+20% unflagged/);
  assert.equal(d.market[1].href, '/analytics');
  // the biggest hammer yesterday IN YOUR MARKETS (sports, from the Mantle follow) — the $90K art hammer is not yours
  assert.match(texts[2], /^\$28K — the biggest hammer yesterday in your markets — 1961 Topps #415 Hank Aaron PSA 9 at REA/);
  assert.equal(d.market[2].href, '/lot?id=big');
  assert.match(texts[3], /^76 bids on the most-bid lot closing tonight — 2004 Upper Deck patch auto at Goldin, \$6.5K bid/);
  assert.match(texts[4], /^1 lot on the block the engine reads below market — of 3 live/);
  assert.equal(d.market[4].href, '/value');
  assert.match(texts[5], /^1 lot first seen since yesterday/);
  const { html, text } = render(d);
  assert.ok(html.includes('The market'));
  assert.ok(html.includes('https://lectr.bid/receipts?utm_source=daily-desk'));
  assert.ok(text.includes('THE MARKET'));
  assert.ok(text.includes('- Hammers ran 10% over the engine’s calls this week — median of 8 calls'));
  assert.ok(text.includes('https://lectr.bid/receipts?utm_source=daily-desk'));
  assert.ok(text.includes('- 76 bids on the most-bid lot closing tonight'));
  // no files, no market claims; the record needs RECORD_MIN_N graded calls
  const d2 = planDesk({ now: NOW, watches: [{ lot_id: 'hot' }], live: liveMap([tonight]), sold: [], picks: [], book: [tonight], receipts: { rows: rows.slice(0, 2) } })!;
  assert.ok(!d2.market.some(m => m.href === '/receipts'));
  assert.ok(!d2.market.some(m => m.href === '/analytics'));
  // under, and on the nose
  const under = Array.from({ length: 5 }, (_, k) => ({ id: `u${k}`, k: 'card', d: '2026-10-10', sd: '2026-10-18', p: 1000, r: 750 }));
  assert.match(planDesk({ now: NOW, watches: [{ lot_id: 'hot' }], live: liveMap([tonight]), sold: [], picks: [], book: [tonight], receipts: { rows: under } })!.market[0].strong!, /^Hammers ran 25% under the engine’s calls this week/);
  const on = under.map(r => ({ ...r, r: 1000 }));
  assert.match(planDesk({ now: NOW, watches: [{ lot_id: 'hot' }], live: liveMap([tonight]), sold: [], picks: [], book: [tonight], receipts: { rows: on } })!.market[0].strong!, /^Hammers landed on the engine’s calls this week/);
});

test('yesterday on lectr: your names’ sales settled yesterday, from the detail buckets’ recent rows', () => {
  const row = (id: string, d: string, p: number, h = 'REA') => ({ id, p, d, h, t: `Card ${id}` });
  const book = [lot('z', 400 * H)];
  const base = {
    now: NOW, tz: 'America/New_York', watches: [], live: liveMap(book), sold: [], picks: [], book,
    follows: [{ kind: 'maker' as const, key: 'mickey-mantle', label: 'Mickey Mantle' }, FOLLOW_WARHOL],
  };
  const d = planDesk({
    ...base,
    nameRecent: new Map([
      ['pl:mickey-mantle', [row('m1', YESTERDAY, 28_290), row('m2', YESTERDAY, 900), row('m0', '2026-10-10', 99_000)]],
      ['mk:andy-warhol', [row('w1', YESTERDAY, 243_200, "Christie's")]],
    ]),
  })!;
  const y = d.market.find(m => m.strong?.startsWith('Yesterday on lectr'))!;
  assert.equal(y.strong, 'Yesterday on lectr: 3 sales by your names settled');
  assert.match(y.text, /^\$243K for Card w1 \(Andy Warhol\) at Christie's, 2 more across Andy Warhol, Mickey Mantle/);
  assert.equal(y.href, '/lot?id=w1');
  // nothing settled yesterday → no line, no claim
  assert.ok(!planDesk({ ...base, nameRecent: new Map([['pl:mickey-mantle', [row('m0', '2026-10-10', 99_000)]]]) })!.market.some(m => m.strong?.startsWith('Yesterday')));
  assert.ok(!planDesk(base)!.market.some(m => m.strong?.startsWith('Yesterday')));
  assert.ok(render(d).html.includes('Yesterday on lectr'));
  assert.ok(render(d).text.includes('- Yesterday on lectr: 3 sales by your names settled — $243K for Card w1 (Andy Warhol)'));
});

test('the plain-text edition carries every section: needs you, the desk, the week, new for you, the picks’ lanes, names, market', () => {
  const over = lot('over', 70 * H, { currentBid: 500, bidCount: 3 }), rest = lot('rest', 80 * H, { currentBid: 100, bidCount: 2 });
  const d = planDesk({
    now: NOW, watches: [{ lot_id: 'over', max_usd: 400 }, { lot_id: 'rest', max_usd: 900, bid_count: 1 }, { lot_id: 'x', max_usd: 10_000, est_mid: 8_000 }],
    live: liveMap([over, rest]), sold: [{ id: 'x', title: 'Card', house: 'REA', price_usd: 12_000, sale_date: '2026-10-20' }], lastSentOn: '2026-10-20',
    picks: [{ lot: lot('p1', 72 * H), note: 'Like your prints', lane: { kind: 'follow', label: 'Because you follow KAWS' } }],
  })!;
  const { text } = render(d);
  for (const s of ['NEEDS YOU', 'Bids past your max', 'Results to confirm', 'Did you win it? https://lectr.bid/profile#results', '+20% vs your max $10K', 'YOUR DESK TODAY', '+1 bid since you saved it', '$800 under your max $900', '+ the 1 above under needs you', 'CLOSING THIS WEEK', 'THE PICKS', 'Because you follow KAWS', 'Open your desk: https://lectr.bid/profile', 'Email settings: https://lectr.bid/profile#account']) {
    assert.ok(text.includes(s), `text edition lacks "${s}"`);
  }
});

test('the lead picks the richest fact: needs you, closing, results, new, the week, the names, the market', () => {
  const far = lot('far', 4 * 24 * H);
  const d1 = planDesk({ now: NOW, watches: [{ lot_id: 'far' }], live: liveMap([far]), sold: [], picks: [] })!;
  assert.equal(d1.subject, 'Your desk: 1 of yours closes this week');
  // picks are not "yours": the week's lead and the glance split watches from picks
  const p1 = lot('p1', 2 * 24 * H), p2 = lot('p2', 3 * 24 * H), p3 = lot('p3', 5 * 24 * H);
  const picks3 = [p1, p2, p3].map(l => ({ lot: l, note: 'x', lane: { kind: 'new' as const, label: 'New to you' } }));
  const dp = planDesk({ now: NOW, watches: [{ lot_id: 'gone' }], live: liveMap([p1, p2, p3]), sold: [], picks: picks3 })!;
  assert.equal(dp.glance.week, 3);
  assert.deepEqual([dp.glance.weekWatches, dp.glance.weekPicks], [0, 3]);
  // with picks on the paper, the lead is the richest of new / picks / names — "3 picks for you today"; the week fact follows
  assert.equal(dp.subject, 'Your desk: 3 picks for you today');
  assert.match(dp.preheader, /3 picks for you close this week/);
  assert.ok(render(dp).html.includes('0 watches + 3 picks closing'));
  const dm = planDesk({ now: NOW, watches: [{ lot_id: 'far' }, { lot_id: 'p1' }], live: liveMap([far, p1, p2, p3]), sold: [], picks: picks3.slice(1) })!;
  assert.match(dm.preheader, /2 of your watches and 2 picks close this week/);
  assert.ok(render(dm).html.includes('2 watches + 2 picks closing'));
  // nothing new, no picks, one name live: the names lead; else the week's words alone
  const n1 = warhol('n1', 30 * H);
  const dn = planDesk({ now: NOW, watches: [], live: liveMap([n1]), sold: [], picks: [], follows: [FOLLOW_WARHOL], book: [n1] })!;
  assert.equal(dn.subject, 'Your desk: 1 of your names is on the block');
  const dw = planDesk({ now: NOW, watches: [{ lot_id: 'far' }, { lot_id: 'gone' }], live: liveMap([far, p1]), sold: [], picks: picks3.slice(0, 1), follows: [], book: [] })!;
  assert.equal(dw.subject, 'Your desk: 1 pick for you today');
  assert.match(dw.preheader, /1 of your watches and 1 pick close this week/);
  // the richest wins: 52 new beats 8 picks
  const many = Array.from({ length: 12 }, (_, k) => warhol(`m${k}`, (k + 30) * H, { firstSeen: TODAY } as Partial<AuctionLot>));
  const dr = planDesk({ now: NOW, watches: [], live: liveMap(many), sold: [], picks: picks3, follows: [FOLLOW_WARHOL], book: many })!;
  assert.equal(dr.subject, 'Your desk: 12 new lots for the names you follow');
  assert.match(dr.preheader, /^3 picks · 1 name on the block/);
  const soon = lot('soon', 3 * H);
  const d2 = planDesk({ now: NOW, watches: [{ lot_id: 'soon' }, { lot_id: 'far' }], live: liveMap([soon, far]), sold: [], picks: [] })!;
  assert.equal(d2.subject, 'Your desk: 1 of yours closes today');
  const flagged = lot('flag', 400 * H, { signal: { label: 'Below Market', pct: 40, basis: 6, kind: 'form', confidence: 'low' } } as unknown as Partial<AuctionLot>);
  const d3 = planDesk({ now: NOW, watches: [], live: liveMap([flagged]), sold: [], picks: [], follows: [{ kind: 'house', key: 'Goldin', label: 'Goldin' }], book: [flagged] })!;
  assert.equal(d3.subject, 'Your desk: 1 below-market flag on the block');
});

test('"In this edition" lists the sections present with their counts, in html and text', () => {
  const a = lot('a', 5 * H), b = lot('b', 50 * H);
  const d = planDesk({ now: NOW, watches: [{ lot_id: 'a' }, { lot_id: 'b' }], live: liveMap([a, b]), sold: [], picks: [{ lot: lot('p', 72 * H), note: 'x', lane: { kind: 'new', label: 'New to you' } }] })!;
  assert.deepEqual(d.edition, ['Needs you (1)', 'Your desk today (2)', 'Closing this week (3)', 'The picks (1)']);
  const { html, text } = render(d);
  assert.ok(html.includes('In this edition: Needs you (1) · Your desk today (2) · Closing this week (3) · The picks (1)'));
  assert.ok(text.includes('In this edition: Needs you (1) · Your desk today (2) · Closing this week (3) · The picks (1)'));
  assert.deepEqual(planDesk({ now: NOW, watches: [{ lot_id: 'gone' }], live: new Map(), sold: [], picks: [] })!.edition, []);
});

test('results to confirm: RESULT_ROWS newest first, grouped by day when they span days, "and N more"', () => {
  const rows = Array.from({ length: 8 }, (_, k) => ({ id: `r${k}`, title: `Card ${k}`, house: 'REA', price_usd: 1000 + k, sale_date: k < 5 ? '2026-10-20' : '2026-10-21' }));
  const d = planDesk({ now: NOW, watches: rows.map(r => ({ lot_id: r.id })), live: new Map(), sold: rows, picks: [], lastSentOn: '2026-10-19' })!;
  assert.equal(d.results.length, 5);
  assert.equal(d.resultsMore, 3);
  assert.deepEqual(d.results.map(r => r.day), ['Wed, Oct 21', 'Wed, Oct 21', 'Wed, Oct 21', 'Tue, Oct 20', 'Tue, Oct 20']);   // newest day first, biggest hammer first within it
  assert.equal(d.results[0].id, 'r7');
  assert.match(d.subject, /8 watches of yours sold/);
  const { html, text } = render(d);
  assert.ok(html.includes('Results to confirm · 8'));
  assert.ok(html.includes('>Wed, Oct 21<') && html.includes('>Tue, Oct 20<'));
  assert.ok(html.includes('and 3 more results'));
  assert.ok(text.includes('Wed, Oct 21\n- Card 7'));
  assert.ok(text.includes('and 3 more: https://lectr.bid/profile#results'));
  // one day: no day heads
  const one = planDesk({ now: NOW, watches: rows.slice(0, 2).map(r => ({ lot_id: r.id })), live: new Map(), sold: rows.slice(0, 2), picks: [], lastSentOn: '2026-10-19' })!;
  assert.ok(!render(one).html.includes('>Tue, Oct 20<'));
});

test('your collection: each owned piece with what you paid and its maker’s latest hammer; no hammer on file, no claim', () => {
  const liveOwned = warhol('lw', 60 * H, { title: 'Flowers, 1970' } as Partial<AuctionLot>);
  const d = planDesk({
    now: NOW, watches: [
      { lot_id: 'own-1', saved_title: 'Cow, 1976', saved_artist: 'andy-warhol', owned: true, paid_usd: 12_000 },
      { lot_id: 'own-2', saved_title: 'Conoid bench', saved_artist: 'george-nakashima', owned: true, paid_usd: null },
      { lot_id: 'own-3', saved_title: 'A letter', saved_artist: 'science-tech', owned: true, paid_usd: 300 },
      { lot_id: 'lw', owned: true, paid_usd: 5_000 },
      { lot_id: 'w', max_usd: 100 },
    ],
    live: liveMap([liveOwned, lot('w', 50 * H)]), sold: [], picks: [],
    nameSold: new Map([['mk:andy-warhol', { id: 'sold-1', p: 243_200, d: '2026-10-21', h: "Christie's", t: 'African Elephant' }]]),
  })!;
  assert.equal(d.collection.length, 4);
  assert.deepEqual(d.collection[0], { id: 'own-1', title: 'Cow, 1976', maker: 'Andy Warhol', house: null, img: null, paid: '$12K', latest: { id: 'sold-1', hammer: '$243K', day: 'Oct 21', house: "Christie's" } });
  assert.equal(d.collection[1].maker, 'George Nakashima');
  assert.equal(d.collection[1].latest, null);     // nothing on file for Nakashima here: no line
  assert.equal(d.collection[1].paid, null);
  assert.equal(d.collection[2].maker, null);      // a category slug is not a maker
  assert.equal(d.collection[3].maker, 'Andy Warhol');   // a live owned lot reads its entity
  assert.equal(d.collection[3].latest?.hammer, '$243K');
  assert.equal(d.watched, 1);                     // owned pieces are not watches
  assert.equal(d.deskSettled, 0);
  assert.ok(d.edition.includes('Your collection (4)'));
  const { html, text } = render(d);
  assert.ok(html.includes('Your collection'));
  assert.ok(html.includes('Andy Warhol’s latest hammer <b style="font-weight:600">$243K</b>'));
  assert.ok(html.includes('bought $12K'));
  assert.ok(text.includes('- Cow, 1976 · Andy Warhol · bought $12K · Andy Warhol’s latest hammer $243K, Oct 21, Christie\'s'));
  assert.ok(!render(planDesk({ now: NOW, watches: [{ lot_id: 'w' }], live: liveMap([lot('w', 50 * H)]), sold: [], picks: [] })!).html.includes('Your collection'));
  // a piece the save kept no title or maker for reads its sold row (the real edition printed "Piece")
  const ds = planDesk({
    now: NOW, watches: [{ lot_id: 'wright-400282', owned: true }], live: new Map(),
    sold: [{ id: 'wright-400282', title: 'Coral Table Lamp', house: 'Wright', artist: 'george-nakashima', price_usd: 4_000, sale_date: '2026-06-01', image_url: 'https://img/x.jpg' }], picks: [],
    nameSold: new Map([['mk:george-nakashima', { id: 'nk-1', p: 46_000, d: '2026-10-15', h: 'Bonhams', t: 'Conoid Desk' }]]),
  })!;
  assert.deepEqual(ds.collection[0], { id: 'wright-400282', title: 'Coral Table Lamp', maker: 'George Nakashima', house: 'Wright', img: 'https://img/x.jpg', paid: null, latest: { id: 'nk-1', hammer: '$46K', day: 'Oct 15', house: 'Bonhams' } });
  assert.equal(ds.results.length, 0);   // an owned piece's own sale is not a result to confirm… (it is older than the window anyway)
  assert.ok(render(ds).html.includes('George Nakashima · Wright'));
  const dn = planDesk({ now: NOW, watches: [{ lot_id: 'nothing-known', owned: true }], live: new Map(), sold: [], picks: [] })!;
  assert.equal(dn.collection[0].title, 'Untitled piece');
});

test('the subject: needs-you in count + noun form, never a period, capped at SUBJECT_MAX', () => {
  const c = lot('c', 8 * H, { currentBid: 5000 });
  const d = planDesk({ now: NOW, watches: [{ lot_id: 'c', max_usd: 4000 }], live: liveMap([c]), sold: [], picks: [] })!;
  assert.equal(d.subject, 'Your desk: 1 bid past your max');
  assert.equal(d.headline, '1 bid has passed your max.');
  const many = Array.from({ length: 12 }, (_, k) => warhol(`m${k}`, (k + 30) * H, { firstSeen: TODAY } as Partial<AuctionLot>));
  const dr = planDesk({ now: NOW, watches: [], live: liveMap(many), sold: [], picks: [], follows: [FOLLOW_WARHOL], book: many })!;
  assert.equal(dr.subject, 'Your desk: 12 new lots for the names you follow');
  const flagged = lot('flag', 400 * H, { signal: { label: 'Below Market', pct: 40, basis: 6, kind: 'form', confidence: 'low' } } as unknown as Partial<AuctionLot>);
  const dm = planDesk({ now: NOW, watches: [], live: liveMap([flagged]), sold: [], picks: [], follows: [{ kind: 'house', key: 'Goldin', label: 'Goldin' }], book: [flagged] })!;
  assert.equal(dm.subject, 'Your desk: 1 below-market flag on the block');   // the market's fact, as the fact
  for (const s of [d.subject, dr.subject, dm.subject]) { assert.ok(s.length <= SUBJECT_MAX); assert.ok(!/\.$/.test(s)); }
  // a long lead closes at a whole word under the cap
  const dw = planDesk({ now: NOW, watches: [{ lot_id: 'far' }, { lot_id: 'p1' }], live: liveMap([lot('far', 4 * 24 * H), lot('p1', 2 * 24 * H), lot('p2', 3 * 24 * H)]), sold: [], picks: [{ lot: lot('p2', 3 * 24 * H), note: 'x', lane: { kind: 'new', label: 'New to you' } }] })!;
  assert.ok(dw.subject.length <= SUBJECT_MAX, dw.subject);
});

test('the size guard: a fat edition trims picks, New for you, the desk, then the names until it fits, and says so', () => {
  const longTitle = 'A very long catalogue title that runs on and on about the piece, its provenance and its condition, as they do';
  // (a house whose every lot is first seen today is an onboarding flood to isNewLot — only a third are "new")
  const many = Array.from({ length: 60 }, (_, k) => warhol(`m${k}`, (k + 60) * H, { title: `${longTitle} ${k}`, firstSeen: k % 3 ? '2026-10-01' : TODAY, imageUrl: `https://img.example/${k}.jpg`.repeat(8) } as unknown as Partial<AuctionLot>));
  const watches = many.slice(0, 12).map(l => ({ lot_id: l.id, max_usd: 1000, bid_count: 1 }));
  const picks = many.slice(12, 20).map((l, k) => ({ lot: l, note: longTitle, lane: { kind: 'saved' as const, label: `Because you saved ${k}`, who: null } }));
  const follows = Array.from({ length: 12 }, (_, k) => ({ kind: 'maker' as const, key: `maker-${k}`, label: `Maker ${k}` }));
  const fat = planDesk({ now: NOW, watches, live: liveMap(many), sold: [], picks, follows: [FOLLOW_WARHOL, ...follows], book: many })!;
  assert.ok(fat.desk.length === 12 && fat.picks.length === 8 && fat.fresh!.groups.length >= 1);
  const o = { origin: 'https://lectr.bid', unsubUrl: 'https://lectr.bid/u', dateLabel: 'Wednesday, Oct 21' };
  const full = renderDesk(fat, o);
  assert.ok(full.html.length <= SIZE_CAP && !full.trimmed);      // this edition fits as it is
  assert.ok(!full.html.includes('Trimmed for your inbox'));
  // under a cap it cannot meet, every trim fires in order and the foot says so
  const tiny = renderDesk(fat, { ...o, sizeCap: 10_000 });
  assert.ok(tiny.trimmed);
  assert.ok(tiny.html.includes('Trimmed for your inbox'));
  assert.equal((tiny.html.match(/Because you saved \d/g) || []).length, 6);   // picks → 6
  assert.ok(tiny.html.includes('and 4 more on your desk'));                   // desk 12 → 8
  // a cap the first trim alone meets stops there
  const first = renderDesk(fat, { ...o, sizeCap: full.html.length - 1 });
  assert.ok(first.trimmed);
  assert.equal((first.html.match(/Because you saved \d/g) || []).length, 6);
  assert.ok(!first.html.includes('more on your desk'));
  assert.ok(first.html.length < full.html.length);
  // a thin edition is never trimmed
  const thin = planDesk({ now: NOW, watches: [{ lot_id: 'm0' }], live: liveMap(many.slice(0, 1)), sold: [], picks: [] })!;
  assert.ok(!renderDesk(thin, o).trimmed);
});

test('two saved-lot lanes of one maker merge; a baseline of zero says all the bids came since the save; an empty New for you is one line', () => {
  const mk = (id: string, label: string, who: string) => ({ lot: lot(id, 72 * H), note: 'x', lane: { kind: 'saved' as const, label, who } });
  const d = planDesk({ now: NOW, watches: [], live: new Map(), sold: [], picks: [mk('a', 'Because you saved Thomas Edison · Letter', 'Thomas Edison'), mk('b', 'Because you saved Thomas Edison · Book', 'Thomas Edison'), mk('c', 'Because you saved Charles Schulz · Snoopy', 'Charles Schulz')] })!;
  assert.deepEqual(d.picks.map(p => p.lane?.label), ['Because you saved 2 Thomas Edison lots', 'Because you saved 2 Thomas Edison lots', 'Because you saved Charles Schulz · Snoopy']);
  const z = lot('z', 50 * H, { currentBid: 900, bidCount: 13 });
  const dz = planDesk({ now: NOW, watches: [{ lot_id: 'z', bid_count: 0 }], live: liveMap([z]), sold: [], picks: [] })!;
  assert.equal(dz.desk[0].moved, 'all 13 bids since you saved it');
  const quietBook = [warhol('q', 48 * H, { firstSeen: '2026-10-01' } as Partial<AuctionLot>)];
  const dq = planDesk({ now: NOW, watches: [], live: liveMap(quietBook), sold: [], picks: [], follows: [FOLLOW_WARHOL, { kind: 'cat', key: 'space-science:science-tech', label: 'Space & Science · science-tech' }], book: quietBook })!;
  assert.equal(dq.fresh?.total, 0);
  const h = render(dq).html;
  assert.ok(h.includes('Nothing first seen since yesterday by a name or category you follow.'));
  assert.ok(!h.includes('0 new ·'));
  assert.deepEqual(dq.quietNames, ['Science & Technology']);   // the taxonomy's label, not the stored "Space & Science · science-tech"
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
  assert.ok(h2.includes('Nothing of yours is live right now.'));
  assert.ok(h2.includes('2 of your watches have settled — '));
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
  assert.equal(d.glance.next?.above, true);   // it prints under needs-you; the glance keeps its clock, not a third title
  assert.ok(render(d).html.includes('first under Needs you'));
  assert.equal(planDesk({ now: NOW, watches: [{ lot_id: 'd3' }], live: liveMap([d3]), sold: [], picks: [] })!.glance.next?.above, false);
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

/**
 * (Oct 9) bare-name culture lots: the person a title leads with, and the
 * learned person → domain map (stampSubCats).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { subjectNameOf, settleNameDomains, personVoteKeys } from '../lib/subject-name';
import { stampSubCats } from '../lib/corpus-normalize';

test('subjectNameOf · reads the leading person name', () => {
  const ok: [string, string][] = [
    ['Paul Newman', 'paul newman'],
    ['Amelia Earhart', 'amelia earhart'],
    ['Abraham Lincoln Document Signed', 'abraham lincoln'],
    ['Huey Long Signature', 'huey long'],
    ['Charles M. Schulz', 'charles m schulz'],
    ['William B. Astor Autograph Letter Signed', 'william b astor'],
    ['General George S. Patton Signed Photograph', 'george s patton'],
    ['Lee de Forest Typed Letter Signed', 'lee de forest'],
    ['Franz von Papen', 'franz von papen'],
    ['Daniel Day-Lewis Signed Photograph', 'daniel day-lewis'],
    ["Eugene O'Neill Autograph Letter Signed", "eugene o'neill"],
    ['Joe DiMaggio Signed Photograph', 'joe dimaggio'],
    ["Elvis Presley's Personally-Owned Ring", 'elvis presley'],
    ['Robert A. Heinlein: Revolt in 2100 Original Unused Dust Jacket', 'robert a heinlein'],
    ['Martin Luther King, Jr. Signed Book', 'martin luther king'],
    ['Jack Kilby (2) Signed Items', 'jack kilby'],
    ['Charles “Lucky” Luciano Signed Check', 'charles luciano'],
    ['Lincoln, Abraham', 'abraham lincoln'],
    ['Lincoln, Abraham Signed Document', 'abraham lincoln'],
    ['James Monroe Document Signed', 'james monroe'],
    ['Gerald Ford Signed Photograph', 'gerald ford'],
    ['Doris Day Signed Photograph', 'doris day'],
    ['Mae West', 'mae west'],
    ['Freddie Mercury Signed Photograph', 'freddie mercury'],
    ['Olivia de Havilland', 'olivia de havilland'],
  ];
  for (const [t, k] of ok) assert.equal(subjectNameOf(t), k, t);
});

test('subjectNameOf · rejects generic phrases, two people, caps, quotes and non-names', () => {
  const no = [
    'Civil War Confederate Canteen', 'World War II', 'Apollo 11 Flown Flag', 'Los Angeles Dodgers Signed Ball',
    'United States Army Discharge', 'Star Wars', 'James Bond', 'The Who Signed Photograph', 'The Monkees Signed Photograph',
    'Madonna Book', 'Napoleon: Napoleon deals with “recalcitrant conscripts”', 'Mary Martin and Ethel Merman Program',
    'Ban Johnson and Jacob Ruppert Signed Document', 'Laurel and Hardy', 'Road Runner color model drawing by Virgil Ross',
    'BERT STERN (B. 1929) Marilyn Monroe', 'MARILYN MONROE', '“Casablanca” Lobby Card', '2004 World Series',
    '(89) 1909-1940 Lincoln Cent Series', 'Elizabeth, Queen Mother Signed Christmas Card', 'Wallis, Duchess of Windsor',
    'Peter, Paul, and Mary Signed Photograph', 'Mantle, Mays and Snider', 'XB-70 Signed Photograph', 'Richard and Pat Nixon Signatures',
    'Mickey Mouse Animation Cel', 'Red Sox Team Signed Ball', '', null as unknown as string,
  ];
  for (const t of no) assert.equal(subjectNameOf(t), null, String(t));
});

test('personVoteKeys · an initialled name also votes initial-less; a bare name reads only its own key', () => {
  assert.deepEqual(personVoteKeys('william c westmoreland'), ['william c westmoreland', 'william westmoreland']);
  assert.deepEqual(personVoteKeys('william westmoreland'), ['william westmoreland']);
  // "Thomas O. Paine" (NASA) looks up 'thomas o paine' only — never Thomas Paine's votes
  assert.equal(subjectNameOf('Thomas O. Paine Signature'), 'thomas o paine');
});

test('settleNameDomains · keeps a name only on ≥ minN lots and ≥ purity agreement', () => {
  const v = (o: Record<string, number>) => new Map(Object.entries(o));
  const votes = new Map([
    ['huey long', v({ political: 5 })],              // 5/5 → kept
    ['paul newman', v({ hollywood: 8, sports: 2 })], // 8/10 = 80% → kept
    ['thomas nast', v({ political: 3, literary: 2 })], // 60% → dropped
    ['jim davis', v({ literary: 4 })],               // n = 4 → dropped
    ['tie name', v({ music: 5, hollywood: 5 })],     // 50% → dropped
  ]);
  const m = settleNameDomains(votes);
  assert.deepEqual(Array.from(m).sort(), [['huey long', 'political'], ['paul newman', 'hollywood']]);
  // the gate is a parameter: a looser gate admits the 4-lot name
  assert.equal(settleNameDomains(votes, { minN: 3, purity: 0.8 }).get('jim davis'), 'literary');
  // deterministic tie-break under a 50% gate
  assert.equal(settleNameDomains(votes, { minN: 2, purity: 0.5 }).get('tie name'), 'hollywood');
});

type L = Record<string, unknown>;
const cult = (id: string, title: string, o: L = {}): L => ({ id, artist: 'entertainment-memorabilia', title, auctionHouse: 'RR Auction', saleName: 'Fine Autographs and Artifacts', ...o });

test('stampSubCats · a bare-name lot takes the domain of the same person’s worded lots, never overriding a rule', () => {
  const lots: L[] = [
    // five lots the rules domain political ("as Governor", "Senator")
    ...[1, 2, 3, 4, 5].map(i => cult(`w${i}`, `Huey Long Signed Document as Governor ${i}`)),
    // the bare-name lots
    cult('b1', 'Huey Long Signature'),
    cult('b2', 'Huey Long'),
    // a rule-domained lot of the same person keeps its own domain
    cult('r1', 'Huey Long Concert Ticket'),
    // initialled worded lots feed the initial-less bare lot
    ...[1, 2, 3, 4, 5].map(i => cult(`p${i}`, `William C. Westmoreland Signed Document as Army General ${i}`)),
    cult('pb', 'William Westmoreland Group Lot'),
    // too little evidence: 4 worded lots
    ...[1, 2, 3, 4].map(i => cult(`m${i}`, `Robert Donat Signed Film Still ${i}`)),
    cult('mb', 'Robert Donat Signed Photograph'),
  ];
  const r = stampSubCats(lots as never);
  const by = (id: string) => (lots.find(l => l.id === id) as { drill?: string }).drill;
  assert.equal(by('w1'), 'political');
  assert.equal(by('b1'), 'political');
  assert.equal(by('b2'), 'political');
  assert.equal(by('r1'), 'music');
  assert.equal(by('m1'), 'hollywood');
  assert.equal(by('mb'), undefined);
  assert.equal(by('pb'), 'military');
  assert.equal(r.personDomains, 3);
  // idempotent: the learned stamps never vote, so a re-run converges
  const again = stampSubCats(lots as never);
  assert.equal(again.personDomains, 3);
  assert.equal(by('b1'), 'political');
  assert.equal(by('mb'), undefined);
});

/** shape-check.ts — print lotShapeOf for titles given on the command line
 *  (or the built-in evidence set). tsconfig-excluded (_qa). */
import { lotShapeOf, shapesCompatible } from '../../../app/lib/comps';

const EVIDENCE = [
  '1977 Robin Yount Milwaukee Brewers Signed Game-Used Bat PSA/DNA GU 9.5',
  '1991-93 Robin Yount Signed Game-Used Bat PSA GU 9',
  'Audemars Piguet Royal Oak länkbit',
  'AUDEMARS PIGUET, ROYAL OAK, REF. 15500ST, A STAINLESS STEEL WRISTWATCH WITH DATE AND BRACELET',
  'George Nakashima, Set of Six Conoid Chairs',
  'George Nakashima, Conoid Chair',
  'Jack Kirby Fantastic Four #52 Original Art Page 12',
  'Fantastic Four #52 CGC 9.4',
  'Collection of Eleven Fantastic Four Comic Books',
  'Sam, from 25 Cats Name(d) Sam and One Blue Pussy',
  '25 Cats Name[d] Sam and One Blue Pussy.',
  'Pair of Rolex Cufflinks',
  'Rolex Submariner ref. 16610, with box and papers',
  'Rolex bracelet links for Submariner',
  'Three Musketeers Original Release Poster',
  'Six Conoid Chairs',
  '1952 Topps Complete Set',
  '1952 Topps #311 Mickey Mantle PSA 8',
  'Own a Piece of History: Babe Ruth Signed Ball',
  'Piece of the Yankee Stadium Floor',
];
const titles = process.argv.slice(2).length ? process.argv.slice(2) : EVIDENCE;
for (const t of titles) console.log(JSON.stringify(lotShapeOf(t)), '·', t);
if (!process.argv.slice(2).length) {
  const pairs: [number, number][] = [[0, 1], [2, 3], [4, 5], [6, 7], [6, 8], [9, 10], [12, 13]];
  for (const [a, b] of pairs) console.log(shapesCompatible(lotShapeOf(titles[a]), lotShapeOf(titles[b])) ? 'COMP ' : 'BLOCK', titles[a].slice(0, 45), '↔', titles[b].slice(0, 45));
}

import fs from 'fs'; import path from 'path'; import zlib from 'zlib';
import { ARTIST_MARKET } from '../../app/constants';
const CORPUS = path.join(process.cwd(), 'data', 'corpus');
const c = new Map<string, number>();
function stream(file: string) {
  const buf = zlib.gunzipSync(fs.readFileSync(file));
  let s = 0;
  while (s < buf.length) {
    let e = buf.indexOf(10, s); if (e === -1) e = buf.length;
    if (e > s + 1) { try { const l = JSON.parse(buf.toString('utf8', s, e)); if (ARTIST_MARKET[l.artist] === 'culture' && Array.isArray(l.subjectKeys)) for (const k of l.subjectKeys) c.set(k, (c.get(k) || 0) + 1); } catch {} }
    s = e + 1;
  }
}
stream(path.join(CORPUS, 'lots.json.gz'));
stream(path.join(CORPUS, 'sold-archive.json.gz'));
const top = Array.from(c.entries()).sort((a, b) => b[1] - a[1]).slice(0, 1500);
fs.writeFileSync('scripts/_qa/subjects-top.txt', top.map(([k, n]) => `${n}\t${k}`).join('\n'));
console.log('wrote', top.length, 'subjects; top covers', top.reduce((s, [, n]) => s + n, 0), 'of', Array.from(c.values()).reduce((a, b) => a + b, 0), 'stamps');

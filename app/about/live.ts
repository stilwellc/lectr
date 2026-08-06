/**
 * live.ts — tonight's book, read at BUILD time.
 *
 * /about is otherwise entirely retrospective: it proves the engine was right
 * about sales that already happened and never shows the product doing its job
 * on lots that have not sold yet. This is that moment.
 *
 * Read with fs rather than `import upcoming from '.../upcoming.json'` on
 * purpose: the file is 6MB+ (5,030 lots in production) and a JSON import lands
 * in the module graph wholesale, so importing it to count two numbers would ship
 * the entire upcoming book inside the page. Server components run at build time
 * under output:'export', so this executes once and only the counts reach the
 * HTML.
 *
 * Returns null if the file is absent or malformed — public/data/ray/ is
 * gitignored and pulled from R2, so a build can legitimately run without it, and
 * a missing live band is much better than a failed build.
 */
import * as fs from 'fs';
import * as path from 'path';

export interface LiveBook {
  total: number;
  called: number;
  below: number;
  above: number;
  /** calls whose confidence tier is 'high' */
  high: number;
  generatedAt: string | null;
}

interface Signal { label?: string; confidence?: string }
interface UpcomingLot { signal?: Signal | null }

export function readLiveBook(): LiveBook | null {
  try {
    const p = path.join(process.cwd(), 'public', 'data', 'ray', 'upcoming.json');
    const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as {
      lots?: UpcomingLot[]; generatedAt?: string;
    };
    const lots = raw.lots;
    if (!Array.isArray(lots) || !lots.length) return null;

    const called = lots.filter((l) => l.signal && l.signal.label);
    return {
      total: lots.length,
      called: called.length,
      below: called.filter((l) => /below/i.test(l.signal!.label || '')).length,
      above: called.filter((l) => /above/i.test(l.signal!.label || '')).length,
      high: called.filter((l) => l.signal!.confidence === 'high').length,
      generatedAt: raw.generatedAt ?? null,
    };
  } catch {
    return null;
  }
}

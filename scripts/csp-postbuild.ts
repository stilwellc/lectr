/**
 * csp-postbuild — make the static export satisfy a strict script-src.
 *
 * Next 14's static export inlines the RSC flight payload into every page as a
 * run of `<script>self.__next_f.push(...)</script>` tags. Their contents differ
 * per page (3,600+ unique bodies across ~1,200 pages), so a hash allow-list is
 * unworkable (Cloudflare caps a header value at 2,000 chars) and a nonce needs
 * a server. Instead this step moves each page's flight scripts, in order, into
 * one content-addressed external file:
 *
 *   <script>self.__next_f…</script>×N  →  <script src="/_next/static/chunks/flight/<hash>.js"></script>
 *
 * The replacement is a classic (non-async, non-defer) script placed where the
 * LAST flight script was, so it still runs in document order during parsing —
 * the same semantics the inline tags had. Next's client bootstrap reads
 * `self.__next_f` whenever it runs, so order relative to the async chunks is
 * unchanged. Living under /_next/static/chunks/ means deploy.yml's
 * "every referenced chunk exists" guard covers these files too.
 *
 * What stays inline must be hash-listed: after rewriting, every remaining
 * inline script (today: only the porcelain theme boot in app/layout.tsx) is
 * sha256-hashed and checked against the Content-Security-Policy in out/_headers.
 * A missing hash FAILS THE BUILD, so editing the theme script without updating
 * public/_headers can never ship a page whose theme boot is blocked.
 *
 * Also checks that the Supabase host baked into the bundle is in connect-src.
 *
 * Idempotent: a second run finds no flight scripts and only re-verifies.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const OUT = path.join(process.cwd(), 'out');
const FLIGHT_DIR = path.join(OUT, '_next', 'static', 'chunks', 'flight');
const FLIGHT_URL = '/_next/static/chunks/flight/';

function htmlFiles(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (p === path.join(OUT, 'data') || p === path.join(OUT, '_next')) continue;
      htmlFiles(p, acc);
    } else if (e.name.endsWith('.html')) acc.push(p);
  }
  return acc;
}

function cspFromHeaders(): string {
  const file = path.join(OUT, '_headers');
  if (!fs.existsSync(file)) throw new Error('out/_headers missing — public/_headers did not export');
  const m = fs.readFileSync(file, 'utf8').match(/^\s+Content-Security-Policy:\s*(.+)$/m);
  if (!m) throw new Error('no Content-Security-Policy in out/_headers');
  return m[1].trim();
}

function main() {
  if (!fs.existsSync(OUT)) throw new Error('out/ missing — run next build first');
  fs.mkdirSync(FLIGHT_DIR, { recursive: true });
  const csp = cspFromHeaders();
  const scriptSrc = (csp.match(/(?:^|;)\s*script-src ([^;]+)/) || [])[1] || '';

  // attribute-less inline <script> whose body is Next's flight push
  const FLIGHT = /<script>((?:\(self\.__next_f=self\.__next_f\|\|\[\]\)|self\.__next_f)\.push\([\s\S]*?)<\/script>/g;
  const INLINE = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/g;

  const files = htmlFiles(OUT);
  let rewritten = 0, flightFiles = 0;
  const missing = new Map<string, string>();

  for (const f of files) {
    let html = fs.readFileSync(f, 'utf8');
    const bodies: string[] = [];
    let lastEnd = -1;
    html.replace(FLIGHT, (whole, body: string, offset: number) => {
      bodies.push(body);
      lastEnd = offset + whole.length;
      return whole;
    });
    if (bodies.length) {
      const js = bodies.map(b => b.replace(/;?\s*$/, ';')).join('\n') + '\n';
      const hash = crypto.createHash('sha256').update(js).digest('hex').slice(0, 20);
      const dest = path.join(FLIGHT_DIR, `${hash}.js`);
      if (!fs.existsSync(dest)) { fs.writeFileSync(dest, js); flightFiles++; }
      const tag = `<script src="${FLIGHT_URL}${hash}.js"></script>`;
      // insert at the last flight script's position, then drop every flight tag
      html = html.slice(0, lastEnd) + '\u0000FLIGHT\u0000' + html.slice(lastEnd);
      html = html.replace(FLIGHT, '').replace('\u0000FLIGHT\u0000', tag);
      fs.writeFileSync(f, html);
      rewritten++;
    }

    // every inline script left must be hash-allowed by the CSP
    let m: RegExpExecArray | null;
    INLINE.lastIndex = 0;
    while ((m = INLINE.exec(html))) {
      const attrs = m[1] || '';
      const body = m[2];
      if (/\bsrc=/.test(attrs) || !body) continue;
      const type = (attrs.match(/\btype="([^"]+)"/) || [])[1];
      if (type && !/javascript|module/.test(type)) continue; // data blocks (ld+json) are not executed
      const h = `'sha256-${crypto.createHash('sha256').update(body).digest('base64')}'`;
      if (!scriptSrc.includes(h)) missing.set(h, `${path.relative(OUT, f)}: ${body.slice(0, 80)}`);
    }
  }

  const problems: string[] = [];
  missing.forEach((where, h) => problems.push(`inline script not allowed by script-src — add ${h} to public/_headers (${where})`));

  // CI passes it in the env; locally `next build` read it from .env.local
  let sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const envLocal = path.join(process.cwd(), '.env.local');
  if (!sbUrl && fs.existsSync(envLocal)) {
    sbUrl = (fs.readFileSync(envLocal, 'utf8').match(/^NEXT_PUBLIC_SUPABASE_URL=\s*"?([^"\s]+)/m) || [])[1];
  }
  if (sbUrl) {
    const origin = new URL(sbUrl).origin;
    const connect = (csp.match(/(?:^|;)\s*connect-src ([^;]+)/) || [])[1] || '';
    if (!connect.split(/\s+/).includes(origin)) problems.push(`connect-src is missing the Supabase origin ${origin} — add it to public/_headers`);
  }

  console.log(`csp-postbuild: ${rewritten}/${files.length} pages externalized, ${flightFiles} flight files written`);
  if (problems.length) {
    for (const p of problems) console.error(`::error::${p}`);
    process.exit(1);
  }
  console.log('csp-postbuild: every remaining inline script is hash-allowed ✓');
}

main();

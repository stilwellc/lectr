import type { Metadata } from 'next';
import Link from 'next/link';
import ArtistNav from '../components/ArtistNav';
import { Colophon } from '../components/Terminal';
import Flick from '../components/Flick';
import Masthead, { Underscore } from '../components/Masthead';
import meta from '../../public/data/ray/meta.json';

export const metadata: Metadata = {
  title: 'Notes from the desk',
  description: 'Writing from lectr — how the pricing engine works, what the market data actually says, and what we got wrong on the way.',
};

// `href` is the special case — a card that lives outside /blog/* (the systems
// walk-through at /about). Cards without it link to /blog/{slug} as before.
const POSTS: { slug: string; date: string; title: string; dek: string; href?: string }[] = [
  {
    slug: 'how-lectr-works',
    href: '/about',
    date: '2026-07-17',
    title: 'How lectr works',
    dek: 'The systems walk-through — crawlers, the identity ledger, the engine, and the nightly replay, section by section.',
  },
  {
    slug: 'q2-2026-art',
    date: '2026-07-16',
    title: 'Art in Q2: a two-speed market',
    dek: 'A $240M quarter carried by one Christie’s evening — masterpieces cleared, the middle got picky (56% sell-through), and KAWS kept repricing.',
  },
  {
    slug: 'q2-2026-watches',
    date: '2026-07-16',
    title: 'Watches in Q2: everything sells, the middle repriced',
    dek: '96% sell-through across 728 lots — but the median fell 19% while Patek Philippe ran +67%. A sorting, not a downturn.',
  },
  {
    slug: 'q2-2026-design',
    date: '2026-07-16',
    title: 'Design in Q2: small money, real heat',
    dek: 'The smallest market we track posted the strongest demand of the quarter: 43% of lots beat their high estimate, and Eames woke up.',
  },
  {
    slug: 'q2-2026-sports',
    date: '2026-07-16',
    title: 'Sports in Q2: game-used doubled',
    dek: 'A $1.34M four-player jersey group on top, Messi debut shirts behind it, and the typical sale up 73% — broad participation, not two whales.',
  },
  {
    slug: 'q2-2026-science',
    date: '2026-07-16',
    title: 'Science in Q2: the quiet quarter',
    dek: 'Ten sales — the honest number. Apollo photographs led, and the real season (241 lots on the block) closes in Q3.',
  },
  {
    slug: 'how-we-built-the-pricing-engine',
    date: '2026-07-16',
    title: 'The pricing engine, quantitatively',
    dek: 'The estimator, the gates, the calibration, and the validation protocol — with the formulas, the fitted constants, and the ablations that measured worse.',
  },
];

function fmtLong(date: string): string {
  return new Date(date + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
function fmtShort(date: string): string {
  return new Date(date + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric', timeZone: 'UTC' });
}

/* The research-notes shelf. One markup, two compositions:
   ≥900px — the newest note runs as a full-width lead (Fraunces title, dek,
   dated kicker) over a dated ledger of the remaining notes (mono date ·
   Fraunces title · one dek line · hairline separators — the terminal's
   shelf of research memos). ≤899px keeps the single card stack.
   Injected via __html — raw-text <style> children with quotes break
   hydration on prerendered pages (LotPage's convention). */
const BLOG_CSS = `
.ray-blog-shelf{display:flex;flex-direction:column;gap:14px}
.ray-blog-lead,.ray-blog-entry{display:block;text-decoration:none;color:inherit;border:1px solid var(--hairline);border-radius:12px;padding:22px 24px;background:var(--color-bg-elevated)}
.ray-blog-date{font-family:var(--font-mono),monospace;font-size:11.5px;color:var(--color-text-faint);margin-bottom:8px;font-variant-numeric:tabular-nums}
.ray-blog-title{font-size:21px;font-weight:700;letter-spacing:-0.02em;margin:0 0 8px;line-height:1.3;color:var(--color-fg)}
.ray-blog-dek{font-size:14.5px;line-height:1.55;color:var(--color-text-secondary);margin:0}
.ray-blog-read{display:inline-flex;align-items:center;gap:7px;margin-top:14px;font-size:13px;font-weight:600;color:var(--color-text-muted)}
.ray-blog-lead-kicker{display:none}
.ray-blog-entry-flick{display:none}
.ray-blog-ledger{display:contents}
.ray-blog-ledger-head{display:none}
@media (min-width:900px){
  .ray-blog-shelf{gap:0}
  /* the lead — the newest note, full width, editorial voice */
  .ray-blog-lead{border:none;border-radius:0;background:none;padding:6px 0 30px;transform:none}
  .ray-blog-lead:hover{border:none;transform:none}
  .ray-blog-lead .ray-blog-date{display:none}
  .ray-blog-lead-kicker{display:flex;align-items:baseline;gap:14px;margin-bottom:14px}
  .ray-blog-lead-kicker .no{letter-spacing:0.08em;color:var(--color-text-faint)}
  .ray-blog-lead .ray-blog-title{font-family:var(--font-serif),serif;font-size:clamp(30px,3.6vw,40px);font-weight:420;letter-spacing:-0.015em;line-height:1.12;margin:0 0 12px;max-width:24ch}
  .ray-blog-lead:hover .ray-blog-title{color:var(--color-accent-gold,var(--color-fg))}
  .ray-blog-lead .ray-blog-dek{font-size:15.5px;line-height:1.6;max-width:62ch}
  /* the ledger — the rest of the file as dated rows */
  .ray-blog-ledger{display:block;border-top:2px solid var(--color-fg);position:relative}
  .ray-blog-ledger::before{content:"";position:absolute;top:2px;left:0;right:0;border-top:1px solid var(--hairline)}
  .ray-blog-ledger-head{display:grid;grid-template-columns:118px 1fr;gap:0 22px;padding:9px 0 10px}
  .ray-blog-entry{display:grid;grid-template-columns:118px 1fr auto;gap:2px 22px;align-items:baseline;border:none;border-radius:0;background:none;padding:16px 2px;border-top:1px solid var(--hairline);transition:background var(--duration-fast) var(--ease-signature)}
  .ray-blog-entry:hover{border-color:var(--hairline);transform:none;background:var(--color-hover-item)}
  .ray-blog-entry .ray-blog-date{grid-row:1 / span 2;margin:0;align-self:baseline}
  .ray-blog-entry .ray-blog-title{font-family:var(--font-serif),serif;font-size:19px;font-weight:460;letter-spacing:-0.01em;line-height:1.25;margin:0}
  .ray-blog-entry:hover .ray-blog-title{color:var(--color-accent-gold,var(--color-fg))}
  .ray-blog-entry .ray-blog-dek{grid-column:2;font-size:13px;line-height:1.5;color:var(--color-text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ray-blog-entry .ray-blog-read{display:none}
  .ray-blog-entry-flick{display:block;grid-column:3;grid-row:1;color:var(--color-text-faint)}
}
`;

export default function BlogIndex() {
  // newest first — the lead is the freshest note on the desk
  const posts = [...POSTS].sort((a, b) => b.date.localeCompare(a.date));
  const [lead, ...rest] = posts;
  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)', color: 'var(--color-fg)', fontFamily: 'var(--font-sans), sans-serif' }}>
      <style dangerouslySetInnerHTML={{ __html: BLOG_CSS }} />
      <ArtistNav activeSlug="blog" />
      <main id="main" style={{ paddingTop: 28, paddingBottom: 60 }}>
        <div style={{ maxWidth: 860, margin: '0 auto', padding: '0 var(--gutter)', marginBottom: 34 }}>
          {/* the certificate masthead — dated from the crawl the notes read */}
          <Masthead
            kicker="Notes from the desk"
            serial={meta.lastCrawl}
            title={<>What the data <Underscore>taught us</Underscore>.</>}
            sub={<>
              {POSTS.length} notes on file · occasional writing on how lectr reads the auction market —
              the methods, the measurements, and the wrong turns we kept the receipts for.
            </>}
          />
        </div>

        <section className="ray-blog-shelf" style={{ maxWidth: 860, margin: '0 auto', padding: '0 var(--gutter)' }}>
          {/* the lead — desktop features it full width; mobile renders it as
              the first card of the stack */}
          <Link href={lead.href ?? `/blog/${lead.slug}`} className="ray-blog-card ray-blog-lead">
            <div className="ray-blog-lead-kicker">
              <span className="kicker">Latest from the desk</span>
              <span className="kicker no">{fmtLong(lead.date)}</span>
            </div>
            <div className="ray-blog-date">{fmtLong(lead.date)}</div>
            <h2 className="ray-blog-title">{lead.title}</h2>
            <p className="ray-blog-dek">{lead.dek}</p>
            <span className="ray-blog-read">Read the note <Flick size={12} /></span>
          </Link>

          {/* the rest of the file — cards on mobile, a dated ledger ≥900px */}
          <div className="ray-blog-ledger">
            <div className="ray-blog-ledger-head" aria-hidden>
              <span className="kicker">Dated</span>
              <span className="kicker">Note</span>
            </div>
            {rest.map(p => (
              <Link key={p.slug} href={p.href ?? `/blog/${p.slug}`} className="ray-blog-card ray-blog-entry">
                <div className="ray-blog-date">{fmtShort(p.date)}</div>
                <h2 className="ray-blog-title">{p.title}</h2>
                <p className="ray-blog-dek">{p.dek}</p>
                <span className="ray-blog-read">Read the note <Flick size={12} /></span>
                <span className="ray-blog-entry-flick" aria-hidden><Flick size={13} /></span>
              </Link>
            ))}
          </div>
        </section>
      </main>
      <Colophon lotCount={meta.totalLots} houseCount={meta.sources.length} record={null} />
    </div>
  );
}

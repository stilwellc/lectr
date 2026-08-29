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
    title: 'Art in Q2: trophies cleared, the middle got picky',
    dek: 'A $509M quarter split almost evenly between Sotheby’s and Christie’s — the masterpieces cleared, about a third of everything offered failed to sell, and KAWS kept repricing.',
  },
  {
    slug: 'q2-2026-watches',
    date: '2026-07-16',
    title: 'Watches in Q2: the deepest tape we track',
    dek: '1,811 watches sold for $240M at 97–98% sell-through — and the only vertical where the engine publishes a return: Cartier and Rolex up over five years, Patek down over three.',
  },
  {
    slug: 'q2-2026-design',
    date: '2026-07-16',
    title: 'Design in Q2: small money, real heat',
    dek: 'The smallest market we track posted the strongest demand of the quarter: 69% of sold lots beat their high estimate, Nakashima and Prouvé led, and the commodity end dragged.',
  },
  {
    slug: 'q2-2026-sports',
    date: '2026-07-16',
    title: 'Sports in Q2: the cards led a $126M quarter',
    dek: 'A $2.93M LeBron rookie patch auto on top, a photo-matched Gretzky jersey behind it, 19,296 lots through the quarter — a card-led tape, read by volume and record.',
  },
  {
    slug: 'q2-2026-science',
    date: '2026-07-16',
    title: 'Science in Q2: between the seasons',
    dek: 'Antique globes and Apollo Type I photographs led a cleaned tape — space and fossils ran hot on demand, meteorites soft, and the big seasonal sales land in Q3.',
  },
  {
    slug: 'how-we-built-the-pricing-engine',
    date: '2026-07-24',
    title: 'How we built the price-movement engine',
    dek: 'A per-maker hedonic regression with a confidence gate bolted to the front — the controls, the abstention rules, and why only three makers currently clear the bar.',
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
/* NORTH STAR (docs/NORTHSTAR_UI.md): the index head goes Waldenburg-style —
   huge, LIGHT, tight — and every label speaks the quiet sentence-case
   kicker voice. Ledger rows keep their grammar; the double certificate
   rule collapses to one hairline. */
.ray-blog-head .ray-masthead-h1{font-weight:320 !important;letter-spacing:-0.02em !important;font-size:clamp(36px,5vw,48px) !important;line-height:1.08 !important}
@media (max-width:480px){.ray-blog-head .ray-masthead-h1{font-size:clamp(28px,8vw,34px) !important}}
.ray-blog-shelf{display:flex;flex-direction:column;gap:14px}
.ray-blog-lead,.ray-blog-entry{display:block;text-decoration:none;color:inherit;border:1px solid var(--hairline);border-radius:12px;padding:22px 24px;background:var(--color-bg-elevated)}
.ray-blog-date{font-family:var(--font-mono),monospace;font-size:11.5px;color:var(--color-text-faint);margin-bottom:8px;font-variant-numeric:tabular-nums}
.ray-blog-title{font-size:21px;font-weight:550;letter-spacing:-0.015em;margin:0 0 8px;line-height:1.3;color:var(--color-fg)}
.ray-blog-dek{font-size:14.5px;line-height:1.55;color:var(--color-text-secondary);margin:0}
.ray-blog-read{display:inline-flex;align-items:center;gap:7px;margin-top:14px;font-size:13px;font-weight:500;color:var(--color-text-muted)}
.ray-blog-lead-kicker{display:none}
.ray-blog-entry-flick{display:none}
.ray-blog-ledger{display:contents}
.ray-blog-ledger-head{display:none}
@media (min-width:900px){
  .ray-blog-shelf{gap:0}
  /* the lead — the newest note, full width, light editorial voice */
  .ray-blog-lead{border:none;border-radius:0;background:none;padding:6px 0 30px;transform:none}
  .ray-blog-lead:hover{border:none;transform:none}
  .ray-blog-lead .ray-blog-date{display:none}
  .ray-blog-lead-kicker{display:flex;align-items:baseline;gap:14px;margin-bottom:14px}
  .ray-blog-lead-kicker .no{color:var(--color-text-faint)}
  .ray-blog-lead .ray-blog-title{font-family:var(--font-sans),sans-serif;font-size:clamp(30px,3.6vw,40px);font-weight:340;letter-spacing:-0.02em;line-height:1.12;margin:0 0 12px;max-width:26ch}
  .ray-blog-lead:hover .ray-blog-title{color:var(--color-text-secondary)}
  .ray-blog-lead .ray-blog-dek{font-size:15.5px;line-height:1.6;max-width:62ch}
  /* the ledger — the rest of the file as dated rows, one quiet top rule */
  .ray-blog-ledger{display:block;border-top:1px solid var(--hairline);position:relative}
  .ray-blog-ledger-head{display:grid;grid-template-columns:118px 1fr;gap:0 22px;padding:9px 0 10px}
  .ray-blog-entry{display:grid;grid-template-columns:118px 1fr auto;gap:2px 22px;align-items:baseline;border:none;border-radius:0;background:none;padding:16px 2px;border-top:1px solid var(--hairline);transition:background var(--duration-fast) var(--ease-signature)}
  .ray-blog-entry:hover{border-color:var(--hairline);transform:none;background:var(--color-hover-item)}
  .ray-blog-entry .ray-blog-date{grid-row:1 / span 2;margin:0;align-self:baseline}
  .ray-blog-entry .ray-blog-title{font-family:var(--font-sans),sans-serif;font-size:19px;font-weight:500;letter-spacing:-0.015em;line-height:1.25;margin:0}
  .ray-blog-entry:hover .ray-blog-title{color:var(--color-fg)}
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
    <div className="terminal-shell" style={{ minHeight: '100vh', background: 'var(--color-bg)', color: 'var(--color-fg)', fontFamily: 'var(--font-sans), sans-serif' }}>
      <style dangerouslySetInnerHTML={{ __html: BLOG_CSS }} />
      <ArtistNav activeSlug="blog" />
      <div style={{ paddingTop: 28, paddingBottom: 60 }}>
        <div className="ray-blog-head" style={{ maxWidth: 860, margin: '0 auto', padding: '0 var(--gutter)', marginBottom: 34 }}>
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
              <span className="ns-kicker" style={{ marginBottom: 0 }}>Latest from the desk</span>
              <span className="ns-kicker no" style={{ marginBottom: 0 }}>{fmtLong(lead.date)}</span>
            </div>
            <div className="ray-blog-date">{fmtShort(lead.date)}</div>
            <h2 className="ray-blog-title">{lead.title}</h2>
            <p className="ray-blog-dek">{lead.dek}</p>
            <span className="ray-blog-read">Read the note <Flick size={12} /></span>
          </Link>

          {/* the rest of the file — cards on mobile, a dated ledger ≥900px */}
          <div className="ray-blog-ledger">
            <div className="ray-blog-ledger-head" aria-hidden>
              <span className="ns-kicker" style={{ marginBottom: 0 }}>Dated</span>
              <span className="ns-kicker" style={{ marginBottom: 0 }}>Note</span>
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

        {/* the integrity shelf — a quiet standing link to the corrections register */}
        <div style={{ maxWidth: 860, margin: '38px auto 0', padding: '0 var(--gutter)' }}>
          <div style={{ borderTop: '1px solid var(--hairline)', paddingTop: 16 }}>
            <Link href="/blog/corrections" style={{ display: 'inline-flex', alignItems: 'baseline', gap: 8, textDecoration: 'none', color: 'var(--color-text-muted)', fontSize: 13.5, lineHeight: 1.5 }}>
              <span className="ns-kicker" style={{ marginBottom: 0, whiteSpace: 'nowrap' }}>Corrections register</span>
              <span>We keep the receipts — a dated log of when a published figure was reconciled to the live build. <Flick size={11} /></span>
            </Link>
          </div>
        </div>
      </div>
      <Colophon record={null} />
    </div>
  );
}

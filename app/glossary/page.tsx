'use client';

/**
 * /glossary — every desk word in plain language, one entry per term from
 * app/lib/glossary.ts (the same source <Term> tooltips read). Each entry is
 * an anchor (/glossary#odds) so a tooltip-less surface can link straight in.
 */
import React, { useMemo } from 'react';
import Link from 'next/link';
import ArtistNav from '../components/ArtistNav';
import { Colophon } from '../components/Terminal';
import { useRayData } from '../hooks/useRayData';
import { useSavedLots } from '../hooks/useSavedLots';
import { GLOSSARY } from '../lib/glossary';
import { formatDate, getUpcomingCounts } from '../utils';
import '../northstar-pages.css';

const CSS = `
.gl-list{margin:34px 0 0;padding:0;list-style:none;border-top:1px solid var(--color-border)}
.gl-item{display:grid;grid-template-columns:minmax(150px,220px) 1fr;gap:6px 32px;padding:22px 0;border-bottom:1px dotted var(--color-border-mid);scroll-margin-top:84px}
.gl-item:target{background:var(--color-butter-subtle,rgba(0,0,0,.03))}
.gl-term{margin:0;font-size:19px;font-weight:400;letter-spacing:-0.01em;color:var(--color-fg);line-height:1.3}
.gl-term a{color:inherit;text-decoration:none}
.gl-term a:hover{text-decoration:underline;text-decoration-color:var(--color-border-mid);text-underline-offset:3px}
.gl-short{margin:0;font-size:15px;line-height:1.55;color:var(--color-fg)}
.gl-long{margin:8px 0 0;font-size:14px;line-height:1.65;color:var(--color-text-secondary);max-width:68ch}
.gl-see{display:inline-block;margin-top:10px;font-size:13px;color:var(--color-fg);text-underline-offset:3px;text-decoration-color:var(--color-border-mid);padding:3px 0}
.gl-toc{display:flex;flex-wrap:wrap;gap:8px;margin:24px 0 0}
.gl-toc a{display:inline-flex;align-items:center;min-height:32px;padding:0 13px;border:1px solid var(--color-border-mid);border-radius:999px;font-size:13px;color:var(--color-fg);text-decoration:none}
.gl-toc a:hover{background:var(--color-butter-subtle,rgba(0,0,0,.04))}
@media (max-width:640px){.gl-item{grid-template-columns:1fr}}
`;

export default function GlossaryPage() {
  const { allLots, lastCrawl } = useRayData();
  const { savedIds } = useSavedLots();
  const upcomingCounts = useMemo(() => getUpcomingCounts(allLots), [allLots]);
  return (
    <div className="terminal-shell">
      <ArtistNav activeSlug="" savedCount={savedIds.length} upcomingCounts={upcomingCounts} lastCrawl={lastCrawl ? formatDate(lastCrawl) : undefined} />
      <div className="rail nsp-doss">
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
        <h1 className="nsp-h1">The desk&rsquo;s words, in plain language</h1>
        <p className="nsp-dek">
          lectr prints a few words of its own on every board. Here is what each one means, how the number behind it is made,
          and where it stops. Anywhere a word is dotted-underlined on the site, hover or tap it for the short version.
        </p>
        <nav className="gl-toc" aria-label="Terms">
          {GLOSSARY.map(e => <a key={e.id} href={`#${e.id}`}>{e.term.charAt(0).toUpperCase() + e.term.slice(1)}</a>)}
        </nav>
        <dl className="gl-list">
          {GLOSSARY.map(e => (
            <div key={e.id} id={e.id} className="gl-item">
              <dt className="gl-term"><a href={`#${e.id}`}>{e.term.charAt(0).toUpperCase() + e.term.slice(1)}</a></dt>
              <dd style={{ margin: 0 }}>
                <p className="gl-short">{e.short}</p>
                <p className="gl-long">{e.long}</p>
                {e.seeAlso && <Link className="gl-see" href={e.seeAlso.href}>{e.seeAlso.label}</Link>}
              </dd>
            </div>
          ))}
        </dl>
        <div className="nsp-links">
          <Link href="/about" className="ray-call-btn ray-call-btn-quiet" style={{ textDecoration: 'none' }}>How lectr works</Link>
          <Link href="/receipts" className="ray-call-btn ray-call-btn-quiet" style={{ textDecoration: 'none' }}>The record</Link>
          <Link href="/value" className="ray-call-btn ray-call-btn-quiet" style={{ textDecoration: 'none' }}>The value desk</Link>
        </div>
      </div>
      <Colophon lastCrawl={lastCrawl || undefined} record={null} />
    </div>
  );
}

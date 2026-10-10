'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ARTISTS } from '../../constants';
import { retiredTarget } from '../../lib/entity/retired';
import EntityPage from '../../components/entity/EntityPage';
import ArtistNav from '../../components/ArtistNav';
import { Colophon } from '../../components/Terminal';
import '../../northstar-pages.css';

/**
 * A maker's page — /makers/<slug>. Since the makers overhaul (P2, Oct 10
 * 2026) it is the one entity page (components/entity/EntityPage) for the
 * maker's id `mk:<slug>`. The category pseudo-makers (graded-cards, pokemon,
 * meteorites …) are retired: Cloudflare 301s them (public/_redirects,
 * generated from app/lib/entity/retired), and any host without the redirect
 * table (next dev) is sent on from here.
 */
export default function MakerPage() {
  const params = useParams();
  const slug = String(params.slug || '');
  const router = useRouter();
  const moved = retiredTarget(slug);
  useEffect(() => { if (moved) router.replace(moved); }, [moved, router]);

  if (moved || !ARTISTS.some(a => a.slug === slug)) {
    return (
      <div className="terminal-shell">
        <ArtistNav activeSlug="" />
        <div className="rail nsp-empty" style={{ minHeight: '60vh' }}>
          <h1>{moved ? 'This page moved' : 'Nothing tracked at this address'}</h1>
          <p>{moved ? 'A category, not a maker — it lives with its market now.' : 'The roster lists every maker lectr follows.'}</p>
          <div className="nsp-links">
            <Link href={moved || '/makers'} className="ray-call-btn ray-call-btn-quiet" style={{ textDecoration: 'none' }}>{moved ? 'Go there' : 'Back to the roster'}</Link>
          </div>
        </div>
        <Colophon record={null} />
      </div>
    );
  }
  return <EntityPage key={slug} id={`mk:${slug}`} />;
}

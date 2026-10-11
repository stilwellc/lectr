'use client';

/**
 * ComparableModal, loaded on first open (perf wave W18, Oct 11 2026).
 *
 * The lot dossier modal (ComparableModal → LotPage, the card record, the
 * comp engine's context pools …) is ~40 KB brotli that no first screen draws:
 * it renders only once a reader opens a lot. Imported statically by the feed
 * rows (LotCard, LotBrowser, TerminalHome) it rode in every live route's
 * first-load JS — on a 400 kbps phone ~1s of download before hydration, i.e.
 * before the first lot row could paint. Behind next/dynamic it downloads
 * after the first paint instead (warmed once the first screen has painted,
 * below, so an open is normally instant).
 *
 * The modal's stylesheet stays a STATIC import here, so every route that
 * shipped it in its first-load CSS still does — nothing outside the modal
 * can change look when the JS moves.
 */
import dynamic from 'next/dynamic';
import type ComparableModalT from './ComparableModal';
import '../northstar-pages.css';
import { afterFirstPaint } from '../lib/after-first-paint';

const load = () => import('./ComparableModal');

const Lazy = dynamic(load, { ssr: false, loading: () => null });

let warmed = false;
/** fetch the modal's chunk once the first screen has painted */
function warm() {
  if (warmed || typeof window === 'undefined') return;
  warmed = true;
  afterFirstPaint().then(load).catch(() => { warmed = false; });
}

export default function ComparableModal(props: React.ComponentProps<typeof ComparableModalT>) {
  return <Lazy {...props} />;
}

// every importer is a surface that can open the modal: warm on idle
warm();

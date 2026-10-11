/**
 * csv.ts — the Portfolio's CSV export (THE DESK v3 §6). One row per piece,
 * every column a figure the section already prints, with its basis beside
 * it; nothing is computed here that the ledger does not show. The file is
 * built on the device (a Blob) — nothing leaves the browser.
 */
import { craftTitle } from '../../utils';
import { makerLineOf } from '../../lib/lot-labels';
import type { PieceRow } from './portfolio';

export const CSV_COLUMNS = [
  'lot_id', 'title', 'maker', 'house', 'sale_date',
  'bought_usd', 'bought_basis',
  'index_mark_usd', 'index_mark_year', 'index_mark_note',
  'appraisal_all_in_usd', 'appraisal_hammer_usd', 'appraisal_comps_n', 'appraisal_confidence',
  'if_sold_now_net_usd', 'seller_commission_rate', 'seller_commission_tier',
  'maker_record_usd', 'maker_record_date', 'maker_record_house', 'maker_record_is_this_piece',
  'yoy_pct', 'yoy_basis', 'timing',
  'lot_url',
] as const;

function cell(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** the CSV text (CRLF rows, RFC 4180 quoting) */
export function portfolioCsv(rows: readonly PieceRow[]): string {
  const out: string[] = [CSV_COLUMNS.join(',')];
  for (const r of rows) {
    const { piece } = r;
    const lot = piece.lot;
    const line: unknown[] = [
      piece.id,
      craftTitle(lot.title, lot.auctionHouse),
      makerLineOf(lot).name,
      lot.auctionHouse,
      lot.saleDate || piece.bought?.day || '',
      piece.bought ? Math.round(piece.bought.usd) : '',
      piece.bought ? (piece.bought.basis === 'paid' ? 'what you paid' : 'realized price') : '',
      r.mark ? Math.round(r.mark.value) : '',
      r.mark ? r.mark.year : '',
      r.mark ? (r.mark.partial ? 'year so far · maker yearly median, relative to the bought year' : 'maker yearly median, relative to the bought year') : (r.noIndex ?? ''),
      piece.appraisal ? Math.round(piece.appraisal.allIn) : '',
      piece.appraisal ? Math.round(piece.appraisal.hammer) : '',
      piece.appraisal ? piece.appraisal.compN : '',
      piece.appraisal ? piece.appraisal.confidence : '',
      piece.soldNow ? piece.soldNow.net : '',
      piece.soldNow ? piece.soldNow.rate : '',
      piece.soldNow ? piece.soldNow.tier : '',
      r.record ? Math.round(r.record.usd) : '',
      r.record ? r.record.day : '',
      r.record ? r.record.house ?? '' : '',
      r.record ? (r.record.yours ? 'yes' : 'no') : '',
      r.trend ? Math.round(r.trend.pct) : '',
      r.trend ? r.trend.basis : '',
      r.timing ? r.timing.text : '',
      lot.url || '',
    ];
    out.push(line.map(cell).join(','));
  }
  return out.join('\r\n') + '\r\n';
}

/** 'lectr-portfolio-2026-10-11.csv' from the desk's clock */
export function csvFilename(now: number): string {
  return `lectr-portfolio-${new Date(now).toISOString().slice(0, 10)}.csv`;
}

/** hand the browser the file (a Blob + an object URL; no server) */
export function downloadCsv(text: string, filename: string): void {
  if (typeof document === 'undefined') return;
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

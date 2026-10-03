/**
 * corpus-parquet.ts — the COLUMNAR corpus (Oct 2026 scale pass), written
 * alongside the gz NDJSON so readers can migrate incrementally:
 *
 *   data/corpus/corpus.parquet   one row per corpus lot, in corpus file order
 *     tier          'main' | 'archive'   (lots.json.gz | sold-archive.json.gz)
 *     ord           row number within its tier
 *     id, artist, auction_house, status, sale_date, category, title   VARCHAR
 *     price_usd, realized_usd, est_low_usd, est_high_usd, current_bid DOUBLE
 *     row_json      the exact NDJSON line (lossless: JSON.parse(row_json) is
 *                   the row readCorpus() returns, key order included)
 *
 * The typed columns are what a query engine filters / groups on (DuckDB
 * reads them without touching row_json; zstd keeps the file ~ the gz size);
 * row_json is what keeps the format a lossless replacement for the NDJSON.
 * Written through DuckDB's appender while build-market streams the corpus
 * out (persistCorpusAndServed's sink), so it costs no extra pass over the
 * rows. ADVISORY: any failure here is a warning — the gz NDJSON stays the
 * source of truth until every reader has moved.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { CorpusRowSink } from '../corpus-io';

export const PARQUET_FILE = 'corpus.parquet';

type Duck = typeof import('@duckdb/node-api');
async function duck(): Promise<Duck | null> {
  try { return await import('@duckdb/node-api'); } catch { return null; }
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : v == null ? null : String(v));

const DDL = `CREATE TABLE corpus (
  tier VARCHAR, ord UINTEGER, id VARCHAR, artist VARCHAR, auction_house VARCHAR, status VARCHAR,
  sale_date VARCHAR, category VARCHAR, title VARCHAR,
  price_usd DOUBLE, realized_usd DOUBLE, est_low_usd DOUBLE, est_high_usd DOUBLE, current_bid DOUBLE,
  row_json VARCHAR)`;

/** A CorpusRowSink that lands every written corpus line in `outFile` as
 *  Parquet (zstd). Null when DuckDB is unavailable (the run goes on). */
export async function openParquetSink(outFile: string, opts: { memoryLimit?: string } = {}): Promise<CorpusRowSink | null> {
  const d = await duck();
  if (!d) { console.log('::warning title=corpus.parquet skipped::@duckdb/node-api not installed — gz NDJSON only tonight'); return null; }
  fs.rmSync(outFile, { force: true }); // never leave a stale file beside a fresh gz
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-duck-'));
  const inst = await d.DuckDBInstance.create(':memory:', {
    memory_limit: opts.memoryLimit || '1GB', temp_directory: tmpDir, threads: '2', preserve_insertion_order: 'true',
  });
  const con = await inst.connect();
  await con.run(DDL);
  const app = await con.createAppender('corpus');
  let rows = 0;
  return {
    add(tier, ord, line, row) {
      app.appendVarchar(tier);
      app.appendUInteger(ord);
      for (const k of ['id', 'artist', 'auctionHouse', 'status', 'saleDate', 'category', 'title']) {
        const v = str(row[k]);
        if (v === null) app.appendNull(); else app.appendVarchar(v);
      }
      for (const k of ['priceUsd', 'realizedUsd', 'estLowUsd', 'estHighUsd', 'currentBid']) {
        const v = num(row[k]);
        if (v === null) app.appendNull(); else app.appendDouble(v);
      }
      app.appendVarchar(line.endsWith('\n') ? line.slice(0, -1) : line);
      app.endRow();
      if (++rows % 100000 === 0) app.flushSync();
    },
    async finish() {
      app.flushSync();
      app.closeSync();
      const tmp = outFile + '.tmp';
      await con.run(`COPY corpus TO '${tmp.replace(/'/g, "''")}' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 122880)`);
      fs.renameSync(tmp, outFile);
      con.closeSync();
      inst.closeSync();
      fs.rmSync(tmpDir, { recursive: true, force: true });
      console.log(`[corpus] ${path.basename(outFile)}: ${rows} rows (${(fs.statSync(outFile).size / 1048576).toFixed(1)}MB)`);
    },
  };
}

/** Stream a corpus.parquet back as readCorpus() rows (main tier, then
 *  archive, in written order), `onRow` per row. Returns the row count. */
export async function readCorpusParquet(file: string, onRow: (row: Record<string, unknown>) => void): Promise<number> {
  const d = await duck();
  if (!d) throw new Error('[corpus-parquet] @duckdb/node-api not installed');
  const inst = await d.DuckDBInstance.create(':memory:', { threads: '2' });
  const con = await inst.connect();
  const res = await con.stream(`SELECT row_json FROM read_parquet('${file.replace(/'/g, "''")}') ORDER BY (tier = 'archive'), ord`);
  let n = 0;
  for (;;) {
    const chunk = await res.fetchChunk();
    if (!chunk || chunk.rowCount === 0) break;
    const col = chunk.getColumnVector(0);
    for (let i = 0; i < chunk.rowCount; i++) { onRow(JSON.parse(col.getItem(i) as string)); n++; }
  }
  con.closeSync();
  inst.closeSync();
  return n;
}

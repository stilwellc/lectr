'use client';

/**
 * SalesScatter — every sale of one reference as a dot on a TRUE time axis
 * (x = the sale date, so a 9-year gap looks like one), price on a log axis
 * (a $3K and a $300K Oyster Perpetual both stay legible). Each year with 3+
 * sales carries a short bar at its median, drawn across that calendar year
 * only — never a line interpolated through years with no sales.
 *
 * The old chart smoothed a monoline through evenly spaced yearly medians,
 * which drew a trend across empty years and hid how thin each point was.
 *
 * Accessible: role="img" with a generated summary (span, range, latest
 * sale); the "every sale" list under the chart is the data table equivalent.
 */
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { formatPrice } from '../utils';
import type { RefSale } from '../lib/search-tokens';

const H = 260;
const PAD = { l: 52, r: 14, t: 14, b: 30 };

const ms = (d: string) => Date.parse(d.length === 7 ? `${d}-15` : d.slice(0, 10));
const fmtAxis = (n: number) => (n >= 1e6 ? `$${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${Math.round(n)}`);

export default function SalesScatter({ sales, yearly, label }: {
  sales: RefSale[];
  yearly: { y: number; med: number; n: number }[];
  label: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(720);
  const titleId = useId();
  const descId = useId();
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const on = () => setW(Math.max(280, Math.round(el.clientWidth)));
    on();
    const ro = new ResizeObserver(on);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pts = useMemo(() => sales
    .map((s, i) => ({ i, t: ms(s[0]), p: s[1], s }))
    .filter(d => Number.isFinite(d.t) && d.p > 0)
    .sort((a, b) => a.t - b.t), [sales]);

  const geo = useMemo(() => {
    if (!pts.length) return null;
    const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
    // pad the span a little so edge dots never sit on the frame
    const span = Math.max(t1 - t0, 365 * 864e5);
    const x0 = t0 - span * 0.02, x1 = t1 + span * 0.02;
    const ps = pts.map(d => d.p);
    const lo = Math.min(...ps), hi = Math.max(...ps);
    const l0 = Math.floor(Math.log10(lo) * 2) / 2, l1 = Math.ceil(Math.log10(hi) * 2) / 2 || l0 + 0.5;
    const iw = w - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;
    const X = (t: number) => PAD.l + ((t - x0) / (x1 - x0)) * iw;
    const Y = (p: number) => PAD.t + ih - ((Math.log10(p) - l0) / Math.max(l1 - l0, 0.5)) * ih;
    // y ticks: 1-2-5 per decade inside the range
    const yt: number[] = [];
    for (let e = Math.floor(l0); e <= Math.ceil(l1); e++) for (const m of [1, 2, 5]) {
      const v = m * 10 ** e;
      if (Math.log10(v) >= l0 - 1e-9 && Math.log10(v) <= l1 + 1e-9) yt.push(v);
    }
    const ytShown = yt.length > 7 ? yt.filter(v => String(v)[0] === '1') : yt;
    // x ticks: whole years, thinned to fit
    const y0 = new Date(x0).getUTCFullYear() + 1, y1 = new Date(x1).getUTCFullYear();
    const years = y1 - y0 + 1;
    const step = [1, 2, 5, 10].find(s => years / s <= Math.max(3, Math.floor(iw / 70))) || 10;
    const xt: number[] = [];
    for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) xt.push(y);
    return { X, Y, ytShown, xt, iw, ih };
  }, [pts, w]);

  if (!geo || pts.length < 2) return null;
  const { X, Y, ytShown, xt } = geo;
  const first = pts[0], last = pts[pts.length - 1];
  const lo = pts.reduce((a, b) => (b.p < a.p ? b : a)), hi = pts.reduce((a, b) => (b.p > a.p ? b : a));
  const yearOf = (d: { t: number }) => new Date(d.t).getUTCFullYear();
  const summary = `${pts.length.toLocaleString()} sales of the ${label} from ${yearOf(first)} to ${yearOf(last)}. ` +
    `Lowest ${formatPrice(lo.p)} (${yearOf(lo)}), highest ${formatPrice(hi.p)} (${yearOf(hi)}). ` +
    `Most recent ${formatPrice(last.p)} at ${last.s[3]}, ${last.s[0].slice(0, 7)}.`;
  const hv = hover != null ? pts.find(d => d.i === hover) : null;

  return (
    <div ref={wrap} style={{ position: 'relative', width: '100%' }}>
      <svg width={w} height={H} role="img" aria-labelledby={`${titleId} ${descId}`} style={{ display: 'block', overflow: 'visible' }}
        onMouseLeave={() => setHover(null)}>
        <title id={titleId}>{`Every sale of the ${label}, by date and price`}</title>
        <desc id={descId}>{summary}</desc>
        {ytShown.map(v => (
          <g key={v}>
            <line x1={PAD.l} x2={w - PAD.r} y1={Y(v)} y2={Y(v)} stroke="var(--color-border)" strokeWidth={1} />
            <text x={PAD.l - 8} y={Y(v) + 4} textAnchor="end" fontSize={11} fill="var(--color-text-muted)" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtAxis(v)}</text>
          </g>
        ))}
        {xt.map(y => {
          const x = X(Date.UTC(y, 0, 1));
          return (
            <g key={y}>
              <line x1={x} x2={x} y1={H - PAD.b} y2={H - PAD.b + 4} stroke="var(--color-border-mid)" />
              <text x={x} y={H - PAD.b + 17} textAnchor="middle" fontSize={11} fill="var(--color-text-muted)" style={{ fontVariantNumeric: 'tabular-nums' }}>{y}</text>
            </g>
          );
        })}
        <line x1={PAD.l} x2={w - PAD.r} y1={H - PAD.b} y2={H - PAD.b} stroke="var(--color-border-mid)" />
        {/* the yearly median — one bar across its own calendar year */}
        {yearly.map(yr => {
          const a = X(Date.UTC(yr.y, 0, 1)), b = X(Date.UTC(yr.y, 11, 31));
          return <line key={yr.y} x1={a} x2={Math.max(b, a + 3)} y1={Y(yr.med)} y2={Y(yr.med)} stroke="#2F6FA8" strokeWidth={2.5} strokeLinecap="round" />;
        })}
        {pts.map(d => (
          <circle key={d.i} cx={X(d.t)} cy={Y(d.p)} r={hover === d.i ? 5 : 3}
            fill="var(--color-fg)" fillOpacity={hover === d.i ? 0.95 : 0.38}
            onMouseEnter={() => setHover(d.i)} />
        ))}
      </svg>
      {hv && (
        <div aria-hidden="true" style={{
          position: 'absolute', left: Math.min(Math.max(X(hv.t) - 110, 0), w - 220), top: Math.max(Y(hv.p) - 64, 0), width: 220,
          background: 'var(--color-surface, #fff)', border: '1px solid var(--color-border-mid)', borderRadius: 10,
          padding: '7px 10px', fontSize: 12, lineHeight: 1.45, color: 'var(--color-fg)', pointerEvents: 'none',
          boxShadow: '0 6px 20px rgba(0,0,0,.12)',
        }}>
          <b style={{ fontWeight: 600 }}>{formatPrice(hv.p)}</b> · {hv.s[3]} · {hv.s[0].slice(0, 10)}
          <div style={{ color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hv.s[4]}</div>
        </div>
      )}
      <p className="nsp-note" style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', alignItems: 'center' }}>
        <span><svg width="10" height="10" aria-hidden="true" style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 6 }}><circle cx="5" cy="5" r="3" fill="var(--color-fg)" fillOpacity={0.5} /></svg> one sale, all-in</span>
        <span><svg width="18" height="10" aria-hidden="true" style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 6 }}><line x1="1" x2="17" y1="5" y2="5" stroke="#2F6FA8" strokeWidth={2.5} strokeLinecap="round" /></svg> that year&rsquo;s median (years with 3+ sales)</span>
        <span>price axis is logarithmic</span>
      </p>
    </div>
  );
}

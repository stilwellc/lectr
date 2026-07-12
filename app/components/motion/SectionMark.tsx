import React from 'react';

export type SectionMarkProps = {
  n: string;                      // '01'
  align?: 'left' | 'right';       // default 'left'
  style?: React.CSSProperties;    // route-h1 usage may pass a larger size,
                                  // e.g. fontSize: 'clamp(180px, 22vw, 320px)'
};

/**
 * The ghost numeral. Static — no motion, ever. aria-hidden, no
 * pointer events, no selection. Opacity lives in globals.css via
 * .section-mark (0.035 dark / 0.04 light) — never exceed 4%.
 *
 * PARENT CONTRACT: the parent must be
 *   position: relative; overflow: hidden;
 * and real content must sit above it (position: relative or z-index).
 */
export default function SectionMark({ n, align = 'left', style }: SectionMarkProps) {
  return (
    <span
      aria-hidden="true"
      className="section-mark"
      style={{
        position: 'absolute',
        top: '50%',
        transform: 'translateY(-50%)',
        left: align === 'left' ? 0 : 'auto',
        right: align === 'right' ? 0 : 'auto',
        fontFamily: 'var(--font-serif)',
        fontWeight: 300,
        fontSize: 'clamp(8rem, 18vw, 16rem)',
        lineHeight: 0.8,
        pointerEvents: 'none',
        userSelect: 'none',
        zIndex: 0,
        ...style,
      }}
    >
      {n}
    </span>
  );
}

import React from 'react';
import HorizonDraw from './motion/HorizonDraw';

export type HorizonVariant = 'gold' | 'wine' | 'sunset';

export const horizonGradients: Record<HorizonVariant, string> = {
  gold: 'linear-gradient(90deg, transparent, var(--color-accent-gold) 30%, var(--color-accent-gold) 70%, transparent)',
  wine: 'linear-gradient(90deg, transparent, var(--color-accent-wine) 30%, var(--color-accent-wine) 70%, transparent)',
  sunset: 'linear-gradient(90deg, transparent, var(--color-accent-coral) 25%, var(--color-accent-gold) 70%, transparent)',
};

/**
 * The Horizon — the site's sole decorative element.
 * Default: static 1px hairline (unchanged from the original).
 * `draw`: the line draws itself on first intersection via the
 * .horizon-draw contract (one-shot IO; static under reduced motion
 * and without JS). Sunset defaults to origin='center' — the sun
 * sets from the middle out.
 */
export default function Horizon({
  variant = 'gold',
  style,
  draw = false,
  origin,
}: {
  variant?: HorizonVariant;
  style?: React.CSSProperties;
  draw?: boolean;
  origin?: 'left' | 'center';
}) {
  const resolvedOrigin = origin ?? (variant === 'sunset' ? 'center' : 'left');

  if (draw) {
    return (
      <HorizonDraw
        origin={resolvedOrigin}
        background={horizonGradients[variant]}
        style={style}
      />
    );
  }

  return (
    <div
      aria-hidden="true"
      style={{
        height: 1,
        width: '100%',
        background: horizonGradients[variant],
        opacity: 0.35,
        ...style,
      }}
    />
  );
}

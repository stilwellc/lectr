/**
 * BoardFrame — wraps content in tasteful "board chrome": a hairline brass frame
 * with small L-shaped corner ticks (like registration marks / an instrument
 * bezel) and an optional faint inset. Reads as "a precision board", not a heavy
 * border. Pure CSS + pseudo-elements — no JS, no motion, static-export safe.
 *
 * The frame is a low-opacity butter hairline (var(--color-border)); the four
 * corner ticks are two overlaid conic-gradient pseudo-elements (::before draws
 * top-left + bottom-right, ::after draws top-right + bottom-left) so all four
 * L-marks are drawn without extra DOM. The inner butter inset is a second
 * inset box-shadow. `position: relative` wrapper never clips children.
 */

const CSS = `
.bframe {
  position: relative;
  border-radius: var(--radius, 10px);
}

/* Hairline brass frame + a whisper-faint inner inset. box-shadow instead of a
   border so it can't shift layout or clip rounded children. */
.bframe--edge {
  box-shadow:
    inset 0 0 0 1px var(--color-border),
    inset 0 0 0 2px var(--color-butter-subtle);
}

/* Corner ticks — L-shaped registration marks inset slightly from each corner.
   pointer-events:none so the chrome is purely decorative over interactive kids. */
.bframe--corners::before,
.bframe--corners::after {
  content: "";
  position: absolute;
  inset: 6px;
  pointer-events: none;
  border-radius: inherit;
  /* butter hairline, quiet — half a brass note */
  --bf-tick: color-mix(in srgb, var(--color-butter) 42%, transparent);
  --bf-len: 11px;   /* arm length of each L */
  --bf-w: 1px;      /* stroke weight of the tick */
}

/* ::before → top-left + bottom-right corners */
.bframe--corners::before {
  background:
    /* TL: horizontal arm + vertical arm */
    linear-gradient(var(--bf-tick), var(--bf-tick)) top left / var(--bf-len) var(--bf-w) no-repeat,
    linear-gradient(var(--bf-tick), var(--bf-tick)) top left / var(--bf-w) var(--bf-len) no-repeat,
    /* BR: horizontal arm + vertical arm */
    linear-gradient(var(--bf-tick), var(--bf-tick)) bottom right / var(--bf-len) var(--bf-w) no-repeat,
    linear-gradient(var(--bf-tick), var(--bf-tick)) bottom right / var(--bf-w) var(--bf-len) no-repeat;
}

/* ::after → top-right + bottom-left corners */
.bframe--corners::after {
  background:
    /* TR */
    linear-gradient(var(--bf-tick), var(--bf-tick)) top right / var(--bf-len) var(--bf-w) no-repeat,
    linear-gradient(var(--bf-tick), var(--bf-tick)) top right / var(--bf-w) var(--bf-len) no-repeat,
    /* BL */
    linear-gradient(var(--bf-tick), var(--bf-tick)) bottom left / var(--bf-len) var(--bf-w) no-repeat,
    linear-gradient(var(--bf-tick), var(--bf-tick)) bottom left / var(--bf-w) var(--bf-len) no-repeat;
}
`;

export default function BoardFrame({
  children,
  className,
  style,
  corners = true,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  /** Draw the four L-shaped corner ticks (default true). */
  corners?: boolean;
}): JSX.Element {
  const cls = ['bframe', 'bframe--edge', corners ? 'bframe--corners' : '', className]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={cls} style={style}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      {children}
    </div>
  );
}

/*
 * Usage:
 *   <BoardFrame style={{ padding: 20, borderRadius: 12 }}>…hero board…</BoardFrame>
 *   <BoardFrame corners={false}>…quiet framed strip…</BoardFrame>
 */

'use client';
import React, { useState } from 'react';

/** the "?" chip + how-to-read strip. The strip is a full-width flex child,
    so inside the flex-wrap room heads it lands on its own line. */
export function HelpChip({ name, children }: { name: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="ck-helpbtn" aria-expanded={open}
        aria-label={`How to read ${name}`} onClick={() => setOpen(v => !v)}>?</button>
      {open && <div className="ck-help">{children}</div>}
    </>
  );
}

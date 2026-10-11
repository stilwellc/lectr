'use client';
/**
 * THE ROOM HEAD (Oct 11 2026, /profile polish) — every section on the desk
 * opens with the same head, so the page scans as one document:
 *
 *   [mark] Title  (?)                                   [actions]
 *   one muted figure line (counts, basis, window)
 *
 * level 2 = a room (the catalogue h2 with its print rule); level 3 = a room
 * inside a group (For your collection and How your picks did sit under Lots
 * you may like) — lighter, no rule, the same row grammar. The figure line
 * never truncates; it wraps. Actions go right on desktop and wrap under the
 * title on a phone.
 */
import React from 'react';
import { HelpChip } from './help';

export function RoomHead({ mark, title, level = 2, help, sub, actions, className, style }: {
  mark?: React.ReactNode;
  title: React.ReactNode;
  level?: 2 | 3;
  /** the how-to-read strip behind the (?) chip */
  help?: { name: string; body: React.ReactNode };
  /** the figure line under the title */
  sub?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  const H = level === 2 ? 'h2' : 'h3';
  return (
    <div className={`ck-head${className ? ` ${className}` : ''}`} data-level={level} style={style}>
      <div className="ck-head-row">
        <H className={level === 2 ? 'ray-h2 ck-head-t' : 'ck-h3 ck-head-t'}>
          {mark && <span className="ray-sect-mark" aria-hidden>{mark}</span>}
          {title}
        </H>
        {help && <HelpChip name={help.name}>{help.body}</HelpChip>}
        {actions && <div className="ck-head-actions">{actions}</div>}
      </div>
      {sub != null && sub !== false && <p className="ck-head-sub">{sub}</p>}
    </div>
  );
}

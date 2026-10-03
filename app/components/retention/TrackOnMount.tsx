'use client';

import { useEffect } from 'react';
import { track, type EventName } from '../../lib/analytics';

/** Counts `event` once per `onceKey` per page-session when it mounts. Renders
 *  nothing — drop it beside the element whose display is the event (the lot
 *  page's Max bid row). The key de-duplicates in the browser only; it is
 *  never sent. */
export default function TrackOnMount({ event, onceKey }: { event: EventName; onceKey?: string }) {
  useEffect(() => { track(event, onceKey); }, [event, onceKey]);
  return null;
}

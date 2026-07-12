'use client';

import { useState, useEffect } from 'react';
import { AuctionLot, MarketStats } from '../types';

interface RayData {
  statsByArtist: Record<string, MarketStats>;
  allLots: AuctionLot[];
  lastCrawl: string;
  sources: string[];
  loading: boolean;
  error: string | null;
  /** true when the module cache was already warm at mount —
      revisits render instantly, no arrival choreography. */
  fromCache: boolean;
}

interface RayPayload {
  statsByArtist: Record<string, MarketStats>;
  allLots: AuctionLot[];
  lastCrawl: string;
  sources: string[];
  error: string | null;
}

// Module-level cache: the JSON payloads are fetched once per session,
// no matter how many Ray routes the visitor moves through.
let cached: RayPayload | null = null;
let inflight: Promise<RayPayload> | null = null;

function loadRayData(): Promise<RayPayload> {
  if (cached) return Promise.resolve(cached);
  if (inflight) return inflight;

  inflight = Promise.allSettled([
    fetch('/data/ray/stats.json').then(r => r.json()),
    fetch('/data/ray/lots.json').then(r => r.json()),
    fetch('/data/ray/meta.json').then(r => r.json()),
  ]).then(([statsResult, lotsResult, metaResult]) => {
    const statsData = statsResult.status === 'fulfilled' ? statsResult.value : null;
    const lotsData: AuctionLot[] = lotsResult.status === 'fulfilled' ? lotsResult.value : [];
    const metaData = metaResult.status === 'fulfilled' ? metaResult.value : {};

    let statsByArtist: Record<string, MarketStats> = {};
    if (statsData) {
      if (statsData.lastUpdated) {
        // Old single-artist format — derive slug from lot data rather than hardcoding
        const artistSlug = lotsData[0]?.artist;
        statsByArtist = artistSlug ? { [artistSlug]: statsData } : {};
      } else {
        statsByArtist = statsData;
      }
    }

    const lotsOk = lotsResult.status === 'fulfilled';
    const statsOk = statsResult.status === 'fulfilled';
    const payload: RayPayload = {
      statsByArtist,
      allLots: lotsData,
      lastCrawl: metaData.lastCrawl || '',
      sources: metaData.sources || [],
      error: (!lotsOk && !statsOk) ? 'Unable to load auction data. Please try again later.' : null,
    };

    // Only cache successful loads so a retry can actually retry
    if (lotsOk || statsOk) cached = payload;
    inflight = null;
    return payload;
  });

  return inflight;
}

export function useRayData(): RayData {
  const [data, setData] = useState<RayPayload | null>(cached);
  const [fromCache] = useState(() => cached !== null);

  useEffect(() => {
    let active = true;
    loadRayData().then(payload => {
      if (active) setData(payload);
    });
    return () => { active = false; };
  }, []);

  return {
    statsByArtist: data?.statsByArtist || {},
    allLots: data?.allLots || [],
    lastCrawl: data?.lastCrawl || '',
    sources: data?.sources || [],
    loading: data === null,
    error: data?.error || null,
    fromCache,
  };
}

import React from 'react';
import type { Metadata } from 'next';
import { withShare } from '../lib/og-meta';

export const metadata: Metadata = withShare({
  title: 'Player dossier',
  description: 'One athlete, the whole market — cards, game-worn and memorabilia read together. lectr auction intelligence.',
});

export default function PlayerLayout({ children }: { children: React.ReactNode }) {
  return children;
}

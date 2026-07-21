import React from 'react';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Player',
  description: 'One athlete, the whole market — cards, game-worn and memorabilia read together. lectr auction intelligence.',
};

export default function PlayerLayout({ children }: { children: React.ReactNode }) {
  return children;
}

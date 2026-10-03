import React from 'react';
import type { Metadata } from 'next';
import { withShare } from '../lib/og-meta';

export const metadata: Metadata = withShare({
  title: 'Watch references',
  description: 'One watch reference, every sale on the book — medians, trend and recent hammers. lectr auction intelligence.',
});

export default function RefLayout({ children }: { children: React.ReactNode }) {
  return children;
}

import React from 'react';
import type { Metadata } from 'next';
import { withShare } from '../lib/og-meta';

export const metadata: Metadata = withShare({
  title: 'Sub-markets',
  description: 'Sub-markets grouped by category, each read only as far as its data supports — a verified index move, measured demand or the typical price — with the record and the coverage behind it.',
});

export default function SubLayout({ children }: { children: React.ReactNode }) {
  return children;
}

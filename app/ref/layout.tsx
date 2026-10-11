import React from 'react';
import type { Metadata } from 'next';
import { seoMeta } from '../lib/seo';

export const metadata: Metadata = seoMeta({
  title: 'Reference',
  description: 'One watch reference, every sale on the book — medians, trend and recent hammers. lectr auction intelligence.',
  path: '/ref',
  // a query shell: no canonical (see seoMeta)
  canonical: false,
});

export default function RefLayout({ children }: { children: React.ReactNode }) {
  return children;
}

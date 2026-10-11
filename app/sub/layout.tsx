import React from 'react';
import type { Metadata } from 'next';
import { seoMeta } from '../lib/seo';

export const metadata: Metadata = seoMeta({
  title: 'Sub-markets',
  description: 'Every tracked sub-market, grouped by category — each read at its strongest honest strength — verified index move, measured demand or the typical price, with the record and the coverage behind it. lectr auction intelligence.',
  path: '/sub',
  // a query shell: no canonical (see seoMeta)
  canonical: false,
});

export default function SubLayout({ children }: { children: React.ReactNode }) {
  return children;
}

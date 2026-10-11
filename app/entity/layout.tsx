import React from 'react';
import type { Metadata } from 'next';
import { seoMeta } from '../lib/seo';

export const metadata: Metadata = seoMeta({
  title: 'Entity',
  description: 'One name, the whole market — a Pokémon, a film, a mission or a collection: live lots, what it sells for and the record. lectr auction intelligence.',
  path: '/entity',
  // a query shell: no canonical (see seoMeta)
  canonical: false,
});

export default function EntityLayout({ children }: { children: React.ReactNode }) {
  return children;
}

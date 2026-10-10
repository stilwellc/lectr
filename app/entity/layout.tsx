import React from 'react';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Entity',
  description: 'One name, the whole market — a Pokémon, a film, a mission or a collection: live lots, what it sells for and the record. lectr auction intelligence.',
};

export default function EntityLayout({ children }: { children: React.ReactNode }) {
  return children;
}

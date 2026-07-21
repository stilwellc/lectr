import React from 'react';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Reference',
  description: 'One watch reference, every sale on the book — medians, trend and recent hammers. lectr auction intelligence.',
};

export default function RefLayout({ children }: { children: React.ReactNode }) {
  return children;
}

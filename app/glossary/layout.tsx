import React from 'react';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Glossary — the desk’s words in plain language',
  description: 'What lectr means by Flags, the Gap, Sleepers, odds, confidence, expected hammer, max bid, comps median, value floor, the record, forming, at the wire and abstain.',
  alternates: { canonical: '/glossary' },
};

export default function GlossaryLayout({ children }: { children: React.ReactNode }) {
  return children;
}

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Data status — how fresh every house is',
  description:
    'When lectr last published, and when each auction house was last read. Houses that go quiet are marked stale, and their lots are labelled with the day they were last seen.',
};

export default function StatusLayout({ children }: { children: React.ReactNode }) {
  return children;
}

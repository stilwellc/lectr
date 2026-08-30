import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Styleguide — internal — lectr',
  robots: { index: false, follow: false },
};

export default function StyleguideLayout({ children }: { children: React.ReactNode }) {
  return children;
}

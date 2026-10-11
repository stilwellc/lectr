import type { Metadata } from 'next';
import { seoMeta } from '../lib/seo';

export const metadata: Metadata = seoMeta({
  title: 'The record — every call, graded against the hammer',
  description:
    'lectr’s forward track record: value calls logged the night they were made, then judged against the real hammer price. No post-hoc recomputes — receipts.',
  path: '/receipts',
});

export default function ReceiptsLayout({ children }: { children: React.ReactNode }) {
  return children;
}

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'The record — every call, graded against the hammer',
  description:
    'lectr’s forward track record: value calls logged the night they were made, then judged against the real hammer price. No post-hoc recomputes — receipts.',
};

export default function ReceiptsLayout({ children }: { children: React.ReactNode }) {
  return children;
}

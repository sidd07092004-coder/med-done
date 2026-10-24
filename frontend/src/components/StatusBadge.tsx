import type { PageStatus } from '../api/types';

const LABELS: Record<PageStatus, string> = {
  draft: 'Draft',
  pending: 'Awaiting approval',
  published: 'Published',
  rejected: 'Rejected',
};

export function StatusBadge({ status }: { status: PageStatus }) {
  return <span className={`pill s-${status}`}>{LABELS[status] ?? status}</span>;
}

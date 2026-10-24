import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchAuditLogs, fetchUsers } from '../api/client';
import { formatDateTime } from '../lib/format';

const PAGE_SIZE = 50;

const TARGET_TYPES = [
  { value: '', label: 'All targets' },
  { value: 'page', label: 'Pages' },
  { value: 'group', label: 'Groups' },
  { value: 'user', label: 'Users' },
  { value: 'media', label: 'Media' },
  { value: 'data', label: 'Data' },
];

export function AuditLogPage() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [targetType, setTargetType] = useState('');
  const [userId, setUserId] = useState('');

  const usersQuery = useQuery({ queryKey: ['users'], queryFn: fetchUsers });
  const users = usersQuery.data ?? [];

  const logsQuery = useQuery({
    queryKey: ['audit-logs', { page, action, targetType, userId }],
    queryFn: () =>
      fetchAuditLogs({
        page,
        limit: PAGE_SIZE,
        action: action || undefined,
        target_type: targetType || undefined,
        user_id: userId || undefined,
      }),
  });

  const resetToFirstPage = () => setPage(1);
  const total = logsQuery.data?.total ?? 0;
  const maxPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const items = logsQuery.data?.items ?? [];

  return (
    <div className="page">
      <div className="crumb">Administration</div>
      <div className="page-head">
        <h2>Audit log</h2>
        {logsQuery.data && <span className="count-bubble">{total} entries</span>}
      </div>
      <p className="muted small">Every save, approval, upload and admin action is recorded here.</p>

      <div className="toolbar">
        <label className="field compact">
          <span>Action contains</span>
          <input
            type="search"
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              resetToFirstPage();
            }}
            placeholder="e.g. Approved"
            aria-label="Filter by action"
          />
        </label>

        <label className="field compact">
          <span>Target type</span>
          <select
            value={targetType}
            onChange={(e) => {
              setTargetType(e.target.value);
              resetToFirstPage();
            }}
            aria-label="Filter by target type"
          >
            {TARGET_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field compact">
          <span>User</span>
          <select
            value={userId}
            onChange={(e) => {
              setUserId(e.target.value);
              resetToFirstPage();
            }}
            aria-label="Filter by user"
          >
            <option value="">All users</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {logsQuery.isLoading && <div className="card">Loading audit log…</div>}
      {logsQuery.isError && (
        <div className="alert alert-error" role="alert">
          Could not load the audit log: {(logsQuery.error as Error).message}
        </div>
      )}

      {logsQuery.isSuccess && (
        <>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">User</th>
                  <th scope="col">Action</th>
                  <th scope="col">Target</th>
                  <th scope="col">Type</th>
                  <th scope="col">IP</th>
                </tr>
              </thead>
              <tbody>
                {items.map((entry) => (
                  <tr key={entry.id}>
                    <td className="nowrap">{formatDateTime(entry.created_at)}</td>
                    <td>{entry.user_name}</td>
                    <td>{entry.action}</td>
                    <td>{entry.target}</td>
                    <td>
                      {entry.target_type ? (
                        <span className="tag tag-plain">{entry.target_type}</span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="muted small">{entry.ip_address ?? '—'}</td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr className="empty-row">
                    <td colSpan={6}>No log entries match these filters.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="pager">
            <button
              type="button"
              className="btn small"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || logsQuery.isFetching}
            >
              ← Newer
            </button>
            <span className="muted small">
              Page {page} of {maxPage}
            </span>
            <button
              type="button"
              className="btn small"
              onClick={() => setPage((p) => Math.min(maxPage, p + 1))}
              disabled={page >= maxPage || logsQuery.isFetching}
            >
              Older →
            </button>
          </div>
        </>
      )}
    </div>
  );
}

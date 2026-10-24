import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { approvePage, fetchGroups, fetchQueue, rejectPage } from '../../api/client';
import type { Page } from '../../api/types';
import { StatusBadge } from '../../components/StatusBadge';
import { groupPath } from '../../lib/groups';
import { formatDateTime, langName } from '../../lib/format';

export function ReviewQueuePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const queueQuery = useQuery({ queryKey: ['queue'], queryFn: fetchQueue });
  const groupsQuery = useQuery({ queryKey: ['groups'], queryFn: fetchGroups, staleTime: 30_000 });
  const groups = groupsQuery.data ?? [];

  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['queue'] });
    queryClient.invalidateQueries({ queryKey: ['pages'] });
    queryClient.invalidateQueries({ queryKey: ['groups'] });
  };

  const approveMutation = useMutation({
    mutationFn: (id: string) => approvePage(id),
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError: (err: Error) => setError(err.message),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) => rejectPage(id, note),
    onSuccess: () => {
      setError(null);
      setRejectingId(null);
      setRejectNote('');
      refresh();
    },
    onError: (err: Error) => setError(err.message),
  });

  const startReject = (page: Page) => {
    setRejectingId(page.id);
    setRejectNote('');
    setError(null);
  };

  return (
    <div className="page">
      <div className="crumb">Approvals</div>
      <div className="page-head">
        <h2>Review queue</h2>
        {queueQuery.data && <span className="count-bubble">{queueQuery.data.length} pending</span>}
      </div>
      <p className="muted small">Volunteer changes do not go live until you approve them.</p>

      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}

      {queueQuery.isLoading && <div className="card">Loading queue…</div>}
      {queueQuery.isError && (
        <div className="alert alert-error" role="alert">
          Could not load the queue: {(queueQuery.error as Error).message}
        </div>
      )}

      {queueQuery.isSuccess && queueQuery.data.length === 0 && (
        <div className="card">
          <p className="muted">Nothing is awaiting approval right now.</p>
        </div>
      )}

      {queueQuery.isSuccess &&
        queueQuery.data.map((page) => {
          const busy = approveMutation.isPending || rejectMutation.isPending;
          return (
            <article className="card review-card" key={page.id}>
              <div className="review-head">
                <div>
                  <b>{page.title}</b> <StatusBadge status={page.status} />
                  {page.lang !== 'en' && <span className="tag">{langName(page.lang)}</span>}
                </div>
                <div className="review-meta muted small">
                  {groupPath(groups, page.group_id)} · updated {formatDateTime(page.updated_at)}
                </div>
              </div>

              <div className="review-actions">
                <button
                  type="button"
                  className="btn success"
                  onClick={() => approveMutation.mutate(page.id)}
                  disabled={busy}
                >
                  Approve &amp; publish
                </button>
                <button
                  type="button"
                  className="btn danger"
                  onClick={() => startReject(page)}
                  disabled={busy}
                >
                  Reject…
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => navigate(`/pages/${page.id}`)}
                  disabled={busy}
                >
                  Open in editor
                </button>
              </div>

              {rejectingId === page.id && (
                <div className="reject-card">
                  <label className="field">
                    <span>Reason for rejection (required, shown to the volunteer)</span>
                    <textarea
                      rows={3}
                      value={rejectNote}
                      onChange={(e) => setRejectNote(e.target.value)}
                      autoFocus
                    />
                  </label>
                  <div className="modal-actions">
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        setRejectingId(null);
                        setRejectNote('');
                      }}
                      disabled={rejectMutation.isPending}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn danger"
                      onClick={() =>
                        rejectMutation.mutate({ id: page.id, note: rejectNote.trim() })
                      }
                      disabled={rejectMutation.isPending || !rejectNote.trim()}
                    >
                      {rejectMutation.isPending ? 'Rejecting…' : 'Confirm rejection'}
                    </button>
                  </div>
                </div>
              )}
            </article>
          );
        })}
    </div>
  );
}

import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addContributor,
  createTranslation,
  fetchContributors,
  fetchRevisions,
  fetchTranslations,
  removeContributor,
  restoreRevision,
} from '../api/client';
import type { Page, PageContent, Revision, TranslationInfo } from '../api/types';
import { StatusBadge } from '../components/StatusBadge';
import { BlockRenderer } from '../components/BlockRenderer';
import { formatDateTime, langName } from '../lib/format';

const TRANSLATION_LANGS = ['hr', 'tr', 'ar'] as const;
const ROLE_SUGGESTIONS = ['Author', 'Co-author', 'Reviewer', 'Editor', 'Translator', 'Medical reviewer'];

interface PageManagePanelProps {
  page: Page;
  isAdmin: boolean;
  locked: boolean;
  onPageChanged: (page: Page, options?: { resetContent?: boolean }) => void;
}

export function PageManagePanel({ page, isAdmin, locked, onPageChanged }: PageManagePanelProps) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [previewRevision, setPreviewRevision] = useState<Revision | null>(null);

  const revisionsQuery = useQuery({
    queryKey: ['revisions', page.id],
    queryFn: () => fetchRevisions(page.id),
  });
  const translationsQuery = useQuery({
    queryKey: ['translations', page.id],
    queryFn: () => fetchTranslations(page.id),
  });
  const contributorsQuery = useQuery({
    queryKey: ['contributors', page.id],
    queryFn: () => fetchContributors(page.id),
  });

  const done = (msg: string) => {
    setError(null);
    setNotice(msg);
  };
  const failed = (err: Error) => {
    setNotice(null);
    setError(err.message);
  };

  const restoreMutation = useMutation({
    mutationFn: (revId: string) => restoreRevision(page.id, revId),
    onSuccess: (updated) => {
      done('Restored an earlier version. The editor now shows the restored content.');
      setPreviewRevision(null);
      queryClient.invalidateQueries({ queryKey: ['revisions', page.id] });
      onPageChanged(updated, { resetContent: true });
    },
    onError: failed,
  });

  const translationMutation = useMutation({
    mutationFn: (lang: string) => createTranslation(page.id, lang),
    onSuccess: (created) => {
      done(`Created the ${langName(created.lang)} translation.`);
      queryClient.invalidateQueries({ queryKey: ['translations', page.id] });
      queryClient.invalidateQueries({ queryKey: ['pages'] });
    },
    onError: failed,
  });

  const addCreditMutation = useMutation({
    mutationFn: (payload: { name: string; role: string }) => addContributor(page.id, payload),
    onSuccess: () => {
      done('Credit added.');
      queryClient.invalidateQueries({ queryKey: ['contributors', page.id] });
    },
    onError: failed,
  });

  const removeCreditMutation = useMutation({
    mutationFn: (id: string) => removeContributor(page.id, id),
    onSuccess: () => {
      done('Credit removed.');
      queryClient.invalidateQueries({ queryKey: ['contributors', page.id] });
    },
    onError: failed,
  });

  const translations = translationsQuery.data;
  const canTranslate = page.lang === 'en' && page.slug !== 'home';

  return (
    <div className="manage-panel">
      {notice && (
        <div className="alert alert-success" role="status">
          {notice}
        </div>
      )}
      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}

      {/* ---- Revisions ---------------------------------------------------- */}
      <section className="card">
        <h3>Version history</h3>
        <p className="muted small">
          Every save keeps a snapshot of the previous version (up to 20). Restoring creates a new
          snapshot of the current state first, so nothing is lost.
        </p>
        {revisionsQuery.isLoading && <p className="muted small">Loading history…</p>}
        {revisionsQuery.isError && (
          <p className="muted small">
            Could not load history: {(revisionsQuery.error as Error).message}
          </p>
        )}
        {revisionsQuery.isSuccess && revisionsQuery.data.length === 0 && (
          <p className="muted">No earlier versions yet.</p>
        )}
        {revisionsQuery.isSuccess && revisionsQuery.data.length > 0 && (
          <ul className="revision-list">
            {revisionsQuery.data.map((rev, i) => (
              <RevisionRow
                key={rev.id}
                revision={rev}
                isLatest={i === 0}
                canRestore={isAdmin}
                restoreDisabled={restoreMutation.isPending || locked}
                onPreview={() => setPreviewRevision(rev)}
                onRestore={() => {
                  if (window.confirm('Restore this version? The current content will be saved to history first.')) {
                    restoreMutation.mutate(rev.id);
                  }
                }}
              />
            ))}
          </ul>
        )}
      </section>

      {previewRevision && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => setPreviewRevision(null)}
        >
          <div
            className="modal modal-wide revision-preview-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="revision-preview-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <h3 id="revision-preview-title">
                  {previewRevision.title || 'Untitled version'}
                </h3>
                <p className="muted small">
                  {formatDateTime(previewRevision.created_at)}
                  {' · '}
                  {previewRevision.created_by_name || 'Unknown'}
                  {previewRevision.slug && (
                    <>
                      {' · '}
                      <code>/{previewRevision.slug}</code>
                    </>
                  )}
                  {' · '}
                  read-only preview
                </p>
              </div>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setPreviewRevision(null)}
                aria-label="Close revision preview"
              >
                ✕
              </button>
            </div>

            <div className="revision-preview-body">
              <BlockRenderer content={previewRevision.content as PageContent | null} />
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="btn"
                onClick={() => setPreviewRevision(null)}
              >
                Close
              </button>
              {isAdmin && (
                <button
                  type="button"
                  className="btn primary"
                  disabled={restoreMutation.isPending || locked}
                  onClick={() => {
                    if (
                      window.confirm(
                        'Restore this version? The current content will be saved to history first.',
                      )
                    ) {
                      restoreMutation.mutate(previewRevision.id);
                    }
                  }}
                >
                  {restoreMutation.isPending ? 'Restoring…' : 'Restore this version'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ---- Translations ------------------------------------------------- */}
      <section className="card">
        <h3>Translations</h3>
        {!canTranslate && (
          <p className="muted small">
            {page.lang === 'en'
              ? 'The homepage cannot be translated.'
              : 'Translations are created from the English page. This page is ' +
                langName(page.lang) +
                '.'}
          </p>
        )}
        {canTranslate && (
          <>
            <p className="muted small">
              Each language is a separate page linked back to this English original.
            </p>
            <ul className="translation-list">
              {TRANSLATION_LANGS.map((code) => {
                const info: TranslationInfo | null | undefined = translations?.[code];
                return (
                  <li key={code} className="translation-row">
                    <span className="translation-lang">{langName(code)}</span>
                    {info ? (
                      <>
                        <StatusBadge status={info.status as Page['status']} />
                        <Link className="btn small" to={`/pages/${info.id}`}>
                          Open translation
                        </Link>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="btn small"
                        onClick={() => translationMutation.mutate(code)}
                        disabled={translationMutation.isPending || locked}
                      >
                        {translationMutation.isPending && translationMutation.variables === code
                          ? 'Creating…'
                          : 'Create'}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>

      {/* ---- Contributors ------------------------------------------------- */}
      <section className="card">
        <h3>Credits</h3>
        <p className="muted small">
          Acknowledge the people who contributed to this page. Credits appear on the public page.
        </p>
        {contributorsQuery.isLoading && <p className="muted small">Loading credits…</p>}
        {contributorsQuery.isSuccess && contributorsQuery.data.length === 0 && (
          <p className="muted">No credits yet.</p>
        )}
        {contributorsQuery.isSuccess && contributorsQuery.data.length > 0 && (
          <ul className="credit-list">
            {contributorsQuery.data.map((c) => (
              <li key={c.id} className="credit-row">
                <span>
                  <b>{c.name}</b> <span className="muted small">· {c.role}</span>
                </span>
                <button
                  type="button"
                  className="btn small danger"
                  onClick={() => removeCreditMutation.mutate(c.id)}
                  disabled={removeCreditMutation.isPending}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        <AddCreditForm
          disabled={locked || addCreditMutation.isPending}
          onSubmit={(payload) => addCreditMutation.mutate(payload)}
        />
      </section>

      {isAdmin && page.status === 'pending' && (
        <p className="muted small">
          This page is locked for volunteers while it waits for approval — remember to approve it from
          the review queue.
        </p>
      )}
    </div>
  );
}

function RevisionRow({
  revision,
  isLatest,
  canRestore,
  restoreDisabled,
  onPreview,
  onRestore,
}: {
  revision: Revision;
  isLatest: boolean;
  canRestore: boolean;
  restoreDisabled: boolean;
  onPreview: () => void;
  onRestore: () => void;
}) {
  return (
    <li className="revision-row">
      <div className="revision-head">
        <span>
          <b>{revision.title || 'Untitled'}</b>
          {isLatest && <span className="tag">latest snapshot</span>}
        </span>
        <span className="muted small nowrap">{formatDateTime(revision.created_at)}</span>
      </div>
      <div className="revision-meta muted small">
        <span>By {revision.created_by_name || 'Unknown'}</span>
        {revision.slug && (
          <span>
            · <code>/{revision.slug}</code>
          </span>
        )}
      </div>
      <div className="revision-actions">
        <button type="button" className="btn small" onClick={onPreview}>
          Preview
        </button>
        {canRestore && (
          <button
            type="button"
            className="btn small"
            onClick={onRestore}
            disabled={restoreDisabled}
          >
            Restore
          </button>
        )}
      </div>
    </li>
  );
}

function AddCreditForm({
  disabled,
  onSubmit,
}: {
  disabled: boolean;
  onSubmit: (payload: { name: string; role: string }) => void;
}) {
  const [name, setName] = useState('');
  const [role, setRole] = useState('Author');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSubmit({ name: name.trim(), role: role.trim() || 'Contributor' });
    setName('');
  };

  return (
    <form className="credit-form" onSubmit={submit}>
      <label className="field compact" style={{ flex: 1 }}>
        <span>Name</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Dr. Ana Horvat"
        />
      </label>
      <label className="field compact">
        <span>Role</span>
        <input
          type="text"
          list="credit-roles"
          value={role}
          onChange={(e) => setRole(e.target.value)}
        />
        <datalist id="credit-roles">
          {ROLE_SUGGESTIONS.map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>
      </label>
      <button type="submit" className="btn" disabled={disabled || !name.trim()}>
        Add credit
      </button>
    </form>
  );
}

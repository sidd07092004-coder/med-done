import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { exportData, importData } from '../api/client';
import type { ImportPayload, ImportResult } from '../api/types';
import { formatDateTime } from '../lib/format';

interface PendingImport {
  payload: ImportPayload;
  groups: number;
  pages: number;
  users: number;
  schemaVersion?: number;
  fileName: string;
}

export function DataPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingImport | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const exportMutation = useMutation({
    mutationFn: () => exportData(),
    onSuccess: (data) => {
      setError(null);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const stamp = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `medically-complicated-export-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setNotice(
        `Exported ${data.pages.length} pages, ${data.groups.length} groups and ${data.users.length} users.`,
      );
    },
    onError: (err: Error) => {
      setNotice(null);
      setError(err.message);
    },
  });

  const importMutation = useMutation({
    mutationFn: (payload: ImportPayload) => importData(payload),
    onSuccess: (res) => {
      setError(null);
      setPending(null);
      setResult(res);
      setNotice(null);
    },
    onError: (err: Error) => {
      setNotice(null);
      setError(err.message);
    },
  });

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setNotice(null);
    setResult(null);
    try {
      const text = await file.text();
      const data = JSON.parse(text) as Partial<ImportPayload>;
      if (!Array.isArray(data.groups) && !Array.isArray(data.pages)) {
        throw new Error('This file does not look like an export (no groups or pages array).');
      }
      setPending({
        payload: {
          schemaVersion: data.schemaVersion,
          users: data.users,
          groups: data.groups ?? [],
          pages: data.pages ?? [],
          log: data.log,
        },
        groups: data.groups?.length ?? 0,
        pages: data.pages?.length ?? 0,
        users: data.users?.length ?? 0,
        schemaVersion: data.schemaVersion,
        fileName: file.name,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that file.');
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="page">
      <div className="crumb">Administration</div>
      <h2>Export &amp; import</h2>
      <p className="muted small">
        Back up the whole site structure and content to a JSON file, or restore one. Imports replace
        all groups and pages — use with care.
      </p>

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

      <div className="stat-columns">
        <section className="card">
          <h3>Export</h3>
          <p className="muted small">
            Downloads users, groups, pages (with live snapshots, revisions and credits) and the
            recent audit log as a single JSON document.
          </p>
          <button
            type="button"
            className="btn primary"
            onClick={() => exportMutation.mutate()}
            disabled={exportMutation.isPending}
          >
            {exportMutation.isPending ? 'Preparing…' : 'Download export (JSON)'}
          </button>
        </section>

        <section className="card">
          <h3>Import</h3>
          <p className="muted small">
            Choose a previously exported JSON file. You will be asked to confirm before anything is
            replaced.
          </p>
          <input
            ref={inputRef}
            type="file"
            accept="application/json,.json"
            onChange={(e) => onFile(e.target.files?.[0])}
            className="visually-hidden"
            id="data-import-input"
          />
          <label htmlFor="data-import-input" className="btn">
            Choose file…
          </label>
          {importMutation.isPending && <p className="muted small">Importing…</p>}
        </section>
      </div>

      {pending && (
        <div className="card import-confirm">
          <h3>Confirm import</h3>
          <div className="alert alert-warn">
            This <b>replaces all existing groups and pages</b>. Users are matched by email and never
            deleted. This cannot be undone.
          </div>
          <dl className="meta-list">
            <div>
              <dt>File</dt>
              <dd>{pending.fileName}</dd>
            </div>
            <div>
              <dt>Schema version</dt>
              <dd>{pending.schemaVersion ?? '—'}</dd>
            </div>
            <div>
              <dt>Groups</dt>
              <dd>{pending.groups}</dd>
            </div>
            <div>
              <dt>Pages</dt>
              <dd>{pending.pages}</dd>
            </div>
            <div>
              <dt>Users</dt>
              <dd>{pending.users}</dd>
            </div>
          </dl>
          <div className="modal-actions">
            <button
              type="button"
              className="btn"
              onClick={() => setPending(null)}
              disabled={importMutation.isPending}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn danger"
              onClick={() => importMutation.mutate(pending.payload)}
              disabled={importMutation.isPending}
            >
              {importMutation.isPending ? 'Importing…' : 'Replace and import'}
            </button>
          </div>
        </div>
      )}

      {result && (
        <div className="alert alert-success" role="status">
          <b>{result.message}.</b> Created {result.groups} groups and {result.pages} pages at{' '}
          {formatDateTime(new Date().toISOString())}. Reload pages to see the new structure.
        </div>
      )}
    </div>
  );
}

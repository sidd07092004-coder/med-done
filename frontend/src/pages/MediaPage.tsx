import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { deleteMedia, fetchMedia, uploadMedia } from '../api/client';
import type { MediaFile } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { formatBytes, formatDateTime } from '../lib/format';

export function MediaPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const inputRef = useRef<HTMLInputElement>(null);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const mediaQuery = useQuery({ queryKey: ['media'], queryFn: fetchMedia });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['media'] });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadMedia(file),
    onSuccess: (m) => {
      setError(null);
      setNotice(`Uploaded ${m.filename}.`);
      refresh();
    },
    onError: (err: Error) => {
      setNotice(null);
      setError(err.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteMedia(id),
    onSuccess: () => {
      setError(null);
      setNotice('Media deleted.');
      refresh();
    },
    onError: (err: Error) => {
      setNotice(null);
      setError(err.message);
    },
  });

  const onFilesChosen = (files: FileList | null) => {
    if (!files?.length) return;
    setNotice(null);
    setError(null);
    // Upload sequentially so server errors are attributable to one file.
    Array.from(files).forEach((file) => uploadMutation.mutate(file));
    if (inputRef.current) inputRef.current.value = '';
  };

  const copyUrl = async (m: MediaFile) => {
    if (!m.public_url) return;
    try {
      await navigator.clipboard.writeText(m.public_url);
      setNotice(`Copied ${m.public_url}`);
      setError(null);
    } catch {
      window.prompt('Copy this URL', m.public_url);
    }
  };

  const items = mediaQuery.data ?? [];

  return (
    <div className="page">
      <div className="crumb">Library</div>
      <div className="page-head">
        <h2>Media library</h2>
        <div className="head-actions">
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            onChange={(e) => onFilesChosen(e.target.files)}
            className="visually-hidden"
            id="media-upload-input"
          />
          <label htmlFor="media-upload-input" className="btn primary">
            {uploadMutation.isPending ? 'Uploading…' : '+ Upload images'}
          </label>
        </div>
      </div>
      <p className="muted small">
        PNG, JPG, WebP or GIF. Uploaded files are served from <code>/uploads/…</code> and can be
        inserted into any page.
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

      {mediaQuery.isLoading && <div className="card">Loading media…</div>}
      {mediaQuery.isError && (
        <div className="alert alert-error" role="alert">
          Could not load media: {(mediaQuery.error as Error).message}
        </div>
      )}

      {mediaQuery.isSuccess && items.length === 0 && (
        <div className="card">
          <p className="muted">No images yet. Upload the first one above.</p>
        </div>
      )}

      {items.length > 0 && (
        <ul className="media-grid">
          {items.map((m) => (
            <li key={m.id}>
              <div className="media-item">
                <span className="media-thumb">
                  {m.public_url ? (
                    <img src={m.public_url} alt={m.filename} loading="lazy" />
                  ) : (
                    '?'
                  )}
                </span>
                <span className="media-name" title={m.filename}>
                  {m.filename}
                </span>
                <span className="media-meta muted small">
                  {formatBytes(m.size_bytes)} · {formatDateTime(m.created_at)}
                </span>
                <div className="media-actions">
                  <button
                    type="button"
                    className="btn small"
                    onClick={() => copyUrl(m)}
                    disabled={!m.public_url}
                  >
                    Copy URL
                  </button>
                  {isAdmin && (
                    <button
                      type="button"
                      className="btn small danger"
                      onClick={() => {
                        if (window.confirm(`Delete ${m.filename}? Pages using it will show a broken image.`)) {
                          deleteMutation.mutate(m.id);
                        }
                      }}
                      disabled={deleteMutation.isPending}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

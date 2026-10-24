import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchPages } from '../api/client';

interface LinkFieldProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  newTab?: boolean;
  onNewTabChange?: (value: boolean) => void;
  disabled?: boolean;
  placeholder?: string;
}

/** Client-side mirror of the backend allow-list. Server validation wins. */
function isAllowedHref(value: string): boolean {
  const href = value.trim();
  if (!href || href.length > 2048) return false;
  if (/[\s\u0000-\u001f\u007f]/.test(href)) return false;
  if (href.startsWith('//') || href.startsWith('/\\')) return false;
  const lower = href.toLowerCase();
  return (
    lower.startsWith('http://') ||
    lower.startsWith('https://') ||
    lower.startsWith('mailto:') ||
    lower.startsWith('tel:') ||
    href.startsWith('/')
  );
}

export function LinkField({
  value,
  onChange,
  label = 'Link',
  newTab,
  onNewTabChange,
  disabled = false,
  placeholder,
}: LinkFieldProps) {
  const dialogTitleId = useId();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const showNewTab = newTab !== undefined && onNewTabChange !== undefined;
  const invalid = value.trim().length > 0 && !isAllowedHref(value);

  const pagesQuery = useQuery({
    queryKey: ['link-picker-pages', search.trim()],
    queryFn: () => fetchPages({ q: search.trim() || undefined }),
    enabled: open,
    staleTime: 10_000,
  });

  const pickPage = (slug: string) => {
    onChange(`/${slug.replace(/^\/+/, '')}`);
    setOpen(false);
    setSearch('');
  };

  return (
    <div className="field link-field">
      <span>{label}</span>

      <div className="link-field-row">
        <input
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder ?? 'https://… or /path'}
          disabled={disabled}
        />
        <button
          type="button"
          className="btn small"
          onClick={() => setOpen(true)}
          disabled={disabled}
        >
          Pick page
        </button>
        <button
          type="button"
          className="btn small"
          onClick={() => onChange('')}
          disabled={disabled || value.length === 0}
        >
          Clear
        </button>
      </div>

      {invalid && (
        <p className="field-hint field-hint-warn">
          Only http(s), /path, mailto: and tel: links are accepted. The server enforces this on save.
        </p>
      )}

      {showNewTab && (
        <label className="inline-field link-field-newtab">
          <input
            type="checkbox"
            checked={newTab === true}
            onChange={(event) => onNewTabChange?.(event.target.checked)}
            disabled={disabled}
          />
          <span>Open in a new tab</span>
        </label>
      )}

      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)} role="presentation">
          <div
            className="modal modal-wide"
            role="dialog"
            aria-modal="true"
            aria-labelledby={dialogTitleId}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <h3 id={dialogTitleId}>Pick a page</h3>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setOpen(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <label className="field link-picker-search">
              <span>Search pages</span>
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Type a page title or slug…"
                autoFocus
              />
            </label>

            {pagesQuery.isLoading && <p className="muted small">Loading pages…</p>}

            {pagesQuery.isError && (
              <div className="alert alert-error" role="alert">
                Could not load pages: {(pagesQuery.error as Error).message}
              </div>
            )}

            {pagesQuery.isSuccess && pagesQuery.data.length === 0 && (
              <p className="muted">No pages match that search.</p>
            )}

            {pagesQuery.isSuccess && pagesQuery.data.length > 0 && (
              <ul className="link-picker-list">
                {pagesQuery.data.map((page) => (
                  <li key={page.id}>
                    <button
                      type="button"
                      className="link-picker-item"
                      onClick={() => pickPage(page.slug)}
                    >
                      <span className="link-picker-title">{page.title || '(untitled)'}</span>
                      <code>/{page.slug}</code>
                      <span className="link-picker-meta">{page.status}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

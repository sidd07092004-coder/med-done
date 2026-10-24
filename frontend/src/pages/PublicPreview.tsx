import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiError, fetchPublicPage } from '../api/client';
import { BlockRenderer } from '../components/BlockRenderer';
import { formatDateTime } from '../lib/format';

/**
 * Renders a page exactly as the public site would, by calling the public,
 * unauthenticated endpoint GET /api/v1/pages/{slug}. Only published pages are
 * served there, so a 404 means the slug has no live version yet.
 */
export function PublicPreview({ slug, lang = 'en' }: { slug: string; lang?: string }) {
  const query = useQuery({
    queryKey: ['public-page', slug, lang],
    queryFn: () => fetchPublicPage(slug, lang),
    enabled: Boolean(slug),
    retry: false,
  });

  if (!slug) return <p className="muted">Enter a slug to preview.</p>;
  if (query.isLoading) return <div className="card">Loading public page…</div>;

  if (query.isError) {
    const err = query.error as ApiError;
    if (err.status === 404) {
      return (
        <div className="alert alert-info">
          No published page exists at <code>/{slug}</code> ({lang}). Publish it (or ask an admin to
          approve it) to see the live version.
        </div>
      );
    }
    return (
      <div className="alert alert-error" role="alert">
        Could not load the public page: {err.message}
      </div>
    );
  }

  const page = query.data!;
  const byline = page.contributors
    ?.filter((c) => c.role === 'Writer' || c.role === 'Medical reviewer')
    .map((c) => `${c.role === 'Writer' ? 'Written by' : 'Reviewed by'} ${c.name}`)
    .join(' · ');

  return (
    <article className="public-page">
      <header className="public-head">
        <h1>{page.title}</h1>
        {byline && <p className="muted">{byline}</p>}
        {page.excerpt && <p className="public-excerpt">{page.excerpt}</p>}
      </header>
      <BlockRenderer content={page.content} />
      <footer className="public-foot muted small">
        <code>/{page.slug}</code> · {page.lang} · published {formatDateTime(page.published_at)}
      </footer>
    </article>
  );
}

/** Standalone route page: /preview?slug=...&lang=... */
export function PublicPreviewPage() {
  const [slugInput, setSlugInput] = useState('home');
  const [slug, setSlug] = useState('home');
  const [lang, setLang] = useState('en');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSlug(slugInput.trim());
  };

  return (
    <div className="page">
      <div className="crumb">Public preview</div>
      <h2>Public preview</h2>
      <p className="muted">
        Renders a published page straight from <code>GET /api/v1/pages/&lt;slug&gt;</code>.
      </p>

      <form className="toolbar" onSubmit={submit}>
        <label className="field compact">
          <span>Slug</span>
          <input
            type="text"
            value={slugInput}
            onChange={(e) => setSlugInput(e.target.value)}
            placeholder="e.g. home"
            aria-label="Page slug"
          />
        </label>
        <label className="field compact">
          <span>Language</span>
          <select value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Language">
            <option value="en">English</option>
            <option value="hr">Croatian</option>
            <option value="tr">Turkish</option>
            <option value="ar">Arabic</option>
          </select>
        </label>
        <button type="submit" className="btn primary">
          Load
        </button>
      </form>

      <div className="card">
        <PublicPreview slug={slug} lang={lang} />
      </div>
    </div>
  );
}

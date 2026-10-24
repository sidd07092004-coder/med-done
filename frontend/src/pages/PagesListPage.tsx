import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createPage,
  duplicatePage,
  fetchGroups,
  fetchPages,
  fetchTemplates,
  fetchTranslations,
} from '../api/client';
import type { Page, PageContent, PageFilters, PageStatus } from '../api/types';
import { StatusBadge } from '../components/StatusBadge';
import { useAuth } from '../auth/AuthContext';
import { findGroup, flattenGroups, groupPath } from '../lib/groups';
import { formatDateTime, langName, slugify } from '../lib/format';

const STATUS_OPTIONS: { value: '' | PageStatus; label: string }[] = [
  { value: '', label: 'All statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'pending', label: 'Awaiting approval' },
  { value: 'published', label: 'Published' },
  { value: 'rejected', label: 'Rejected' },
];

const LANG_OPTIONS = [
  { value: '', label: 'All languages' },
  { value: 'en', label: 'English' },
  { value: 'hr', label: 'Croatian' },
  { value: 'tr', label: 'Turkish' },
  { value: 'ar', label: 'Arabic' },
];

export function PagesListPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const groupId = params.get('group') ?? '';
  const q = params.get('q') ?? '';
  const status = (params.get('status') ?? '') as PageStatus | '';
  const lang = params.get('lang') ?? '';

  const [qInput, setQInput] = useState(q);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Keep the search box in sync if the URL changes (e.g. back button).
  useEffect(() => {
    setQInput(q);
  }, [q]);

  // Debounce typing into the URL so we do not fire a request per keystroke.
  useEffect(() => {
    if (qInput === q) return;
    const t = setTimeout(() => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (qInput) next.set('q', qInput);
          else next.delete('q');
          return next;
        },
        { replace: true },
      );
    }, 300);
    return () => clearTimeout(t);
  }, [qInput, q, setParams]);

  const filters: PageFilters = {
    group_id: groupId || undefined,
    q: q || undefined,
    status: status || undefined,
    lang: lang || undefined,
  };

  const pagesQuery = useQuery({
    queryKey: ['pages', filters],
    queryFn: () => fetchPages(filters),
  });

  // Fetch all pages separately so filters do not hide existing language versions.
  const allPagesQuery = useQuery({
    queryKey: ['pages', 'translation-index'],
    queryFn: () => fetchPages({}),
    staleTime: 30_000,
  });
  const allPages = allPagesQuery.data ?? [];

  const groupsQuery = useQuery({ queryKey: ['groups'], queryFn: fetchGroups, staleTime: 30_000 });
  const groups = groupsQuery.data ?? [];

  const duplicateMutation = useMutation({
    mutationFn: (pageId: string) => duplicatePage(pageId),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['pages'] });
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      navigate(`/pages/${created.id}`);
    },
  });

  const selectedGroup = findGroup(groups, groupId);
  const flatGroups = useMemo(() => flattenGroups(groups), [groups]);

  const setParam = (key: string, value: string) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    });
  };

  const openPage = (page: Page) => navigate(`/pages/${page.id}`);

  const onRowKey = (e: KeyboardEvent<HTMLTableRowElement>, page: Page) => {
    // Only handle keyboard activation when the row itself has focus.
    // Do not intercept Space/Enter from inputs, selects, buttons, or links inside the row.
    if (e.target !== e.currentTarget) return;

    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openPage(page);
    }
  };

  const heading = selectedGroup ? selectedGroup.name : 'All pages';
  const crumb = groupId ? groupPath(groups, groupId) : 'All pages';

  return (
    <div className="page">
      <div className="crumb">{crumb}</div>
      <div className="page-head">
        <h2>{heading}</h2>
        <button type="button" className="btn primary" onClick={() => setDialogOpen(true)}>
          + New page
        </button>
      </div>

      <div className="toolbar">
        <label className="field compact">
          <span>Search</span>
          <input
            type="search"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="Search title, slug or text…"
            aria-label="Search pages"
          />
        </label>

        <label className="field compact">
          <span>Status</span>
          <select
            value={status}
            onChange={(e) => setParam('status', e.target.value)}
            aria-label="Filter by status"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field compact">
          <span>Language</span>
          <select
            value={lang}
            onChange={(e) => setParam('lang', e.target.value)}
            aria-label="Filter by language"
          >
            {LANG_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {selectedGroup && selectedGroup.children.length > 0 && (
        <p className="muted">
          Subgroups:{' '}
          {selectedGroup.children.map((child, i) => (
            <span key={child.id}>
              {i > 0 && ', '}
              <Link to={`/pages?group=${child.id}`}>{child.name}</Link>
            </span>
          ))}
        </p>
      )}

      {pagesQuery.isLoading && <div className="card">Loading pages…</div>}

      {pagesQuery.isError && (
        <div className="alert alert-error" role="alert">
          Could not load pages: {(pagesQuery.error as Error).message}
        </div>
      )}

      {duplicateMutation.isError && (
        <div className="alert alert-error" role="alert">
          Could not duplicate the page: {(duplicateMutation.error as Error).message}
        </div>
      )}

      {pagesQuery.isSuccess && (
        <>
          <p className="muted small">
            {pagesQuery.data.length} page{pagesQuery.data.length === 1 ? '' : 's'}
            {selectedGroup && selectedGroup.children.length
              ? ` · ${selectedGroup.children.length} subgroup(s)`
              : ''}
            .
          </p>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Title</th>
                  <th scope="col">Slug</th>
                  <th scope="col">Lang</th>
                  <th scope="col">Status</th>
                  <th scope="col">Updated</th>
                  <th scope="col">Translations</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pagesQuery.data.map((page) => (
                  <tr
                    key={page.id}
                    className="clickable"
                    tabIndex={0}
                    onClick={() => openPage(page)}
                    onKeyDown={(e) => onRowKey(e, page)}
                    aria-label={`Open ${page.title}`}
                  >
                    <td>
                      <Link
                        to={`/pages/${page.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="strong-link"
                      >
                        {page.title}
                      </Link>
                      {page.is_homepage && <span className="tag">homepage</span>}
                    </td>
                    <td>
                      <code>/{page.slug}</code>
                    </td>
                    <td>{langName(page.lang)}</td>
                    <td>
                      <StatusBadge status={page.status} />
                    </td>
                    <td className="nowrap">{formatDateTime(page.updated_at)}</td>

                    <td onClick={(event) => event.stopPropagation()}>
                      <TranslationActions
                        page={page}
                        groups={flatGroups}
                        allPages={allPages}
                        isAdmin={isAdmin}
                        onCreated={(translatedPage) => {
                          queryClient.invalidateQueries({ queryKey: ['pages'] });
                          queryClient.invalidateQueries({ queryKey: ['groups'] });
                          queryClient.invalidateQueries({
                            queryKey: ['translations', page.id],
                          });

                          navigate(`/pages/${translatedPage.id}`);
                        }}
                      />
                    </td>
                    <td className="nowrap">
                      <button
                        type="button"
                        className="btn small"
                        onClick={(e) => {
                          e.stopPropagation();
                          duplicateMutation.mutate(page.id);
                        }}
                        onKeyDown={(e) => e.stopPropagation()}
                        disabled={
                          duplicateMutation.isPending && duplicateMutation.variables === page.id
                        }
                        aria-label={`Duplicate ${page.title}`}
                      >
                        {duplicateMutation.isPending && duplicateMutation.variables === page.id
                          ? 'Duplicating…'
                          : 'Duplicate'}
                      </button>
                    </td>
                  </tr>
                ))}
                {pagesQuery.data.length === 0 && (
                  <tr className="empty-row">
                    <td colSpan={7}>No pages match these filters.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {dialogOpen && (
        <NewPageDialog
          groups={flatGroups}
          defaultGroupId={groupId || flatGroups[0]?.id || ''}
          isAdmin={isAdmin}
          onClose={() => setDialogOpen(false)}
          onCreated={(page) => {
            queryClient.invalidateQueries({ queryKey: ['pages'] });
            queryClient.invalidateQueries({ queryKey: ['groups'] });
            setDialogOpen(false);
            navigate(`/pages/${page.id}`);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Translation actions
// ---------------------------------------------------------------------------

const TRANSLATION_LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'hr', label: 'Croatian' },
  { value: 'tr', label: 'Turkish' },
  { value: 'ar', label: 'Arabic' },
] as const;

type TranslationLanguage = 'en' | 'hr' | 'tr' | 'ar';
type TranslatableLanguage = 'hr' | 'tr' | 'ar';

interface TranslationActionsProps {
  page: Page;
  groups: { id: string; name: string; depth: number; path: string }[];
  allPages: Page[];
  isAdmin: boolean;
  onCreated: (page: Page) => void;
}

function TranslationActions({
  page,
  groups,
  allPages,
  isAdmin,
  onCreated,
}: TranslationActionsProps) {
  const [selectedLang, setSelectedLang] = useState<TranslatableLanguage | ''>('');
  const [dialogOpen, setDialogOpen] = useState(false);

  const translationsQuery = useQuery({
    queryKey: ['translations', page.id],
    queryFn: () => fetchTranslations(page.id),
    enabled: Boolean(page.id),
    staleTime: 30_000,
  });

  const translations = translationsQuery.data;

  const normalizeSlug = (slug: string) =>
    slug.replace(/^\/+|\/+$/g, '').toLowerCase();

  // Some existing language pages were created separately and may not have
  // translation_of_id. Match by group + slug as well as the translations API.
  const existingLanguages = new Set<TranslationLanguage>(
    allPages
      .filter(
        (candidate) =>
          candidate.id !== page.id &&
          candidate.group_id === page.group_id &&
          normalizeSlug(candidate.slug) === normalizeSlug(page.slug),
      )
      .map((candidate) => candidate.lang)
      .filter(
        (language): language is TranslationLanguage =>
          language === 'en' || language === 'hr' || language === 'tr' || language === 'ar',
      ),
  );

  const availableLanguages = (['en', 'hr', 'tr', 'ar'] as TranslationLanguage[])
    .filter((language) => language !== page.lang)
    .filter((language) => !existingLanguages.has(language))
    .filter((language) => {
      if (language === 'en') return true;
      return !translations?.[language as TranslatableLanguage];
    });

  if (translationsQuery.isLoading) {
    return <span className="muted small">Loading…</span>;
  }

  if (translationsQuery.isError) {
    return (
      <button
        type="button"
        className="btn small"
        onClick={(event) => {
          event.stopPropagation();
          void translationsQuery.refetch();
        }}
      >
        Retry
      </button>
    );
  }

  if (availableLanguages.length === 0) {
    return <span className="muted small">Complete</span>;
  }

  return (
    <>
      <label className="field compact">
        <span className="sr-only">Add translation for {page.title}</span>
        <select
          value=""
          aria-label={`Add translation for ${page.title}`}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => {
            const language = event.target.value as TranslatableLanguage;
            if (!language) return;

            setSelectedLang(language);
            setDialogOpen(true);
          }}
        >
          <option value="">+ Add translation</option>
          {availableLanguages.map((language) => (
            <option key={language} value={language}>
              {TRANSLATION_LANGUAGES.find((item) => item.value === language)?.label}
            </option>
          ))}
        </select>
      </label>

      {dialogOpen && selectedLang && (
        <NewPageDialog
          groups={groups}
          defaultGroupId={page.group_id}
          isAdmin={isAdmin}
          initialLang={selectedLang}
          translationSource={page}
          onClose={() => setDialogOpen(false)}
          onCreated={(translatedPage) => {
            setDialogOpen(false);
            onCreated(translatedPage);
          }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// New page dialog
// ---------------------------------------------------------------------------

interface NewPageDialogProps {
  groups: { id: string; name: string; depth: number; path: string }[];
  defaultGroupId: string;
  isAdmin: boolean;
  initialLang?: string;
  translationSource?: Page;
  onClose: () => void;
  onCreated: (page: Page) => void;
}

function NewPageDialog({
  groups,
  defaultGroupId,
  isAdmin,
  initialLang,
  translationSource,
  onClose,
  onCreated,
}: NewPageDialogProps) {
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [groupId, setGroupId] = useState(defaultGroupId);
  const [lang, setLang] = useState(initialLang ?? 'en');
  const [templateId, setTemplateId] = useState('blank');
  const [error, setError] = useState<string | null>(null);

  const templatesQuery = useQuery({
    queryKey: ['page-templates'],
    queryFn: fetchTemplates,
    staleTime: Infinity,
  });

  const templates = templatesQuery.data?.templates ?? [];
  const selectedTemplate = templates.find((template) => template.id === templateId);

  // Blank stays available even if the catalogue request fails or is still loading.
  const fallbackContent: PageContent = {
    format: 'blocks-v1',
    blocks: [{ type: 'paragraph', text: '' }],
  };
  const selectedContent = selectedTemplate?.content ?? fallbackContent;

  const effectiveSlug = slugEdited ? slug : slugify(title);

  const mutation = useMutation({
    mutationFn: () =>
      createPage({
        title: title.trim(),
        // For a translation, reuse the source page's slug and group.
        // Create a fresh, empty page instead of copying the source page content.
        slug: translationSource ? translationSource.slug : effectiveSlug,
        group_id: translationSource ? translationSource.group_id : groupId,
        lang,
        content: structuredClone(selectedContent),
        status: 'draft',
      }),
    onSuccess: (page) => onCreated(page),
    onError: (err: Error) => setError(err.message),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!groupId) {
      setError('Choose a group for the new page.');
      return;
    }
    mutation.mutate();
  };

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-page-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="new-page-title">{translationSource ? 'New translation' : 'New page'}</h3>
        <form onSubmit={submit}>
          {error && (
            <div className="alert alert-error" role="alert">
              {error}
            </div>
          )}

          <label className="field">
            <span>Title</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              required
            />
          </label>

          <label className="field">
            <span>Slug (URL path)</span>
            <input
              type="text"
              value={effectiveSlug}
              readOnly={Boolean(translationSource)}
              onChange={(e) => {
                setSlugEdited(true);
                setSlug(e.target.value);
              }}
            />
          </label>

          <fieldset className="field template-field">
            <legend>Template</legend>
            {templatesQuery.isLoading && <p className="muted small">Loading templates…</p>}
            {templatesQuery.isError && (
              <p className="muted small">
                Templates could not be loaded; a blank page will be created.
              </p>
            )}
            <div className="template-grid" role="radiogroup" aria-label="Starter template">
              {(templates.length > 0 ? templates : [{ id: 'blank', label: 'Blank', description: 'An empty page.', content: fallbackContent }]).map(
                (template) => (
                  <label
                    key={template.id}
                    className={`template-card${templateId === template.id ? ' selected' : ''}`}
                  >
                    <input
                      type="radio"
                      name="page-template"
                      value={template.id}
                      checked={templateId === template.id}
                      onChange={() => setTemplateId(template.id)}
                    />
                    <span className="template-card-body">
                      <b>{template.label}</b>
                      <span className="muted small">{template.description}</span>
                    </span>
                  </label>
                ),
              )}
            </div>
            <p className="muted small">
              The template supplies the initial blocks; you can edit everything afterwards.
            </p>
          </fieldset>

          <label className="field">
            <span>Group</span>
            <select value={groupId} onChange={(e) => setGroupId(e.target.value)} required disabled={Boolean(translationSource)}>
              <option value="">— choose a group —</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {'\u00A0'.repeat(g.depth * 3)}
                  {g.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Language</span>
            <select value={lang} onChange={(e) => setLang(e.target.value)} disabled={Boolean(translationSource)}>
              <option value="en">English</option>
              <option value="hr">Croatian</option>
              <option value="tr">Turkish</option>
              <option value="ar">Arabic</option>
            </select>
          </label>

          {!isAdmin && (
            <p className="muted small">
              The page is created as a draft. Only admins can publish directly.
            </p>
          )}

          <div className="modal-actions">
            <button type="button" className="btn" onClick={onClose} disabled={mutation.isPending}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={mutation.isPending || !groups.length}>
              {mutation.isPending ? 'Creating…' : translationSource ? 'Create translation' : 'Create page'}
            </button>
          </div>
          {!groups.length && (
            <p className="muted small">No groups exist yet, so a page cannot be created.</p>
          )}
        </form>
      </div>
    </div>
  );
}

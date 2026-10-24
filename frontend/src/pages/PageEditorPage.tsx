import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  Link,
  UNSAFE_DataRouterContext,
  useBlocker,
  useNavigate,
  useParams,
} from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  approvePage,
  deletePage,
  duplicatePage,
  fetchGroups,
  fetchPage,
  fetchTemplates,
  rejectPage,
  submitPage,
  unpublishPage,
  updatePage,
} from '../api/client';
import type {
  Block,
  Page,
  PageContent,
  PageUpdatePayload,
  RobotsDirective,
} from '../api/types';
import { isBlocksContent, isHomeContent, isKnownBlock } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { StatusBadge } from '../components/StatusBadge';
import { BlockRenderer } from '../components/BlockRenderer';
import { UndoRedoToolbar } from '../components/UndoRedoToolbar';
import { MediaField } from '../components/MediaField';
import { BlockEditor, HomeFieldsEditor } from './BlockEditor';
import { PublicPreview } from './PublicPreview';
import { PageManagePanel } from './PageManagePanel';
import { flattenGroups } from '../lib/groups';
import { formatDateTime, langName } from '../lib/format';
import { applyArrangeBox, type ArrangeBox } from '../lib/arrange';
import {
  blocksChangeKey,
  contentSignature,
  getPrePublishChecks,
  isDirty,
  structuralHistoryKey,
  useEditorHistory,
  type EditorContentState,
  type PrePublishCheck,
} from '../lib/pageBuilder';
import { useDocumentMeta } from '../hooks/useDocumentMeta';

type PreviewMode = 'working' | 'public';
type RobotsValue = '' | RobotsDirective;

function normalizeBlocks(blocks: Block[]): Block[] {
  return blocks.map((b) => {
    if (isKnownBlock(b) && b.type === 'list') {
      return { ...b, items: b.items.filter((i) => i.trim() !== '') };
    }
    return b;
  });
}

export function PageEditorPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const inDataRouter = useContext(UNSAFE_DataRouterContext) !== null;

  const pageQuery = useQuery({
    queryKey: ['page', id],
    queryFn: () => fetchPage(id),
    enabled: Boolean(id),
  });
  const groupsQuery = useQuery({ queryKey: ['groups'], queryFn: fetchGroups, staleTime: 30_000 });
  const templatesQuery = useQuery({
    queryKey: ['page-templates'],
    queryFn: fetchTemplates,
    staleTime: Infinity,
  });
  const flatGroups = useMemo(() => flattenGroups(groupsQuery.data ?? []), [groupsQuery.data]);

  const page = pageQuery.data;

  // ---- local editable state -------------------------------------------------
  const [initializedId, setInitializedId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [groupId, setGroupId] = useState('');
  const [lang, setLang] = useState('en');
  const [excerpt, setExcerpt] = useState('');
  const [metaTitle, setMetaTitle] = useState('');
  const [metaDescription, setMetaDescription] = useState('');
  const [canonicalPath, setCanonicalPath] = useState('');
  const [robots, setRobots] = useState<RobotsValue>('');
  const [ogImage, setOgImage] = useState('');
  const [reviewer, setReviewer] = useState('');
  const [isHomeFormat, setIsHomeFormat] = useState(false);
  const [isHomepage, setIsHomepage] = useState(false);
  const [featured, setFeatured] = useState(false);

  const editorHistory = useEditorHistory<EditorContentState>({ blocks: [], homeFields: {} });
  const { blocks, homeFields } = editorHistory.present;
  const {
    push: pushHistory,
    reset: resetHistory,
    undo: undoHistory,
    redo: redoHistory,
    canUndo,
    canRedo,
    undoCount,
    redoCount,
  } = editorHistory;

  const [tab, setTab] = useState<'edit' | 'preview' | 'manage'>('edit');
  const [previewMode, setPreviewMode] = useState<PreviewMode>('working');
  const [arrangeMode, setArrangeMode] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectNote, setRejectNote] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seoOpen, setSeoOpen] = useState(false);
  const [templateChoice, setTemplateChoice] = useState('');
  const [pendingLanguage, setPendingLanguage] = useState<string | null>(null);
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(null);
  const allowNavigationRef = useRef(false);

  // Re-arm the guard when the editor is reused for another page id (duplicate).
  useEffect(() => {
    allowNavigationRef.current = false;
  }, [id]);

  useEffect(() => {
    if (!page || initializedId === page.id) return;
    setInitializedId(page.id);
    setTitle(page.title);
    setSlug(page.slug);
    setGroupId(page.group_id);
    setLang(page.lang || 'en');
    setExcerpt(page.excerpt ?? '');
    setMetaTitle(page.meta_title ?? '');
    setMetaDescription(page.meta_description ?? '');
    setCanonicalPath(page.canonical_path ?? '');
    setRobots(page.robots === 'index' || page.robots === 'noindex' ? page.robots : '');
    setOgImage(page.og_image ?? '');
    setReviewer(page.reviewer ?? '');
    setIsHomepage(Boolean(page.is_homepage));
    setFeatured(Boolean(page.featured));
    if (isHomeContent(page.content)) {
      setIsHomeFormat(true);
      resetHistory({ blocks: [], homeFields: { ...page.content.fields } });
    } else {
      setIsHomeFormat(false);
      resetHistory({
        blocks: isBlocksContent(page.content) ? [...page.content.blocks] : [],
        homeFields: {},
      });
    }
    setArrangeMode(false);
  }, [page, initializedId, resetHistory]);

  const currentContent = useMemo<PageContent>(() => {
    if (isHomeFormat) return { format: 'home-v1', fields: homeFields };
    return { format: 'blocks-v1', blocks: normalizeBlocks(blocks) };
  }, [isHomeFormat, homeFields, blocks]);

  const locked = page?.status === 'pending' && !isAdmin;

  // Arrange mode edits the blocks, so it must never stay on for a page that
  // cannot be edited any more.
  useEffect(() => {
    if (locked) setArrangeMode(false);
  }, [locked]);

  const savedContent = useMemo<PageContent>(() => {
    if (!page) return { format: 'blocks-v1', blocks: [] };
    if (isHomeContent(page.content)) {
      return { format: 'home-v1', fields: page.content.fields };
    }
    if (isBlocksContent(page.content)) {
      return { format: 'blocks-v1', blocks: normalizeBlocks(page.content.blocks) };
    }
    return { format: 'blocks-v1', blocks: [] };
  }, [page]);

  const savedSignature = contentSignature(savedContent);

  const dirty = useMemo(() => {
    if (!page) return false;

    const baseline: Record<string, unknown> = {
      title: page.title,
      slug: page.slug,
      groupId: page.group_id,
      lang: page.lang || 'en',
      excerpt: page.excerpt ?? '',
      metaTitle: page.meta_title ?? '',
      metaDescription: page.meta_description ?? '',
      canonicalPath: page.canonical_path ?? '',
      robots: page.robots === 'index' || page.robots === 'noindex' ? page.robots : '',
      ogImage: page.og_image ?? '',
      reviewer: (page.lang || 'en') !== 'en' ? page.reviewer ?? '' : '',
      content: savedSignature,
    };
    const current: Record<string, unknown> = {
      title,
      slug,
      groupId,
      lang,
      excerpt,
      metaTitle,
      metaDescription,
      canonicalPath,
      robots,
      ogImage,
      reviewer: lang !== 'en' ? reviewer : '',
      content: contentSignature(currentContent),
    };
    // Admin-only flags never make a volunteer's page dirty.
    if (isAdmin) {
      baseline.isHomepage = Boolean(page.is_homepage);
      baseline.featured = Boolean(page.featured);
      current.isHomepage = isHomepage;
      current.featured = featured;
    }

    return isDirty(baseline, current);
  }, [
    page,
    title,
    slug,
    groupId,
    lang,
    excerpt,
    metaTitle,
    metaDescription,
    canonicalPath,
    robots,
    ogImage,
    reviewer,
    isAdmin,
    isHomepage,
    featured,
    currentContent,
    savedSignature,
  ]);

  // Document title/meta reflects the current draft while this page is open.
  useDocumentMeta(
    {
      metaTitle,
      title,
      metaDescription,
      excerpt,
      canonicalPath,
      robots: robots || null,
      ogImage,
    },
    Boolean(page),
  );

  // ---- dirty-navigation guard ----------------------------------------------
  const discardChanges = useCallback(() => {
    if (!page) return;
    setTitle(page.title);
    setSlug(page.slug);
    setGroupId(page.group_id);
    setLang(page.lang || 'en');
    setExcerpt(page.excerpt ?? '');
    setMetaTitle(page.meta_title ?? '');
    setMetaDescription(page.meta_description ?? '');
    setCanonicalPath(page.canonical_path ?? '');
    setRobots(page.robots === 'index' || page.robots === 'noindex' ? page.robots : '');
    setOgImage(page.og_image ?? '');
    setReviewer(page.reviewer ?? '');
    setIsHomepage(Boolean(page.is_homepage));
    setFeatured(Boolean(page.featured));

    if (isHomeContent(page.content)) {
      setIsHomeFormat(true);
      resetHistory({ blocks: [], homeFields: { ...page.content.fields } });
    } else {
      setIsHomeFormat(false);
      resetHistory({
        blocks: isBlocksContent(page.content) ? [...page.content.blocks] : [],
        homeFields: {},
      });
    }
  }, [page, resetHistory]);

  useEffect(() => {
    if (!dirty || locked) return undefined;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty, locked]);

  // BrowserRouter fallback: links are intercepted so the same discard modal is
  // shown for in-app navigation. Data routers use the useBlocker component.
  useEffect(() => {
    if (inDataRouter) return undefined;

    const onClick = (event: MouseEvent) => {
      if (!dirty || locked || allowNavigationRef.current) return;
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const target = event.target as HTMLElement | null;
      const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor) return;
      if ((anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) return;

      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#') || /^(mailto|tel):/i.test(href)) return;

      let url: URL;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;

      event.preventDefault();
      event.stopPropagation();
      setPendingNavigation(`${url.pathname}${url.search}${url.hash}`);
    };

    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [inDataRouter, dirty, locked]);

  // ---- content change handlers ---------------------------------------------
  const handleBlocksChange = (next: Block[]) => {
    pushHistory({ blocks: next, homeFields }, { key: blocksChangeKey(blocks, next) });
  };

  const handleHomeFieldsChange = (next: Record<string, string>) => {
    const previousKeys = Object.keys(homeFields);
    const nextKeys = Object.keys(next);
    const structural =
      previousKeys.length !== nextKeys.length ||
      previousKeys.some((key) => !Object.prototype.hasOwnProperty.call(next, key));

    const changedKey =
      nextKeys.find((key) => next[key] !== homeFields[key]) ??
      previousKeys.find((key) => !Object.prototype.hasOwnProperty.call(next, key)) ??
      'field';

    pushHistory(
      { blocks, homeFields: next },
      { key: structural ? structuralHistoryKey('home-fields') : `text:home:${changedKey}` },
    );
  };

  /**
   * Arrange mode writes straight into the same history state the block editor
   * uses, so the regular Save flow persists the result and undo still works.
   */
  const handleArrangeChange = (index: number, box: ArrangeBox) => {
    const next = blocks.map((block, i) => (i === index ? applyArrangeBox(block, box) : block));
    pushHistory({ blocks: next, homeFields }, { key: `layout:${index}:arrange` });
  };

  // Undo/redo shortcuts. Native text undo is intentionally left alone while the
  // caret is inside a field; the toolbar still works there.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (tab !== 'edit' || !(event.ctrlKey || event.metaKey) || event.altKey) return;

      const target = event.target as HTMLElement | null;
      if (
        target?.closest(
          'input, textarea, select, [contenteditable="true"], [role="textbox"], .modal-backdrop, [role="dialog"]',
        )
      ) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === 'z') {
        if (event.shiftKey) {
          if (canRedo) {
            event.preventDefault();
            redoHistory();
          }
        } else if (canUndo) {
          event.preventDefault();
          undoHistory();
        }
      } else if (key === 'y' && canRedo) {
        event.preventDefault();
        redoHistory();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [tab, canUndo, canRedo, undoHistory, redoHistory]);

  // ---- mutations ------------------------------------------------------------
  const applyServerPage = (updated: Page, options: { resetContent?: boolean } = {}) => {
    queryClient.setQueryData(['page', updated.id], updated);
    queryClient.invalidateQueries({ queryKey: ['pages'] });
    queryClient.invalidateQueries({ queryKey: ['queue'] });
    queryClient.invalidateQueries({ queryKey: ['groups'] });
    queryClient.invalidateQueries({ queryKey: ['page', id] });

    // Keep scalar form values in sync with server trimming/sanitising without
    // touching history (so undo after a save still marks the page dirty).
    setTitle(updated.title);
    setSlug(updated.slug);
    setGroupId(updated.group_id);
    setLang(updated.lang || 'en');
    setExcerpt(updated.excerpt ?? '');
    setMetaTitle(updated.meta_title ?? '');
    setMetaDescription(updated.meta_description ?? '');
    setCanonicalPath(updated.canonical_path ?? '');
    setRobots(updated.robots === 'index' || updated.robots === 'noindex' ? updated.robots : '');
    setOgImage(updated.og_image ?? '');
    setReviewer(updated.reviewer ?? '');
    setIsHomepage(Boolean(updated.is_homepage));
    setFeatured(Boolean(updated.featured));

    if (options.resetContent) {
      setInitializedId(null);
    }
  };

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload: PageUpdatePayload = {
        title: title.trim(),
        slug: slug.trim(),
        group_id: groupId,
        lang,
        excerpt: excerpt || null,
        // Caps are enforced in the UI and repeated here (spec §6.1).
        meta_title: metaTitle.trim() ? metaTitle.trim().slice(0, 70) : null,
        meta_description: metaDescription.trim()
          ? metaDescription.trim().slice(0, 160)
          : null,
        canonical_path: canonicalPath.trim() || null,
        robots: robots || null,
        og_image: ogImage.trim() || null,
        content: currentContent,
      };
      if (lang !== 'en') payload.reviewer = reviewer || null;
      // Admin-only flags (R22): volunteers must not send either key at all.
      if (isAdmin) {
        payload.is_homepage = isHomepage;
        payload.featured = featured;
      }
      return updatePage(id, payload);
    },
    onSuccess: (updated) => {
      setError(null);
      setNotice('Saved.');
      applyServerPage(updated);
    },
    onError: (err: Error) => {
      setNotice(null);
      setError(err.message);
    },
  });

  const submitMutation = useMutation({
    mutationFn: () => submitPage(id),
    onSuccess: (updated) => {
      setError(null);
      setNotice('Submitted for approval.');
      applyServerPage(updated);
    },
    onError: (err: Error) => {
      setNotice(null);
      setError(err.message);
    },
  });

  const handleSubmitForApproval = async () => {
    setError(null);
    setNotice(null);
    try {
      // Step 1: save pending changes first.
      if (dirty) await saveMutation.mutateAsync();
      // Step 2: submit the saved page for approval.
      await submitMutation.mutateAsync();
    } catch (err) {
      console.error('Page submission failed:', err);
    }
  };

  const approveMutation = useMutation({
    mutationFn: () => approvePage(id),
    onSuccess: (updated) => {
      setError(null);
      setNotice('Approved and published.');
      applyServerPage(updated);
    },
    onError: (err: Error) => {
      setNotice(null);
      setError(err.message);
    },
  });

  const rejectMutation = useMutation({
    mutationFn: () => rejectPage(id, rejectNote.trim()),
    onSuccess: (updated) => {
      setError(null);
      setNotice('Rejected.');
      setRejecting(false);
      setRejectNote('');
      applyServerPage(updated);
    },
    onError: (err: Error) => {
      setNotice(null);
      setError(err.message);
    },
  });

  const unpublishMutation = useMutation({
    mutationFn: () => unpublishPage(id),
    onSuccess: (updated) => {
      setError(null);
      setNotice('Unpublished (moved back to draft).');
      applyServerPage(updated);
    },
    onError: (err: Error) => {
      setNotice(null);
      setError(err.message);
    },
  });

  const duplicateMutation = useMutation({
    mutationFn: () => duplicatePage(id),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['pages'] });
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      allowNavigationRef.current = true;
      navigate(`/pages/${created.id}`);
    },
    onError: (err: Error) => {
      setNotice(null);
      setError(err.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deletePage(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pages'] });
      queryClient.invalidateQueries({ queryKey: ['queue'] });
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      allowNavigationRef.current = true;
      navigate('/pages');
    },
    onError: (err: Error) => setError(err.message),
  });

  const busy =
    saveMutation.isPending ||
    submitMutation.isPending ||
    approveMutation.isPending ||
    rejectMutation.isPending ||
    unpublishMutation.isPending ||
    duplicateMutation.isPending ||
    deleteMutation.isPending;

  // ---- editorial checks -----------------------------------------------------
  const selectedGroupPath = flatGroups.find((g) => g.id === groupId)?.path ?? '';
  const checks = useMemo<PrePublishCheck[]>(
    () =>
      getPrePublishChecks(
        { slug, metaTitle, metaDescription },
        currentContent,
        selectedGroupPath,
      ),
    [slug, metaTitle, metaDescription, currentContent, selectedGroupPath],
  );

  const templates = templatesQuery.data?.templates ?? [];
  const applyTemplate = () => {
    const template = templates.find((item) => item.id === templateChoice);
    if (!template || !isBlocksContent(template.content)) return;
    if (
      blocks.length > 0 &&
      !window.confirm(`Replace the current content with the ${template.label} template?`)
    ) {
      return;
    }
    pushHistory(
      { blocks: structuredClone(template.content.blocks), homeFields },
      { key: structuralHistoryKey('template') },
    );
    setNotice(`Applied the ${template.label} template. Save to keep the change.`);
  };

  const requestLanguageChange = (next: string) => {
    if (next === lang) return;
    if (!dirty || locked) {
      setLang(next);
      return;
    }
    setPendingLanguage(next);
  };

  // ---- render ---------------------------------------------------------------
  if (pageQuery.isLoading) return <div className="card">Loading page…</div>;
  if (pageQuery.isError) {
    return (
      <div className="page">
        <div className="alert alert-error" role="alert">
          Could not load the page: {(pageQuery.error as Error).message}
        </div>
        <Link to="/pages" className="btn">
          Back to pages
        </Link>
      </div>
    );
  }
  if (!page) return null;

  const canSubmit = page.status === 'draft' || page.status === 'rejected';

  return (
    <div className="page">
      <div className="crumb">
        <Link to="/pages">All pages</Link> / {page.title}
      </div>

      <div className="page-head">
        <h2>{page.title}</h2>
        <div className="head-actions">
          <StatusBadge status={page.status} />
          <div className="tabs" role="tablist" aria-label="Editor view">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'edit'}
              className={`tab${tab === 'edit' ? ' active' : ''}`}
              onClick={() => setTab('edit')}
            >
              Edit
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'preview'}
              className={`tab${tab === 'preview' ? ' active' : ''}`}
              onClick={() => setTab('preview')}
            >
              Preview
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'manage'}
              className={`tab${tab === 'manage' ? ' active' : ''}`}
              onClick={() => setTab('manage')}
            >
              History &amp; credits
            </button>
          </div>
        </div>
      </div>

      <p className="muted small">
        {page.live_title
          ? 'A live version is visible on the site. Edits stay hidden until approved.'
          : 'Not on the site yet.'}
        {page.updated_at && <> · Last updated {formatDateTime(page.updated_at)}</>}
      </p>

      {page.status === 'rejected' && page.reject_note && (
        <div className="alert alert-error">
          <b>Rejected:</b> {page.reject_note}
        </div>
      )}

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

      {locked && (
        <div className="alert alert-warn">
          Waiting for admin approval. A volunteer cannot edit this page until it is approved or
          rejected.
        </div>
      )}

      {tab === 'edit' ? (
        <div className="editor-layout">
          <section className="editor-main" aria-label="Page content">
            <div className="editor-toolbar">
              <UndoRedoToolbar
                canUndo={canUndo}
                canRedo={canRedo}
                undoCount={undoCount}
                redoCount={redoCount}
                onUndo={undoHistory}
                onRedo={redoHistory}
                disabled={locked}
              />
            </div>

            {isHomeFormat ? (
              <HomeFieldsEditor
                fields={homeFields}
                onChange={handleHomeFieldsChange}
                disabled={locked}
              />
            ) : (
              <BlockEditor value={blocks} onChange={handleBlocksChange} disabled={locked} />
            )}
          </section>

          <aside className="editor-side" aria-label="Page settings">
            <label className="field">
              <span>Title</span>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={locked}
              />
            </label>

            <label className="field">
              <span>Slug (URL path)</span>
              <input
                type="text"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                disabled={locked}
              />
            </label>

            <label className="field">
              <span>Group</span>
              <select
                value={groupId}
                onChange={(e) => setGroupId(e.target.value)}
                disabled={locked}
              >
                <option value="">— choose a group —</option>
                {flatGroups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {'\u00A0'.repeat(g.depth * 3)}
                    {g.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Language</span>
              <select
                value={lang}
                onChange={(e) => requestLanguageChange(e.target.value)}
                disabled={locked}
              >
                <option value="en">English</option>
                <option value="hr">Croatian</option>
                <option value="tr">Turkish</option>
                <option value="ar">Arabic</option>
              </select>
            </label>

            {isAdmin && (
              <>
                <label className="inline-field">
                  <input
                    type="checkbox"
                    checked={isHomepage}
                    onChange={(e) => setIsHomepage(e.target.checked)}
                    disabled={locked}
                  />
                  <span>Use as homepage for this language</span>
                </label>
                <label className="inline-field">
                  <input
                    type="checkbox"
                    checked={featured}
                    onChange={(e) => setFeatured(e.target.checked)}
                    disabled={locked}
                  />
                  <span>Featured</span>
                </label>
                <p className="muted small">
                  Saving a homepage unsets the previous homepage for this language.
                </p>
              </>
            )}

            {lang !== 'en' && (
              <label className="field">
                <span>Reviewer</span>
                <input
                  type="text"
                  value={reviewer}
                  onChange={(e) => setReviewer(e.target.value)}
                  disabled={locked}
                />
              </label>
            )}

            <label className="field">
              <span>Excerpt</span>
              <textarea
                rows={3}
                value={excerpt}
                onChange={(e) => setExcerpt(e.target.value)}
                disabled={locked}
              />
            </label>

            <div className={`seo-panel${seoOpen ? ' open' : ''}`}>
              <button
                type="button"
                className="seo-toggle"
                aria-expanded={seoOpen}
                onClick={() => setSeoOpen((open) => !open)}
              >
                <span>SEO &amp; metadata</span>
                <span aria-hidden="true">{seoOpen ? '▾' : '▸'}</span>
              </button>

              {seoOpen && (
                <div className="seo-body">
                  <label className="field">
                    <span className="field-label-row">
                      Meta title
                      <span className="char-count">{metaTitle.length}/70</span>
                    </span>
                    <input
                      type="text"
                      value={metaTitle}
                      maxLength={70}
                      onChange={(e) => setMetaTitle(e.target.value)}
                      disabled={locked}
                    />
                    <span className="field-hint">
                      Falls back to the page title, then the site default. Truncated at 70
                      characters on save.
                    </span>
                  </label>

                  <label className="field">
                    <span className="field-label-row">
                      Meta description
                      <span className="char-count">{metaDescription.length}/160</span>
                    </span>
                    <textarea
                      rows={3}
                      value={metaDescription}
                      maxLength={160}
                      onChange={(e) => setMetaDescription(e.target.value)}
                      disabled={locked}
                    />
                    <span className="field-hint">
                      Falls back to the excerpt, then the site default. Truncated at 160
                      characters on save.
                    </span>
                  </label>

                  <label className="field">
                    <span>Canonical path</span>
                    <input
                      type="text"
                      value={canonicalPath}
                      onChange={(e) => setCanonicalPath(e.target.value)}
                      placeholder="/guides/example"
                      disabled={locked}
                    />
                    <span className="field-hint">
                      Optional absolute URL or site path (must start with /). Empty means the
                      page&apos;s own URL.
                    </span>
                  </label>

                  <label className="field">
                    <span>Robots</span>
                    <select
                      value={robots}
                      onChange={(e) => setRobots(e.target.value as RobotsValue)}
                      disabled={locked}
                    >
                      <option value="">Default (index)</option>
                      <option value="index">index</option>
                      <option value="noindex">noindex</option>
                    </select>
                    <span className="field-hint">
                      noindex keeps the page out of search engines; the default is index.
                    </span>
                  </label>

                  <MediaField
                    label="Social share image (OG)"
                    value={ogImage}
                    onChange={setOgImage}
                    accept="image"
                    disabled={locked}
                  />
                  <p className="field-hint">
                    Used for og:image. No image tag is emitted when this is empty.
                  </p>

                  {page.meta_keywords && page.meta_keywords.length > 0 && (
                    <p className="muted small legacy-keywords">
                      Legacy meta keywords are preserved for existing content but are not
                      editable or sent with this form.
                    </p>
                  )}
                </div>
              )}
            </div>

            {!locked && !isHomeFormat && (
              <details className="template-panel">
                <summary>Start from a template</summary>
                <div className="template-panel-body">
                  {templatesQuery.isLoading && <p className="muted small">Loading templates…</p>}
                  {templatesQuery.isError && (
                    <p className="muted small">Templates could not be loaded.</p>
                  )}
                  {templates.length > 0 && (
                    <select
                      value={templateChoice}
                      onChange={(e) => setTemplateChoice(e.target.value)}
                      aria-label="Choose a template"
                    >
                      <option value="">— choose a template —</option>
                      {templates.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.label}
                        </option>
                      ))}
                    </select>
                  )}
                  <button
                    type="button"
                    className="btn small"
                    onClick={applyTemplate}
                    disabled={!templateChoice}
                  >
                    Replace content
                  </button>
                  <p className="muted small">
                    The template replaces the current blocks. Undo is available if you change
                    your mind.
                  </p>
                </div>
              </details>
            )}

            <dl className="meta-list">
              <div>
                <dt>Language</dt>
                <dd>{langName(page.lang)}</dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>{formatDateTime(page.created_at)}</dd>
              </div>
              <div>
                <dt>Published</dt>
                <dd>{formatDateTime(page.published_at)}</dd>
              </div>
            </dl>
          </aside>
        </div>
      ) : tab === 'preview' ? (
        <div className="editor-layout single">
          <section aria-label="Preview">
            <div className="preview-toggle" role="group" aria-label="Preview source">
              <button
                type="button"
                className={`btn small${previewMode === 'working' ? ' primary' : ''}`}
                onClick={() => setPreviewMode('working')}
              >
                Working draft
              </button>
              <button
                type="button"
                className={`btn small${previewMode === 'public' ? ' primary' : ''}`}
                onClick={() => setPreviewMode('public')}
              >
                Public (live)
              </button>
              <Link className="btn small" to={`/preview?slug=${encodeURIComponent(slug || page.slug)}`}>
                Open public preview page ↗
              </Link>
            </div>

            {!locked && !isHomeFormat && previewMode === 'working' && (
              <div className="arrange-bar">
                <label className="inline-field">
                  <input
                    type="checkbox"
                    checked={arrangeMode}
                    onChange={(e) => setArrangeMode(e.target.checked)}
                  />
                  <span>Arrange mode</span>
                </label>
                <p className="muted small">
                  {arrangeMode
                    ? 'Drag the ↔ handle on the left edge of a block to move it, or the ⇥ handle on its right edge to resize it.'
                    : 'Turn on Arrange mode to position blocks by dragging. Exact values stay available in each block’s Design panel.'}
                </p>
              </div>
            )}

            <div className="card preview-card">
              {previewMode === 'working' ? (
                <article className="public-page">
                  <header className="public-head">
                    <h1>{title || 'Untitled'}</h1>
                    {excerpt && <p className="public-excerpt">{excerpt}</p>}
                  </header>
                  <BlockRenderer
                    content={currentContent}
                    arrange={
                      arrangeMode && !locked && !isHomeFormat
                        ? { onLayoutChange: handleArrangeChange }
                        : undefined
                    }
                  />
                </article>
              ) : (
                <PublicPreview slug={page.live_slug || slug} lang={lang} />
              )}
            </div>
          </section>
        </div>
      ) : (
        <PageManagePanel
          page={page}
          isAdmin={isAdmin}
          locked={locked}
          onPageChanged={(updated, options) => applyServerPage(updated, options)}
        />
      )}

      {!locked && canSubmit && (
        <section className="card check-panel" aria-label="Pre-publish checks">
          <div className="check-head">
            <h3>Pre-publish checks</h3>
            <span className={`check-count${checks.length ? ' warn' : ' ok'}`}>
              {checks.length ? `${checks.length} warning${checks.length === 1 ? '' : 's'}` : 'All clear'}
            </span>
          </div>
          {checks.length === 0 ? (
            <p className="muted small">
              No editorial warnings. Metadata and accessibility checks look good.
            </p>
          ) : (
            <ul className="check-list">
              {checks.map((check, index) => (
                <li key={`${check.code}-${check.blockIndex ?? 'page'}-${index}`}>
                  <span className="check-message">{check.message}</span>
                  <code className="check-code">{check.code}</code>
                </li>
              ))}
            </ul>
          )}
          <p className="muted small">
            These checks are advisory only — submitting still works and nothing is blocked.
          </p>
        </section>
      )}

      {/* Action bar */}
      <div className="action-bar">
        {!locked && (
          <button
            type="button"
            className="btn primary"
            onClick={() => saveMutation.mutate()}
            disabled={busy || !dirty}
          >
            {saveMutation.isPending ? 'Saving…' : 'Save changes'}
          </button>
        )}

        {!locked && canSubmit && (
          <button type="button" className="btn" onClick={handleSubmitForApproval} disabled={busy}>
            {submitMutation.isPending
              ? 'Submitting…'
              : dirty && saveMutation.isPending
                ? 'Saving changes…'
                : checks.length > 0
                  ? 'Submit anyway'
                  : 'Submit for approval'}
          </button>
        )}

        {isAdmin && page.status === 'pending' && (
          <>
            <button
              type="button"
              className="btn success"
              onClick={() => approveMutation.mutate()}
              disabled={busy}
            >
              {approveMutation.isPending ? 'Approving…' : 'Approve & publish'}
            </button>
            <button
              type="button"
              className="btn danger"
              onClick={() => setRejecting((v) => !v)}
              disabled={busy}
            >
              Reject…
            </button>
          </>
        )}

        {isAdmin && page.status === 'published' && (
          <button
            type="button"
            className="btn"
            onClick={() => unpublishMutation.mutate()}
            disabled={busy}
          >
            {unpublishMutation.isPending ? 'Unpublishing…' : 'Unpublish'}
          </button>
        )}

        <button
          type="button"
          className="btn"
          onClick={() => duplicateMutation.mutate()}
          disabled={busy}
          title="Create a new draft copy of this page"
        >
          {duplicateMutation.isPending ? 'Duplicating…' : 'Duplicate'}
        </button>

        <div className="action-spacer" />

        {isAdmin && (
          <button
            type="button"
            className="btn danger ghost"
            onClick={() => {
              if (window.confirm(`Delete "${page.title}"? This also removes its live version.`)) {
                deleteMutation.mutate();
              }
            }}
            disabled={busy}
          >
            Delete page
          </button>
        )}
      </div>

      {rejecting && (
        <div className="card reject-card">
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
                setRejecting(false);
                setRejectNote('');
              }}
              disabled={rejectMutation.isPending}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn danger"
              onClick={() => rejectMutation.mutate()}
              disabled={rejectMutation.isPending || !rejectNote.trim()}
            >
              {rejectMutation.isPending ? 'Rejecting…' : 'Confirm rejection'}
            </button>
          </div>
        </div>
      )}

      {dirty && !locked && <p className="muted small unsaved">You have unsaved changes.</p>}

      {inDataRouter && (
        <DataRouterNavigationGuard when={dirty && !locked} onDiscard={discardChanges} />
      )}

      {pendingLanguage && (
        <UnsavedChangesDialog
          message={`Switch this page to ${langName(pendingLanguage)}? Your unsaved changes will be discarded.`}
          onKeep={() => setPendingLanguage(null)}
          onDiscard={() => {
            const next = pendingLanguage;
            setPendingLanguage(null);
            discardChanges();
            setLang(next);
          }}
        />
      )}

      {pendingNavigation && (
        <UnsavedChangesDialog
          message="Leave this page? Your unsaved changes will be discarded."
          onKeep={() => setPendingNavigation(null)}
          onDiscard={() => {
            const destination = pendingNavigation;
            setPendingNavigation(null);
            discardChanges();
            allowNavigationRef.current = true;
            navigate(destination);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Unsaved-changes guard UI
// ---------------------------------------------------------------------------

function UnsavedChangesDialog({
  message,
  onKeep,
  onDiscard,
}: {
  message: string;
  onKeep: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onKeep}>
      <div
        className="modal guard-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="unsaved-title"
        aria-describedby="unsaved-message"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="unsaved-title">Unsaved changes</h3>
        <p id="unsaved-message">{message}</p>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onKeep} autoFocus>
            Keep editing
          </button>
          <button type="button" className="btn danger" onClick={onDiscard}>
            Discard changes
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * React Router's data-router blocker. It is only mounted when the app actually
 * runs under a data router; BrowserRouter setups use the link capture fallback
 * in the editor. This keeps `useBlocker` from throwing outside a data router.
 */
function DataRouterNavigationGuard({
  when,
  onDiscard,
}: {
  when: boolean;
  onDiscard: () => void;
}) {
  const blocker = useBlocker(when);
  if (blocker.state !== 'blocked') return null;

  return (
    <UnsavedChangesDialog
      message="Leave this page? Your unsaved changes will be discarded."
      onKeep={() => blocker.reset?.()}
      onDiscard={() => {
        onDiscard();
        blocker.proceed?.();
      }}
    />
  );
}

// Document metadata for the admin preview/editor.
//
// Mirrors the public-site mapping in work/page-builder/03-prompt.md §6.1:
//   title       -> metaTitle || page title || site default
//   description -> metaDescription || excerpt || site default
//   canonical   -> canonicalPath || url || current path
//   robots      -> null/absent means index; noindex is honoured
//   og:image    -> omitted entirely when absent
//
// Every applied value is restored when the hook unmounts or the inputs change,
// so the admin shell keeps its own document title and meta tags.

import { useEffect } from 'react';

export interface DocumentMetaOptions {
  /** SEO title. */
  metaTitle?: string | null;
  /** Page title, used when `metaTitle` is blank. */
  title?: string | null;
  /** SEO description. */
  metaDescription?: string | null;
  /** Page excerpt, used when `metaDescription` is blank. */
  excerpt?: string | null;
  /** Absolute URL or site-relative path. */
  canonicalPath?: string | null;
  robots?: 'index' | 'noindex' | string | null;
  ogImage?: string | null;
  /** Fallback URL, typically the current public route. */
  url?: string | null;
  siteDefaultTitle?: string;
  siteDefaultDescription?: string;
  ogType?: string;
}

const DEFAULT_TITLE = 'Medically Complicated';
const DEFAULT_DESCRIPTION = 'Clear, evidence-based medical information.';

type MetaAttribute = 'name' | 'property';

interface AppliedTag {
  element: HTMLMetaElement;
  existed: boolean;
  previous: string | null;
}

interface AppliedCanonical {
  element: HTMLLinkElement;
  existed: boolean;
  previous: string | null;
}

function nonEmpty(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function absoluteUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('/')) {
    if (typeof window === 'undefined') return trimmed;
    return `${window.location.origin}${trimmed}`;
  }
  return trimmed;
}

function currentPath(): string {
  if (typeof window === 'undefined') return '/';
  return `${window.location.origin}${window.location.pathname}`;
}

function applyMeta(attribute: MetaAttribute, key: string, content: string | null): AppliedTag {
  const selector = `meta[${attribute}="${key}"]`;
  let element = document.head.querySelector<HTMLMetaElement>(selector);
  const existed = Boolean(element);
  const previous = element?.getAttribute('content') ?? null;

  if (!element) {
    element = document.createElement('meta');
    element.setAttribute(attribute, key);
    document.head.appendChild(element);
  }

  if (content === null) {
    element.remove();
  } else {
    element.setAttribute('content', content);
  }

  return { element, existed, previous };
}

function restoreMeta(tag: AppliedTag): void {
  if (!tag.existed) {
    tag.element.remove();
    return;
  }
  if (tag.previous === null) tag.element.removeAttribute('content');
  else tag.element.setAttribute('content', tag.previous);
  if (!tag.element.isConnected) document.head.appendChild(tag.element);
}

function applyCanonical(href: string | null): AppliedCanonical {
  const selector = 'link[rel="canonical"]';
  let element = document.head.querySelector<HTMLLinkElement>(selector);
  const existed = Boolean(element);
  const previous = element?.getAttribute('href') ?? null;

  if (!element) {
    element = document.createElement('link');
    element.setAttribute('rel', 'canonical');
    document.head.appendChild(element);
  }

  if (href === null) element.remove();
  else element.setAttribute('href', href);

  return { element, existed, previous };
}

function restoreCanonical(tag: AppliedCanonical): void {
  if (!tag.existed) {
    tag.element.remove();
    return;
  }
  if (tag.previous === null) tag.element.removeAttribute('href');
  else tag.element.setAttribute('href', tag.previous);
  if (!tag.element.isConnected) document.head.appendChild(tag.element);
}

/**
 * Apply page metadata to the current document and restore it afterwards.
 * Safe to call during every render of a page; values are diffed by React.
 */
export function useDocumentMeta(options: DocumentMetaOptions, enabled = true): void {
  const {
    metaTitle,
    title,
    metaDescription,
    excerpt,
    canonicalPath,
    robots,
    ogImage,
    url,
    siteDefaultTitle = DEFAULT_TITLE,
    siteDefaultDescription = DEFAULT_DESCRIPTION,
    ogType = 'article',
  } = options;

  const resolvedTitle = nonEmpty(metaTitle) || nonEmpty(title) || siteDefaultTitle;
  const resolvedDescription =
    nonEmpty(metaDescription) || nonEmpty(excerpt) || siteDefaultDescription;
  const resolvedCanonical =
    absoluteUrl(nonEmpty(canonicalPath)) || absoluteUrl(nonEmpty(url)) || currentPath();
  const resolvedRobots = nonEmpty(robots).toLowerCase() === 'noindex' ? 'noindex' : 'index';
  const resolvedImage = nonEmpty(ogImage) || null;

  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return undefined;

    const previousTitle = document.title;
    const descriptionTag = applyMeta('name', 'description', resolvedDescription || null);
    const robotsTag = applyMeta('name', 'robots', resolvedRobots);
    const ogTitleTag = applyMeta('property', 'og:title', resolvedTitle);
    const ogDescriptionTag = applyMeta('property', 'og:description', resolvedDescription || null);
    const ogImageTag = applyMeta('property', 'og:image', resolvedImage);
    const ogUrlTag = applyMeta('property', 'og:url', resolvedCanonical);
    const ogTypeTag = applyMeta('property', 'og:type', ogType);
    const canonicalTag = applyCanonical(resolvedCanonical);

    document.title = resolvedTitle;

    return () => {
      document.title = previousTitle;
      restoreMeta(descriptionTag);
      restoreMeta(robotsTag);
      restoreMeta(ogTitleTag);
      restoreMeta(ogDescriptionTag);
      restoreMeta(ogImageTag);
      restoreMeta(ogUrlTag);
      restoreMeta(ogTypeTag);
      restoreCanonical(canonicalTag);
    };
  }, [
    enabled,
    resolvedTitle,
    resolvedDescription,
    resolvedCanonical,
    resolvedRobots,
    resolvedImage,
    ogType,
  ]);
}

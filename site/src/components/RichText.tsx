import { Fragment } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { RichMark, RichSpan } from '../api/types';

interface RichTextProps {
  rich?: RichSpan[];
  text: string;
}

/** Split on newlines and render each break as a real <br /> element. */
function renderMultiline(value: string): ReactNode[] {
  const parts = value.split('\n');
  const nodes: ReactNode[] = [];
  parts.forEach((part, index) => {
    if (index > 0) nodes.push(<br key={`br-${index}`} />);
    nodes.push(part);
  });
  return nodes;
}

/**
 * Return the href when it is safe to render as a link, otherwise null.
 * Mirrors the backend allow-list: http(s), site-relative `/…`, mailto, tel.
 */
function safeHref(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const href = value.trim();
  if (!href || href.length > 2048) return null;
  if (/[\s\u0000-\u001f\u007f]/.test(href)) return null;
  if (href.startsWith('//') || href.startsWith('/\\')) return null;
  const lower = href.toLowerCase();
  if (lower.startsWith('http://') || lower.startsWith('https://')) return href;
  if (lower.startsWith('mailto:') || lower.startsWith('tel:')) return href;
  if (href.startsWith('/')) return href;
  return null;
}

/** Render one span in the fixed nest: link → strong → em → sup → sub → text. */
function renderSpan(span: RichSpan, index: number): ReactNode {
  const marks = new Set<RichMark>(Array.isArray(span.marks) ? span.marks : []);
  let node: ReactNode = renderMultiline(
    typeof span.text === 'string' ? span.text : '',
  );

  if (marks.has('subscript')) node = <sub>{node}</sub>;
  if (marks.has('superscript')) node = <sup>{node}</sup>;
  if (marks.has('italic')) node = <em>{node}</em>;
  if (marks.has('bold')) node = <strong>{node}</strong>;

  const href = safeHref(span.link?.href);
  if (span.link && href !== null) {
    node = span.link.newTab ? (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {node}
      </a>
    ) : (
      <a href={href}>{node}</a>
    );
  }

  return <Fragment key={index}>{node}</Fragment>;
}

/**
 * Shared rich-text renderer. Falls back to the plain `text` field (newlines
 * become <br />) when no spans are present. All content is escaped by React –
 * spans are always rendered as text nodes, never parsed as HTML.
 */
export function RichText({ rich, text }: RichTextProps): ReactElement {
  if (!rich || rich.length === 0) {
    return <>{renderMultiline(typeof text === 'string' ? text : '')}</>;
  }
  return <>{rich.map((span, index) => renderSpan(span, index))}</>;
}

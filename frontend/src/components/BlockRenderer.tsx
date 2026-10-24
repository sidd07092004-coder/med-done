import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type {
  Block,
  BlockAlign,
  ButtonSize,
  ButtonVariant,
  KnownBlock,
  PageContent,
} from '../api/types';
import { isBlocksContent, isHomeContent, isKnownBlock } from '../api/types';
import {
  CALLOUT_SHAPE_STYLES,
  buildTocTree,
  calloutLabel,
  collectHeadingAnchors,
  layoutToCss,
  tableColumnCount,
  type HeadingAnchor,
  type TocNode,
} from '../lib/blockDesign';
import { ArrangeOverlay } from './ArrangeOverlay';
import type { ArrangeBox } from '../lib/arrange';
import { RichText } from './RichText';

/**
 * Optional "Arrange" mode wiring. When it is missing (the default) the
 * renderer produces exactly the same DOM as before.
 */
export interface ArrangeOptions {
  /** Called with the block index and its new horizontal box (percent). */
  onLayoutChange: (index: number, box: ArrangeBox) => void;
}

/** Join truthy class names. */
function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
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

/** Render newline-separated text as paragraphs/line breaks. */
function Multiline({ text }: { text: string }) {
  const lines = String(text ?? '').split('\n');

  return (
    <>
      {lines.map((line, i) => (
        <span key={i}>
          {line}
          {i < lines.length - 1 && <br />}
        </span>
      ))}
    </>
  );
}

/** Render a table cell: `\n` becomes a line break, everything else is escaped by JSX. */
function renderCell(text: string) {
  const lines = String(text ?? '').split('\n');

  return lines.map((line, i) => (
    <span key={i}>
      {line}
      {i < lines.length - 1 && <br />}
    </span>
  ));
}

/**
 * Map heading block objects to their TOC ids in document order. This mirrors
 * `collectHeadingAnchors` (including column recursion) and keeps every TOC link
 * resolvable even when two headings inside different columns share a path key.
 */
function buildHeadingIdByBlock(
  blocks: Block[],
  anchors: HeadingAnchor[],
): Map<Block, string> {
  const ids = new Map<Block, string>();
  let index = 0;

  const walk = (list: Block[]): void => {
    for (const block of list) {
      if (!isKnownBlock(block)) continue;
      if (block.type === 'heading') {
        const anchor = anchors[index];
        index += 1;
        if (anchor) ids.set(block, anchor.id);
      } else if (block.type === 'columns') {
        block.columns.forEach(walk);
      }
    }
  };

  walk(blocks);
  return ids;
}

function formatFileSize(bytes: number | undefined): string | null {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  const gb = mb / 1024;
  return `${gb < 10 ? gb.toFixed(1) : Math.round(gb)} GB`;
}

function fileTypeFromSrc(src: string): string {
  const ext = src.split(/[?#]/)[0].split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf') return 'PDF';
  if (ext === 'docx' || ext === 'doc') return 'DOCX';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif'].includes(ext)) return 'IMAGE';
  return 'OTHER';
}

function videoMime(src: string): string | undefined {
  const ext = src.split(/[?#]/)[0].split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'mp4' || ext === 'm4v') return 'video/mp4';
  if (ext === 'webm') return 'video/webm';
  if (ext === 'ogv' || ext === 'ogg') return 'video/ogg';
  return undefined;
}

const EMBED_LABELS: Record<string, string> = {
  youtube: 'YouTube',
  vimeo: 'Vimeo',
  spotify: 'Spotify',
  google_maps: 'Google Maps',
};

interface ActionLinkProps {
  label: string;
  href?: string;
  newTab?: boolean;
  variant?: ButtonVariant;
  size?: ButtonSize;
  align?: BlockAlign;
  className?: string;
  style?: CSSProperties;
}

/** Button contract: a real link when the href is valid, otherwise a disabled span. */
function ActionLink({
  label,
  href,
  newTab,
  variant = 'primary',
  size = 'md',
  align,
  className,
  style,
}: ActionLinkProps) {
  const classes = cx(
    'pv-btn',
    `pv-btn--${variant}`,
    `pv-btn--${size}`,
    align ? `pv-btn--align-${align}` : '',
    className,
  );
  const safe = safeHref(href);

  if (safe) {
    return (
      <a
        className={classes}
        style={style}
        href={safe}
        {...(newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      >
        {label}
      </a>
    );
  }

  return (
    <span className={classes} style={style} aria-disabled="true">
      {label}
    </span>
  );
}

function CalloutView({ block }: { block: Extract<KnownBlock, { type: 'callout' }> }) {
  const shape = block.shape ?? 'rounded';
  const variant = block.variant || 'info';
  const explicitLabel = typeof block.label === 'string' ? block.label.trim() : undefined;
  const label = explicitLabel !== undefined ? explicitLabel : calloutLabel(block.variant);

  const styles: CSSProperties = {
    ...CALLOUT_SHAPE_STYLES[shape],
    backgroundColor: block.backgroundColor || '#eef6ff',
    color: block.textColor || '#243447',
    borderColor: block.borderColor || '#b8cce0',
    borderStyle: 'solid',
    borderWidth: '1px',
    overflowWrap: 'anywhere',
    whiteSpace: 'normal',
    boxSizing: 'border-box',
    margin: '12px 0',
    ...layoutToCss(block.layout), // layout wins, including margin overrides
  };

  return (
    <div
      className={`pv-callout pv-callout-${variant} pv-callout-shape-${shape}`}
      role="note"
      style={styles}
    >
      {label !== '' && (
        <span
          className="pv-callout-label"
          style={{
            display: 'block',
            marginBottom: '6px',
            fontWeight: 700,
            lineHeight: 1.35,
          }}
        >
          {label}
        </span>
      )}
      <div style={{ lineHeight: 1.6 }}>
        <RichText rich={block.rich} text={block.text} />
      </div>
    </div>
  );
}

function TableView({ block }: { block: Extract<KnownBlock, { type: 'table' }> }) {
  const table = block.table ?? { rows: [] };
  const header = table.header ?? [];
  const rows = table.rows ?? [];
  const cols = tableColumnCount(table);
  const aligns = Array.from({ length: cols }, (_, i) => table.align?.[i] ?? 'left');

  const headerBackground = table.headerBackgroundColor ?? '#eef2f7';
  const headerText = table.headerTextColor ?? '#1f2937';

  const classes = [
    'pv-table',
    table.bordered !== false ? 'pv-table--bordered' : '',
    table.striped === true ? 'pv-table--striped' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="pv-table-wrap" style={layoutToCss(block.layout)}>
      <table className={classes}>
        {header.length > 0 && (
          <thead>
            <tr>
              {header.map((cell, i) => (
                <th
                  key={i}
                  style={{
                    textAlign: aligns[i],
                    backgroundColor: headerBackground,
                    color: headerText,
                  }}
                >
                  {renderCell(cell)}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (
                <td key={c} style={{ textAlign: aligns[c] }}>
                  {renderCell(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function initialAccordionOpen(
  block: Extract<KnownBlock, { type: 'accordion' }>,
): Set<number> {
  if (block.defaultOpen === 'all') {
    return new Set(block.items.map((_, i) => i));
  }
  if (block.defaultOpen === 'first' && block.items.length > 0) {
    return new Set([0]);
  }
  return new Set();
}

function AccordionView({
  block,
  blockKey,
}: {
  block: Extract<KnownBlock, { type: 'accordion' }>;
  blockKey: string;
}) {
  const defaultOpen = block.defaultOpen ?? 'none';
  const [openItems, setOpenItems] = useState<Set<number>>(() => initialAccordionOpen(block));

  // Reflect editor changes to the default while the preview stays mounted.
  useEffect(() => {
    setOpenItems(initialAccordionOpen(block));
  }, [defaultOpen, block.items.length]);

  const allowMultiple = block.allowMultiple === true;

  const toggle = (index: number) => {
    setOpenItems((previous) => {
      const next = new Set(previous);
      if (next.has(index)) {
        next.delete(index);
      } else {
        if (!allowMultiple) next.clear();
        next.add(index);
      }
      return next;
    });
  };

  return (
    <section className="pv-accordion" style={layoutToCss(block.layout)}>
      {block.heading ? <h2 className="pv-accordion__heading">{block.heading}</h2> : null}
      {block.items.map((item, index) => {
        const answerId = `a-${blockKey}-${index}`;
        const questionId = `q-${blockKey}-${index}`;
        const open = openItems.has(index);

        return (
          <div className="pv-accordion__item" key={index}>
            <button
              type="button"
              className="pv-accordion__question"
              id={questionId}
              aria-expanded={open}
              aria-controls={answerId}
              onClick={() => toggle(index)}
            >
              {item.question}
            </button>
            <div
              className="pv-accordion__answer"
              id={answerId}
              role="region"
              aria-labelledby={questionId}
              hidden={!open}
            >
              <RichText rich={item.rich} text={item.answer} />
            </div>
          </div>
        );
      })}
    </section>
  );
}

function TocView({
  block,
  anchors,
  blockKey,
}: {
  block: Extract<KnownBlock, { type: 'toc' }>;
  anchors: HeadingAnchor[];
  blockKey: string;
}) {
  const title = block.title?.trim() || 'On this page';
  const titleId = `${blockKey || 'toc'}-toc-title`;
  const minLevel = block.minLevel ?? 2;
  const maxLevel = block.maxLevel ?? 4;
  const maxDepth = block.maxDepth ?? 2;
  const tree = buildTocTree(anchors, minLevel, maxLevel, maxDepth);

  const renderNodes = (nodes: TocNode[]): ReactNode => (
    <ol className="pv-toc__list">
      {nodes.map((node) => (
        <li className="pv-toc__item" key={node.anchor.id}>
          <a className="pv-toc__link" href={`#${node.anchor.id}`}>
            {node.anchor.text}
          </a>
          {node.children.length > 0 ? renderNodes(node.children) : null}
        </li>
      ))}
    </ol>
  );

  return (
    <nav
      className={cx('pv-toc', block.sticky ? 'pv-toc--sticky' : '')}
      style={layoutToCss(block.layout)}
      aria-labelledby={titleId}
    >
      <h2 className="pv-toc__title" id={titleId}>
        {title}
      </h2>
      {tree.length > 0 ? renderNodes(tree) : null}
    </nav>
  );
}

export function BlockView({
  block,
  path = '',
  uid,
  headingIds,
  headingIdByBlock,
  anchors = [],
  depth = 0,
}: {
  block: Block;
  path?: string;
  /** Unique render path for element ids (columns include their column index). */
  uid?: string;
  headingIds?: ReadonlyMap<string, string>;
  headingIdByBlock?: ReadonlyMap<Block, string>;
  anchors?: HeadingAnchor[];
  depth?: number;
}) {
  const elementKey = uid ?? path;
  if (!isKnownBlock(block)) {
    return (
      <div className="pv-unknown-block" role="note">
        Unsupported block type: {block.type}
      </div>
    );
  }

  const layout = layoutToCss(block.layout);

  switch (block.type) {
    case 'heading': {
      const cls = `pv-h pv-h${block.level}`;
      const headingId = headingIdByBlock?.get(block) ?? headingIds?.get(path);
      const idProps = headingId ? { id: headingId } : {};
      if (block.level === 1) {
        return (
          <h1 className={cls} style={layout} {...idProps}>
            {block.text}
          </h1>
        );
      }
      if (block.level === 3) {
        return (
          <h3 className={cls} style={layout} {...idProps}>
            {block.text}
          </h3>
        );
      }
      if (block.level === 4) {
        return (
          <h4 className={cls} style={layout} {...idProps}>
            {block.text}
          </h4>
        );
      }
      return (
        <h2 className={cls} style={layout} {...idProps}>
          {block.text}
        </h2>
      );
    }

    case 'paragraph':
      return (
        <p className="pv-p" style={layout}>
          <RichText rich={block.rich} text={block.text} />
        </p>
      );

    case 'list': {
      const items = block.items.map((item, i) => (
        <li key={i}>
          <RichText rich={block.richItems?.[i]} text={item} />
        </li>
      ));

      const layout = layoutToCss(block.layout);

      return block.ordered ? (
        <ol className="pv-list" style={layout}>
          {items}
        </ol>
      ) : (
        <ul className="pv-list" style={layout}>
          {items}
        </ul>
      );
    }

    case 'quote':
      return (
        <blockquote className="pv-quote" style={layout}>
          <RichText rich={block.rich} text={block.text} />
          {block.cite ? <cite>{block.cite}</cite> : null}
        </blockquote>
      );

    case 'callout':
      return <CalloutView block={block} />;

    case 'image': {
      // The image's own `align` field owns horizontal placement, so the layout's
      // textAlign is deliberately dropped here.
      const imageLayout: CSSProperties = { ...layout };
      delete imageLayout.textAlign;

      const figureStyle: CSSProperties = {
        ...(block.align ? { textAlign: block.align } : {}),
        ...imageLayout,
      };
      const imgStyle: CSSProperties = {
        ...(block.width !== undefined ? { width: `${block.width}%` } : {}),
        ...(block.height !== undefined ? { height: `${block.height}px` } : {}),
        ...(block.height !== undefined && block.fit === undefined
          ? { objectFit: 'cover' as const }
          : {}),
        ...(block.fit !== undefined ? { objectFit: block.fit } : {}),
        ...(block.radius !== undefined ? { borderRadius: `${block.radius}px` } : {}),
      };

      return block.src ? (
        <figure className="pv-figure" style={figureStyle}>
          <img src={block.src} alt={block.alt} loading="lazy" style={imgStyle} />
          {block.alt ? <figcaption>{block.alt}</figcaption> : null}
        </figure>
      ) : (
        <div className="pv-image-missing" role="img" aria-label="Image placeholder" style={figureStyle}>
          Image — no source set
        </div>
      );
    }

    case 'divider':
      return <hr className="pv-divider" style={layout} />;

    case 'table':
      return <TableView block={block} />;

    case 'button':
      return (
        <ActionLink
          label={block.label}
          href={block.href}
          newTab={block.newTab}
          variant={block.variant ?? 'primary'}
          size={block.size ?? 'md'}
          align={block.align ?? 'left'}
          style={layout}
        />
      );

    case 'hero': {
      const height = block.height ?? 'md';
      const align = block.align ?? 'left';
      const overlay =
        typeof block.overlay === 'number' ? Math.max(0, Math.min(100, block.overlay)) : undefined;
      const hasImage = Boolean(block.imageSrc);

      return (
        <section
          className={cx(
            'pv-hero',
            `pv-hero--${height}`,
            `pv-hero--align-${align}`,
            hasImage ? 'pv-hero--has-image' : '',
          )}
          style={layout}
        >
          {hasImage ? (
            <img
              className="pv-hero__image"
              src={block.imageSrc}
              alt={block.imageAlt ?? ''}
              loading="eager"
            />
          ) : null}
          {hasImage && overlay !== undefined ? (
            <div
              className="pv-hero__overlay"
              aria-hidden="true"
              style={{ backgroundColor: `rgba(0, 0, 0, ${overlay / 100})` }}
            />
          ) : null}
          <div className="pv-hero__content">
            {block.eyebrow ? <p className="pv-hero__eyebrow">{block.eyebrow}</p> : null}
            <h2 className="pv-hero__title">{block.title}</h2>
            {block.subtitle ? (
              <p className="pv-hero__subtitle">
                <Multiline text={block.subtitle} />
              </p>
            ) : null}
            {block.primaryCta || block.secondaryCta ? (
              <div className="pv-hero__ctas">
                {block.primaryCta ? (
                  <ActionLink
                    label={block.primaryCta.label}
                    href={block.primaryCta.href}
                    newTab={block.primaryCta.newTab}
                    variant="primary"
                    size="md"
                  />
                ) : null}
                {block.secondaryCta ? (
                  <ActionLink
                    label={block.secondaryCta.label}
                    href={block.secondaryCta.href}
                    newTab={block.secondaryCta.newTab}
                    variant="secondary"
                    size="md"
                  />
                ) : null}
              </div>
            ) : null}
          </div>
        </section>
      );
    }

    case 'accordion':
      return <AccordionView block={block} blockKey={elementKey} />;

    case 'cards': {
      const columns = block.columns ?? 3;
      const variant = block.variant ?? 'image-top';

      return (
        <ul
          className={cx('pv-cards', `pv-cards--${columns}`, `pv-cards--${variant}`)}
          style={layout}
        >
          {block.items.map((item, index) => {
            const href = safeHref(item.href);
            const wholeCard = block.linkWholeCard === true && href !== null;
            const ctaLabel = item.ctaLabel?.trim() || 'Read more';
            const showCta = Boolean(item.ctaLabel?.trim() || href);
            const linkProps = item.newTab
              ? { target: '_blank', rel: 'noopener noreferrer' }
              : {};

            const content = (
              <>
                {item.imageSrc ? (
                  <div className="pv-card__media">
                    <img
                      className="pv-card__image"
                      src={item.imageSrc}
                      alt={item.imageAlt ?? ''}
                      loading="lazy"
                    />
                  </div>
                ) : (
                  <div
                    className="pv-card__placeholder"
                    role="img"
                    aria-label="Image placeholder"
                  />
                )}
                <p className="pv-card__title">
                  <strong>{item.title}</strong>
                </p>
                {item.text ? (
                  <p className="pv-card__text">
                    <Multiline text={item.text} />
                  </p>
                ) : null}
                {showCta ? (
                  wholeCard ? (
                    <span className="pv-card__cta pv-card__cta--text">{ctaLabel}</span>
                  ) : href ? (
                    <a
                      className="pv-btn pv-btn--secondary pv-btn--sm pv-card__cta"
                      href={href}
                      {...linkProps}
                    >
                      {ctaLabel}
                    </a>
                  ) : (
                    <span
                      className="pv-btn pv-btn--secondary pv-btn--sm pv-card__cta"
                      aria-disabled="true"
                    >
                      {ctaLabel}
                    </span>
                  )
                ) : null}
              </>
            );

            return (
              <li className="pv-cards__item" key={index}>
                {wholeCard && href ? (
                  <a className="pv-card pv-card--link" href={href} {...linkProps}>
                    {content}
                  </a>
                ) : (
                  <article className="pv-card">{content}</article>
                )}
              </li>
            );
          })}
        </ul>
      );
    }

    case 'steps': {
      const numbered = block.style !== 'plain';
      const items = block.items.map((item, index) => (
        <li className="pv-steps__item" key={index}>
          <strong className="pv-steps__title">{item.title}</strong>
          {item.text ? (
            <p className="pv-steps__text">
              <Multiline text={item.text} />
            </p>
          ) : null}
        </li>
      ));

      return (
        <section
          className={cx('pv-steps', numbered ? 'pv-steps--numbered' : 'pv-steps--plain')}
          style={layout}
        >
          {block.heading ? <h2 className="pv-steps__heading">{block.heading}</h2> : null}
          {numbered ? (
            <ol className="pv-steps__list">{items}</ol>
          ) : (
            <ul className="pv-steps__list">{items}</ul>
          )}
        </section>
      );
    }

    case 'checklist': {
      const numbered = block.style === 'number';
      const items = block.items.map((item, index) => (
        <li className="pv-checklist__item" key={index}>
          {numbered ? null : (
            <span className="pv-checklist__icon" aria-hidden="true">
              ✓
            </span>
          )}
          <span className="pv-checklist__text">
            {item.text}
            {item.note ? <span className="pv-checklist__note">{item.note}</span> : null}
          </span>
        </li>
      ));

      return (
        <section
          className={cx('pv-checklist', numbered ? 'pv-checklist--number' : 'pv-checklist--check')}
          style={layout}
        >
          {block.title ? <h2 className="pv-checklist__title">{block.title}</h2> : null}
          {numbered ? (
            <ol className="pv-checklist__list">{items}</ol>
          ) : (
            <ul className="pv-checklist__list">{items}</ul>
          )}
        </section>
      );
    }

    case 'download': {
      const src = typeof block.fileSrc === 'string' ? block.fileSrc.trim() : '';
      const href = safeHref(src);

      if (!src || href === null) {
        return (
          <div className="pv-download pv-download--missing" role="note" style={layout}>
            Attachment unavailable
          </div>
        );
      }

      const fileType = block.fileType
        ? block.fileType.toUpperCase()
        : fileTypeFromSrc(src);
      const fileSize = formatFileSize(block.fileSizeBytes);
      const separator = src.includes('?') ? '&' : '?';
      const linkProps = block.newTab
        ? { target: '_blank', rel: 'noopener noreferrer' }
        : {};

      return (
        <a
          className="pv-download"
          href={`${src}${separator}download=1`}
          download
          style={layout}
          {...linkProps}
        >
          <span className="pv-download__icon" aria-hidden="true">
            ↓
          </span>
          <span className="pv-download__body">
            <span className="pv-download__label">{block.label}</span>
            {block.description ? (
              <span className="pv-download__description">{block.description}</span>
            ) : null}
            <span className="pv-download__meta">
              {fileType}
              {fileSize ? ` · ${fileSize}` : ''}
            </span>
          </span>
        </a>
      );
    }

    case 'toc':
      return <TocView block={block} anchors={anchors} blockKey={elementKey} />;

    case 'references': {
      const numbered = block.numbered !== false;
      const items = block.items.map((item, index) => {
        const href = safeHref(item.url);
        const citation = [item.publisher, item.year !== undefined ? String(item.year) : '']
          .filter(Boolean)
          .join(', ');

        return (
          <li className="pv-references__item" key={index}>
            <Multiline text={item.text} />
            {citation ? <cite className="pv-references__cite">{citation}</cite> : null}
            {href ? (
              <a className="pv-references__link" href={href} rel="noreferrer">
                View source
              </a>
            ) : null}
          </li>
        );
      });

      return (
        <section className="pv-references" style={layout}>
          {block.title ? <h2 className="pv-references__title">{block.title}</h2> : null}
          {numbered ? (
            <ol className="pv-references__list">{items}</ol>
          ) : (
            <ul className="pv-references__list">{items}</ul>
          )}
        </section>
      );
    }

    case 'video': {
      const src = typeof block.src === 'string' ? block.src.trim() : '';
      const safeSrc = safeHref(src);
      const mime = safeSrc ? videoMime(safeSrc) : undefined;

      return (
        <figure className="pv-video" style={layout}>
          {safeSrc ? (
            <video
              className="pv-video__media"
              controls
              preload="metadata"
              playsInline
              poster={block.poster || undefined}
              autoPlay={block.autoplay === true && block.muted === true}
              loop={block.loop === true}
              muted={block.muted === true}
            >
              <source src={safeSrc} type={mime} />
              {block.captionsSrc ? (
                <track kind="captions" src={block.captionsSrc} label="Captions" default />
              ) : null}
            </video>
          ) : (
            <div className="pv-video__missing" role="note">
              Video — no source set
            </div>
          )}
          {block.title ? <figcaption>{block.title}</figcaption> : null}
        </figure>
      );
    }

    case 'columns': {
      const ratio = block.ratio ?? 'equal';
      const stackAt = block.stackAt ?? 'mobile';
      const columnStyle: CSSProperties = {
        ...(block.gap !== undefined ? { gap: `${block.gap}px` } : {}),
        ...layout,
      };

      return (
        <div
          className={cx(
            'pv-columns',
            `pv-columns--${ratio}`,
            `pv-columns--stack-${stackAt}`,
            `pv-columns--count-${block.columns.length}`,
          )}
          style={columnStyle}
        >
          {block.columns.map((column, columnIndex) => (
            <div className="pv-columns__col" key={columnIndex}>
              {column.map((child, childIndex) => (
                <BlockView
                  key={childIndex}
                  block={child}
                  // collectHeadingAnchors keys column children as
                  // `<columns-path>.<child-index>` (it does not include the
                  // column index), so the path must match that shape.
                  path={`${path}.${childIndex}`}
                  uid={`${elementKey}.${columnIndex}.${childIndex}`}
                  headingIds={headingIds}
                  headingIdByBlock={headingIdByBlock}
                  anchors={anchors}
                  depth={depth + 1}
                />
              ))}
            </div>
          ))}
        </div>
      );
    }

    case 'gallery': {
      const display = block.display ?? 'grid';
      const columns = block.columns ?? 3;
      const aspect = (block.aspect ?? '4:3').replace(':', '-');

      return (
        <ul
          className={cx(
            'pv-gallery',
            `pv-gallery--${display}`,
            `pv-gallery--${aspect}`,
            `pv-gallery--cols-${columns}`,
          )}
          style={layout}
        >
          {block.images.map((image, index) => (
            <li className="pv-gallery__item" key={index}>
              <figure className="pv-gallery__figure">
                {image.src ? (
                  <img src={image.src} alt={image.alt ?? ''} loading="lazy" />
                ) : (
                  <div
                    className="pv-gallery__missing"
                    role="img"
                    aria-label="Image placeholder"
                  />
                )}
                {image.caption ? <figcaption>{image.caption}</figcaption> : null}
              </figure>
            </li>
          ))}
        </ul>
      );
    }

    case 'timeline': {
      const styleName = block.style ?? 'line';

      return (
        <ol className={cx('pv-timeline', `pv-timeline--${styleName}`)} style={layout}>
          {block.items.map((item, index) => (
            <li className="pv-timeline__item" key={index}>
              {item.label ? <span className="pv-timeline__label">{item.label}</span> : null}
              <strong className="pv-timeline__title">{item.title}</strong>
              {item.text ? (
                <p className="pv-timeline__text">
                  <Multiline text={item.text} />
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      );
    }

    case 'stats': {
      const variant = block.variant ?? 'cards';

      return (
        <ul className={cx('pv-stats', `pv-stats--${variant}`)} style={layout}>
          {block.items.map((item, index) => {
            const source = String(item.source ?? '').trim();

            return (
              <li className="pv-stats__item" key={index}>
                <p className="pv-stats__value">{item.value}</p>
                <p className="pv-stats__label">{item.label}</p>
                {source ? (
                  <cite className="pv-stats__source">{source}</cite>
                ) : (
                  <cite className="pv-stats__source pv-stats__source--missing">
                    Source not provided
                  </cite>
                )}
                {item.note ? <p className="pv-stats__note">{item.note}</p> : null}
              </li>
            );
          })}
        </ul>
      );
    }

    case 'key_facts': {
      const title = block.title?.trim() || 'Key facts';

      return (
        <section className="pv-key-facts" style={layout}>
          <h2 className="pv-key-facts__title">{title}</h2>
          <dl className="pv-key-facts__list">
            {block.items.map((item, index) => (
              <div className="pv-key-facts__row" key={index}>
                <dt className="pv-key-facts__label">{item.label}</dt>
                <dd className="pv-key-facts__value">{item.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      );
    }

    case 'audio': {
      const src = typeof block.src === 'string' ? block.src.trim() : '';
      const safeSrc = safeHref(src);

      return (
        <figure className="pv-audio" style={layout}>
          {block.title ? (
            <figcaption className="pv-audio__caption">{block.title}</figcaption>
          ) : null}
          {safeSrc ? (
            <audio className="pv-audio__media" controls preload="metadata" src={safeSrc} />
          ) : (
            <div className="pv-audio__missing" role="note">
              Audio — no source set
            </div>
          )}
          <details className="pv-audio__transcript">
            <summary>Transcript</summary>
            {block.transcript ? (
              <p>
                <Multiline text={block.transcript} />
              </p>
            ) : (
              <p className="muted">No transcript provided.</p>
            )}
          </details>
        </figure>
      );
    }

    case 'testimonial':
      // `consentRef` is internal and must never reach the rendered preview.
      return (
        <figure className="pv-testimonial" style={layout}>
          <blockquote className="pv-testimonial__quote">
            <p>
              <Multiline text={block.quote} />
            </p>
          </blockquote>
          <figcaption className="pv-testimonial__cite">
            {block.avatarSrc ? (
              <img
                className="pv-testimonial__avatar"
                src={block.avatarSrc}
                alt={block.attribution}
                loading="lazy"
              />
            ) : null}
            <span className="pv-testimonial__cite-text">
              <span className="pv-testimonial__attribution">{block.attribution}</span>
              {block.context ? (
                <span className="pv-testimonial__context">{block.context}</span>
              ) : null}
            </span>
          </figcaption>
        </figure>
      );

    case 'map': {
      const directions = safeHref(block.directionsUrl);
      const imageAlt = block.label?.trim() || block.address || 'Map';

      return (
        <section className="pv-map" style={layout}>
          {block.label ? <h2 className="pv-map__title">{block.label}</h2> : null}
          <address className="pv-map__address">{block.address}</address>
          {block.staticImageSrc ? (
            <figure className="pv-map__figure">
              <img
                className="pv-map__img"
                src={block.staticImageSrc}
                alt={imageAlt}
                loading="lazy"
              />
            </figure>
          ) : null}
          {directions ? (
            <a className="pv-map__directions" href={directions} rel="noreferrer">
              Directions
            </a>
          ) : null}
          <p className="pv-map__note">Live map is not loaded in the admin preview.</p>
        </section>
      );
    }

    case 'embed': {
      const provider = String(block.provider ?? '').trim().toLowerCase();
      const label = EMBED_LABELS[provider];
      const known = Boolean(label);

      return (
        <div className="pv-embed" style={layout}>
          <span className="pv-embed__provider">
            {known ? label : 'Unknown provider'}
          </span>
          {block.title ? <p className="pv-embed__title">{block.title}</p> : null}
          <div className="pv-embed__placeholder" role="note">
            {known
              ? `${label} content is not embedded in the admin preview.`
              : 'Unsupported embed provider.'}
          </div>
        </div>
      );
    }

      // case 'video': {
      //   const src = block.src?.trim() ?? '';

      //   return (
      //     <section className="pv-video my-6" style={layout}>
      //       {block.title && (
      //         <h3 className="pv-h pv-h3">
      //           {block.title}
      //         </h3>
      //       )}

      //       {!src ? (
      //         <p className="muted">
      //           No video source has been provided.
      //         </p>
      //       ) : (
      //         <video
      //           className="w-full rounded-lg"
      //           src={src}
      //           poster={block.poster}
      //           controls={block.controls !== false}
      //           autoPlay={block.autoplay ?? false}
      //           loop={block.loop ?? false}
      //           muted={block.muted ?? false}
      //           preload="metadata"
      //         >
      //           {block.captionsSrc && (
      //             <track
      //               kind="captions"
      //               src={block.captionsSrc}
      //               srcLang="en"
      //               label="English captions"
      //             />
      //           )}

      //           Your browser does not support HTML video.
      //         </video>
      //       )}
      //     </section>
      //   );
      // }
      // case 'table':
      // return <TableView block={block} />;

    default:
      return null;
  }
}

function humanize(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (c) => c.toUpperCase());
}

function HomeFields({ fields }: { fields: Record<string, string> }) {
  const entries = Object.entries(fields).filter(([, v]) => String(v ?? '').trim() !== '');

  if (!entries.length) {
    return <p className="muted">No homepage fields have content yet.</p>;
  }

  return (
    <>
      {entries.map(([key, value]) => {
        const lines = String(value).split('\n').filter((l) => l.trim() !== '');
        const isList = lines.length > 1;

        return (
          <section className="pv-section" key={key}>
            <h3 className="pv-h pv-h3">{humanize(key)}</h3>
            {isList ? (
              <ul className="pv-list">
                {lines.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            ) : (
              <p className="pv-p">{value}</p>
            )}
          </section>
        );
      })}
    </>
  );
}

export function BlockRenderer({
  content,
  arrange,
}: {
  content: PageContent | null | undefined;
  arrange?: ArrangeOptions;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);

  if (isBlocksContent(content)) {
    if (!content.blocks.length) {
      return <p className="muted">This page has no content blocks yet.</p>;
    }

    // Compute the heading anchor map once per render. Every BlockView (including
    // headings nested in columns) looks up its own path in this map, so a TOC
    // can reference headings that appear before or after it.
    const anchors = collectHeadingAnchors(content.blocks);
    const headingIds = new Map(anchors.map((anchor) => [anchor.key, anchor.id]));
    const headingIdByBlock = buildHeadingIdByBlock(content.blocks, anchors);

    if (arrange) {
      // Arrange mode: the blocks render exactly as usual, the overlay floats
      // on top of them and drives the horizontal layout.
      return (
        <div className="preview-body arrange-body" ref={bodyRef}>
          {content.blocks.map((block, i) => (
            <BlockView
              key={i}
              block={block}
              path={String(i)}
              headingIds={headingIds}
              headingIdByBlock={headingIdByBlock}
              anchors={anchors}
            />
          ))}
          <ArrangeOverlay
            containerRef={bodyRef}
            blocks={content.blocks}
            onLayoutChange={arrange.onLayoutChange}
          />
        </div>
      );
    }

    return (
      <div className="preview-body">
        {content.blocks.map((block, i) => (
          <BlockView
            key={i}
            block={block}
            path={String(i)}
            headingIds={headingIds}
            headingIdByBlock={headingIdByBlock}
            anchors={anchors}
          />
        ))}
      </div>
    );
  }

  if (isHomeContent(content)) {
    return (
      <div className="preview-body home-preview">
        <HomeFields fields={content.fields} />
      </div>
    );
  }

  return <p className="muted">No content.</p>;
}

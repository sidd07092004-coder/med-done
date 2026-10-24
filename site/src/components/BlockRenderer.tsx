import { useEffect, useState, type CSSProperties } from 'react'
import type { Block, CalloutBlock, EmbedProvider } from '../api/types'
import { isKnownBlock } from '../api/types'
import {
  CALLOUT_SHAPE_STYLES,
  buildTocTree,
  calloutLabel,
  collectHeadingAnchors,
  layoutToCss,
  tableColumnCount,
} from '../lib/blockDesign'
import { RichText } from './RichText'

function Multiline({ text }: { text: string }) {
  const lines = String(text ?? '').split('\n')
  return (
    <>
      {lines.map((line, i) => (
        <span key={i}>
          {line}
          {i < lines.length - 1 && <br />}
        </span>
      ))}
    </>
  )
}

function renderCell(text: string) {
  const lines = String(text ?? '').split('\n')
  return (
    <>
      {lines.map((line, i) => (
        <span key={i}>
          {line}
          {i < lines.length - 1 && <br />}
        </span>
      ))}
    </>
  )
}

const VARIANT_RE = /^[a-z][a-z0-9_-]{0,31}$/

function variantSlug(variant: string): string {
  const slug = String(variant ?? '').trim().toLowerCase()
  return VARIANT_RE.test(slug) ? slug : 'info'
}

function safeHref(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const href = value.trim()
  if (!href || href.length > 2048) return null
  if (/[\s\u0000-\u001f\u007f]/.test(href)) return null
  if (href.startsWith('//') || href.startsWith('/\\')) return null
  const lower = href.toLowerCase()
  if (lower.startsWith('http://') || lower.startsWith('https://')) return href
  if (lower.startsWith('mailto:') || lower.startsWith('tel:')) return href
  if (href.startsWith('/')) return href
  return null
}

function formatFileSize(bytes: number | undefined): string | null {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return null
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`
  const gb = mb / 1024
  return `${gb < 10 ? gb.toFixed(1) : Math.round(gb)} GB`
}

function fileTypeLabel(type: string | undefined, src: string): string {
  if (type) return String(type).toUpperCase()
  const ext = src.split(/[?#]/)[0].split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'pdf') return 'PDF'
  if (ext === 'docx' || ext === 'doc') return 'DOCX'
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif'].includes(ext)) return 'IMAGE'
  return 'OTHER'
}

function videoMime(src: string): string | undefined {
  const ext = src.split(/[?#]/)[0].split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'mp4' || ext === 'm4v') return 'video/mp4'
  if (ext === 'webm') return 'video/webm'
  if (ext === 'ogv' || ext === 'ogg') return 'video/ogg'
  return undefined
}

const EMBED_LABELS: Record<string, string> = {
  youtube: 'YouTube',
  vimeo: 'Vimeo',
  spotify: 'Spotify',
  google_maps: 'Google Maps',
}

const EMBED_ALLOWLIST: Record<EmbedProvider, RegExp[]> = {
  youtube: [
    /^https:\/\/www\.youtube\.com\/embed\/[A-Za-z0-9_-]{6,}(?:[?#].*)?$/,
    /^https:\/\/www\.youtube-nocookie\.com\/embed\/[A-Za-z0-9_-]{6,}(?:[?#].*)?$/,
  ],
  vimeo: [/^https:\/\/player\.vimeo\.com\/video\/[0-9]+(?:[?#].*)?$/],
  spotify: [/^https:\/\/open\.spotify\.com\/embed\/(?:track|album|playlist|episode|show)\/[A-Za-z0-9]+(?:[?#].*)?$/],
  google_maps: [/^https:\/\/www\.google\.com\/maps\/embed\?.*pb=.*$/],
}

function isAllowedEmbed(provider: EmbedProvider, url: string): boolean {
  const patterns = EMBED_ALLOWLIST[provider]
  if (!patterns) return false
  return patterns.some((re) => re.test(url.trim()))
}

function CalloutView({ block }: { block: CalloutBlock }) {
  const variant = variantSlug(block.variant)

  const hasDesign =
    block.label !== undefined ||
    block.backgroundColor !== undefined ||
    block.textColor !== undefined ||
    block.borderColor !== undefined ||
    block.shape !== undefined ||
    block.layout !== undefined

  if (!hasDesign) {
    return (
      <div className={`content-callout content-callout--${variant}`} role="note">
        <span className="content-callout__label">{calloutLabel(variant)}</span>
        <span className="content-callout__text">
          <Multiline text={block.text} />
        </span>
      </div>
    )
  }

  const shape = block.shape ?? 'rounded'
  const explicitLabel = typeof block.label === 'string' ? block.label.trim() : undefined
  const label = explicitLabel !== undefined ? explicitLabel : calloutLabel(block.variant)

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
    ...layoutToCss(block.layout),
  }

  return (
    <div
      className={`content-callout content-callout--${variant} content-callout-shape-${shape}`}
      role="note"
      style={styles}
    >
      {label !== '' && <span className="content-callout__label">{label}</span>}
      <div className="content-callout__text">
        <RichText rich={(block as any).rich} text={block.text} />
      </div>
    </div>
  )
}

function buildHeadingIdByBlock(blocks: Block[], anchors: any[]): Map<any, string> {
  const ids = new Map<any, string>()
  let index = 0
  const walk = (list: Block[]): void => {
    for (const block of list) {
      if (!isKnownBlock(block)) continue
      if (block.type === 'heading') {
        const anchor = anchors[index]
        index += 1
        if (anchor) ids.set(block, anchor.id)
      } else if ((block as any).type === 'columns') {
        const cols = (block as any).columns
        if (Array.isArray(cols)) {
          cols.forEach((col: Block[]) => walk(col))
        }
      }
    }
  }
  walk(blocks)
  return ids
}

function TocView({ block, allBlocks }: { block: any; allBlocks: Block[] }) {
  const anchors = collectHeadingAnchors(allBlocks)
  const tree = buildTocTree(anchors, block.minLevel ?? 2, block.maxLevel ?? 4, block.maxDepth ?? 2)
  const titleId = `toc-title-${Math.random().toString(36).slice(2)}`
  const renderNodes = (nodes: any[]): any => (
    <ol className="content-toc__list">
      {nodes.map((node: any) => (
        <li className="content-toc__item" key={node.anchor.id}>
          <a className="content-toc__link" href={`#${node.anchor.id}`}>
            {node.anchor.text}
          </a>
          {node.children && node.children.length > 0 ? renderNodes(node.children) : null}
        </li>
      ))}
    </ol>
  )
  return (
    <nav
      className={`content-toc${block.sticky ? ' content-toc--sticky' : ''}`}
      aria-labelledby={titleId}
      style={layoutToCss(block.layout)}
    >
      <h2 className="content-toc__title" id={titleId}>
        {block.title || 'On this page'}
      </h2>
      {tree.length === 0 ? null : renderNodes(tree)}
    </nav>
  )
}

function BlockView({
  block,
  path,
  headingIdByBlock,
  anchors,
  allBlocks,
}: {
  block: Block
  path: string
  headingIdByBlock: Map<any, string>
  anchors: any[]
  allBlocks: Block[]
}) {
  if (!isKnownBlock(block)) {
    return (
      <div className="content-unknown-block" role="note" style={layoutToCss(block.layout)}>
        Unsupported block type: {block.type}
      </div>
    )
  }

  const layout = layoutToCss(block.layout)

  switch (block.type) {
    case 'heading': {
      const level = Math.max(block.level, 2)
      const Tag = (`h${level}` as unknown) as 'h2'
      const headingId = headingIdByBlock?.get(block) ?? undefined
      const idProps = headingId ? { id: headingId } : {}
      return (
        <Tag className={`content-heading content-heading--${level}`} style={layout} {...idProps}>
          {block.text}
        </Tag>
      )
    }
    case 'paragraph':
      return (
        <p className="content-paragraph" style={layout}>
          <RichText rich={(block as any).rich} text={block.text} />
        </p>
      )
    case 'list': {
      const items = ((block as any).items || []).map((item: string, i: number) => (
        <li key={i}>
          {(block as any).richItems && Array.isArray((block as any).richItems[i]) ? (
            <RichText rich={(block as any).richItems[i]} text={item} />
          ) : (
            <Multiline text={item} />
          )}
        </li>
      ))
      return (block as any).ordered ? (
        <ol className="content-list" style={layout}>
          {items}
        </ol>
      ) : (
        <ul className="content-list" style={layout}>
          {items}
        </ul>
      )
    }
    case 'quote':
      return (
        <blockquote className="content-quote" style={layout}>
          <RichText rich={(block as any).rich} text={(block as any).text} />
          {(block as any).cite ? <cite className="content-quote__cite">{(block as any).cite}</cite> : null}
        </blockquote>
      )
    case 'callout':
      return <CalloutView block={block as CalloutBlock} />
    case 'image': {
      const { textAlign: _ignored, ...imageLayout } = layout as any
      const figureStyle: CSSProperties = {
        ...((block as any).align ? { textAlign: (block as any).align } : {}),
        ...imageLayout,
      }
      const imgStyle: CSSProperties = {
        ...((block as any).width !== undefined ? { width: `${(block as any).width}%` } : {}),
        ...((block as any).height !== undefined ? { height: `${(block as any).height}px` } : {}),
        ...((block as any).height !== undefined && (block as any).fit === undefined
          ? { objectFit: 'cover' as const }
          : {}),
        ...((block as any).fit !== undefined ? { objectFit: (block as any).fit } : {}),
        ...((block as any).radius !== undefined ? { borderRadius: `${(block as any).radius}px` } : {}),
      }
      return (block as any).src ? (
        <figure className="content-figure" style={figureStyle}>
          <img src={(block as any).src} alt={(block as any).alt ?? ''} loading="lazy" style={imgStyle} />
          {(block as any).alt ? <figcaption>{(block as any).alt}</figcaption> : null}
        </figure>
      ) : (
        <div className="content-image-missing" role="img" aria-label="Image missing">
          Image — no source set
        </div>
      )
    }
    case 'divider':
      return <hr className="content-divider" style={layout} />
    case 'table': {
      const table = (block as any).table || {}
      const header = Array.isArray(table.header) ? table.header : []
      const rows = Array.isArray(table.rows) ? table.rows : []
      const cols = tableColumnCount({ ...table, rows })
      const aligns = Array.from({ length: cols }, (_, i) => table.align?.[i] ?? 'left')
      const headerBackground = table.headerBackgroundColor ?? '#eef2f7'
      const headerText = table.headerTextColor ?? '#1f2937'
      const tableClass = [
        'content-table',
        table.bordered !== false ? 'content-table--bordered' : '',
        table.striped === true ? 'content-table--striped' : '',
      ]
        .filter(Boolean)
        .join(' ')
      return (
        <div className="content-table-wrap" style={layout}>
          <table className={tableClass}>
            {header.length > 0 && (
              <thead>
                <tr>
                  {header.map((cell: string, i: number) => (
                    <th
                      key={i}
                      style={{ textAlign: aligns[i], backgroundColor: headerBackground, color: headerText }}
                    >
                      {renderCell(cell)}
                    </th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {rows.map((row: any, r: number) => (
                <tr key={r}>
                  {(Array.isArray(row) ? row : []).map((cell: string, c: number) => (
                    <td key={c} style={{ textAlign: aligns[c] }}>
                      {renderCell(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    }
    case 'button': {
      const b: any = block
      const label = b.label || ''
      const variant = b.variant || 'primary'
      const size = b.size || 'md'
      const align = b.align || 'left'
      const href = safeHref(b.href)
      const cls = `content-btn content-btn--${variant} content-btn--${size} content-btn--align-${align}`
      const style = { textAlign: align, ...layout } as CSSProperties
      if (href) {
        return (
          <div style={style}>
            <a className={cls} href={href} {...(b.newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
              {label}
            </a>
          </div>
        )
      }
      return (
        <div style={style}>
          <span className={cls} aria-disabled="true">
            {label}
          </span>
        </div>
      )
    }
    case 'hero': {
      const b: any = block
      const style = layoutToCss(b.layout) as CSSProperties
      const overlay = typeof b.overlay === 'number' ? b.overlay : undefined
      const pHref = safeHref(b.primaryCta?.href)
      const sHref = safeHref(b.secondaryCta?.href)
      return (
        <section className={`content-hero content-hero--${b.height || 'md'}`} style={style}>
          {b.eyebrow ? <p className="content-hero__eyebrow">{b.eyebrow}</p> : null}
          <h2 className="content-hero__title">{b.title}</h2>
          {b.subtitle ? <p className="content-hero__subtitle">{b.subtitle}</p> : null}
          {b.imageSrc && b.imageAlt ? <img className="content-hero__image" src={b.imageSrc} alt={b.imageAlt} loading="lazy" /> : null}
          {overlay !== undefined ? (
            <div className="content-hero__overlay" aria-hidden="true" style={{ background: `rgba(0,0,0,${Math.min(Math.max(overlay, 0), 80) / 100})` }} />
          ) : null}
          <div className="content-hero__actions">
            {b.primaryCta?.label && pHref ? (
              <a className="content-btn content-btn--primary content-btn--md" href={pHref} {...(b.primaryCta.newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
                {b.primaryCta.label}
              </a>
            ) : b.primaryCta?.label ? (
              <span className="content-btn content-btn--primary content-btn--md" aria-disabled="true">{b.primaryCta.label}</span>
            ) : null}
            {b.secondaryCta?.label && sHref ? (
              <a className="content-btn content-btn--secondary content-btn--md" href={sHref} {...(b.secondaryCta.newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
                {b.secondaryCta.label}
              </a>
            ) : b.secondaryCta?.label ? (
              <span className="content-btn content-btn--secondary content-btn--md" aria-disabled="true">{b.secondaryCta.label}</span>
            ) : null}
          </div>
        </section>
      )
    }
    case 'accordion': {
      const b: any = block
      const items = Array.isArray(b.items) ? b.items : []
      const defaultOpen = b.defaultOpen || 'none'
      const allowMultiple = b.allowMultiple === true
      const [openSet, setOpenSet] = useState<Set<number>>(() => {
        const s = new Set<number>()
        if (defaultOpen === 'first' && items.length > 0) s.add(0)
        if (defaultOpen === 'all') items.forEach((_: any, i: number) => s.add(i))
        return s
      })
      const toggle = (i: number) => {
        setOpenSet((prev) => {
          const next = new Set(prev)
          if (next.has(i)) {
            next.delete(i)
            return next
          }
          if (!allowMultiple) {
            next.clear()
          }
          next.add(i)
          return next
        })
      }
      const baseKey = path
      return (
        <section className="content-accordion" style={layout}>
          {b.heading ? <h2 className="content-accordion__heading">{b.heading}</h2> : null}
          {items.map((item: any, i: number) => {
            const open = openSet.has(i)
            const qId = `q-${baseKey}-${i}`
            const aId = `a-${baseKey}-${i}`
            return (
              <div className="content-accordion__item" key={i}>
                <button
                  id={qId}
                  className="content-accordion__button"
                  type="button"
                  aria-expanded={open}
                  aria-controls={aId}
                  onClick={() => toggle(i)}
                >
                  {item.question}
                </button>
                <div
                  id={aId}
                  className="content-accordion__panel"
                  role="region"
                  aria-labelledby={qId}
                  hidden={!open}
                >
                  {item.rich ? <RichText rich={item.rich} text={item.answer || ''} /> : <Multiline text={item.answer || ''} />}
                </div>
              </div>
            )
          })}
        </section>
      )
    }
    case 'cards': {
      const b: any = block
      const items = Array.isArray(b.items) ? b.items : []
      const columns = b.columns || 3
      return (
        <ul className={`content-cards content-cards--${columns}`} style={layout}>
          {items.map((item: any, i: number) => {
            const wholeCard = b.linkWholeCard && safeHref(item.href)
            const content = (
              <article className="content-card">
                {item.imageSrc ? (
                  <img className="content-card__image" src={item.imageSrc} alt={item.imageAlt || ''} loading="lazy" />
                ) : (
                  <div className="content-card__placeholder" role="img" aria-label="Image placeholder" />
                )}
                <p className="content-card__title">
                  <strong>{item.title}</strong>
                </p>
                {item.text ? <p className="content-card__text">{item.text}</p> : null}
                {item.ctaLabel ? (
                  safeHref(item.href) ? (
                    <a className="content-card__cta" href={safeHref(item.href)!} {...(item.newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
                      {item.ctaLabel}
                    </a>
                  ) : (
                    <span className="content-card__cta" aria-disabled="true">{item.ctaLabel}</span>
                  )
                ) : null}
              </article>
            )
            return (
              <li className="content-cards__item" key={i}>
                {wholeCard ? (
                  <a className="content-card__link" href={wholeCard} {...(item.newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
                    {content}
                  </a>
                ) : (
                  content
                )}
              </li>
            )
          })}
        </ul>
      )
    }
    case 'steps': {
      const b: any = block
      const items = Array.isArray(b.items) ? b.items : []
      const styleType = b.style || 'numbered'
      const ListTag = styleType === 'numbered' ? 'ol' : 'ul'
      return (
        <section className="content-steps" style={layout}>
          {b.heading ? <h2 className="content-steps__heading">{b.heading}</h2> : null}
          <ListTag className="content-steps__list">
            {items.map((item: any, i: number) => (
              <li className="content-steps__item" key={i}>
                <strong className="content-steps__title">{item.title}</strong>
                {item.text ? <p className="content-steps__text">{item.text}</p> : null}
              </li>
            ))}
          </ListTag>
        </section>
      )
    }
    case 'checklist': {
      const b: any = block
      const items = Array.isArray(b.items) ? b.items : []
      const styleType = b.style || 'check'
      const ListTag = styleType === 'number' ? 'ol' : 'ul'
      return (
        <section className="content-checklist" style={layout}>
          {b.title ? <h2 className="content-checklist__title">{b.title}</h2> : null}
          <ListTag className="content-checklist__list">
            {items.map((item: any, i: number) => (
              <li className="content-checklist__item" key={i}>
                <span className="content-checklist__icon" aria-hidden="true">{styleType === 'check' ? '✓' : `${i + 1}.`}</span>
                <span className="content-checklist__text">
                  {item.text}
                  {item.note ? <span className="content-checklist__note"> {item.note}</span> : null}
                </span>
              </li>
            ))}
          </ListTag>
        </section>
      )
    }
    case 'download': {
      const b: any = block
      const href = safeHref(b.fileSrc)
      if (!href) {
        return (
          <div className="content-download content-download--missing" role="note" style={layout}>
            Attachment unavailable
          </div>
        )
      }
      const dlHref = href.includes('?') ? `${href}&download=1` : `${href}?download=1`
      const size = formatFileSize(b.fileSizeBytes)
      const type = fileTypeLabel(b.fileType, href)
      return (
        <a
          className="content-download"
          href={dlHref}
          download
          {...(b.newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          style={layout as any}
        >
          <span className="content-download__icon" aria-hidden="true">↓</span>
          <span className="content-download__body">
            <span className="content-download__label">{b.label}</span>
            {b.description ? <span className="content-download__desc">{b.description}</span> : null}
            <span className="content-download__meta">
              {type}
              {size ? ` • ${size}` : ''}
            </span>
          </span>
        </a>
      )
    }
    case 'toc': {
      return <TocView block={block as any} allBlocks={allBlocks} />
    }
    case 'references': {
      const b: any = block
      const items = Array.isArray(b.items) ? b.items : []
      const numbered = b.numbered !== false
      const ListTag = numbered ? 'ol' : 'ul'
      return (
        <section className="content-references" style={layout}>
          {b.title ? <h2 className="content-references__title">{b.title}</h2> : null}
          <ListTag className="content-references__list">
            {items.map((item: any, i: number) => (
              <li className="content-references__item" key={i}>
                <span className="content-references__text">{item.text}</span>
                {(item.publisher || item.year) ? (
                  <cite className="content-references__cite">
                    {item.publisher}
                    {item.publisher && item.year ? ', ' : ''}
                    {item.year}
                  </cite>
                ) : null}
                {item.url && safeHref(item.url) ? (
                  <a className="content-references__link" href={safeHref(item.url)!} rel="noreferrer">
                    {item.url}
                  </a>
                ) : null}
              </li>
            ))}
          </ListTag>
        </section>
      )
    }
    case 'video': {
      const b: any = block
      const src = b.src
      const mime = src ? videoMime(src) : undefined
      const muted = b.autoplay ? true : b.muted
      const autoplay = b.autoplay ? true : undefined
      return (
        <figure className="content-video" style={layout}>
          {src ? (
            <video
              className="content-video__player"
              controls={b.controls !== false}
              preload="metadata"
              poster={b.poster}
              {...(autoplay ? { autoPlay: true } : {})}
              {...(b.loop ? { loop: true } : {})}
              {...(muted ? { muted: true } : {})}
              playsInline
            >
              <source src={src} {...(mime ? { type: mime } : {})} />
              {b.captionsSrc ? <track kind="captions" src={b.captionsSrc} label="Captions" default /> : null}
            </video>
          ) : null}
          {b.title ? <figcaption className="content-video__caption">{b.title}</figcaption> : null}
        </figure>
      )
    }
    case 'columns': {
      const b: any = block
      const columns = Array.isArray(b.columns) ? b.columns : [[], []]
      const ratio = b.ratio || 'equal'
      const stackAt = b.stackAt || 'mobile'
      const gap = typeof b.gap === 'number' ? b.gap : 24
      const style: CSSProperties = { ...layoutToCss(b.layout), gap: `${gap}px` }
      return (
        <div className={`content-columns content-columns--${ratio} content-columns--stack-${stackAt}`} style={style}>
          {columns.map((col: Block[], c: number) => (
            <div className="content-columns__col" key={c}>
              {col.map((child: Block, ci: number) => (
                <BlockView key={ci} block={child} path={`${path}.${c}.${ci}`} headingIdByBlock={headingIdByBlock} anchors={anchors} allBlocks={allBlocks} />
              ))}
            </div>
          ))}
        </div>
      )
    }
    case 'gallery': {
      const b: any = block
      const images = Array.isArray(b.images) ? b.images : []
      const display = b.display || 'grid'
      const aspect = b.aspect || '4:3'
      const [open, setOpen] = useState<number | null>(null)
      useEffect(() => {
        if (open === null) return
        const onKey = (e: KeyboardEvent) => {
          if (e.key === 'Escape') setOpen(null)
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
      }, [open])
      return (
        <div style={layout}>
          <ul className={`content-gallery content-gallery--${display} content-gallery--${aspect}`}>
            {images.map((img: any, i: number) => (
              <li className="content-gallery__item" key={i}>
                <figure>
                  {b.lightbox ? (
                    <button
                      className="content-gallery__button"
                      type="button"
                      aria-label={img.alt ? `View ${img.alt} larger` : 'View image larger'}
                      onClick={() => setOpen(i)}
                    >
                      <img src={img.src} alt={img.alt || ''} loading="lazy" />
                    </button>
                  ) : (
                    <img src={img.src} alt={img.alt || ''} loading="lazy" />
                  )}
                  {img.caption ? <figcaption>{img.caption}</figcaption> : null}
                </figure>
              </li>
            ))}
          </ul>
          {b.lightbox && open !== null && images[open] ? (
            <dialog className="content-gallery__dialog" open onClose={() => setOpen(null)}>
              <button className="content-gallery__close" type="button" onClick={() => setOpen(null)} aria-label="Close">
                ×
              </button>
              <img src={images[open].src} alt={images[open].alt || ''} />
              {images[open].caption ? <p className="content-gallery__dialog-caption">{images[open].caption}</p> : null}
            </dialog>
          ) : null}
        </div>
      )
    }
    case 'timeline': {
      const b: any = block
      const items = Array.isArray(b.items) ? b.items : []
      const styleType = b.style || 'line'
      return (
        <ol className={`content-timeline content-timeline--${styleType}`} style={layout}>
          {items.map((item: any, i: number) => (
            <li className="content-timeline__item" key={i}>
              {item.label ? <span className="content-timeline__label">{item.label}</span> : null}
              <strong className="content-timeline__title">{item.title}</strong>
              {item.text ? <p className="content-timeline__text">{item.text}</p> : null}
            </li>
          ))}
        </ol>
      )
    }
    case 'stats': {
      const b: any = block
      const items = Array.isArray(b.items) ? b.items : []
      const variant = b.variant || 'cards'
      return (
        <ul className={`content-stats content-stats--${variant}`} style={layout}>
          {items.map((item: any, i: number) => (
            <li className="content-stats__item" key={i}>
              <p className="content-stats__value">{item.value}</p>
              <p className="content-stats__label">{item.label}</p>
              {item.source ? (
                <cite className="content-stats__source">{item.source}</cite>
              ) : (
                <cite className="content-stats__source content-stats__source--missing">Source not provided</cite>
              )}
              {item.note ? <p className="content-stats__note">{item.note}</p> : null}
            </li>
          ))}
        </ul>
      )
    }
    case 'key_facts': {
      const b: any = block
      const items = Array.isArray(b.items) ? b.items : []
      const title = b.title || 'Key facts'
      return (
        <section className="content-keyfacts" style={layout}>
          <h2 className="content-keyfacts__title">{title}</h2>
          <dl className="content-keyfacts__list">
            {items.map((item: any, i: number) => (
              <div className="content-keyfacts__row" key={i}>
                <dt className="content-keyfacts__label">{item.label}</dt>
                <dd className="content-keyfacts__value">{item.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )
    }
    case 'audio': {
      const b: any = block
      const src = b.src
      return (
        <figure className="content-audio" style={layout}>
          {src ? <audio className="content-audio__player" controls preload="metadata" src={src} /> : null}
          {b.title ? <figcaption className="content-audio__caption">{b.title}</figcaption> : null}
          {b.transcript !== undefined && b.transcript !== null ? (
            <details className="content-audio__transcript">
              <summary>Transcript</summary>
              <p>
                <Multiline text={b.transcript || ''} />
              </p>
            </details>
          ) : null}
          {!src ? (
            <div className="content-audio__missing" role="note">
              Audio unavailable
            </div>
          ) : null}
        </figure>
      )
    }
    case 'testimonial': {
      const b: any = block
      return (
        <figure className="content-testimonial" style={layout}>
          <blockquote className="content-testimonial__quote">
            <p>
              <Multiline text={b.quote || ''} />
            </p>
          </blockquote>
          <figcaption className="content-testimonial__cite">
            {b.avatarSrc ? <img className="content-testimonial__avatar" src={b.avatarSrc} alt={b.attribution || ''} loading="lazy" /> : null}
            <span className="content-testimonial__cite-text">
              <span className="content-testimonial__attribution">{b.attribution}</span>
              {b.context ? <span className="content-testimonial__context">{b.context}</span> : null}
            </span>
          </figcaption>
        </figure>
      )
    }
    case 'map': {
      const b: any = block
      const directions = safeHref(b.directionsUrl)
      const imageAlt = b.label?.trim() || b.address || 'Map'
      return (
        <section className="content-map" style={layout}>
          {b.label ? <h2 className="content-map__title">{b.label}</h2> : null}
          {b.address ? <address className="content-map__address">{b.address}</address> : null}
          {b.staticImageSrc ? (
            <figure className="content-map__figure">
              <img className="content-map__img" src={b.staticImageSrc} alt={imageAlt} loading="lazy" />
            </figure>
          ) : null}
          {directions ? (
            <a className="content-map__directions" href={directions} rel="noreferrer">
              Directions
            </a>
          ) : null}
        </section>
      )
    }
    case 'embed': {
      const b: any = block
      const provider = String(b.provider ?? '').trim().toLowerCase() as EmbedProvider
      const label = EMBED_LABELS[provider] || provider
      const url = String(b.url ?? '').trim()
      const title = b.title || label
      const [loaded, setLoaded] = useState(false)
      const consentRequired = b.consentRequired !== false
      if (consentRequired && !loaded) {
        return (
          <div className="content-embed" style={layout}>
            <div className="content-embed__header">
              <span className="content-embed__provider">{label}</span>
              {b.title ? <p className="content-embed__title">{b.title}</p> : null}
            </div>
            <button type="button" className="content-embed__consent" aria-expanded="false" onClick={() => setLoaded(true)}>
              Load {label} content
            </button>
          </div>
        )
      }
      if (!isAllowedEmbed(provider, url)) {
        return (
          <div className="content-embed" style={layout}>
            <span className="content-embed__provider">{EMBED_LABELS[provider] || 'Unknown provider'}</span>
            {b.title ? <p className="content-embed__title">{b.title}</p> : null}
            <div className="content-embed__placeholder" role="note">
              {EMBED_LABELS[provider] ? `${EMBED_LABELS[provider]} content is not available.` : 'Unsupported embed provider.'}
            </div>
          </div>
        )
      }
      return (
        <div className="content-embed" style={layout}>
          <span className="content-embed__provider">{label}</span>
          {b.title ? <p className="content-embed__title">{b.title}</p> : null}
          <iframe
            className="content-embed__iframe"
            src={url}
            title={title}
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        </div>
      )
    }
    default:
      return null
  }
}

export function BlockRenderer({ blocks }: { blocks: Block[] }) {
  if (!Array.isArray(blocks) || !blocks.length) {
    return <p className="muted">This page has no content yet.</p>
  }
  const anchors = collectHeadingAnchors(blocks)
  const headingIdByBlock = buildHeadingIdByBlock(blocks, anchors)
  return (
    <div className="content-body">
      {blocks.map((block, i) => (
        <BlockView key={i} block={block} path={String(i)} headingIdByBlock={headingIdByBlock} anchors={anchors} allBlocks={blocks} />
      ))}
    </div>
  )
}

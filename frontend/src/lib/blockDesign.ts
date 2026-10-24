import type { CSSProperties } from "react";
import { isKnownBlock } from "../api/types";
import type { Block, BlockLayout, BlockTable, HeadingLevel } from "../api/types";

export const CALLOUT_SHAPES = ["rectangle", "rounded", "square", "oval", "circle"] as const;
export type CalloutShape = (typeof CALLOUT_SHAPES)[number];

export const CALLOUT_SHAPE_STYLES: Record<CalloutShape, CSSProperties> = {
  rectangle: {
    display: 'block',
    width: '100%',
    borderRadius: '6px',
    padding: '16px 20px',
  },
  rounded: {
    display: 'block',
    width: '100%',
    borderRadius: '16px',
    padding: '16px 20px',
  },
  square: {
    display: 'block',
    width: '100%',
    borderRadius: 0,
    padding: '16px 20px',
  },
  oval: {
    display: 'inline-block',
    width: 'fit-content',
    maxWidth: '100%',
    borderRadius: '9999px',
    padding: '16px 20px',
  },
  circle: {
    display: 'inline-flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    boxSizing: 'border-box',
    width: '160px',
    minHeight: '160px',
    maxWidth: '100%',
    aspectRatio: '1 / 1',
    borderRadius: '50%',
    textAlign: 'center',
    padding: '18px',
  },
};

const CALLOUT_LABELS: Record<string, string> = {
  info: 'Information',
  warn: 'Warning',
  ok: 'Good to know',
  bad: 'Important',
};

/** Default label for a callout variant. Never returns an empty string. */
export function calloutLabel(variant: string): string {
  const key = String(variant ?? '')
    .trim()
    .toLowerCase();
  return CALLOUT_LABELS[key] ?? 'Custom callout';
}

/** Number of columns of a table payload (header length, else longest row). */
export function tableColumnCount(table: BlockTable): number {
  return table.header && table.header.length > 0
    ? table.header.length
    : Math.max(0, ...table.rows.map((r) => r.length));
}

/**
 * Translate a validated `layout` object into CSS properties.
 * Only the keys that are actually present are emitted — an absent key means
 * "keep the stylesheet/theme value" (never a default).
 */
export function layoutToCss(layout?: BlockLayout): CSSProperties {
  if (!layout) return {};
  const css: CSSProperties = {};
  if (layout.textAlign !== undefined) css.textAlign = layout.textAlign;
  if (layout.width !== undefined) {
    const offset = layout.offsetX ?? 0;
    css.width = `${Math.min(layout.width, Math.max(0, 100 - Math.abs(offset)))}%`;
  }
  if (layout.offsetX !== undefined) css.marginLeft = `${layout.offsetX}%`;
  if (layout.marginTop !== undefined) css.marginTop = `${layout.marginTop}px`;
  if (layout.marginBottom !== undefined) css.marginBottom = `${layout.marginBottom}px`;
  if (layout.backgroundColor !== undefined) css.backgroundColor = layout.backgroundColor;
  if (layout.borderColor !== undefined) css.borderColor = layout.borderColor;
  if (layout.borderWidth !== undefined) css.borderWidth = `${layout.borderWidth}px`;
  if (layout.borderStyle !== undefined) css.borderStyle = layout.borderStyle;
  if (layout.borderRadius !== undefined) css.borderRadius = `${layout.borderRadius}px`;
  if (layout.padding !== undefined) css.padding = `${layout.padding}px`;
  return css;
}

// ---------------------------------------------------------------------------
// Heading anchors / table of contents (pure, shared verbatim by admin & site)
// ---------------------------------------------------------------------------

export interface HeadingAnchor { key: string; id: string; level: HeadingLevel; text: string; }
export interface TocNode { anchor: HeadingAnchor; depth: number; children: TocNode[]; }

/**
 * Stable slug for a heading: trimmed, NFKD-normalised, combining marks
 * stripped, lowercased, non `[a-z0-9]` runs collapsed to `-`, capped at 60
 * chars, with `section` as the fallback.
 */
export function slugifyHeading(text: string): string {
  const slug = text
    .trim()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'section';
}

/**
 * Collect heading anchors in document order, including headings nested inside
 * `columns`. `key` is the block path (`0`, `3.1`, `3.1.2`). TOC blocks and
 * unknown blocks never contribute; unknown blocks are not descended into.
 * Duplicate slugs are disambiguated with `-2`, `-3`, … in document order.
 */
export function collectHeadingAnchors(blocks: Block[], prefix?: string): HeadingAnchor[] {
  const anchors: HeadingAnchor[] = [];
  const seen = new Map<string, number>();

  const walk = (list: Block[], parentKey: string): void => {
    list.forEach((block, index) => {
      const key = parentKey === '' ? String(index) : `${parentKey}.${index}`;
      if (!isKnownBlock(block)) return;
      if (block.type === 'heading') {
        const base = slugifyHeading(block.text);
        const count = (seen.get(base) ?? 0) + 1;
        seen.set(base, count);
        anchors.push({
          key,
          id: count === 1 ? base : `${base}-${count}`,
          level: block.level,
          text: block.text,
        });
        return;
      }
      if (block.type === 'columns') {
        block.columns.forEach((column) => walk(column, key));
      }
    });
  };

  walk(blocks, prefix ?? '');
  return anchors;
}

/**
 * Build a nested TOC from anchors. Keeps only levels in `minLevel..maxLevel`,
 * derives `depth = level - minLevel + 1` and clamps it to `1..maxDepth`.
 */
export function buildTocTree(
  anchors: HeadingAnchor[],
  minLevel: number,
  maxLevel: number,
  maxDepth: number,
): TocNode[] {
  const depthLimit = Math.max(1, Math.floor(maxDepth));
  const roots: TocNode[] = [];
  const stack: TocNode[] = [];

  for (const anchor of anchors) {
    if (anchor.level < minLevel || anchor.level > maxLevel) continue;
    const depth = Math.min(Math.max(anchor.level - minLevel + 1, 1), depthLimit);
    const node: TocNode = { anchor, depth, children: [] };
    while (stack.length > 0 && stack[stack.length - 1].depth >= depth) stack.pop();
    if (stack.length === 0) roots.push(node);
    else stack[stack.length - 1].children.push(node);
    stack.push(node);
  }

  return roots;
}

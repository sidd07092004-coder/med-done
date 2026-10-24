// Page-builder helpers shared by the admin editor and the manage panel.
//
// The public contract is intentionally small:
//   - useEditorHistory<T>  undo/redo snapshots with 750 ms text coalescing
//   - isDirty/deepEqual     dirty comparison used by the editor guard
//   - getPrePublishChecks   non-blocking editorial warnings (spec §6.7)
//   - slug helpers          normalisation used by the create/editor dialogs

import { useCallback, useRef, useState } from 'react';
import type { Block, KnownBlock, PageContent } from '../api/types';
import { isBlocksContent, isKnownBlock } from '../api/types';

// ---------------------------------------------------------------------------
// Content state + undo / redo history
// ---------------------------------------------------------------------------

export interface EditorContentState {
  blocks: Block[];
  homeFields: Record<string, string>;
}

export interface HistoryPushOptions {
  /** Stable key used to coalesce a run of edits (text/item/layout). */
  key?: string;
  /** Injectable clock; defaults to Date.now(). */
  now?: number;
}

export interface EditorHistory<T> {
  present: T;
  past: T[];
  future: T[];
  push: (next: T, options?: HistoryPushOptions) => void;
  undo: () => void;
  redo: () => void;
  /** Clear both stacks and start again from `next` (e.g. after a restore). */
  reset: (next: T) => void;
  canUndo: boolean;
  canRedo: boolean;
  undoCount: number;
  redoCount: number;
}

/** Maximum number of undo snapshots retained (spec §6.4). */
export const HISTORY_LIMIT = 50;

/** A typing run with the same key inside this window is one history step. */
export const HISTORY_COALESCE_MS = 750;

interface HistoryState<T> {
  past: T[];
  present: T;
  future: T[];
  lastKey: string | null;
  lastTime: number;
}

/** Structural operations always get a unique key so they never coalesce. */
let structuralSequence = 0;
export function structuralHistoryKey(kind = 'edit'): string {
  structuralSequence += 1;
  return `struct:${kind}:${Date.now()}:${structuralSequence}`;
}

/**
 * `useEditorHistory` keeps a bounded undo/redo stack for editor content.
 *
 * Coalescing mirrors the spec: a `push` with the same key within 750 ms updates
 * the present snapshot without adding another past entry. Structural edits pass
 * a unique key (see `structuralHistoryKey`) and therefore always create a step.
 */
export function useEditorHistory<T>(initial: T, limit = HISTORY_LIMIT): EditorHistory<T> {
  const [state, setState] = useState<HistoryState<T>>({
    past: [],
    present: initial,
    future: [],
    lastKey: null,
    lastTime: 0,
  });

  // Keep a ref so stale event handlers can still read the current snapshot.
  const stateRef = useRef(state);
  stateRef.current = state;

  const push = useCallback(
    (next: T, options: HistoryPushOptions = {}) => {
      const now = options.now ?? Date.now();
      const key = options.key ?? null;
      setState((prev) => {
        if (deepEqual(prev.present, next)) return prev;

        const coalesce =
          key !== null && key === prev.lastKey && now - prev.lastTime < HISTORY_COALESCE_MS;

        if (coalesce) {
          return { ...prev, present: next, lastKey: key, lastTime: now };
        }

        const past = [...prev.past, prev.present];
        if (past.length > limit) past.splice(0, past.length - limit);

        return {
          past,
          present: next,
          future: [],
          lastKey: key,
          lastTime: now,
        };
      });
    },
    [limit],
  );

  const undo = useCallback(() => {
    setState((prev) => {
      if (prev.past.length === 0) return prev;
      const previous = prev.past[prev.past.length - 1];
      return {
        past: prev.past.slice(0, -1),
        present: previous,
        future: [prev.present, ...prev.future],
        lastKey: null,
        lastTime: 0,
      };
    });
  }, []);

  const redo = useCallback(() => {
    setState((prev) => {
      if (prev.future.length === 0) return prev;
      const next = prev.future[0];
      return {
        past: [...prev.past, prev.present],
        present: next,
        future: prev.future.slice(1),
        lastKey: null,
        lastTime: 0,
      };
    });
  }, []);

  const reset = useCallback((next: T) => {
    setState({
      past: [],
      present: next,
      future: [],
      lastKey: null,
      lastTime: 0,
    });
  }, []);

  return {
    present: state.present,
    past: state.past,
    future: state.future,
    push,
    undo,
    redo,
    reset,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    undoCount: state.past.length,
    redoCount: state.future.length,
  };
}

// ---------------------------------------------------------------------------
// Content change classification (used to choose a coalescing key)
// ---------------------------------------------------------------------------

const STRUCTURAL_ARRAY_KEYS = new Set(['columns', 'items', 'images', 'richItems']);

function stableStringify(value: unknown): string {
  return JSON.stringify(value);
}

function firstDiffPath(previous: unknown, next: unknown, path = ''): string | null {
  if (Object.is(previous, next)) return null;

  if (Array.isArray(previous) && Array.isArray(next)) {
    if (previous.length !== next.length) return path || '[]';
    for (let i = 0; i < previous.length; i += 1) {
      const child = firstDiffPath(previous[i], next[i], `${path}[${i}]`);
      if (child !== null) return child;
    }
    return path || '[]';
  }

  if (
    previous &&
    next &&
    typeof previous === 'object' &&
    typeof next === 'object' &&
    !Array.isArray(previous) &&
    !Array.isArray(next)
  ) {
    const a = previous as Record<string, unknown>;
    const b = next as Record<string, unknown>;
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) {
      const child = firstDiffPath(a[key], b[key], path ? `${path}.${key}` : key);
      if (child !== null) return child;
    }
    return path || '{}';
  }

  return path || 'value';
}

function parentKey(path: string): string {
  const segment = path.split('.').pop() ?? path;
  return segment.replace(/\[\d+\]$/, '');
}

/** True when any nested array (columns, items, images…) gained/lost entries. */
function hasArrayLengthChange(previous: unknown, next: unknown): boolean {
  if (Array.isArray(previous) && Array.isArray(next)) {
    if (previous.length !== next.length) return true;
    return previous.some((item, index) => hasArrayLengthChange(item, next[index]));
  }
  if (
    previous &&
    next &&
    typeof previous === 'object' &&
    typeof next === 'object' &&
    !Array.isArray(previous) &&
    !Array.isArray(next)
  ) {
    const a = previous as Record<string, unknown>;
    const b = next as Record<string, unknown>;
    return Object.keys(a).some((key) => hasArrayLengthChange(a[key], b[key]));
  }
  return false;
}

function isPermutation(previous: Block[], next: Block[]): boolean {
  if (previous.length !== next.length) return false;
  return (
    [...previous].map(stableStringify).sort().join('\u0000') ===
    [...next].map(stableStringify).sort().join('\u0000')
  );
}

/**
 * Choose a coalescing key for a block-list edit.
 *
 * Text edits use `text:index:field`, item edits use
 * `item:index:itemIndex:field`, layout edits use `layout:index:key` and any
 * structural change gets a unique key.
 */
export function blocksChangeKey(previous: Block[], next: Block[]): string {
  if (previous === next) return structuralHistoryKey('noop');
  if (previous.length !== next.length) return structuralHistoryKey('blocks-length');

  // A drag/drop or move reorders the same set of blocks without changing them.
  if (isPermutation(previous, next) && previous.some((block, i) => block !== next[i])) {
    return structuralHistoryKey('reorder');
  }

  const index = previous.findIndex((block, i) => block !== next[i]);
  if (index < 0) return structuralHistoryKey('noop');

  const before = previous[index];
  const after = next[index];
  if (!before || !after || before.type !== after.type) {
    return structuralHistoryKey('block-type');
  }

  const path = firstDiffPath(before, after, '');
  if (!path) return structuralHistoryKey('block');

  // Adding/removing a column, item or nested block changes an array length.
  const parent = parentKey(path);
  if (hasArrayLengthChange(before, after)) {
    return structuralHistoryKey(`array:${parent}`);
  }
  if (!path.includes('[') && STRUCTURAL_ARRAY_KEYS.has(parent)) {
    return structuralHistoryKey(`array:${parent}`);
  }
  if (/\.(columns|items|images|richItems)$/.test(path)) {
    return structuralHistoryKey(`array:${parent}`);
  }

  if (path.includes('layout')) {
    return `layout:${index}:${parent}`;
  }

  const itemMatch = path.match(/\.(items|images|richItems|columns)\[(\d+)\]\.(.+)$/);
  if (itemMatch) {
    return `item:${index}:${itemMatch[2]}:${itemMatch[3]}`;
  }

  return `text:${index}:${path}`;
}

// ---------------------------------------------------------------------------
// Dirty comparison
// ---------------------------------------------------------------------------

/** Structural equality for JSON-like editor values. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  if (
    a &&
    b &&
    typeof a === 'object' &&
    typeof b === 'object' &&
    !Array.isArray(a) &&
    !Array.isArray(b)
  ) {
    const recordA = a as Record<string, unknown>;
    const recordB = b as Record<string, unknown>;
    const keysA = Object.keys(recordA);
    const keysB = Object.keys(recordB);
    if (keysA.length !== keysB.length) return false;
    for (const key of keysA) {
      if (!Object.prototype.hasOwnProperty.call(recordB, key)) return false;
      if (!deepEqual(recordA[key], recordB[key])) return false;
    }
    return true;
  }

  return false;
}

/** True when the current editor values differ from the saved baseline. */
export function isDirty(baseline: unknown, current: unknown): boolean {
  return !deepEqual(baseline, current);
}

/** Deterministic signature used in the editor's dirty snapshot. */
export function contentSignature(content: PageContent): string {
  return stableStringify(content);
}

// ---------------------------------------------------------------------------
// Slug helpers
// ---------------------------------------------------------------------------

/** Normalise a slug/path: trim, lower-case and remove leading/trailing slashes. */
export function normalizeSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/{2,}/g, '/');
}

/** Convert free text to a URL-safe slug (allows nested `/` paths). */
export function slugifyTitle(value: string): string {
  return (
    normalizeSlug(
      value
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9/]+/g, '-')
        .replace(/-+/g, '-'),
    ) || 'page'
  );
}

/** Canonical path helper: a leading slash, no trailing slash (except root). */
export function canonicalPathFor(slug: string): string {
  const normalized = normalizeSlug(slug);
  return normalized ? `/${normalized}` : '/';
}

/** A slug is valid when it is non-empty, <= 512 chars and has no whitespace. */
export function isValidSlug(value: string): boolean {
  const slug = normalizeSlug(value);
  return slug.length > 0 && slug.length <= 512 && !/\s/.test(slug);
}

// ---------------------------------------------------------------------------
// Pre-publish checks (non-blocking editorial warnings, spec §6.7)
// ---------------------------------------------------------------------------

export type PrePublishCheckCode =
  | 'meta_description_missing'
  | 'meta_title_missing'
  | 'image_alt_missing'
  | 'empty_link_or_cta'
  | 'accordion_answer_empty'
  | 'references_missing'
  | 'video_captions_missing'
  | 'audio_transcript_missing'
  | 'stats_source_missing'
  | 'testimonial_consent_missing'
  | 'download_file_missing';

export interface PrePublishCheck {
  code: PrePublishCheckCode;
  message: string;
  blockIndex?: number;
}

/** Accepts the API Page (snake_case) or a camelCase draft. */
export interface PrePublishPageInput {
  slug: string;
  metaTitle?: string | null;
  metaDescription?: string | null;
  meta_title?: string | null;
  meta_description?: string | null;
}

function firstNonEmpty(values: Array<string | null | undefined>): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return '';
}

interface RichSpanLike {
  text?: string;
  link?: { href?: string } | null;
}

function richSpans(block: Block): RichSpanLike[] {
  const record = block as unknown as Record<string, unknown>;
  const spans: RichSpanLike[] = [];
  if (Array.isArray(record.rich)) spans.push(...(record.rich as RichSpanLike[]));
  if (Array.isArray(record.richItems)) {
    for (const item of record.richItems) {
      if (Array.isArray(item)) spans.push(...(item as RichSpanLike[]));
    }
  }
  return spans;
}

function walkBlocks(
  blocks: Block[],
  visit: (block: KnownBlock, index: number) => void,
): void {
  blocks.forEach((block, index) => {
    if (!isKnownBlock(block)) return;
    visit(block, index);
    if (block.type === 'columns' && Array.isArray(block.columns)) {
      block.columns.forEach((column) => walkBlocks(column, visit));
    }
  });
}

function hasBlock(blocks: Block[], type: string): boolean {
  let found = false;
  walkBlocks(blocks, (block) => {
    if (block.type === type) found = true;
  });
  return found;
}

/**
 * Return editorial warnings for a page before it is submitted. These are never
 * enforced by the backend; Submit still works with warnings present.
 */
export function getPrePublishChecks(
  page: PrePublishPageInput,
  content: PageContent | null | undefined,
  groupPath = '',
): PrePublishCheck[] {
  const checks: PrePublishCheck[] = [];
  const metaTitle = firstNonEmpty([page.metaTitle, page.meta_title]);
  const metaDescription = firstNonEmpty([page.metaDescription, page.meta_description]);

  if (!metaDescription) {
    checks.push({
      code: 'meta_description_missing',
      message: 'Add a meta description so search results have a useful summary.',
    });
  }
  if (!metaTitle) {
    checks.push({
      code: 'meta_title_missing',
      message: 'Add a meta title so the browser and search results have a heading.',
    });
  }

  if (!isBlocksContent(content)) return checks;
  const blocks = content.blocks;

  walkBlocks(blocks, (block, index) => {
    switch (block.type) {
      case 'image': {
        if (block.src.trim() && !block.alt.trim()) {
          checks.push({
            code: 'image_alt_missing',
            blockIndex: index,
            message: 'An image has a source but no alt text.',
          });
        }
        break;
      }
      case 'hero': {
        if (block.imageSrc?.trim() && !block.imageAlt?.trim()) {
          checks.push({
            code: 'image_alt_missing',
            blockIndex: index,
            message: 'The hero image has a source but no alt text.',
          });
        }
        for (const cta of [block.primaryCta, block.secondaryCta]) {
          if (cta && (!cta.label.trim() || !cta.href.trim())) {
            checks.push({
              code: 'empty_link_or_cta',
              blockIndex: index,
              message: 'A hero call-to-action is missing its label or link.',
            });
          }
        }
        break;
      }
      case 'button': {
        if (!block.label.trim() || !block.href?.trim()) {
          checks.push({
            code: 'empty_link_or_cta',
            blockIndex: index,
            message: 'A button is missing its label or link.',
          });
        }
        break;
      }
      case 'cards': {
        for (const item of block.items) {
          if (item.imageSrc?.trim() && !item.imageAlt?.trim()) {
            checks.push({
              code: 'image_alt_missing',
              blockIndex: index,
              message: 'A card image has a source but no alt text.',
            });
          }
          if (item.ctaLabel !== undefined && (!item.ctaLabel.trim() || !item.href?.trim())) {
            checks.push({
              code: 'empty_link_or_cta',
              blockIndex: index,
              message: 'A card call-to-action is missing its label or link.',
            });
          }
        }
        break;
      }
      case 'gallery': {
        for (const image of block.images) {
          if (image.src.trim() && !image.alt.trim()) {
            checks.push({
              code: 'image_alt_missing',
              blockIndex: index,
              message: 'A gallery image has a source but no alt text.',
            });
          }
        }
        break;
      }
      case 'accordion': {
        for (const item of block.items) {
          const answer = item.answer ?? '';
          const richText = (item.rich ?? []).map((span) => span.text ?? '').join('');
          if (!answer.trim() && !richText.trim()) {
            checks.push({
              code: 'accordion_answer_empty',
              blockIndex: index,
              message: 'An accordion item has a question but no answer.',
            });
          }
        }
        break;
      }
      case 'video': {
        if (block.src.trim() && !block.captionsSrc?.trim()) {
          checks.push({
            code: 'video_captions_missing',
            blockIndex: index,
            message: 'A video has no captions file.',
          });
        }
        break;
      }
      case 'audio': {
        if (!block.transcript.trim()) {
          checks.push({
            code: 'audio_transcript_missing',
            blockIndex: index,
            message: 'An audio block has no transcript.',
          });
        }
        break;
      }
      case 'stats': {
        for (const item of block.items) {
          if (!item.source.trim()) {
            checks.push({
              code: 'stats_source_missing',
              blockIndex: index,
              message: 'A statistic is missing its source.',
            });
          }
        }
        break;
      }
      case 'testimonial': {
        if (!block.consentRef.trim()) {
          checks.push({
            code: 'testimonial_consent_missing',
            blockIndex: index,
            message: 'A testimonial is missing its consent reference.',
          });
        }
        break;
      }
      case 'download': {
        if (!block.fileSrc.trim()) {
          checks.push({
            code: 'download_file_missing',
            blockIndex: index,
            message: 'A download block has no file selected.',
          });
        }
        break;
      }
      default:
        break;
    }

    for (const span of richSpans(block)) {
      if (span.link && (!span.text?.trim() || !span.link.href?.trim())) {
        checks.push({
          code: 'empty_link_or_cta',
          blockIndex: index,
          message: 'A text link is missing its label or URL.',
        });
      }
    }
  });

  const looksLikeTreatment = /(treat|therap)/i.test(`${page.slug} ${groupPath}`);
  if (looksLikeTreatment && !hasBlock(blocks, 'references')) {
    checks.push({
      code: 'references_missing',
      message: 'Treatment/therapy pages should include a References block.',
    });
  }

  return checks;
}

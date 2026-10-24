import type { Block, BlockLayout } from '../api/types';

/**
 * Geometry for the editor's "Arrange" mode.
 *
 * The model is deliberately narrow: a block keeps its place in the normal
 * document flow (no absolute positioning, no free vertical placement) and
 * only two numbers change — `layout.offsetX` (the left edge, in percent of
 * the container) and `layout.width` (the block width, in percent of the
 * container). Everything here is pure so it can be reasoned about (and
 * tested) without a DOM.
 */

/** Smallest width (percent of the container) a block can be resized to. */
export const ARRANGE_MIN_WIDTH = 10;

/** Largest width (percent of the container) a block can have. */
export const ARRANGE_MAX_WIDTH = 100;

/** Largest horizontal offset the backend validator accepts. */
export const ARRANGE_MAX_OFFSET = 100;

/** The horizontal box of a block, in percent of the preview container. */
export interface ArrangeBox {
  width: number;
  offsetX: number;
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** Snap to a whole percent — the backend stores integers. */
export function snapPercent(value: number): number {
  return Math.round(value);
}

/**
 * The width the block occupies inside the container.
 *
 * Mirrors `layoutToCss()`: an explicit width is capped so that the block
 * always fits next to its offset. A block without an explicit width counts as
 * full width, which is what the renderer paints.
 */
export function paintedWidth(layout?: BlockLayout): number {
  const width = layout?.width ?? ARRANGE_MAX_WIDTH;
  const offset = Math.abs(layout?.offsetX ?? 0);
  return clamp(Math.min(width, ARRANGE_MAX_WIDTH - offset), 0, ARRANGE_MAX_WIDTH);
}

/**
 * Move a block horizontally.
 *
 * The left edge follows the pointer. The block keeps its width while it fits
 * and narrows (never below the minimum) once it would leave the container, so
 * the page can never gain a horizontal scrollbar. The result is clamped to
 * 0 … 100 percent, i.e. the block always stays inside the container.
 */
export function moveBox(layout: BlockLayout | undefined, deltaPercent: number): ArrangeBox {
  const startOffset = layout?.offsetX ?? 0;
  const startWidth = layout?.width ?? ARRANGE_MAX_WIDTH;
  const maxOffset = ARRANGE_MAX_WIDTH - ARRANGE_MIN_WIDTH;

  const offsetX = clamp(
    snapPercent(startOffset + deltaPercent),
    0,
    Math.max(0, maxOffset),
  );
  const width = Math.min(startWidth, ARRANGE_MAX_WIDTH - offsetX);

  return { width: snapPercent(width), offsetX };
}

/**
 * Resize a block from its right edge.
 *
 * The left edge stays where it is, the right edge follows the pointer. The
 * result is clamped to the container: never wider than 100 percent and never
 * narrower than the minimum width.
 */
export function resizeBox(layout: BlockLayout | undefined, deltaPercent: number): ArrangeBox {
  const startOffset = layout?.offsetX ?? 0;
  const left = clamp(snapPercent(startOffset), 0, ARRANGE_MAX_WIDTH - ARRANGE_MIN_WIDTH);
  const width = paintedWidth(layout);

  const right = clamp(
    snapPercent(left + width + deltaPercent),
    left + ARRANGE_MIN_WIDTH,
    ARRANGE_MAX_WIDTH,
  );

  return { width: right - left, offsetX: left };
}

/**
 * Write a new horizontal box into a block.
 *
 * Only the two arrange keys are touched; every other layout key is kept.
 * The default box (full width, no offset) is written as *no keys at all*, so
 * a legacy block round-trips byte-identical. When nothing is left in the
 * layout object, the whole `layout` is dropped again.
 */
export function applyArrangeBox(block: Block, box: ArrangeBox): Block {
  const layout: BlockLayout = { ...(block.layout ?? {}) };
  const width = clamp(snapPercent(box.width), ARRANGE_MIN_WIDTH, ARRANGE_MAX_WIDTH);
  const offsetX = clamp(snapPercent(box.offsetX), 0, ARRANGE_MAX_OFFSET);

  if (width >= ARRANGE_MAX_WIDTH && offsetX === 0) {
    // The default box — remove both keys instead of writing them.
    delete layout.width;
    delete layout.offsetX;
  } else {
    // The width is always written explicitly here: a block with an offset but
    // no width would overflow its container.
    layout.width = width;
    if (offsetX === 0) delete layout.offsetX;
    else layout.offsetX = offsetX;
  }

  if (Object.keys(layout).length === 0) {
    const stripped: Block = { ...block };
    delete stripped.layout;
    return stripped;
  }

  return { ...block, layout };
}

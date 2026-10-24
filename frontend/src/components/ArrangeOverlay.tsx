import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import type { Block, BlockLayout } from '../api/types';
import { moveBox, paintedWidth, resizeBox, type ArrangeBox } from '../lib/arrange';

type DragKind = 'move' | 'resize';

interface DragState {
  index: number;
  kind: DragKind;
  pointerId: number;
  startX: number;
  containerWidth: number;
  startLayout?: BlockLayout;
}

interface ArrangeOverlayProps {
  /** The element that holds the rendered blocks — one element per block. */
  containerRef: RefObject<HTMLElement>;
  blocks: Block[];
  onLayoutChange: (index: number, box: ArrangeBox) => void;
}

function formatOffset(value: number): string {
  const rounded = Math.round(value);
  return `${rounded > 0 ? '+' : ''}${rounded}%`;
}

/**
 * The direct-manipulation overlay of the editor's "Arrange" mode.
 *
 * It floats above the rendered preview: every block gets a move handle on its
 * left edge and a resize handle on its right edge. Dragging a handle writes a
 * new `layout.offsetX` / `layout.width` through `onLayoutChange`, which the
 * editor feeds back into the live block state — so the normal Save flow
 * persists the result and no second save path exists.
 *
 * The overlay never changes the blocks themselves: it only measures where they
 * ended up and positions its boxes on top of them.
 */
export function ArrangeOverlay({ containerRef, blocks, onLayoutChange }: ArrangeOverlayProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const dragRef = useRef<DragState | null>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  /** Line every overlay box up with the block it belongs to. */
  const syncOverlay = useCallback(() => {
    const container = containerRef.current;
    const layer = layerRef.current;
    if (!container || !layer) return;

    const layerRect = layer.getBoundingClientRect();
    const blockElements = Array.from(container.children).filter(
      (child) => child.getAttribute('data-arrange-layer') !== 'true',
    );

    // Read every rect first, write the styles afterwards — mixing reads and
    // writes would force the browser to re-layout on every block.
    const rects = blockElements.map((element) => element.getBoundingClientRect());

    rects.forEach((rect, index) => {
      const item = itemRefs.current.get(index);
      if (!item) return;
      item.style.transform = `translate(${rect.left - layerRect.left}px, ${
        rect.top - layerRect.top
      }px)`;
      item.style.width = `${rect.width}px`;
      item.style.height = `${rect.height}px`;
    });
  }, [containerRef]);

  // Re-align after every render: a drag changes the block geometry, so the
  // overlay has to follow it exactly. This runs before the browser paints.
  useLayoutEffect(() => {
    syncOverlay();
  });

  // Keep the overlay aligned when the container itself changes size.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const observer = new ResizeObserver(() => syncOverlay());
    observer.observe(container);
    window.addEventListener('resize', syncOverlay);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', syncOverlay);
      document.body.classList.remove('is-arranging');
    };
  }, [containerRef, syncOverlay]);

  const beginDrag = (event: ReactPointerEvent<HTMLButtonElement>, index: number, kind: DragKind) => {
    // Only the primary mouse button starts a drag.
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    const container = containerRef.current;
    if (!container) return;
    const containerWidth = container.getBoundingClientRect().width;
    if (!containerWidth) return;

    const block = blocks[index];
    const startLayout: BlockLayout | undefined = block?.layout ? { ...block.layout } : undefined;

    // Keeps the browser from selecting text or scrolling while dragging.
    event.preventDefault();
    event.stopPropagation();

    dragRef.current = {
      index,
      kind,
      pointerId: event.pointerId,
      startX: event.clientX,
      containerWidth,
      startLayout,
    };
    setActiveIndex(index);

    const handle = event.currentTarget;
    handle.focus({ preventScroll: true });
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is best-effort — the drag still works without it.
    }
    document.body.classList.add('is-arranging');
  };

  const updateDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    event.preventDefault();
    const deltaPercent = ((event.clientX - drag.startX) / drag.containerWidth) * 100;
    const box =
      drag.kind === 'move'
        ? moveBox(drag.startLayout, deltaPercent)
        : resizeBox(drag.startLayout, deltaPercent);

    onLayoutChange(drag.index, box);
  };

  const endDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    dragRef.current = null;
    setActiveIndex(null);
    document.body.classList.remove('is-arranging');

    const handle = event.currentTarget;
    if (handle.hasPointerCapture(event.pointerId)) {
      handle.releasePointerCapture(event.pointerId);
    }
  };

  /**
   * Keyboard equivalent of the drag: the arrow keys nudge the block, so the
   * handles are usable without a pointer as well.
   */
  const handleKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    index: number,
    kind: DragKind,
  ) => {
    const step = event.shiftKey ? 5 : 1;
    let delta = 0;
    if (event.key === 'ArrowLeft') delta = -step;
    else if (event.key === 'ArrowRight') delta = step;
    else return;

    event.preventDefault();
    const layout = blocks[index]?.layout;
    const box = kind === 'move' ? moveBox(layout, delta) : resizeBox(layout, delta);
    onLayoutChange(index, box);
  };

  const activeBlock = activeIndex === null ? undefined : blocks[activeIndex];
  const activeWidth = paintedWidth(activeBlock?.layout);
  const activeOffset = activeBlock?.layout?.offsetX ?? 0;

  return (
    <div className="arrange-layer" ref={layerRef} data-arrange-layer="true">
      {blocks.map((_block, index) => (
        <div
          className={`arrange-item${activeIndex === index ? ' is-active' : ''}`}
          key={index}
          ref={(element) => {
            if (element) itemRefs.current.set(index, element);
            else itemRefs.current.delete(index);
          }}
        >
          <button
            type="button"
            className="arrange-handle arrange-handle-move"
            aria-label={`Move block ${index + 1} horizontally`}
            title="Drag left or right to move this block"
            onPointerDown={(event) => beginDrag(event, index, 'move')}
            onPointerMove={updateDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onLostPointerCapture={endDrag}
            onKeyDown={(event) => handleKeyDown(event, index, 'move')}
            onClick={(event) => event.preventDefault()}
          >
            <span aria-hidden="true">↔</span>
          </button>

          <button
            type="button"
            className="arrange-handle arrange-handle-resize"
            aria-label={`Resize block ${index + 1} width`}
            title="Drag left or right to resize this block"
            onPointerDown={(event) => beginDrag(event, index, 'resize')}
            onPointerMove={updateDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onLostPointerCapture={endDrag}
            onKeyDown={(event) => handleKeyDown(event, index, 'resize')}
            onClick={(event) => event.preventDefault()}
          >
            <span aria-hidden="true">⇥</span>
          </button>

          {activeIndex === index && (
            <span className="arrange-readout" role="status">
              {Math.round(activeWidth)}% wide · {formatOffset(activeOffset)}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

import type { ReactNode } from 'react';

interface ItemListEditorProps<T> {
  items: T[];
  onChange: (items: T[]) => void;
  makeItem: () => T;
  minItems?: number;
  maxItems?: number;
  addLabel?: string;
  renderItem: (item: T, index: number, update: (next: T) => void) => ReactNode;
  itemLabel: (index: number) => string;
  disabled?: boolean;
}

/**
 * Generic repeatable-item editor used by every list-based block (accordion,
 * cards, steps, checklist, references, gallery, timeline, stats, key facts…).
 *
 * Rows always expose ↑ / ↓ / Remove; the Add button appends a blank item.
 * Controls are disabled rather than hidden at the minimum/maximum so the limits
 * stay discoverable. Every operation produces a new array (never mutates).
 */
export function ItemListEditor<T>({
  items,
  onChange,
  makeItem,
  minItems = 0,
  maxItems,
  addLabel = 'Add item',
  renderItem,
  itemLabel,
  disabled = false,
}: ItemListEditorProps<T>) {
  const maximum = maxItems ?? Number.POSITIVE_INFINITY;
  const canAdd = !disabled && items.length < maximum;

  const add = () => {
    if (!canAdd) return;
    onChange([...items, makeItem()]);
  };

  const remove = (index: number) => {
    if (disabled || items.length <= minItems) return;
    onChange(items.filter((_, itemIndex) => itemIndex !== index));
  };

  const move = (index: number, direction: -1 | 1) => {
    if (disabled) return;
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    const next = items.slice();
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const updateAt = (index: number, nextItem: T) => {
    if (disabled) return;
    onChange(items.map((item, itemIndex) => (itemIndex === index ? nextItem : item)));
  };

  return (
    <div className="item-list-editor">
      {items.map((item, index) => (
        <div className="item-row" key={index}>
          <div className="item-row-head">
            <span className="item-row-label">{itemLabel(index)}</span>
            <div className="item-row-actions">
              <button
                type="button"
                className="icon-btn tiny"
                onClick={() => move(index, -1)}
                disabled={disabled || index === 0}
                aria-label={`Move ${itemLabel(index)} up`}
              >
                ↑
              </button>
              <button
                type="button"
                className="icon-btn tiny"
                onClick={() => move(index, 1)}
                disabled={disabled || index === items.length - 1}
                aria-label={`Move ${itemLabel(index)} down`}
              >
                ↓
              </button>
              <button
                type="button"
                className="icon-btn danger tiny"
                onClick={() => remove(index)}
                disabled={disabled || items.length <= minItems}
                aria-label={`Remove ${itemLabel(index)}`}
              >
                ✕
              </button>
            </div>
          </div>
          <div className="item-row-body">
            {renderItem(item, index, (nextItem) => updateAt(index, nextItem))}
          </div>
        </div>
      ))}

      <div className="item-add-row">
        <button type="button" className="btn small" onClick={add} disabled={!canAdd}>
          + {addLabel}
        </button>
        <span className="muted small">
          {items.length}
          {Number.isFinite(maximum) ? ` / ${maximum}` : ''} item
          {items.length === 1 ? '' : 's'}
        </span>
      </div>
    </div>
  );
}

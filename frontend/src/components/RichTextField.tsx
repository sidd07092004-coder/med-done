import { useId, useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import type { BlockLink, RichMark, RichSpan } from '../api/types';
import { RichText } from './RichText';

export interface RichTextValue {
  text: string;
  rich?: RichSpan[];
}

interface RichTextFieldProps {
  value: RichTextValue;
  onChange: (value: RichTextValue) => void;
  label?: string;
  maxLength?: number;
  disabled?: boolean;
  rows?: number;
  placeholder?: string;
}

const MARK_ORDER: RichMark[] = ['bold', 'italic', 'superscript', 'subscript'];

function normalizeMarks(marks?: RichMark[]): RichMark[] | undefined {
  if (!marks || marks.length === 0) return undefined;
  const present = new Set(marks);
  const ordered = MARK_ORDER.filter((mark) => present.has(mark));
  return ordered.length > 0 ? ordered : undefined;
}

function sameMarks(a?: RichMark[], b?: RichMark[]): boolean {
  const left = a ?? [];
  const right = b ?? [];
  return left.length === right.length && left.every((mark, index) => mark === right[index]);
}

function sameLink(a?: BlockLink, b?: BlockLink): boolean {
  if (!a || !b) return !a && !b;
  return a.href === b.href && (a.newTab === true) === (b.newTab === true);
}

/** Drop empty spans, canonicalise marks and merge adjacent identical styles. */
function cleanSpans(spans: RichSpan[]): RichSpan[] {
  const output: RichSpan[] = [];

  for (const span of spans) {
    if (typeof span.text !== 'string' || span.text.length === 0) continue;
    const marks = normalizeMarks(span.marks);
    const link =
      span.link && span.link.href
        ? {
            href: span.link.href,
            ...(span.link.newTab ? { newTab: true } : {}),
          }
        : undefined;

    const previous = output[output.length - 1];
    if (previous && sameMarks(previous.marks, marks) && sameLink(previous.link, link)) {
      previous.text += span.text;
    } else {
      output.push({
        text: span.text,
        ...(marks ? { marks } : {}),
        ...(link ? { link } : {}),
      });
    }
  }

  return output;
}

function spansFromValue(value: RichTextValue): RichSpan[] {
  if (value.rich && value.rich.length > 0) {
    return cleanSpans(value.rich.map((span) => ({ ...span })));
  }
  return [{ text: value.text }];
}

function spansLength(spans: RichSpan[]): number {
  return spans.reduce((total, span) => total + span.text.length, 0);
}

function splitAt(spans: RichSpan[], offset: number): [RichSpan[], RichSpan[]] {
  const left: RichSpan[] = [];
  const right: RichSpan[] = [];
  let position = 0;

  for (const span of spans) {
    const start = position;
    const end = position + span.text.length;
    position = end;

    if (end <= offset) {
      left.push(span);
      continue;
    }
    if (start >= offset) {
      right.push(span);
      continue;
    }

    const cut = offset - start;
    const before = span.text.slice(0, cut);
    const after = span.text.slice(cut);
    if (before) left.push({ ...span, text: before });
    if (after) right.push({ ...span, text: after });
  }

  return [left, right];
}

function splitRange(
  spans: RichSpan[],
  start: number,
  end: number,
): [RichSpan[], RichSpan[], RichSpan[]] {
  const length = spansLength(spans);
  const safeStart = Math.max(0, Math.min(start, length));
  const safeEnd = Math.max(safeStart, Math.min(end, length));
  const [left, rest] = splitAt(spans, safeStart);
  const [middle, right] = splitAt(rest, safeEnd - safeStart);
  return [left, middle, right];
}

function toggleMarkInSpans(
  spans: RichSpan[],
  start: number,
  end: number,
  mark: RichMark,
): RichSpan[] {
  const [left, middle, right] = splitRange(spans, start, end);
  if (middle.length === 0) return spans;

  const remove = middle.every((span) => span.marks?.includes(mark));
  const nextMiddle = middle.map((span) => {
    const marks = new Set(span.marks ?? []);
    if (remove) marks.delete(mark);
    else marks.add(mark);

    const ordered = MARK_ORDER.filter((candidate) => marks.has(candidate));
    const next: RichSpan = { ...span };
    if (ordered.length > 0) next.marks = ordered;
    else delete next.marks;
    return next;
  });

  return cleanSpans([...left, ...nextMiddle, ...right]);
}

function setLinkInSpans(
  spans: RichSpan[],
  start: number,
  end: number,
  link: BlockLink | undefined,
): RichSpan[] {
  const [left, middle, right] = splitRange(spans, start, end);
  if (middle.length === 0) return spans;

  const nextMiddle = middle.map((span) => {
    const next: RichSpan = { ...span };
    if (link && link.href) {
      next.link = {
        href: link.href,
        ...(link.newTab ? { newTab: true } : {}),
      };
    } else {
      delete next.link;
    }
    return next;
  });

  return cleanSpans([...left, ...nextMiddle, ...right]);
}

function sliceSpans(spans: RichSpan[], start: number, end: number): RichSpan[] {
  return splitRange(spans, start, end)[1];
}

/**
 * Rebuild the span tree after a plain-text edit. The diff is deliberately
 * simple (common prefix + common suffix), which covers typing, paste,
 * backspace and delete while keeping all surrounding formatting intact.
 */
function editSpans(spans: RichSpan[], previousText: string, nextText: string): RichSpan[] {
  const minimum = Math.min(previousText.length, nextText.length);
  let prefix = 0;
  while (prefix < minimum && previousText[prefix] === nextText[prefix]) prefix += 1;

  let previousEnd = previousText.length;
  let nextEnd = nextText.length;
  while (
    previousEnd > prefix &&
    nextEnd > prefix &&
    previousText[previousEnd - 1] === nextText[nextEnd - 1]
  ) {
    previousEnd -= 1;
    nextEnd -= 1;
  }

  const inserted = nextText.slice(prefix, nextEnd);
  const [left, middle, right] = splitRange(spans, prefix, previousEnd);
  const inherited = middle[0] ?? left[left.length - 1] ?? right[0];

  if (inserted.length === 0) return cleanSpans([...left, ...right]);

  const insertedSpan: RichSpan = {
    text: inserted,
    ...(inherited?.marks ? { marks: [...inherited.marks] } : {}),
    ...(inherited?.link
      ? { link: { ...inherited.link, ...(inherited.link.newTab ? { newTab: true } : {}) } }
      : {}),
  };

  return cleanSpans([...left, insertedSpan, ...right]);
}

export function RichTextField({
  value,
  onChange,
  label,
  maxLength,
  disabled = false,
  rows = 4,
  placeholder,
}: RichTextFieldProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dialogTitleId = useId();
  const [hint, setHint] = useState('');
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkHref, setLinkHref] = useState('');
  const [linkNewTab, setLinkNewTab] = useState(false);
  const [linkSelection, setLinkSelection] = useState<{ start: number; end: number } | null>(null);

  const spans = spansFromValue(value);
  const text = spans.map((span) => span.text).join('');

  const writeSpans = (nextSpans: RichSpan[]) => {
    const cleaned = cleanSpans(nextSpans);
    const derivedText = cleaned.map((span) => span.text).join('');
    const hasFormatting = cleaned.some(
      (span) => (span.marks?.length ?? 0) > 0 || Boolean(span.link?.href),
    );
    const next: RichTextValue = { text: derivedText };
    if (hasFormatting) next.rich = cleaned;
    onChange(next);
  };

  const restoreSelection = (start: number, end: number) => {
    requestAnimationFrame(() => {
      const element = textareaRef.current;
      if (!element) return;
      element.focus();
      element.setSelectionRange(start, end);
    });
  };

  const currentSelection = (): { start: number; end: number } | null => {
    const element = textareaRef.current;
    if (!element) return null;
    return { start: element.selectionStart, end: element.selectionEnd };
  };

  const handleTextChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const raw = event.target.value;
    const nextText = typeof maxLength === 'number' ? raw.slice(0, maxLength) : raw;
    const previousText = spans.map((span) => span.text).join('');
    setHint('');
    writeSpans(editSpans(spans, previousText, nextText));
  };

  const applyMark = (mark: RichMark) => {
    const selection = currentSelection();
    if (!selection) return;
    if (selection.start === selection.end) {
      setHint('Select some text first, then apply formatting.');
      return;
    }
    setHint('');
    writeSpans(toggleMarkInSpans(spans, selection.start, selection.end, mark));
    restoreSelection(selection.start, selection.end);
  };

  const openLink = () => {
    const selection = currentSelection();
    if (!selection) return;
    if (selection.start === selection.end) {
      setHint('Select some text first, then add a link.');
      return;
    }

    const existing = sliceSpans(spans, selection.start, selection.end).find(
      (span) => span.link?.href,
    )?.link;
    setHint('');
    setLinkSelection(selection);
    setLinkHref(existing?.href ?? '');
    setLinkNewTab(existing?.newTab === true);
    setLinkOpen(true);
  };

  const closeLink = () => {
    setLinkOpen(false);
    setLinkSelection(null);
    setLinkHref('');
    setLinkNewTab(false);
  };

  const confirmLink = () => {
    const href = linkHref.trim();
    if (!linkSelection || !href) return;
    const selection = linkSelection;
    writeSpans(setLinkInSpans(spans, selection.start, selection.end, { href, newTab: linkNewTab }));
    closeLink();
    restoreSelection(selection.start, selection.end);
  };

  const removeLink = () => {
    const selection = currentSelection();
    if (!selection) return;
    if (selection.start === selection.end) {
      setHint('Select linked text first, then remove the link.');
      return;
    }
    setHint('');
    writeSpans(setLinkInSpans(spans, selection.start, selection.end, undefined));
    restoreSelection(selection.start, selection.end);
  };

  const toolbarButton = (mark: RichMark, content: ReactNode, title: string) => (
    <button
      type="button"
      className="rich-tool"
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => applyMark(mark)}
      disabled={disabled}
      aria-label={title}
      title={title}
    >
      {content}
    </button>
  );

  return (
    <div className="field rich-text-field">
      {label && <span>{label}</span>}

      <div className="rich-toolbar" role="toolbar" aria-label={`${label ?? 'Text'} formatting`}>
        {toolbarButton('bold', <strong>B</strong>, 'Bold')}
        {toolbarButton('italic', <em>I</em>, 'Italic')}
        {toolbarButton('superscript', 'x²', 'Superscript')}
        {toolbarButton('subscript', 'x₂', 'Subscript')}
        <button
          type="button"
          className="rich-tool"
          onMouseDown={(event) => event.preventDefault()}
          onClick={openLink}
          disabled={disabled}
          aria-label="Add link"
          title="Add link"
        >
          Link…
        </button>
        <button
          type="button"
          className="rich-tool"
          onMouseDown={(event) => event.preventDefault()}
          onClick={removeLink}
          disabled={disabled}
          aria-label="Remove link"
          title="Remove link"
        >
          Remove link
        </button>
      </div>

      <textarea
        ref={textareaRef}
        className="rich-text-area"
        rows={rows}
        value={text}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={handleTextChange}
        disabled={disabled}
      />

      {hint && (
        <p className="field-hint field-hint-warn" role="status">
          {hint}
        </p>
      )}

      <div className="rich-text-preview">
        <span className="rich-text-preview-label">Preview</span>
        <div className="rich-text-preview-body">
          <RichText rich={value.rich} text={text} />
        </div>
      </div>

      {linkOpen && (
        <div className="modal-backdrop rich-link-backdrop" onClick={closeLink} role="presentation">
          <div
            className="modal rich-link-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby={dialogTitleId}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <h3 id={dialogTitleId}>Add link</h3>
              <button type="button" className="icon-btn" onClick={closeLink} aria-label="Close">
                ✕
              </button>
            </div>

            <label className="field">
              <span>Link URL</span>
              <input
                type="text"
                value={linkHref}
                onChange={(event) => setLinkHref(event.target.value)}
                placeholder="https://… or /path"
                autoFocus
              />
            </label>

            <label className="inline-field">
              <input
                type="checkbox"
                checked={linkNewTab}
                onChange={(event) => setLinkNewTab(event.target.checked)}
              />
              <span>Open in a new tab</span>
            </label>

            <p className="field-hint">
              Accepted: http(s), site-relative /path, mailto: and tel:. The server validates links on
              save.
            </p>

            <div className="modal-actions">
              <button type="button" className="btn" onClick={closeLink}>
                Cancel
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={confirmLink}
                disabled={!linkHref.trim()}
              >
                Apply link
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import type { DragEvent } from 'react';
import type {
  AccordionItem,
  Block,
  BlockAlign,
  BlockBorderStyle,
  BlockCategory,
  BlockLayout,
  BlockTable,
  BlockTextAlign,
  BlockType,
  ButtonSize,
  ButtonVariant,
  CalloutBlock,
  CalloutShape,
  CalloutVariant,
  CardItem,
  ChecklistItem,
  ColumnsBlock,
  DownloadFileType,
  EmbedProvider,
  GalleryImage,
  HeadingLevel,
  HeroCta,
  ImageBlock,
  KeyFactItem,
  KnownBlock,
  ListBlock,
  ReferenceItem,
  RichSpan,
  StatItem,
  StepItem,
  TableBlock,
  TimelineItem,
  UnknownBlock,
} from '../api/types';
import { BLOCK_META, blockMeta, isKnownBlock, makeDefaultBlock } from '../api/types';
import { CALLOUT_SHAPES, calloutLabel, tableColumnCount } from '../lib/blockDesign';
import { formatBytes } from '../lib/format';
import { ItemListEditor } from '../components/ItemListEditor';
import { LinkField } from '../components/LinkField';
import { MediaField } from '../components/MediaField';
import { RichText } from '../components/RichText';
import { RichTextField } from '../components/RichTextField';
import type { RichTextValue } from '../components/RichTextField';

// ---------------------------------------------------------------------------
// Block factories / catalogue
// ---------------------------------------------------------------------------

/** Kept for callers that used the old local factory; delegates to BLOCK_META. */
export function makeBlock(type: BlockType): KnownBlock {
  return makeDefaultBlock(type);
}

const CATEGORY_ORDER: BlockCategory[] = [
  'text',
  'media',
  'layout',
  'data',
  'navigation',
  'trust',
];

const CATEGORY_LABELS: Record<BlockCategory, string> = {
  text: 'Text',
  media: 'Media',
  layout: 'Layout',
  data: 'Data',
  navigation: 'Navigation',
  trust: 'Trust & evidence',
};

const ICON_GLYPHS: Record<string, string> = {
  type: 'T',
  'align-left': '¶',
  list: '•',
  quote: '❝',
  'alert-circle': '!',
  image: '▧',
  minus: '—',
  table: '▦',
  'mouse-pointer': '➤',
  'layout-hero': '▣',
  'chevron-down': '⌄',
  grid: '▦',
  'list-ordered': '1.',
  'check-square': '☑',
  download: '↓',
  'list-tree': '☰',
  'book-open': '▤',
  video: '▶',
  columns: '❙❙',
  images: '▧',
  clock: '◷',
  'bar-chart': '▥',
  info: 'i',
  headphones: '♪',
  'message-quote': '❞',
  'map-pin': '◉',
  code: '</>',
};

function iconGlyph(icon: string): string {
  return ICON_GLYPHS[icon] ?? '•';
}

function blockTitle(block: Block): string {
  return blockMeta(block.type)?.label ?? block.type;
}

const CALLOUT_VARIANTS = ['info', 'warn', 'ok', 'bad'] as const;

function shapeLabel(shape: CalloutShape): string {
  switch (shape) {
    case 'rectangle':
      return 'Rectangle (full width)';
    case 'rounded':
      return 'Rounded rectangle (full width)';
    case 'square':
      return 'Square corners (full width)';
    case 'oval':
      return 'Oval (fits content)';
    case 'circle':
      return 'Circle (fixed square)';
    default:
      return shape;
  }
}

// ---------------------------------------------------------------------------
// Optional-value helpers
// ---------------------------------------------------------------------------

/**
 * Apply a patch while deleting empty optional keys. `0` and `false` are real
 * values and are preserved; only undefined, null and the empty string vanish.
 */
function withOptional<T extends object>(block: T, patch: Partial<T>): T {
  const next: Record<string, unknown> = { ...(block as Record<string, unknown>) };
  for (const key of Object.keys(patch) as Array<keyof T>) {
    const value = patch[key];
    if (value === undefined || value === null || value === '') {
      delete next[key as string];
    } else {
      next[key as string] = value;
    }
  }
  return next as T;
}

function toOptionalNumber(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function setRichText<T extends { text: string; rich?: RichSpan[] }>(
  block: T,
  value: RichTextValue,
): T {
  const next: Record<string, unknown> = {
    ...(block as Record<string, unknown>),
    text: value.text,
  };
  if (value.rich && value.rich.length > 0) next.rich = value.rich;
  else delete next.rich;
  return next as T;
}

function setAccordionAnswer(item: AccordionItem, value: RichTextValue): AccordionItem {
  const next: AccordionItem = { ...item, answer: value.text };
  if (value.rich && value.rich.length > 0) return { ...next, rich: value.rich };
  delete next.rich;
  return next;
}

interface RichListItem {
  text: string;
  rich?: RichSpan[];
}

function listEditorItems(block: ListBlock): RichListItem[] {
  return block.items.map((text, index) => {
    const rich = block.richItems?.[index];
    return rich && rich.length > 0 ? { text, rich } : { text };
  });
}

function listFromEditorItems(block: ListBlock, items: RichListItem[]): ListBlock {
  const plain = items.map((item) => item.text);
  const richItems = items.map((item) => item.rich ?? []);
  const next: ListBlock = { ...block, items: plain };
  if (richItems.some((spans) => spans.length > 0)) next.richItems = richItems;
  else delete next.richItems;
  return next;
}

function richListItem(value: RichTextValue): RichListItem {
  const item: RichListItem = { text: value.text };
  if (value.rich && value.rich.length > 0) item.rich = value.rich;
  return item;
}

function downloadTypeFromUrl(src: string): DownloadFileType {
  const clean = src.split('?')[0]?.split('#')[0] ?? '';
  const dot = clean.lastIndexOf('.');
  const extension = dot >= 0 ? clean.slice(dot + 1).toLowerCase() : '';
  if (extension === 'pdf') return 'pdf';
  if (extension === 'doc' || extension === 'docx') return 'docx';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif'].includes(extension)) return 'image';
  return 'other';
}

const EMBED_HINTS: Record<EmbedProvider, string> = {
  youtube: 'https://www.youtube.com/embed/VIDEO_ID or https://www.youtube-nocookie.com/embed/VIDEO_ID',
  vimeo: 'https://player.vimeo.com/video/123456789',
  spotify: 'https://open.spotify.com/embed/track/…, /album/…, /playlist/…, /episode/… or /show/…',
  google_maps: 'https://www.google.com/maps/embed?pb=…',
};

// ---------------------------------------------------------------------------
// Layout helpers
//
// Every design key is optional. Clearing a control removes the key entirely so
// that a legacy block (which has no `layout` at all) round-trips byte-identical.
// ---------------------------------------------------------------------------

function pruneLayout(layout: BlockLayout): BlockLayout {
  const out: BlockLayout = {};
  if (layout.textAlign !== undefined) out.textAlign = layout.textAlign;
  if (layout.width !== undefined) out.width = layout.width;
  if (layout.offsetX !== undefined) out.offsetX = layout.offsetX;
  if (layout.marginTop !== undefined) out.marginTop = layout.marginTop;
  if (layout.marginBottom !== undefined) out.marginBottom = layout.marginBottom;
  if (layout.backgroundColor !== undefined) out.backgroundColor = layout.backgroundColor;
  if (layout.borderColor !== undefined) out.borderColor = layout.borderColor;
  if (layout.borderWidth !== undefined) out.borderWidth = layout.borderWidth;
  if (layout.borderStyle !== undefined) out.borderStyle = layout.borderStyle;
  if (layout.borderRadius !== undefined) out.borderRadius = layout.borderRadius;
  if (layout.padding !== undefined) out.padding = layout.padding;
  return out;
}

function applyLayout(block: KnownBlock, patch: Partial<BlockLayout>): KnownBlock {
  const merged = pruneLayout({ ...(block.layout ?? {}), ...patch });
  if (Object.keys(merged).length === 0) {
    const stripped: KnownBlock & { layout?: BlockLayout } = { ...block };
    delete stripped.layout;
    return stripped;
  }
  return { ...block, layout: merged };
}

type CalloutDesignKeys = Pick<
  CalloutBlock,
  'label' | 'backgroundColor' | 'textColor' | 'borderColor' | 'shape'
>;

function applyCallout(block: CalloutBlock, patch: Partial<CalloutDesignKeys>): CalloutBlock {
  const next: CalloutBlock = { ...block, ...patch };
  if (next.label === undefined || next.label.trim() === '') delete next.label;
  if (next.backgroundColor === undefined) delete next.backgroundColor;
  if (next.textColor === undefined) delete next.textColor;
  if (next.borderColor === undefined) delete next.borderColor;
  if (next.shape === undefined) delete next.shape;
  return next;
}

type ImageDesignKeys = Pick<ImageBlock, 'width' | 'height' | 'align' | 'fit' | 'radius'>;

function applyImage(block: ImageBlock, patch: Partial<ImageDesignKeys>): ImageBlock {
  const next: ImageBlock = { ...block, ...patch };
  if (next.width === undefined) delete next.width;
  if (next.height === undefined) delete next.height;
  if (next.align === undefined) delete next.align;
  if (next.fit === undefined) delete next.fit;
  if (next.radius === undefined) delete next.radius;
  return next;
}

function pruneTable(table: BlockTable): BlockTable {
  const out: BlockTable = { rows: table.rows };
  if (table.header !== undefined) out.header = table.header;
  if (table.align !== undefined) out.align = table.align;
  if (table.headerBackgroundColor !== undefined) {
    out.headerBackgroundColor = table.headerBackgroundColor;
  }
  if (table.headerTextColor !== undefined) out.headerTextColor = table.headerTextColor;
  if (table.bordered !== undefined) out.bordered = table.bordered;
  if (table.striped !== undefined) out.striped = table.striped;
  return out;
}

function padRow(row: string[], width: number): string[] {
  const out = row.slice(0, Math.max(0, width));
  while (out.length < width) out.push('');
  return out;
}

function alignFor(table: BlockTable, columns: number): BlockAlign[] {
  const align = table.align ?? [];
  const out: BlockAlign[] = [];
  for (let i = 0; i < columns; i += 1) out.push(align[i] ?? 'left');
  return out;
}

// ---------------------------------------------------------------------------
// Reusable field controls
// ---------------------------------------------------------------------------

interface SelectOption<T extends string> {
  value: T;
  label: string;
}

interface SelectFieldProps<T extends string> {
  label: string;
  value: T | '';
  options: readonly SelectOption<T>[];
  onChange: (value: T | '') => void;
  disabled?: boolean;
  allowDefault?: boolean;
  defaultLabel?: string;
}

function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
  allowDefault = true,
  defaultLabel = '— default —',
}: SelectFieldProps<T>) {
  return (
    <label className="field">
      <span>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as T | '')}
        disabled={disabled}
      >
        {allowDefault && <option value="">{defaultLabel}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

interface NumberFieldProps {
  label: string;
  value?: number;
  onChange: (value: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  disabled?: boolean;
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  placeholder,
  disabled = false,
}: NumberFieldProps) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        value={value ?? ''}
        min={min}
        max={max}
        step={step}
        placeholder={placeholder}
        onChange={(event) => onChange(toOptionalNumber(event.target.value))}
        disabled={disabled}
      />
    </label>
  );
}

const ALIGN_OPTIONS: readonly SelectOption<BlockAlign>[] = [
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Center' },
  { value: 'right', label: 'Right' },
];

const BUTTON_VARIANT_OPTIONS: readonly SelectOption<ButtonVariant>[] = [
  { value: 'primary', label: 'Primary' },
  { value: 'secondary', label: 'Secondary' },
  { value: 'ghost', label: 'Ghost' },
];

const BUTTON_SIZE_OPTIONS: readonly SelectOption<ButtonSize>[] = [
  { value: 'sm', label: 'Small' },
  { value: 'md', label: 'Medium' },
  { value: 'lg', label: 'Large' },
];

const HERO_HEIGHT_OPTIONS: readonly SelectOption<'sm' | 'md' | 'lg'>[] = [
  { value: 'sm', label: 'Small' },
  { value: 'md', label: 'Medium' },
  { value: 'lg', label: 'Large' },
];

const HERO_ALIGN_OPTIONS: readonly SelectOption<'left' | 'center'>[] = [
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Center' },
];

const ACCORDION_OPEN_OPTIONS: readonly SelectOption<'none' | 'first' | 'all'>[] = [
  { value: 'none', label: 'None' },
  { value: 'first', label: 'First item' },
  { value: 'all', label: 'All items' },
];

const CARDS_VARIANT_OPTIONS: readonly SelectOption<'image-top' | 'compact'>[] = [
  { value: 'image-top', label: 'Image on top' },
  { value: 'compact', label: 'Compact' },
];

const STEPS_STYLE_OPTIONS: readonly SelectOption<'numbered' | 'plain'>[] = [
  { value: 'numbered', label: 'Numbered' },
  { value: 'plain', label: 'Plain' },
];

const CHECKLIST_STYLE_OPTIONS: readonly SelectOption<'check' | 'number'>[] = [
  { value: 'check', label: 'Check marks' },
  { value: 'number', label: 'Numbered' },
];

const GALLERY_DISPLAY_OPTIONS: readonly SelectOption<'grid' | 'carousel'>[] = [
  { value: 'grid', label: 'Grid' },
  { value: 'carousel', label: 'Carousel' },
];

const GALLERY_ASPECT_OPTIONS: readonly SelectOption<'square' | '4:3' | '16:9' | 'natural'>[] = [
  { value: 'square', label: 'Square' },
  { value: '4:3', label: '4 : 3' },
  { value: '16:9', label: '16 : 9' },
  { value: 'natural', label: 'Natural' },
];

const TIMELINE_STYLE_OPTIONS: readonly SelectOption<'line' | 'cards'>[] = [
  { value: 'line', label: 'Line' },
  { value: 'cards', label: 'Cards' },
];

const STATS_VARIANT_OPTIONS: readonly SelectOption<'cards' | 'inline'>[] = [
  { value: 'cards', label: 'Cards' },
  { value: 'inline', label: 'Inline' },
];

const EMBED_PROVIDER_OPTIONS: readonly SelectOption<EmbedProvider>[] = [
  { value: 'youtube', label: 'YouTube' },
  { value: 'vimeo', label: 'Vimeo' },
  { value: 'spotify', label: 'Spotify' },
  { value: 'google_maps', label: 'Google Maps' },
];

const COLUMNS_RATIO_OPTIONS: readonly SelectOption<'equal' | 'wide-left' | 'wide-right'>[] = [
  { value: 'equal', label: 'Equal' },
  { value: 'wide-left', label: 'Wide left' },
  { value: 'wide-right', label: 'Wide right' },
];

const COLUMNS_STACK_OPTIONS: readonly SelectOption<'mobile' | 'tablet'>[] = [
  { value: 'mobile', label: 'Stack on mobile' },
  { value: 'tablet', label: 'Stack on tablet' },
];

// ---------------------------------------------------------------------------
// Colour control
// ---------------------------------------------------------------------------

interface ColorControlProps {
  label: string;
  value?: string;
  onChange: (value: string | undefined) => void;
  disabled?: boolean;
}

function ColorControl({ label, value, onChange, disabled = false }: ColorControlProps) {
  const [draft, setDraft] = useState(value ?? '');
  const valid = /^#[0-9a-fA-F]{6}$/.test(value ?? '');

  // Keep the text field in sync when the value changes elsewhere (e.g. picker).
  useEffect(() => {
    setDraft(value ?? '');
  }, [value]);

  return (
    <label className="field">
      <span>{label}</span>
      <div className="callout-color-control">
        <input
          type="color"
          value={valid ? (value as string) : '#ffffff'}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          aria-label={`${label} picker`}
        />
        <input
          type="text"
          value={draft}
          maxLength={7}
          placeholder="#rrggbb"
          onChange={(e) => {
            const raw = e.target.value;
            setDraft(raw);
            const next = raw.trim();
            if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(next)) onChange(next.toLowerCase());
          }}
          disabled={disabled}
        />
        <button
          type="button"
          className="btn small"
          onClick={() => onChange(undefined)}
          disabled={disabled}
        >
          Clear
        </button>
      </div>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Design panel (per-block layout controls)
// ---------------------------------------------------------------------------

interface BlockDesignPanelProps {
  block: KnownBlock;
  disabled: boolean;
  onChange: (next: KnownBlock) => void;
}

function BlockDesignPanel({ block, disabled, onChange }: BlockDesignPanelProps) {
  const [open, setOpen] = useState(false);
  const layout = block.layout ?? {};
  const update = (patch: Partial<BlockLayout>) => onChange(applyLayout(block, patch));

  return (
    <div className="block-design">
      <button
        type="button"
        className="btn small"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-expanded={open}
      >
        {open ? 'Hide design' : 'Design'}
      </button>

      {open && (
        <div className="block-design-panel">
          <p className="muted small">
            Layout applies to this block only. Leave a field empty to keep the theme default.
          </p>

          <div className="pv-block-design-grid">
            <label className="field">
              <span>Text align</span>
              <select
                value={layout.textAlign ?? ''}
                onChange={(e) =>
                  update({
                    textAlign:
                      e.target.value === '' ? undefined : (e.target.value as BlockTextAlign),
                  })
                }
                disabled={disabled}
              >
                <option value="">— default —</option>
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
                <option value="justify">Justify</option>
              </select>
            </label>

            <label className="field">
              <span>Width (%)</span>
              <div className="design-range-row">
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={layout.width ?? 100}
                  onChange={(e) => update({ width: Number(e.target.value) })}
                  disabled={disabled}
                  aria-label="Block width percent"
                />
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={layout.width ?? ''}
                  placeholder="auto"
                  onChange={(e) =>
                    update({ width: e.target.value === '' ? undefined : Number(e.target.value) })
                  }
                  disabled={disabled}
                  aria-label="Block width percent value"
                />
              </div>
            </label>

            <label className="field">
              <span>Offset X (%)</span>
              <div className="design-range-row">
                <input
                  type="range"
                  min={-100}
                  max={100}
                  step={1}
                  value={layout.offsetX ?? 0}
                  onChange={(e) => update({ offsetX: Number(e.target.value) })}
                  disabled={disabled}
                  aria-label="Block horizontal offset percent"
                />
                <input
                  type="number"
                  min={-100}
                  max={100}
                  value={layout.offsetX ?? ''}
                  placeholder="0"
                  onChange={(e) =>
                    update({ offsetX: e.target.value === '' ? undefined : Number(e.target.value) })
                  }
                  disabled={disabled}
                  aria-label="Block horizontal offset percent value"
                />
              </div>
            </label>

            <label className="field">
              <span>Margin top (px)</span>
              <input
                type="number"
                min={0}
                max={200}
                value={layout.marginTop ?? ''}
                placeholder="auto"
                onChange={(e) =>
                  update({ marginTop: e.target.value === '' ? undefined : Number(e.target.value) })
                }
                disabled={disabled}
              />
            </label>

            <label className="field">
              <span>Margin bottom (px)</span>
              <input
                type="number"
                min={0}
                max={200}
                value={layout.marginBottom ?? ''}
                placeholder="auto"
                onChange={(e) =>
                  update({
                    marginBottom: e.target.value === '' ? undefined : Number(e.target.value),
                  })
                }
                disabled={disabled}
              />
            </label>

            <label className="field">
              <span>Border width (px)</span>
              <input
                type="number"
                min={0}
                max={8}
                value={layout.borderWidth ?? ''}
                placeholder="auto"
                onChange={(e) =>
                  update({
                    borderWidth: e.target.value === '' ? undefined : Number(e.target.value),
                  })
                }
                disabled={disabled}
              />
            </label>

            <label className="field">
              <span>Border style</span>
              <select
                value={layout.borderStyle ?? ''}
                onChange={(e) =>
                  update({
                    borderStyle:
                      e.target.value === '' ? undefined : (e.target.value as BlockBorderStyle),
                  })
                }
                disabled={disabled}
              >
                <option value="">— default —</option>
                <option value="none">None</option>
                <option value="solid">Solid</option>
                <option value="dashed">Dashed</option>
                <option value="dotted">Dotted</option>
              </select>
            </label>

            <label className="field">
              <span>Border radius (px)</span>
              <input
                type="number"
                min={0}
                max={64}
                value={layout.borderRadius ?? ''}
                placeholder="auto"
                onChange={(e) =>
                  update({
                    borderRadius: e.target.value === '' ? undefined : Number(e.target.value),
                  })
                }
                disabled={disabled}
              />
            </label>

            <label className="field">
              <span>Padding (px)</span>
              <input
                type="number"
                min={0}
                max={64}
                value={layout.padding ?? ''}
                placeholder="auto"
                onChange={(e) =>
                  update({ padding: e.target.value === '' ? undefined : Number(e.target.value) })
                }
                disabled={disabled}
              />
            </label>
          </div>

          <div className="callout-color-row">
            <ColorControl
              label="Background color"
              value={layout.backgroundColor}
              onChange={(v) => update({ backgroundColor: v })}
              disabled={disabled}
            />
            <ColorControl
              label="Border color"
              value={layout.borderColor}
              onChange={(v) => update({ borderColor: v })}
              disabled={disabled}
            />
          </div>

          {block.type === 'image' && (
            <>
              <h4 className="design-section-title">Image</h4>
              <div className="pv-block-design-grid">
                <label className="field">
                  <span>Image width (%)</span>
                  <div className="design-range-row">
                    <input
                      type="range"
                      min={1}
                      max={100}
                      step={1}
                      value={block.width ?? 100}
                      onChange={(e) =>
                        onChange(applyImage(block, { width: Number(e.target.value) }))
                      }
                      disabled={disabled}
                      aria-label="Image width percent"
                    />
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={block.width ?? ''}
                      placeholder="100"
                      onChange={(e) =>
                        onChange(
                          applyImage(block, {
                            width: e.target.value === '' ? undefined : Number(e.target.value),
                          }),
                        )
                      }
                      disabled={disabled}
                      aria-label="Image width percent value"
                    />
                  </div>
                </label>

                <label className="field">
                  <span>Image height (px)</span>
                  <input
                    type="number"
                    min={1}
                    max={4000}
                    value={block.height ?? ''}
                    placeholder="Auto"
                    onChange={(e) =>
                      onChange(
                        applyImage(block, {
                          height: e.target.value === '' ? undefined : Number(e.target.value),
                        }),
                      )
                    }
                    disabled={disabled}
                  />
                </label>

                <label className="field">
                  <span>Image align</span>
                  <select
                    value={block.align ?? ''}
                    onChange={(e) =>
                      onChange(
                        applyImage(block, {
                          align: e.target.value === '' ? undefined : (e.target.value as BlockAlign),
                        }),
                      )
                    }
                    disabled={disabled}
                  >
                    <option value="">— default —</option>
                    <option value="left">Left</option>
                    <option value="center">Center</option>
                    <option value="right">Right</option>
                  </select>
                </label>

                <label className="field">
                  <span>Image fit</span>
                  <select
                    value={block.fit ?? ''}
                    onChange={(e) =>
                      onChange(
                        applyImage(block, {
                          fit:
                            e.target.value === ''
                              ? undefined
                              : (e.target.value as ImageBlock['fit']),
                        }),
                      )
                    }
                    disabled={disabled}
                  >
                    <option value="">— default —</option>
                    <option value="cover">Cover</option>
                    <option value="contain">Contain</option>
                    <option value="fill">Fill</option>
                  </select>
                </label>

                <label className="field">
                  <span>Image radius (px)</span>
                  <input
                    type="number"
                    min={0}
                    max={64}
                    value={block.radius ?? ''}
                    placeholder="auto"
                    onChange={(e) =>
                      onChange(
                        applyImage(block, {
                          radius: e.target.value === '' ? undefined : Number(e.target.value),
                        }),
                      )
                    }
                    disabled={disabled}
                  />
                </label>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table editor
// ---------------------------------------------------------------------------

interface TableEditorProps {
  block: TableBlock;
  disabled: boolean;
  onChange: (next: TableBlock) => void;
}

const MAX_TABLE_COLUMNS = 50;
const MAX_TABLE_ROWS = 200;
const MAX_CELL_LENGTH = 2000;

function TableEditor({ block, disabled, onChange }: TableEditorProps) {
  const table = block.table;
  const rows = table.rows ?? [];
  const header = table.header ?? [];
  const columns = tableColumnCount(table);
  const aligns = alignFor(table, columns);

  const commit = (nextTable: BlockTable) => {
    const pruned = pruneTable(nextTable);
    const nextColumns = tableColumnCount(pruned);
    if (pruned.align !== undefined) pruned.align = alignFor(pruned, nextColumns);
    onChange({ ...block, table: pruned });
  };

  const setCell = (rowIndex: number, columnIndex: number, value: string) => {
    const nextRows = rows.map((row, r) => {
      if (r !== rowIndex) return row;
      const next = [...row];
      while (next.length <= columnIndex) next.push('');
      next[columnIndex] = value;
      return next;
    });
    commit({ ...table, rows: nextRows });
  };

  const setHeaderCell = (columnIndex: number, value: string) => {
    const nextHeader = [...header];
    while (nextHeader.length <= columnIndex) nextHeader.push('');
    nextHeader[columnIndex] = value;
    commit({ ...table, header: nextHeader });
  };

  const toggleHeader = (on: boolean) => {
    if (!on) {
      const next: BlockTable = { ...table };
      delete next.header;
      commit(next);
      return;
    }
    const hasData = rows.some((row) => row.some((cell) => cell.trim() !== ''));
    const width = Math.max(columns, 1);
    commit({
      ...table,
      header: Array.from({ length: width }, (_, i) => (hasData ? '' : `Column ${i + 1}`)),
    });
  };

  const addColumn = () => {
    if (columns >= MAX_TABLE_COLUMNS) return;
    const width = columns + 1;
    const nextRows =
      rows.length > 0
        ? rows.map((row) => padRow(row, width))
        : [Array.from({ length: width }, () => '')];
    const next: BlockTable = { ...table, rows: nextRows };
    if (table.header !== undefined) next.header = padRow(table.header, width);
    commit(next);
  };

  const removeColumn = () => {
    if (columns <= 0) return;
    const width = columns - 1;
    const next: BlockTable = { ...table, rows: rows.map((row) => padRow(row, width)) };
    if (table.header !== undefined) next.header = padRow(table.header, width);
    commit(next);
  };

  const addRow = () => {
    if (rows.length >= MAX_TABLE_ROWS) return;
    const width = Math.max(columns, 1);
    commit({ ...table, rows: [...rows, Array.from({ length: width }, () => '')] });
  };

  const removeRow = (rowIndex: number) => {
    commit({ ...table, rows: rows.filter((_, r) => r !== rowIndex) });
  };

  const setColumnAlign = (columnIndex: number, value: BlockAlign) => {
    const next = aligns.slice();
    next[columnIndex] = value;
    commit({ ...table, align: next });
  };

  return (
    <div className="block-fields">
      <div className="table-editor-toolbar">
        <label className="inline-field">
          <input
            type="checkbox"
            checked={table.header !== undefined}
            onChange={(e) => toggleHeader(e.target.checked)}
            disabled={disabled}
          />
          <span>Header row</span>
        </label>
        <label className="inline-field">
          <input
            type="checkbox"
            checked={table.bordered !== false}
            onChange={(e) => commit({ ...table, bordered: e.target.checked })}
            disabled={disabled}
          />
          <span>Bordered</span>
        </label>
        <label className="inline-field">
          <input
            type="checkbox"
            checked={table.striped === true}
            onChange={(e) => commit({ ...table, striped: e.target.checked })}
            disabled={disabled}
          />
          <span>Striped rows</span>
        </label>
        <button type="button" className="btn small" onClick={addColumn} disabled={disabled}>
          + Column
        </button>
        <button
          type="button"
          className="btn small"
          onClick={removeColumn}
          disabled={disabled || columns === 0}
        >
          − Column
        </button>
        <button
          type="button"
          className="btn small"
          onClick={addRow}
          disabled={disabled || rows.length >= MAX_TABLE_ROWS}
        >
          + Row
        </button>
      </div>

      <div className="pv-table-editor">
        <table>
          <thead>
            <tr>
              {Array.from({ length: columns }, (_, c) => (
                <th key={c}>
                  {table.header !== undefined ? (
                    <input
                      type="text"
                      value={header[c] ?? ''}
                      maxLength={MAX_CELL_LENGTH}
                      onChange={(e) => setHeaderCell(c, e.target.value)}
                      disabled={disabled}
                      aria-label={`Header cell ${c + 1}`}
                    />
                  ) : (
                    <span className="muted small">Column {c + 1}</span>
                  )}
                  <select
                    value={aligns[c] ?? 'left'}
                    onChange={(e) => setColumnAlign(c, e.target.value as BlockAlign)}
                    disabled={disabled}
                    aria-label={`Align column ${c + 1}`}
                  >
                    <option value="left">Left</option>
                    <option value="center">Center</option>
                    <option value="right">Right</option>
                  </select>
                </th>
              ))}
              {columns === 0 && (
                <th>
                  <span className="muted small">No columns yet</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>
                {Array.from({ length: columns }, (_, c) => (
                  <td key={c}>
                    <input
                      type="text"
                      value={row[c] ?? ''}
                      maxLength={MAX_CELL_LENGTH}
                      onChange={(e) => setCell(r, c, e.target.value)}
                      disabled={disabled}
                      aria-label={`Row ${r + 1} column ${c + 1}`}
                    />
                  </td>
                ))}
                <td>
                  <button
                    type="button"
                    className="icon-btn danger tiny"
                    onClick={() => removeRow(r)}
                    disabled={disabled}
                    aria-label={`Remove row ${r + 1}`}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={Math.max(columns, 1)}>
                  <span className="muted small">No rows yet — use “+ Row”.</span>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="callout-color-row">
        <ColorControl
          label="Header background color"
          value={table.headerBackgroundColor}
          onChange={(v) => commit({ ...table, headerBackgroundColor: v })}
          disabled={disabled}
        />
        <ColorControl
          label="Header text color"
          value={table.headerTextColor}
          onChange={(v) => commit({ ...table, headerTextColor: v })}
          disabled={disabled}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CTA group (hero)
// ---------------------------------------------------------------------------

interface CtaGroupProps {
  legend: string;
  cta?: HeroCta;
  disabled: boolean;
  onChange: (cta: HeroCta | undefined) => void;
}

function CtaGroup({ legend, cta, disabled, onChange }: CtaGroupProps) {
  const value: HeroCta = cta ?? { label: '', href: '' };

  const update = (patch: Partial<HeroCta>) => {
    const next: HeroCta = { ...value, ...patch };
    if (next.label.trim() === '' && next.href.trim() === '') {
      onChange(undefined);
      return;
    }
    onChange(next);
  };

  return (
    <fieldset className="cta-group">
      <legend>{legend}</legend>
      <label className="field">
        <span>Label</span>
        <input
          type="text"
          value={value.label}
          maxLength={80}
          onChange={(event) => update({ label: event.target.value })}
          disabled={disabled}
        />
      </label>
      <LinkField
        label="URL"
        value={value.href}
        onChange={(href) => update({ href })}
        newTab={value.newTab ?? false}
        onNewTabChange={(newTab) => update({ newTab })}
        disabled={disabled}
      />
      <p className="field-hint">Both a label and a valid link are required to publish this CTA.</p>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Columns editor (recursive)
// ---------------------------------------------------------------------------

interface ColumnsEditorProps {
  block: ColumnsBlock;
  disabled: boolean;
  onChange: (next: KnownBlock) => void;
}

const MAX_COLUMNS = 3;
const MIN_COLUMNS = 2;
const MAX_COLUMN_BLOCKS = 20;
const MAX_NESTED_BLOCKS = 60;

function ColumnsEditor({ block, disabled, onChange }: ColumnsEditorProps) {
  const columns = block.columns;
  const total = columns.reduce((sum, column) => sum + column.length, 0);

  const addColumn = () => {
    if (disabled || columns.length >= MAX_COLUMNS) return;
    onChange({ ...block, columns: [...columns, []] });
  };

  const removeColumn = (index: number) => {
    if (disabled || columns.length <= MIN_COLUMNS) return;
    onChange({ ...block, columns: columns.filter((_, columnIndex) => columnIndex !== index) });
  };

  const updateColumn = (index: number, nextColumn: Block[]) => {
    if (disabled || nextColumn.length > MAX_COLUMN_BLOCKS) return;
    const otherTotal = columns.reduce(
      (sum, column, columnIndex) =>
        sum + (columnIndex === index ? 0 : column.length),
      0,
    );
    if (otherTotal + nextColumn.length > MAX_NESTED_BLOCKS) return;
    onChange({
      ...block,
      columns: columns.map((column, columnIndex) =>
        columnIndex === index ? nextColumn : column,
      ),
    });
  };

  const maxForColumn = (index: number) => {
    const otherTotal = columns.reduce(
      (sum, column, columnIndex) =>
        sum + (columnIndex === index ? 0 : column.length),
      0,
    );
    const current = columns[index]?.length ?? 0;
    return Math.min(MAX_COLUMN_BLOCKS, Math.max(current, MAX_NESTED_BLOCKS - otherTotal));
  };

  const gridClasses = [
    'columns-grid',
    `columns-grid--${columns.length}`,
    block.ratio && block.ratio !== 'equal' ? `columns-grid--${block.ratio}` : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="columns-editor">
      <div className="columns-toolbar">
        <span className="columns-toolbar-label">
          {columns.length} columns · {total} / {MAX_NESTED_BLOCKS} nested blocks
        </span>
        <button
          type="button"
          className="btn small"
          onClick={addColumn}
          disabled={disabled || columns.length >= MAX_COLUMNS}
        >
          + Column
        </button>
        <button
          type="button"
          className="btn small"
          onClick={() => removeColumn(columns.length - 1)}
          disabled={disabled || columns.length <= MIN_COLUMNS}
        >
          − Column
        </button>
      </div>

      <div className="form-grid">
        <SelectField
          label="Ratio"
          value={block.ratio ?? ''}
          options={COLUMNS_RATIO_OPTIONS}
          onChange={(value) =>
            onChange(withOptional(block, { ratio: value === '' ? undefined : value }))
          }
          disabled={disabled}
        />
        <NumberField
          label="Gap (px)"
          value={block.gap}
          min={0}
          max={64}
          step={1}
          onChange={(gap) => onChange(withOptional(block, { gap }))}
          disabled={disabled}
        />
        <SelectField
          label="Stack at"
          value={block.stackAt ?? ''}
          options={COLUMNS_STACK_OPTIONS}
          onChange={(value) =>
            onChange(withOptional(block, { stackAt: value === '' ? undefined : value }))
          }
          disabled={disabled}
        />
      </div>

      <div className={gridClasses}>
        {columns.map((column, index) => (
          <div className="column-editor" key={index}>
            <div className="column-editor-head">
              <strong>Column {index + 1}</strong>
              <button
                type="button"
                className="icon-btn danger tiny"
                onClick={() => removeColumn(index)}
                disabled={disabled || columns.length <= MIN_COLUMNS}
                aria-label={`Remove column ${index + 1}`}
              >
                ✕
              </button>
            </div>
            <BlockEditor
              value={column}
              onChange={(next) => updateColumn(index, next)}
              disabled={disabled}
              nested
              maxBlocks={maxForColumn(index)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-block forms
// ---------------------------------------------------------------------------

interface BlockFieldsProps {
  block: KnownBlock;
  disabled: boolean;
  onChange: (next: KnownBlock) => void;
}

function BlockFields({ block, disabled, onChange }: BlockFieldsProps) {
  switch (block.type) {
    case 'heading':
      return (
        <div className="block-fields">
          <div className="field">
            <span>Alignment</span>

            <select
              value={block.layout?.textAlign ?? 'left'}
              onChange={(event) => {
                const value = event.target.value as BlockTextAlign;

                onChange(
                  applyLayout(block, {
                    textAlign: value,
                  }),
                );
              }}
              disabled={disabled}
            >
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
              <option value="justify">Justify</option>
            </select>
          </div>

          <label className="field">
            <span>Level</span>
            <select
              value={block.level}
              onChange={(e) =>
                onChange({ ...block, level: Number(e.target.value) as HeadingLevel })
              }
              disabled={disabled}
            >
              {[1, 2, 3, 4].map((level) => (
                <option key={level} value={level}>
                  Heading {level}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Text</span>
            <input
              type="text"
              value={block.text}
              onChange={(e) => onChange({ ...block, text: e.target.value })}
              disabled={disabled}
            />
          </label>
        </div>
      );

    case 'paragraph':
      return (
        <RichTextField
          label="Text"
          value={{ text: block.text, rich: block.rich }}
          onChange={(value) => onChange(setRichText(block, value))}
          disabled={disabled}
          rows={4}
        />
      );

    case 'list': {
      const items = listEditorItems(block);
      return (
        <div className="block-fields">
          <div className="field">
            <span>Alignment</span>

            <select
              value={block.layout?.textAlign ?? 'left'}
              onChange={(event) => {
                const value = event.target.value as BlockTextAlign;

                onChange(
                  applyLayout(block, {
                    textAlign: value,
                  }),
                );
              }}
              disabled={disabled}
            >
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
              <option value="justify">Justify</option>
            </select>
          </div>
          <label className="inline-field">
            <input
              type="checkbox"
              checked={block.ordered}
              onChange={(e) => onChange({ ...block, ordered: e.target.checked })}
              disabled={disabled}
            />
            <span>Ordered (numbered) list</span>
          </label>

          <ItemListEditor<RichListItem>
            items={items}
            onChange={(next) => onChange(listFromEditorItems(block, next))}
            makeItem={() => ({ text: '' })}
            minItems={0}
            addLabel="Add item"
            itemLabel={(index) => `Item ${index + 1}`}
            renderItem={(item, index, update) => (
              <RichTextField
                label={`Item ${index + 1}`}
                value={{ text: item.text, rich: item.rich }}
                onChange={(value) => update(richListItem(value))}
                disabled={disabled}
                rows={2}
              />
            )}
            disabled={disabled}
          />
        </div>
      );
    }

    case 'quote':
      return (
        <div className="block-fields">
          <RichTextField
            label="Quote text"
            value={{ text: block.text, rich: block.rich }}
            onChange={(value) => onChange(setRichText(block, value))}
            disabled={disabled}
            rows={3}
          />
          <label className="field">
            <span>Citation (optional)</span>
            <input
              type="text"
              value={block.cite ?? ''}
              onChange={(e) => onChange(withOptional(block, { cite: e.target.value }))}
              disabled={disabled}
            />
          </label>
        </div>
      );

    case 'callout':
      return (
        <div className="block-fields">
          <div className="field">
            <span>Alignment</span>

            <select
              value={block.layout?.textAlign ?? 'left'}
              onChange={(event) => {
                const value = event.target.value as BlockTextAlign;

                onChange(
                  applyLayout(block, {
                    textAlign: value,
                  }),
                );
              }}
              disabled={disabled}
            >
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
              <option value="justify">Justify</option>
            </select>
          </div>
          <label className="field">
            <span>Variant</span>
            <select
              value={
                CALLOUT_VARIANTS.includes(block.variant as (typeof CALLOUT_VARIANTS)[number])
                  ? block.variant
                  : 'custom'
              }
              onChange={(e) => {
                const selectedVariant = e.target.value;
                onChange({
                  ...block,
                  // Keep existing variants and use a non-empty sentinel for custom mode.
                  variant: (selectedVariant === 'custom'
                    ? 'custom'
                    : selectedVariant) as CalloutVariant,
                });
              }}
              disabled={disabled}
            >
              <option value="info">Info</option>
              <option value="warn">Warning</option>
              <option value="ok">OK / good to know</option>
              <option value="bad">Bad / important</option>
              <option value="custom">Custom variant…</option>
            </select>
          </label>

          {!CALLOUT_VARIANTS.includes(block.variant as (typeof CALLOUT_VARIANTS)[number]) && (
            <label className="field">
              <span>Custom variant</span>
              <input
                type="text"
                value={block.variant === 'custom' ? '' : block.variant}
                onChange={(e) => {
                  const customVariant = e.target.value.trim();
                  onChange({
                    ...block,
                    // Never assign an empty string to the variant field.
                    variant: (customVariant || 'custom') as CalloutVariant,
                  });
                }}
                placeholder="e.g. featured, medical-note"
                disabled={disabled}
              />
              <small className="text-slate-500">Use any custom style key you need.</small>
            </label>
          )}

          <label className="field">
            <span>Callout label (optional)</span>
            <input
              type="text"
              maxLength={200}
              value={block.label ?? ''}
              placeholder={calloutLabel(block.variant)}
              onChange={(e) => onChange(applyCallout(block, { label: e.target.value }))}
              disabled={disabled}
            />
          </label>

          <RichTextField
            label="Callout text"
            value={{ text: block.text, rich: block.rich }}
            onChange={(value) => onChange(setRichText(block, value))}
            disabled={disabled}
            rows={3}
            placeholder="Write your callout message..."
          />

          <div className="block-fields">
            <label className="field">
              <span>Shape</span>
              <select
                value={block.shape ?? ''}
                onChange={(e) =>
                  onChange(
                    applyCallout(block, {
                      shape: e.target.value === '' ? undefined : (e.target.value as CalloutShape),
                    }),
                  )
                }
                disabled={disabled}
              >
                <option value="">— default (rounded) —</option>
                {CALLOUT_SHAPES.map((shape) => (
                  <option key={shape} value={shape}>
                    {shapeLabel(shape)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="callout-color-row">
            <ColorControl
              label="Background color"
              value={block.backgroundColor}
              onChange={(v) => onChange(applyCallout(block, { backgroundColor: v }))}
              disabled={disabled}
            />
            <ColorControl
              label="Text color"
              value={block.textColor}
              onChange={(v) => onChange(applyCallout(block, { textColor: v }))}
              disabled={disabled}
            />
            <ColorControl
              label="Border color"
              value={block.borderColor}
              onChange={(v) => onChange(applyCallout(block, { borderColor: v }))}
              disabled={disabled}
            />
          </div>

          <div
            className="callout-editor-preview"
            aria-label="Callout live preview"
            style={{
              display:
                (block.shape ?? 'rounded') === 'oval'
                  ? 'inline-block'
                  : (block.shape ?? 'rounded') === 'circle'
                    ? 'inline-flex'
                    : 'block',
              width:
                (block.shape ?? 'rounded') === 'oval'
                  ? 'fit-content'
                  : (block.shape ?? 'rounded') === 'circle'
                    ? '160px'
                    : '100%',
              maxWidth: '100%',
              minHeight: (block.shape ?? 'rounded') === 'circle' ? '160px' : undefined,
              aspectRatio: (block.shape ?? 'rounded') === 'circle' ? '1 / 1' : undefined,
              boxSizing: 'border-box',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius:
                (block.shape ?? 'rounded') === 'circle' || (block.shape ?? 'rounded') === 'oval'
                  ? '9999px'
                  : (block.shape ?? 'rounded') === 'rounded'
                    ? '16px'
                    : (block.shape ?? 'rounded') === 'square'
                      ? '0'
                      : '6px',
              padding: (block.shape ?? 'rounded') === 'circle' ? '18px' : '16px 20px',
              overflowWrap: 'anywhere',
              whiteSpace: 'normal',
              border: `1px solid ${block.borderColor || '#b8cce0'}`,
              backgroundColor: block.backgroundColor || '#eef6ff',
              color: block.textColor || '#243447',
              textAlign: (block.shape ?? 'rounded') === 'circle' ? 'center' : 'left',
              marginTop: '4px',
            }}
          >
            <strong style={{ display: 'block', marginBottom: '6px', lineHeight: 1.35 }}>
              {block.label?.trim() || calloutLabel(block.variant)}
            </strong>
            <div style={{ lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
              {block.text ? (
                <RichText rich={block.rich} text={block.text} />
              ) : (
                'Your callout text will appear here.'
              )}
            </div>
          </div>
        </div>
      );

    case 'image':
      return (
        <div className="block-fields">
          <MediaField
            label="Image"
            accept="image"
            value={block.src}
            onChange={(src) => onChange({ ...block, src })}
            disabled={disabled}
          />
          <label className="field">
            <span>Alt text</span>
            <input
              type="text"
              value={block.alt}
              maxLength={250}
              onChange={(e) => onChange({ ...block, alt: e.target.value })}
              disabled={disabled}
            />
          </label>
          {block.src && (
            <div className="block-image-preview">
              <img src={block.src} alt={block.alt} />
            </div>
          )}
        </div>
      );

    case 'divider':
      return <p className="muted small">A horizontal rule.</p>;

    case 'table':
      return (
        <TableEditor
          block={block}
          disabled={disabled}
          onChange={(next) => onChange(next)}
        />
      );

    case 'button':
      return (
        <div className="block-fields">
          <label className="field">
            <span>Label</span>
            <input
              type="text"
              value={block.label}
              maxLength={80}
              onChange={(e) => onChange({ ...block, label: e.target.value })}
              disabled={disabled}
            />
          </label>
          <LinkField
            label="Button link"
            value={block.href ?? ''}
            onChange={(href) => onChange(withOptional(block, { href }))}
            newTab={block.newTab ?? false}
            onNewTabChange={(newTab) => onChange({ ...block, newTab })}
            disabled={disabled}
          />
          <div className="form-grid">
            <SelectField
              label="Variant"
              value={block.variant ?? ''}
              options={BUTTON_VARIANT_OPTIONS}
              onChange={(value) =>
                onChange(withOptional(block, { variant: value === '' ? undefined : value }))
              }
              disabled={disabled}
            />
            <SelectField
              label="Size"
              value={block.size ?? ''}
              options={BUTTON_SIZE_OPTIONS}
              onChange={(value) =>
                onChange(withOptional(block, { size: value === '' ? undefined : value }))
              }
              disabled={disabled}
            />
            <SelectField
              label="Align"
              value={block.align ?? ''}
              options={ALIGN_OPTIONS}
              onChange={(value) =>
                onChange(withOptional(block, { align: value === '' ? undefined : value }))
              }
              disabled={disabled}
            />
          </div>
        </div>
      );

    case 'hero':
      return (
        <div className="block-fields">
          <label className="field">
            <span>Eyebrow (optional)</span>
            <input
              type="text"
              value={block.eyebrow ?? ''}
              maxLength={80}
              onChange={(e) => onChange(withOptional(block, { eyebrow: e.target.value }))}
              disabled={disabled}
            />
          </label>
          <label className="field">
            <span>Title</span>
            <input
              type="text"
              value={block.title}
              maxLength={200}
              onChange={(e) => onChange({ ...block, title: e.target.value })}
              disabled={disabled}
            />
          </label>
          <label className="field">
            <span>Subtitle (optional)</span>
            <textarea
              rows={2}
              value={block.subtitle ?? ''}
              maxLength={400}
              onChange={(e) => onChange(withOptional(block, { subtitle: e.target.value }))}
              disabled={disabled}
            />
          </label>
          <MediaField
            label="Hero image"
            accept="image"
            value={block.imageSrc ?? ''}
            onChange={(imageSrc) => onChange(withOptional(block, { imageSrc }))}
            disabled={disabled}
          />
          <label className="field">
            <span>Image alt text</span>
            <input
              type="text"
              value={block.imageAlt ?? ''}
              maxLength={250}
              onChange={(e) => onChange(withOptional(block, { imageAlt: e.target.value }))}
              disabled={disabled}
            />
          </label>
          <div className="form-grid">
            <SelectField
              label="Height"
              value={block.height ?? ''}
              options={HERO_HEIGHT_OPTIONS}
              onChange={(value) =>
                onChange(withOptional(block, { height: value === '' ? undefined : value }))
              }
              disabled={disabled}
            />
            <NumberField
              label="Overlay (%)"
              value={block.overlay}
              min={0}
              max={80}
              step={1}
              onChange={(overlay) => onChange(withOptional(block, { overlay }))}
              disabled={disabled}
            />
            <SelectField
              label="Align"
              value={block.align ?? ''}
              options={HERO_ALIGN_OPTIONS}
              onChange={(value) =>
                onChange(withOptional(block, { align: value === '' ? undefined : value }))
              }
              disabled={disabled}
            />
          </div>
          <CtaGroup
            legend="Primary CTA"
            cta={block.primaryCta}
            disabled={disabled}
            onChange={(primaryCta) => onChange(withOptional(block, { primaryCta }))}
          />
          <CtaGroup
            legend="Secondary CTA"
            cta={block.secondaryCta}
            disabled={disabled}
            onChange={(secondaryCta) => onChange(withOptional(block, { secondaryCta }))}
          />
        </div>
      );

    case 'accordion':
      return (
        <div className="block-fields">
          <label className="field">
            <span>Heading (optional)</span>
            <input
              type="text"
              value={block.heading ?? ''}
              maxLength={200}
              onChange={(e) => onChange(withOptional(block, { heading: e.target.value }))}
              disabled={disabled}
            />
          </label>

          <ItemListEditor<AccordionItem>
            items={block.items}
            onChange={(items) => onChange({ ...block, items })}
            makeItem={() => ({ question: '', answer: '' })}
            minItems={0}
            maxItems={50}
            addLabel="Add question"
            itemLabel={(index) => `Question ${index + 1}`}
            renderItem={(item, index, update) => (
              <div className="block-fields">
                <label className="field">
                  <span>Question</span>
                  <input
                    type="text"
                    value={item.question}
                    maxLength={200}
                    onChange={(e) => update({ ...item, question: e.target.value })}
                    disabled={disabled}
                  />
                </label>
                <RichTextField
                  label={`Answer ${index + 1}`}
                  value={{ text: item.answer, rich: item.rich }}
                  onChange={(value) => update(setAccordionAnswer(item, value))}
                  disabled={disabled}
                  rows={3}
                />
              </div>
            )}
            disabled={disabled}
          />

          <div className="form-grid">
            <label className="inline-field">
              <input
                type="checkbox"
                checked={block.allowMultiple === true}
                onChange={(e) => onChange({ ...block, allowMultiple: e.target.checked })}
                disabled={disabled}
              />
              <span>Allow multiple open</span>
            </label>
            <SelectField
              label="Default open"
              value={block.defaultOpen ?? 'none'}
              options={ACCORDION_OPEN_OPTIONS}
              allowDefault={false}
              onChange={(value) =>
                onChange({ ...block, defaultOpen: value === '' ? 'none' : value })
              }
              disabled={disabled}
            />
          </div>
        </div>
      );

    case 'cards':
      return (
        <div className="block-fields">
          <ItemListEditor<CardItem>
            items={block.items}
            onChange={(items) => onChange({ ...block, items })}
            makeItem={() => ({ title: '' })}
            minItems={0}
            maxItems={12}
            addLabel="Add card"
            itemLabel={(index) => `Card ${index + 1}`}
            renderItem={(item, index, update) => (
              <div className="block-fields">
                <MediaField
                  label={`Image ${index + 1}`}
                  accept="image"
                  value={item.imageSrc ?? ''}
                  onChange={(imageSrc) => update(withOptional(item, { imageSrc }))}
                  disabled={disabled}
                />
                <label className="field">
                  <span>Image alt text</span>
                  <input
                    type="text"
                    value={item.imageAlt ?? ''}
                    maxLength={250}
                    onChange={(e) => update(withOptional(item, { imageAlt: e.target.value }))}
                    disabled={disabled}
                  />
                </label>
                <label className="field">
                  <span>Title</span>
                  <input
                    type="text"
                    value={item.title}
                    maxLength={120}
                    onChange={(e) => update({ ...item, title: e.target.value })}
                    disabled={disabled}
                  />
                </label>
                <label className="field">
                  <span>Text (optional)</span>
                  <textarea
                    rows={2}
                    value={item.text ?? ''}
                    maxLength={400}
                    onChange={(e) => update(withOptional(item, { text: e.target.value }))}
                    disabled={disabled}
                  />
                </label>
                <LinkField
                  label="Card link"
                  value={item.href ?? ''}
                  onChange={(href) => update(withOptional(item, { href }))}
                  newTab={item.newTab ?? false}
                  onNewTabChange={(newTab) => update({ ...item, newTab })}
                  disabled={disabled}
                />
                <label className="field">
                  <span>CTA label (optional)</span>
                  <input
                    type="text"
                    value={item.ctaLabel ?? ''}
                    maxLength={60}
                    onChange={(e) => update(withOptional(item, { ctaLabel: e.target.value }))}
                    disabled={disabled}
                  />
                </label>
              </div>
            )}
            disabled={disabled}
          />

          <div className="form-grid">
            <label className="field">
              <span>Columns</span>
              <select
                value={block.columns ?? ''}
                onChange={(e) =>
                  onChange(
                    withOptional(block, {
                      columns:
                        e.target.value === ''
                          ? undefined
                          : (Number(e.target.value) as 1 | 2 | 3),
                    }),
                  )
                }
                disabled={disabled}
              >
                <option value="">— default —</option>
                <option value={1}>1 column</option>
                <option value={2}>2 columns</option>
                <option value={3}>3 columns</option>
              </select>
            </label>
            <SelectField
              label="Variant"
              value={block.variant ?? ''}
              options={CARDS_VARIANT_OPTIONS}
              onChange={(value) =>
                onChange(withOptional(block, { variant: value === '' ? undefined : value }))
              }
              disabled={disabled}
            />
            <label className="inline-field">
              <input
                type="checkbox"
                checked={block.linkWholeCard === true}
                onChange={(e) => onChange({ ...block, linkWholeCard: e.target.checked })}
                disabled={disabled}
              />
              <span>Link the whole card</span>
            </label>
          </div>
        </div>
      );

    case 'steps':
      return (
        <div className="block-fields">
          <label className="field">
            <span>Heading (optional)</span>
            <input
              type="text"
              value={block.heading ?? ''}
              maxLength={200}
              onChange={(e) => onChange(withOptional(block, { heading: e.target.value }))}
              disabled={disabled}
            />
          </label>

          <ItemListEditor<StepItem>
            items={block.items}
            onChange={(items) => onChange({ ...block, items })}
            makeItem={() => ({ title: '', text: '' })}
            minItems={0}
            maxItems={20}
            addLabel="Add step"
            itemLabel={(index) => `Step ${index + 1}`}
            renderItem={(item, index, update) => (
              <div className="block-fields">
                <label className="field">
                  <span>Title</span>
                  <input
                    type="text"
                    value={item.title}
                    maxLength={120}
                    onChange={(e) => update({ ...item, title: e.target.value })}
                    disabled={disabled}
                  />
                </label>
                <label className="field">
                  <span>Text (optional)</span>
                  <textarea
                    rows={2}
                    value={item.text ?? ''}
                    maxLength={1000}
                    onChange={(e) => update(withOptional(item, { text: e.target.value }))}
                    disabled={disabled}
                  />
                </label>
                <span className="visually-hidden">Step {index + 1}</span>
              </div>
            )}
            disabled={disabled}
          />

          <SelectField
            label="Style"
            value={block.style ?? ''}
            options={STEPS_STYLE_OPTIONS}
            onChange={(value) =>
              onChange(withOptional(block, { style: value === '' ? undefined : value }))
            }
            disabled={disabled}
          />
        </div>
      );

    case 'checklist':
      return (
        <div className="block-fields">
          <label className="field">
            <span>Title (optional)</span>
            <input
              type="text"
              value={block.title ?? ''}
              maxLength={200}
              onChange={(e) => onChange(withOptional(block, { title: e.target.value }))}
              disabled={disabled}
            />
          </label>

          <ItemListEditor<ChecklistItem>
            items={block.items}
            onChange={(items) => onChange({ ...block, items })}
            makeItem={() => ({ text: '' })}
            minItems={0}
            maxItems={50}
            addLabel="Add item"
            itemLabel={(index) => `Item ${index + 1}`}
            renderItem={(item, _index, update) => (
              <div className="block-fields">
                <label className="field">
                  <span>Text</span>
                  <input
                    type="text"
                    value={item.text}
                    maxLength={300}
                    onChange={(e) => update({ ...item, text: e.target.value })}
                    disabled={disabled}
                  />
                </label>
                <label className="field">
                  <span>Note (optional)</span>
                  <input
                    type="text"
                    value={item.note ?? ''}
                    maxLength={200}
                    onChange={(e) => update(withOptional(item, { note: e.target.value }))}
                    disabled={disabled}
                  />
                </label>
              </div>
            )}
            disabled={disabled}
          />

          <SelectField
            label="Style"
            value={block.style ?? ''}
            options={CHECKLIST_STYLE_OPTIONS}
            onChange={(value) =>
              onChange(withOptional(block, { style: value === '' ? undefined : value }))
            }
            disabled={disabled}
          />
        </div>
      );

    case 'download':
      return (
        <div className="block-fields">
          <MediaField
            label="File"
            accept="document"
            value={block.fileSrc}
            onChange={(fileSrc) => onChange({ ...block, fileSrc })}
            disabled={disabled}
          />
          <label className="field">
            <span>Label</span>
            <input
              type="text"
              value={block.label}
              maxLength={120}
              onChange={(e) => onChange({ ...block, label: e.target.value })}
              disabled={disabled}
            />
          </label>
          <label className="field">
            <span>Description (optional)</span>
            <input
              type="text"
              value={block.description ?? ''}
              maxLength={300}
              onChange={(e) => onChange(withOptional(block, { description: e.target.value }))}
              disabled={disabled}
            />
          </label>
          <label className="inline-field">
            <input
              type="checkbox"
              checked={block.newTab === true}
              onChange={(e) => onChange({ ...block, newTab: e.target.checked })}
              disabled={disabled}
            />
            <span>Open in a new tab</span>
          </label>
          <div className="form-grid">
            <label className="field">
              <span>File type (derived)</span>
              <input type="text" value={downloadTypeFromUrl(block.fileSrc)} readOnly />
            </label>
            <label className="field">
              <span>File size (server-derived)</span>
              <input
                type="text"
                value={
                  block.fileSizeBytes !== undefined
                    ? formatBytes(block.fileSizeBytes)
                    : 'Not reported'
                }
                readOnly
              />
            </label>
          </div>
        </div>
      );

    case 'toc':
      return (
        <div className="block-fields">
          <label className="field">
            <span>Title</span>
            <input
              type="text"
              value={block.title ?? ''}
              maxLength={120}
              onChange={(e) => onChange(withOptional(block, { title: e.target.value }))}
              disabled={disabled}
            />
          </label>
          <div className="form-grid">
            <label className="field">
              <span>Minimum level</span>
              <select
                value={block.minLevel ?? ''}
                onChange={(e) =>
                  onChange(
                    withOptional(block, {
                      minLevel:
                        e.target.value === ''
                          ? undefined
                          : (Number(e.target.value) as 1 | 2 | 3 | 4),
                    }),
                  )
                }
                disabled={disabled}
              >
                <option value="">— default —</option>
                {[1, 2, 3, 4].map((level) => (
                  <option key={level} value={level}>
                    Heading {level}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Maximum level</span>
              <select
                value={block.maxLevel ?? ''}
                onChange={(e) =>
                  onChange(
                    withOptional(block, {
                      maxLevel:
                        e.target.value === ''
                          ? undefined
                          : (Number(e.target.value) as 1 | 2 | 3 | 4),
                    }),
                  )
                }
                disabled={disabled}
              >
                <option value="">— default —</option>
                {[1, 2, 3, 4].map((level) => (
                  <option key={level} value={level}>
                    Heading {level}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Maximum depth</span>
              <select
                value={block.maxDepth ?? ''}
                onChange={(e) =>
                  onChange(
                    withOptional(block, {
                      maxDepth:
                        e.target.value === ''
                          ? undefined
                          : (Number(e.target.value) as 1 | 2 | 3),
                    }),
                  )
                }
                disabled={disabled}
              >
                <option value="">— default —</option>
                {[1, 2, 3].map((depth) => (
                  <option key={depth} value={depth}>
                    {depth}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="inline-field">
            <input
              type="checkbox"
              checked={block.sticky === true}
              onChange={(e) => onChange({ ...block, sticky: e.target.checked })}
              disabled={disabled}
            />
            <span>Sticky table of contents</span>
          </label>
          <p className="field-hint">Generated from the heading blocks on this page.</p>
        </div>
      );

    case 'references':
      return (
        <div className="block-fields">
          <label className="field">
            <span>Title (optional)</span>
            <input
              type="text"
              value={block.title ?? ''}
              maxLength={120}
              onChange={(e) => onChange(withOptional(block, { title: e.target.value }))}
              disabled={disabled}
            />
          </label>

          <ItemListEditor<ReferenceItem>
            items={block.items}
            onChange={(items) => onChange({ ...block, items })}
            makeItem={() => ({ text: '' })}
            minItems={0}
            maxItems={100}
            addLabel="Add reference"
            itemLabel={(index) => `Reference ${index + 1}`}
            renderItem={(item, _index, update) => (
              <div className="block-fields">
                <label className="field">
                  <span>Text</span>
                  <input
                    type="text"
                    value={item.text}
                    maxLength={300}
                    onChange={(e) => update({ ...item, text: e.target.value })}
                    disabled={disabled}
                  />
                </label>
                <LinkField
                  label="URL"
                  value={item.url ?? ''}
                  onChange={(url) => update(withOptional(item, { url }))}
                  disabled={disabled}
                />
                <div className="form-grid">
                  <label className="field">
                    <span>Publisher (optional)</span>
                    <input
                      type="text"
                      value={item.publisher ?? ''}
                      maxLength={200}
                      onChange={(e) =>
                        update(withOptional(item, { publisher: e.target.value }))
                      }
                      disabled={disabled}
                    />
                  </label>
                  <NumberField
                    label="Year (optional)"
                    value={item.year}
                    min={1800}
                    max={2100}
                    step={1}
                    onChange={(year) => update(withOptional(item, { year }))}
                    disabled={disabled}
                  />
                </div>
              </div>
            )}
            disabled={disabled}
          />

          <label className="inline-field">
            <input
              type="checkbox"
              checked={block.numbered !== false}
              onChange={(e) => onChange({ ...block, numbered: e.target.checked })}
              disabled={disabled}
            />
            <span>Numbered list</span>
          </label>
        </div>
      );

    case 'video':
      return (
        <div className="block-fields">
          <MediaField
            label="Video file"
            accept="video"
            value={block.src}
            onChange={(src) => onChange({ ...block, src })}
            disabled={disabled}
          />
          <MediaField
            label="Poster image"
            accept="image"
            value={block.poster ?? ''}
            onChange={(poster) => onChange(withOptional(block, { poster }))}
            disabled={disabled}
          />
          <MediaField
            label="Captions (.vtt)"
            accept="vtt"
            value={block.captionsSrc ?? ''}
            onChange={(captionsSrc) => onChange(withOptional(block, { captionsSrc }))}
            disabled={disabled}
          />
          <label className="field">
            <span>Title (optional)</span>
            <input
              type="text"
              value={block.title ?? ''}
              maxLength={200}
              onChange={(e) => onChange(withOptional(block, { title: e.target.value }))}
              disabled={disabled}
            />
          </label>
          <div className="form-grid checkbox-grid">
            <label className="inline-field">
              <input
                type="checkbox"
                checked={block.autoplay === true}
                onChange={(e) => {
                  const autoplay = e.target.checked;
                  onChange({ ...block, autoplay, ...(autoplay ? { muted: true } : {}) });
                }}
                disabled={disabled}
              />
              <span>Autoplay (forces muted)</span>
            </label>
            <label className="inline-field">
              <input
                type="checkbox"
                checked={block.loop === true}
                onChange={(e) => onChange({ ...block, loop: e.target.checked })}
                disabled={disabled}
              />
              <span>Loop</span>
            </label>
            <label className="inline-field">
              <input
                type="checkbox"
                checked={block.muted === true}
                onChange={(e) => onChange({ ...block, muted: e.target.checked })}
                disabled={disabled}
              />
              <span>Muted</span>
            </label>
            <label className="inline-field">
              <input type="checkbox" checked disabled onChange={() => undefined} />
              <span>Controls always shown</span>
            </label>
          </div>
        </div>
      );

    case 'columns':
      return <ColumnsEditor block={block} disabled={disabled} onChange={onChange} />;

    case 'gallery':
      return (
        <div className="block-fields">
          <ItemListEditor<GalleryImage>
            items={block.images}
            onChange={(images) => onChange({ ...block, images })}
            makeItem={() => ({ src: '', alt: '' })}
            minItems={0}
            maxItems={24}
            addLabel="Add image"
            itemLabel={(index) => `Image ${index + 1}`}
            renderItem={(item, index, update) => (
              <div className="block-fields">
                <MediaField
                  label={`Image ${index + 1}`}
                  accept="image"
                  value={item.src}
                  onChange={(src) => update({ ...item, src })}
                  disabled={disabled}
                />
                <label className="field">
                  <span>Alt text</span>
                  <input
                    type="text"
                    value={item.alt}
                    maxLength={250}
                    onChange={(e) => update({ ...item, alt: e.target.value })}
                    disabled={disabled}
                  />
                </label>
                <label className="field">
                  <span>Caption (optional)</span>
                  <input
                    type="text"
                    value={item.caption ?? ''}
                    maxLength={300}
                    onChange={(e) => update(withOptional(item, { caption: e.target.value }))}
                    disabled={disabled}
                  />
                </label>
              </div>
            )}
            disabled={disabled}
          />

          <div className="form-grid">
            <SelectField
              label="Display"
              value={block.display ?? ''}
              options={GALLERY_DISPLAY_OPTIONS}
              onChange={(value) =>
                onChange(withOptional(block, { display: value === '' ? undefined : value }))
              }
              disabled={disabled}
            />
            <label className="field">
              <span>Columns</span>
              <select
                value={block.columns ?? ''}
                onChange={(e) =>
                  onChange(
                    withOptional(block, {
                      columns:
                        e.target.value === ''
                          ? undefined
                          : (Number(e.target.value) as 2 | 3 | 4),
                    }),
                  )
                }
                disabled={disabled}
              >
                <option value="">— default —</option>
                <option value={2}>2</option>
                <option value={3}>3</option>
                <option value={4}>4</option>
              </select>
            </label>
            <SelectField
              label="Aspect ratio"
              value={block.aspect ?? ''}
              options={GALLERY_ASPECT_OPTIONS}
              onChange={(value) =>
                onChange(withOptional(block, { aspect: value === '' ? undefined : value }))
              }
              disabled={disabled}
            />
          </div>
          <label className="inline-field">
            <input
              type="checkbox"
              checked={block.lightbox === true}
              onChange={(e) => onChange({ ...block, lightbox: e.target.checked })}
              disabled={disabled}
            />
            <span>Enable lightbox</span>
          </label>
        </div>
      );

    case 'timeline':
      return (
        <div className="block-fields">
          <ItemListEditor<TimelineItem>
            items={block.items}
            onChange={(items) => onChange({ ...block, items })}
            makeItem={() => ({ title: '', text: '' })}
            minItems={0}
            maxItems={20}
            addLabel="Add entry"
            itemLabel={(index) => `Entry ${index + 1}`}
            renderItem={(item, _index, update) => (
              <div className="block-fields">
                <label className="field">
                  <span>Label (optional)</span>
                  <input
                    type="text"
                    value={item.label ?? ''}
                    maxLength={80}
                    onChange={(e) => update(withOptional(item, { label: e.target.value }))}
                    disabled={disabled}
                  />
                </label>
                <label className="field">
                  <span>Title</span>
                  <input
                    type="text"
                    value={item.title}
                    maxLength={120}
                    onChange={(e) => update({ ...item, title: e.target.value })}
                    disabled={disabled}
                  />
                </label>
                <label className="field">
                  <span>Text (optional)</span>
                  <textarea
                    rows={2}
                    value={item.text ?? ''}
                    maxLength={600}
                    onChange={(e) => update(withOptional(item, { text: e.target.value }))}
                    disabled={disabled}
                  />
                </label>
              </div>
            )}
            disabled={disabled}
          />

          <SelectField
            label="Style"
            value={block.style ?? ''}
            options={TIMELINE_STYLE_OPTIONS}
            onChange={(value) =>
              onChange(withOptional(block, { style: value === '' ? undefined : value }))
            }
            disabled={disabled}
          />
        </div>
      );

    case 'stats':
      return (
        <div className="block-fields">
          <ItemListEditor<StatItem>
            items={block.items}
            onChange={(items) => onChange({ ...block, items })}
            makeItem={() => ({ value: '', label: '', source: '' })}
            minItems={0}
            maxItems={6}
            addLabel="Add stat"
            itemLabel={(index) => `Stat ${index + 1}`}
            renderItem={(item, index, update) => (
              <div className="block-fields">
                <div className="form-grid">
                  <label className="field">
                    <span>Value</span>
                    <input
                      type="text"
                      value={item.value}
                      maxLength={20}
                      onChange={(e) => update({ ...item, value: e.target.value })}
                      disabled={disabled}
                    />
                  </label>
                  <label className="field">
                    <span>Label</span>
                    <input
                      type="text"
                      value={item.label}
                      maxLength={80}
                      onChange={(e) => update({ ...item, label: e.target.value })}
                      disabled={disabled}
                    />
                  </label>
                </div>
                <label className="field">
                  <span>Source</span>
                  <input
                    type="text"
                    value={item.source}
                    maxLength={200}
                    onChange={(e) => update({ ...item, source: e.target.value })}
                    disabled={disabled}
                  />
                </label>
                {item.source.trim() === '' && (
                  <p className="field-hint field-hint-warn">
                    Source is required before stat {index + 1} can be published.
                  </p>
                )}
                <label className="field">
                  <span>Note (optional)</span>
                  <input
                    type="text"
                    value={item.note ?? ''}
                    maxLength={200}
                    onChange={(e) => update(withOptional(item, { note: e.target.value }))}
                    disabled={disabled}
                  />
                </label>
              </div>
            )}
            disabled={disabled}
          />

          <SelectField
            label="Variant"
            value={block.variant ?? ''}
            options={STATS_VARIANT_OPTIONS}
            onChange={(value) =>
              onChange(withOptional(block, { variant: value === '' ? undefined : value }))
            }
            disabled={disabled}
          />
        </div>
      );

    case 'key_facts':
      return (
        <div className="block-fields">
          <label className="field">
            <span>Title (optional)</span>
            <input
              type="text"
              value={block.title ?? ''}
              maxLength={120}
              onChange={(e) => onChange(withOptional(block, { title: e.target.value }))}
              disabled={disabled}
            />
          </label>

          <ItemListEditor<KeyFactItem>
            items={block.items}
            onChange={(items) => onChange({ ...block, items })}
            makeItem={() => ({ label: '', value: '' })}
            minItems={0}
            maxItems={10}
            addLabel="Add fact"
            itemLabel={(index) => `Fact ${index + 1}`}
            renderItem={(item, _index, update) => (
              <div className="form-grid">
                <label className="field">
                  <span>Label</span>
                  <input
                    type="text"
                    value={item.label}
                    maxLength={80}
                    onChange={(e) => update({ ...item, label: e.target.value })}
                    disabled={disabled}
                  />
                </label>
                <label className="field">
                  <span>Value</span>
                  <input
                    type="text"
                    value={item.value}
                    maxLength={200}
                    onChange={(e) => update({ ...item, value: e.target.value })}
                    disabled={disabled}
                  />
                </label>
              </div>
            )}
            disabled={disabled}
          />
        </div>
      );

    case 'audio':
      return (
        <div className="block-fields">
          <MediaField
            label="Audio file"
            accept="audio"
            value={block.src}
            onChange={(src) => onChange({ ...block, src })}
            disabled={disabled}
          />
          <label className="field">
            <span>Title (optional)</span>
            <input
              type="text"
              value={block.title ?? ''}
              maxLength={200}
              onChange={(e) => onChange(withOptional(block, { title: e.target.value }))}
              disabled={disabled}
            />
          </label>
          <label className="field">
            <span>Transcript</span>
            <textarea
              rows={5}
              value={block.transcript}
              maxLength={20_000}
              onChange={(e) => onChange({ ...block, transcript: e.target.value })}
              disabled={disabled}
            />
          </label>
          <label className="inline-field">
            <input type="checkbox" checked disabled onChange={() => undefined} />
            <span>Controls always shown</span>
          </label>
        </div>
      );

    case 'testimonial':
      return (
        <div className="block-fields">
          <label className="field">
            <span>Quote</span>
            <textarea
              rows={3}
              value={block.quote}
              maxLength={1000}
              onChange={(e) => onChange({ ...block, quote: e.target.value })}
              disabled={disabled}
            />
          </label>
          <label className="field">
            <span>Attribution</span>
            <input
              type="text"
              value={block.attribution}
              maxLength={120}
              onChange={(e) => onChange({ ...block, attribution: e.target.value })}
              disabled={disabled}
            />
          </label>
          <label className="field">
            <span>Context (optional)</span>
            <input
              type="text"
              value={block.context ?? ''}
              maxLength={200}
              onChange={(e) => onChange(withOptional(block, { context: e.target.value }))}
              disabled={disabled}
            />
          </label>
          <label className="field">
            <span>Consent reference (internal — never published)</span>
            <input
              type="text"
              value={block.consentRef}
              maxLength={120}
              onChange={(e) => onChange({ ...block, consentRef: e.target.value })}
              disabled={disabled}
            />
          </label>
          <MediaField
            label="Avatar"
            accept="image"
            value={block.avatarSrc ?? ''}
            onChange={(avatarSrc) => onChange(withOptional(block, { avatarSrc }))}
            disabled={disabled}
          />
        </div>
      );

    case 'map':
      return (
        <div className="block-fields">
          <label className="field">
            <span>Address</span>
            <textarea
              rows={2}
              value={block.address}
              maxLength={300}
              onChange={(e) => onChange({ ...block, address: e.target.value })}
              disabled={disabled}
            />
          </label>
          <div className="form-grid">
            <NumberField
              label="Latitude"
              value={block.lat}
              min={-90}
              max={90}
              step={0.000001}
              placeholder="e.g. 45.1"
              onChange={(lat) => onChange(withOptional(block, { lat }))}
              disabled={disabled}
            />
            <NumberField
              label="Longitude"
              value={block.lng}
              min={-180}
              max={180}
              step={0.000001}
              placeholder="e.g. 15.2"
              onChange={(lng) => onChange(withOptional(block, { lng }))}
              disabled={disabled}
            />
            <NumberField
              label="Zoom"
              value={block.zoom}
              min={1}
              max={20}
              step={1}
              onChange={(zoom) => onChange(withOptional(block, { zoom }))}
              disabled={disabled}
            />
          </div>
          <label className="field">
            <span>Label (optional)</span>
            <input
              type="text"
              value={block.label ?? ''}
              maxLength={120}
              onChange={(e) => onChange(withOptional(block, { label: e.target.value }))}
              disabled={disabled}
            />
          </label>
          <MediaField
            label="Static map image"
            accept="image"
            value={block.staticImageSrc ?? ''}
            onChange={(staticImageSrc) => onChange(withOptional(block, { staticImageSrc }))}
            disabled={disabled}
          />
          <LinkField
            label="Directions link"
            value={block.directionsUrl ?? ''}
            onChange={(directionsUrl) => onChange(withOptional(block, { directionsUrl }))}
            disabled={disabled}
          />
        </div>
      );

    case 'embed':
      return (
        <div className="block-fields">
          <SelectField
            label="Provider"
            value={block.provider}
            options={EMBED_PROVIDER_OPTIONS}
            allowDefault={false}
            onChange={(value) =>
              onChange({ ...block, provider: value === '' ? 'youtube' : value })
            }
            disabled={disabled}
          />
          <label className="field">
            <span>Embed URL</span>
            <input
              type="text"
              value={block.url}
              onChange={(e) => onChange({ ...block, url: e.target.value })}
              placeholder={EMBED_HINTS[block.provider]}
              disabled={disabled}
            />
            <small className="field-hint">{EMBED_HINTS[block.provider]}</small>
          </label>
          <label className="field">
            <span>Title (optional)</span>
            <input
              type="text"
              value={block.title ?? ''}
              maxLength={200}
              onChange={(e) => onChange(withOptional(block, { title: e.target.value }))}
              disabled={disabled}
            />
          </label>
          <label className="inline-field">
            <input
              type="checkbox"
              checked={block.consentRequired !== false}
              onChange={(e) => onChange({ ...block, consentRequired: e.target.checked })}
              disabled={disabled}
            />
            <span>Require consent before loading third-party content</span>
          </label>
        </div>
      );

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Single known block card
// ---------------------------------------------------------------------------

interface BlockCardProps {
  block: KnownBlock;
  index: number;
  total: number;
  disabled: boolean;
  nested: boolean;
  dragging: boolean;
  dropTarget: boolean;
  onChange: (index: number, next: KnownBlock) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onRemove: (index: number) => void;
  onDuplicate: (index: number) => void;
  onDragStart: (index: number, event: DragEvent<HTMLElement>) => void;
  onDragOver: (index: number, event: DragEvent<HTMLElement>) => void;
  onDrop: (index: number, event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
}

function BlockCard({
  block,
  index,
  total,
  disabled,
  nested,
  dragging,
  dropTarget,
  onChange,
  onMove,
  onRemove,
  onDuplicate,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: BlockCardProps) {
  const classes = ['block-card', dragging ? 'dragging' : '', dropTarget ? 'drop-target' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <fieldset
      className={classes}
      onDragOver={(event) => onDragOver(index, event)}
      onDrop={(event) => onDrop(index, event)}
    >
      <legend className="block-legend">
        Block {index + 1} · {blockTitle(block)}
      </legend>

      <div className="block-toolbar">
        <span className="block-type-label">{blockTitle(block)}</span>
        <div className="block-actions">
          <button
            type="button"
            className="icon-btn block-drag-handle"
            draggable={!disabled}
            onDragStart={(event) => onDragStart(index, event)}
            onDragEnd={onDragEnd}
            disabled={disabled}
            aria-label={`Drag block ${index + 1} to reorder`}
            title="Drag to reorder"
          >
            ⠿
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => onMove(index, -1)}
            disabled={disabled || index === 0}
            aria-label={`Move block ${index + 1} up`}
          >
            ↑
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => onMove(index, 1)}
            disabled={disabled || index === total - 1}
            aria-label={`Move block ${index + 1} down`}
          >
            ↓
          </button>
          <button
            type="button"
            className="btn small"
            onClick={() => onDuplicate(index)}
            disabled={disabled}
            aria-label={`Duplicate block ${index + 1}`}
          >
            Duplicate
          </button>
          <button
            type="button"
            className="icon-btn danger"
            onClick={() => onRemove(index)}
            disabled={disabled}
            aria-label={`Remove block ${index + 1}`}
          >
            ✕
          </button>
        </div>
      </div>

      <BlockFields
        block={block}
        disabled={disabled}
        onChange={(next) => onChange(index, next)}
      />

      {!nested && (
        <BlockDesignPanel
          block={block}
          disabled={disabled}
          onChange={(next) => onChange(index, next)}
        />
      )}
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Unknown block card (read-only, preserved as-is)
// ---------------------------------------------------------------------------

interface UnknownBlockCardProps {
  block: UnknownBlock;
  index: number;
  total: number;
  disabled: boolean;
  onMove: (index: number, direction: -1 | 1) => void;
  onRemove: (index: number) => void;
}

function UnknownBlockCard({
  block,
  index,
  total,
  disabled,
  onMove,
  onRemove,
}: UnknownBlockCardProps) {
  return (
    <fieldset className="block-card">
      <legend className="block-legend">
        Block {index + 1} · {block.type}
      </legend>

      <div className="block-toolbar">
        <span className="block-type-label">{block.type}</span>
        <div className="block-actions">
          <button
            type="button"
            className="icon-btn"
            onClick={() => onMove(index, -1)}
            disabled={disabled || index === 0}
            aria-label={`Move block ${index + 1} up`}
          >
            ↑
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => onMove(index, 1)}
            disabled={disabled || index === total - 1}
            aria-label={`Move block ${index + 1} down`}
          >
            ↓
          </button>
          <button
            type="button"
            className="icon-btn danger"
            onClick={() => onRemove(index)}
            disabled={disabled}
            aria-label={`Remove block ${index + 1}`}
          >
            ✕
          </button>
        </div>
      </div>

      <p className="muted small">
        Unsupported block type <code>{block.type}</code>. It is preserved when you save; editing it
        is not supported in this version.
      </p>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Block list editor
// ---------------------------------------------------------------------------

interface BlockEditorProps {
  value: Block[];
  onChange: (blocks: Block[]) => void;
  disabled?: boolean;
  nested?: boolean;
  maxBlocks?: number;
}

export function BlockEditor({
  value,
  onChange,
  disabled = false,
  nested = false,
  maxBlocks,
}: BlockEditorProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const limit = maxBlocks ?? Number.POSITIVE_INFINITY;
  const atLimit = value.length >= limit;
  const visibleMeta = BLOCK_META.filter((meta) => !nested || meta.type !== 'columns');

  const update = (index: number, next: Block) => {
    onChange(value.map((block, blockIndex) => (blockIndex === index ? next : block)));
  };

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= value.length) return;
    const next = [...value];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const remove = (index: number) => {
    onChange(value.filter((_, blockIndex) => blockIndex !== index));
  };

  const add = (type: BlockType) => {
    if (disabled || atLimit) return;
    if (nested && type === 'columns') return;
    onChange([...value, makeDefaultBlock(type)]);
  };

  const duplicate = (index: number) => {
    if (disabled || atLimit) return;
    const copy = structuredClone(value[index]);
    const next = [...value];
    next.splice(index + 1, 0, copy);
    onChange(next);
  };

  const handleDragStart = (index: number, event: DragEvent<HTMLElement>) => {
    if (disabled) {
      event.preventDefault();
      return;
    }
    event.stopPropagation();
    setDragIndex(index);
    setDropIndex(index);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(index));
  };

  const handleDragOver = (index: number, event: DragEvent<HTMLElement>) => {
    if (disabled || dragIndex === null) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    if (dropIndex !== index) setDropIndex(index);
  };

  const handleDragEnd = () => {
    setDragIndex(null);
    setDropIndex(null);
  };

  const handleDrop = (index: number, event: DragEvent<HTMLElement>) => {
    // Let a parent editor handle a drag that started in its own list.
    if (dragIndex === null) return;
    event.preventDefault();
    event.stopPropagation();
    const from = dragIndex;
    setDragIndex(null);
    setDropIndex(null);
    if (disabled || from === index) return;
    const next = [...value];
    const [moved] = next.splice(from, 1);
    next.splice(index, 0, moved);
    onChange(next);
  };

  return (
    <div className={nested ? 'block-editor block-editor--nested' : 'block-editor'}>
      <div
        className="block-add-bar"
        role="group"
        aria-label={nested ? 'Add a block to this column' : 'Add a content block'}
      >
        <div className="block-add-bar-head">
          <span className="block-add-label">Add block</span>
          {nested && Number.isFinite(limit) && (
            <span className="muted small">
              {value.length} / {limit} in this column
            </span>
          )}
        </div>

        <div className="block-add-groups">
          {CATEGORY_ORDER.map((category) => {
            const metas = visibleMeta.filter((meta) => meta.category === category);
            if (metas.length === 0) return null;
            return (
              <div className="block-add-group" key={category}>
                <span className="block-add-group-label">{CATEGORY_LABELS[category]}</span>
                <div className="block-add-group-buttons">
                  {metas.map((meta) => (
                    <button
                      key={meta.type}
                      type="button"
                      className="btn small"
                      onClick={() => add(meta.type)}
                      disabled={disabled || atLimit}
                    >
                      <span className="block-add-icon" aria-hidden="true">
                        {iconGlyph(meta.icon)}
                      </span>
                      {meta.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {value.length === 0 ? (
        <p className="muted">No blocks yet. Use “Add block” to start writing.</p>
      ) : (
        <div className="block-list">
          {value.map((block, index) =>
            isKnownBlock(block) ? (
              <BlockCard
                key={index}
                block={block}
                index={index}
                total={value.length}
                disabled={disabled}
                nested={nested}
                dragging={dragIndex === index}
                dropTarget={dropIndex === index && dragIndex !== index}
                onChange={update}
                onMove={move}
                onRemove={remove}
                onDuplicate={duplicate}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onDragEnd={handleDragEnd}
              />
            ) : (
              <UnknownBlockCard
                key={index}
                block={block}
                index={index}
                total={value.length}
                disabled={disabled}
                onMove={move}
                onRemove={remove}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Homepage fields editor (home-v1)
// ---------------------------------------------------------------------------

interface HomeFieldsEditorProps {
  fields: Record<string, string>;
  onChange: (fields: Record<string, string>) => void;
  disabled?: boolean;
}

function humanize(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (c) => c.toUpperCase());
}

export function HomeFieldsEditor({ fields, onChange, disabled = false }: HomeFieldsEditorProps) {
  const keys = Object.keys(fields);
  const setField = (key: string, value: string) => onChange({ ...fields, [key]: value });
  const addField = () => {
    let name = 'newField';
    let i = 1;
    while (name in fields) name = `newField${++i}`;
    onChange({ ...fields, [name]: '' });
  };
  const removeField = (key: string) => {
    const next = { ...fields };
    delete next[key];
    onChange(next);
  };
  const renameField = (oldKey: string, newKey: string) => {
    if (!newKey || newKey === oldKey || newKey in fields) return;
    const next: Record<string, string> = {};
    for (const k of keys) next[k === oldKey ? newKey : k] = fields[k];
    onChange(next);
  };

  return (
    <div className="home-editor">
      <p className="muted small">
        This page uses the <code>home-v1</code> format: each field is a named section of the
        homepage. Values with multiple lines render as a list.
      </p>
      {keys.length === 0 && <p className="muted">No fields yet.</p>}
      {keys.map((key) => (
        <fieldset className="block-card" key={key}>
          <legend className="block-legend">{humanize(key)}</legend>
          <div className="block-toolbar">
            <label className="inline-field">
              <span>Key</span>
              <input
                type="text"
                defaultValue={key}
                onBlur={(e) => renameField(key, e.target.value.trim())}
                disabled={disabled}
                aria-label={`Field key for ${key}`}
              />
            </label>

            
            <div className="block-actions">
              <button
                type="button"
                className="icon-btn danger"
                onClick={() => removeField(key)}
                disabled={disabled}
                aria-label={`Remove field ${key}`}
              >
                ✕
              </button>
            </div>
          </div>
          <label className="field">
            <span>Value</span>
            <textarea
              rows={3}
              value={fields[key]}
              onChange={(e) => setField(key, e.target.value)}
              disabled={disabled}
            />
          </label>
        </fieldset>
      ))}
      <button type="button" className="btn small" onClick={addField} disabled={disabled}>
        + Add field
      </button>
    </div>
  );
}

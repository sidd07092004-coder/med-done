# Implementation Spec — Page Builder expansion (all catalogue blocks)

**Spec version:** `v1` — 2026-10-22
**Inputs:** `work/page-builder/02-requirements.md` (product contract), `work/page-designer/03-prompt.md` (conventions).
**Status:** build-ready. This file is the only contract shared by BACKEND, ADMIN and SITE.

> If this file contradicts the code, this file wins for this feature; if this file is silent, follow
> `02-requirements.md`; if both are silent, follow existing code style. Do not invent a fourth
> interpretation. No application code may be written until all three agents accept §0.

---

## 0. Ownership, invariants and definition of done

### 0.1 Exclusive file ownership

| Agent | Owns exactly these files | Must not edit |
|---|---|---|
| **BACKEND** | `backend/app/services/sanitize.py`, `backend/app/services/content_text.py`, `backend/app/services/templates.py` (new), `backend/app/schemas/page.py`, `backend/app/models/page.py`, `backend/app/db/ensure_schema.py`, `backend/app/crud/crud_page.py`, `backend/app/api/v1/routes/pages.py`, `backend/app/api/v1/routes/media.py`, `backend/app/core/config.py`, `backend/app/main.py`, `backend/tests/test_page_builder_schema.py` (new), `backend/tests/test_page_builder_db.py` (new), `backend/tests/fixtures/page_builder_legacy.json` (new) | any `frontend/` or `site/` file; root `app/`; `work/page-builder/02-requirements.md` |
| **ADMIN** | `frontend/src/api/types.ts`, `frontend/src/lib/blockDesign.ts`, `frontend/src/lib/pageBuilder.ts` (new), `frontend/src/components/BlockRenderer.tsx`, `frontend/src/components/RichText.tsx` (new), `frontend/src/components/ItemListEditor.tsx` (new), `frontend/src/components/LinkField.tsx` (new), `frontend/src/components/MediaPicker.tsx`, `frontend/src/pages/BlockEditor.tsx`, `frontend/src/pages/PageEditorPage.tsx`, `frontend/src/pages/PagesListPage.tsx`, `frontend/src/pages/PageManagePanel.tsx`, `frontend/src/api/client.ts`, `frontend/src/index.css` | `backend/`; `site/`; root `app/` |
| **SITE** | `site/src/api/types.ts`, `site/src/lib/blockDesign.ts`, `site/src/components/BlockRenderer.tsx`, `site/src/components/RichText.tsx` (new), `site/src/hooks/useDocumentMeta.ts`, `site/src/pages/ContentPage.tsx`, `site/src/index.css` | `backend/`; `frontend/`; root `app/` |

**Dead duplicate:** the root `app/` directory is stale. Never edit it. **Nested git:** `backend/` is
its own repository inside the root repository; check both with `git status` before and after.

### 0.2 Global invariants

1. **Additive only.** No shipped block, field, workflow state, endpoint or `home-v1` output may be removed or renamed. New fields are optional; untouched content serialises exactly as today.
2. **Backend validates and keeps.** Unknown keys survive deep-sanitised. Unknown block types keep the shipped placeholder. A bad value is clamped, dropped or emptied; a save never fails because of content.
3. **Absent ≠ default.** The sanitiser never materialises renderer defaults into storage. Editor factories may create explicit defaults; that is client input.
4. **No raw HTML/CSS/class names.** Styling is `layout` primitives only. `dangerouslySetInnerHTML` is forbidden in both apps; all text is a React text node.
5. **One shared contract.** The canonical block in both `types.ts` files and `blockDesign.ts` in both apps must be byte-identical. `RichText.tsx` is also kept byte-identical.
6. **Public API keeps serving `content`**, not `live_content`, in this release.
7. **Columns is in scope.** The PM “flag” is a merge gate: columns ships only after recursion, TOC, search-text, mobile-stacking and byte-cap tests are green. No runtime flag is added.

### 0.3 Definition of done

```bash
cd backend && ../.venv/bin/python -m pytest -q          # 0 failures; DB tests may skip
cd frontend && npm run build                            # tsc -b && vite build
cd site && npm run build                                # tsc --noEmit && vite build
```

Plus the parity gate, live round-trip and XSS corpus in §7. A legacy page whose saved JSON changes
shape, or either build failing, means “not done”.

---

## 1. Canonical schema (normative, both apps)

Paste the block below **byte-identically** between the existing markers in
`frontend/src/api/types.ts` and `site/src/api/types.ts`. Keep the current content before/after the
markers unchanged. Existing type/field lines are reproduced verbatim; new lines are additions only.

```ts
// [BEGIN CANONICAL BLOCK SCHEMA]
export type HeadingLevel = 1 | 2 | 3 | 4;
export type BlockAlign = 'left' | 'center' | 'right';
export type BlockTextAlign = BlockAlign | 'justify';
export type BlockImageFit = 'cover' | 'contain' | 'fill';
export type BlockBorderStyle = 'none' | 'solid' | 'dashed' | 'dotted';
export interface BlockLayout { textAlign?: BlockTextAlign; width?: number; offsetX?: number; marginTop?: number; marginBottom?: number; backgroundColor?: string; borderColor?: string; borderWidth?: number; borderStyle?: BlockBorderStyle; borderRadius?: number; padding?: number; }
export interface BlockTable { header?: string[]; rows: string[][]; align?: BlockAlign[]; headerBackgroundColor?: string; headerTextColor?: string; bordered?: boolean; striped?: boolean; }
export type CalloutVariant = 'info' | 'warn' | 'ok' | 'bad' | (string & {});
export type CalloutShape = 'rectangle' | 'rounded' | 'square' | 'oval' | 'circle';

export interface HeadingBlock { type: 'heading'; level: HeadingLevel; text: string; layout?: BlockLayout; }
export interface ParagraphBlock { type: 'paragraph'; text: string; rich?: RichSpan[]; layout?: BlockLayout; }
export interface ListBlock { type: 'list'; ordered: boolean; items: string[]; richItems?: RichSpan[][]; layout?: BlockLayout; }
export interface QuoteBlock { type: 'quote'; text: string; rich?: RichSpan[]; cite?: string; layout?: BlockLayout; }
export interface CalloutBlock { type: 'callout'; variant: CalloutVariant; text: string; rich?: RichSpan[]; label?: string; backgroundColor?: string; textColor?: string; borderColor?: string; shape?: CalloutShape; layout?: BlockLayout; }
export interface ImageBlock { type: 'image'; src: string; alt: string; width?: number; height?: number; align?: BlockAlign; fit?: BlockImageFit; radius?: number; layout?: BlockLayout; }
export interface DividerBlock { type: 'divider'; layout?: BlockLayout; }
export interface TableBlock { type: 'table'; table: BlockTable; layout?: BlockLayout; }

export type RichMark = 'bold' | 'italic' | 'superscript' | 'subscript';
export interface BlockLink { href: string; newTab?: boolean; }
export interface RichSpan { text: string; marks?: RichMark[]; link?: BlockLink; }

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';
export interface ButtonBlock { type: 'button'; label: string; href?: string; variant?: ButtonVariant; size?: ButtonSize; align?: BlockAlign; newTab?: boolean; layout?: BlockLayout; }
export interface HeroCta { label: string; href: string; newTab?: boolean; }
export interface HeroBlock { type: 'hero'; eyebrow?: string; title: string; subtitle?: string; imageSrc?: string; imageAlt?: string; height?: 'sm' | 'md' | 'lg'; overlay?: number; align?: 'left' | 'center'; primaryCta?: HeroCta; secondaryCta?: HeroCta; layout?: BlockLayout; }
export interface AccordionItem { question: string; answer: string; rich?: RichSpan[]; }
export interface AccordionBlock { type: 'accordion'; heading?: string; items: AccordionItem[]; allowMultiple?: boolean; defaultOpen?: 'none' | 'first' | 'all'; layout?: BlockLayout; }
export interface CardItem { imageSrc?: string; imageAlt?: string; title: string; text?: string; href?: string; ctaLabel?: string; newTab?: boolean; }
export interface CardsBlock { type: 'cards'; items: CardItem[]; columns?: 1 | 2 | 3; variant?: 'image-top' | 'compact'; linkWholeCard?: boolean; layout?: BlockLayout; }
export interface StepItem { title: string; text?: string; }
export interface StepsBlock { type: 'steps'; heading?: string; items: StepItem[]; style?: 'numbered' | 'plain'; layout?: BlockLayout; }
export interface ChecklistItem { text: string; note?: string; }
export interface ChecklistBlock { type: 'checklist'; title?: string; items: ChecklistItem[]; style?: 'check' | 'number'; layout?: BlockLayout; }
export type DownloadFileType = 'pdf' | 'docx' | 'image' | 'other';
export interface DownloadBlock { type: 'download'; fileSrc: string; label: string; description?: string; fileType?: DownloadFileType; fileSizeBytes?: number; newTab?: boolean; layout?: BlockLayout; }
export interface TocBlock { type: 'toc'; title?: string; minLevel?: 1 | 2 | 3 | 4; maxLevel?: 1 | 2 | 3 | 4; maxDepth?: 1 | 2 | 3; sticky?: boolean; layout?: BlockLayout; }
export interface ReferenceItem { text: string; url?: string; publisher?: string; year?: number; }
export interface ReferencesBlock { type: 'references'; title?: string; items: ReferenceItem[]; numbered?: boolean; layout?: BlockLayout; }
export interface VideoBlock { type: 'video'; src: string; poster?: string; captionsSrc?: string; title?: string; autoplay?: boolean; loop?: boolean; muted?: boolean; controls?: boolean; layout?: BlockLayout; }
export interface ColumnsBlock { type: 'columns'; columns: Block[][]; ratio?: 'equal' | 'wide-left' | 'wide-right'; gap?: number; stackAt?: 'mobile' | 'tablet'; layout?: BlockLayout; }
export interface GalleryImage { src: string; alt: string; caption?: string; }
export interface GalleryBlock { type: 'gallery'; images: GalleryImage[]; display?: 'grid' | 'carousel'; columns?: 2 | 3 | 4; lightbox?: boolean; aspect?: 'square' | '4:3' | '16:9' | 'natural'; layout?: BlockLayout; }
export interface TimelineItem { label?: string; title: string; text?: string; }
export interface TimelineBlock { type: 'timeline'; items: TimelineItem[]; style?: 'line' | 'cards'; layout?: BlockLayout; }
export interface StatItem { value: string; label: string; source: string; note?: string; }
export interface StatsBlock { type: 'stats'; items: StatItem[]; variant?: 'cards' | 'inline'; layout?: BlockLayout; }
export interface KeyFactItem { label: string; value: string; }
export interface KeyFactsBlock { type: 'key_facts'; title?: string; items: KeyFactItem[]; layout?: BlockLayout; }
export interface AudioBlock { type: 'audio'; src: string; title?: string; transcript: string; controls?: boolean; layout?: BlockLayout; }
export interface TestimonialBlock { type: 'testimonial'; quote: string; attribution: string; context?: string; consentRef: string; avatarSrc?: string; layout?: BlockLayout; }
export interface MapBlock { type: 'map'; address: string; lat?: number; lng?: number; zoom?: number; label?: string; staticImageSrc?: string; directionsUrl?: string; layout?: BlockLayout; }
export type EmbedProvider = 'youtube' | 'vimeo' | 'spotify' | 'google_maps';
export interface EmbedBlock { type: 'embed'; provider: EmbedProvider; url: string; title?: string; consentRequired?: boolean; layout?: BlockLayout; }
export interface UnknownBlock { type: string; layout?: BlockLayout; [key: string]: unknown; }

export type KnownBlock = HeadingBlock | ParagraphBlock | ListBlock | QuoteBlock | CalloutBlock | ImageBlock | DividerBlock | TableBlock
  | ButtonBlock | HeroBlock | AccordionBlock | CardsBlock | StepsBlock | ChecklistBlock | DownloadBlock | TocBlock | ReferencesBlock | VideoBlock
  | ColumnsBlock | GalleryBlock | TimelineBlock | StatsBlock | KeyFactsBlock | AudioBlock | TestimonialBlock | MapBlock | EmbedBlock;
export type Block = KnownBlock | UnknownBlock;
export type BlockType = KnownBlock['type'];

export const KNOWN_BLOCK_TYPES = [
  'heading', 'paragraph', 'list', 'quote', 'callout', 'image', 'divider', 'table',
  'button', 'hero', 'accordion', 'cards', 'steps', 'checklist', 'download', 'toc',
  'references', 'video', 'columns', 'gallery', 'timeline', 'stats', 'key_facts',
  'audio', 'testimonial', 'map', 'embed',
] as const;
export function isKnownBlock(block: Block): block is KnownBlock {
  return (KNOWN_BLOCK_TYPES as readonly string[]).includes(block.type);
}

export type BlockCategory = 'text' | 'media' | 'layout' | 'data' | 'navigation' | 'trust';
export interface BlockMeta { type: BlockType; label: string; category: BlockCategory; icon: string; takesLayout: boolean; defaultFactory: () => KnownBlock; }
export const BLOCK_META: readonly BlockMeta[] = [
  { type: 'heading', label: 'Heading', category: 'text', icon: 'type', takesLayout: true, defaultFactory: () => ({ type: 'heading', level: 2, text: '' }) },
  { type: 'paragraph', label: 'Paragraph', category: 'text', icon: 'align-left', takesLayout: true, defaultFactory: () => ({ type: 'paragraph', text: '' }) },
  { type: 'list', label: 'List', category: 'text', icon: 'list', takesLayout: true, defaultFactory: () => ({ type: 'list', ordered: false, items: [''] }) },
  { type: 'quote', label: 'Quote', category: 'text', icon: 'quote', takesLayout: true, defaultFactory: () => ({ type: 'quote', text: '', cite: '' }) },
  { type: 'callout', label: 'Callout', category: 'text', icon: 'alert-circle', takesLayout: true, defaultFactory: () => ({ type: 'callout', variant: 'info', text: '' }) },
  { type: 'image', label: 'Image', category: 'media', icon: 'image', takesLayout: true, defaultFactory: () => ({ type: 'image', src: '', alt: '' }) },
  { type: 'divider', label: 'Divider', category: 'layout', icon: 'minus', takesLayout: true, defaultFactory: () => ({ type: 'divider' }) },
  { type: 'table', label: 'Table', category: 'data', icon: 'table', takesLayout: true, defaultFactory: () => ({ type: 'table', table: { header: ['Column 1', 'Column 2', 'Column 3'], rows: [['', '', ''], ['', '', '']] } }) },
  { type: 'button', label: 'Button', category: 'navigation', icon: 'mouse-pointer', takesLayout: true, defaultFactory: () => ({ type: 'button', label: '', variant: 'primary', size: 'md', align: 'left' }) },
  { type: 'hero', label: 'Hero', category: 'layout', icon: 'layout-hero', takesLayout: true, defaultFactory: () => ({ type: 'hero', title: '', height: 'md', align: 'left' }) },
  { type: 'accordion', label: 'Accordion / FAQ', category: 'text', icon: 'chevron-down', takesLayout: true, defaultFactory: () => ({ type: 'accordion', items: [{ question: '', answer: '' }], defaultOpen: 'none' }) },
  { type: 'cards', label: 'Cards', category: 'data', icon: 'grid', takesLayout: true, defaultFactory: () => ({ type: 'cards', items: [{ title: '' }], columns: 3, variant: 'image-top' }) },
  { type: 'steps', label: 'Steps', category: 'data', icon: 'list-ordered', takesLayout: true, defaultFactory: () => ({ type: 'steps', items: [{ title: '', text: '' }, { title: '', text: '' }], style: 'numbered' }) },
  { type: 'checklist', label: 'Checklist', category: 'data', icon: 'check-square', takesLayout: true, defaultFactory: () => ({ type: 'checklist', items: [{ text: '' }], style: 'check' }) },
  { type: 'download', label: 'Download', category: 'navigation', icon: 'download', takesLayout: true, defaultFactory: () => ({ type: 'download', fileSrc: '', label: '' }) },
  { type: 'toc', label: 'Table of contents', category: 'navigation', icon: 'list-tree', takesLayout: true, defaultFactory: () => ({ type: 'toc', title: 'On this page', minLevel: 2, maxLevel: 4, maxDepth: 2 }) },
  { type: 'references', label: 'References', category: 'trust', icon: 'book-open', takesLayout: true, defaultFactory: () => ({ type: 'references', title: 'References', items: [{ text: '' }], numbered: true }) },
  { type: 'video', label: 'Video', category: 'media', icon: 'video', takesLayout: true, defaultFactory: () => ({ type: 'video', src: '', controls: true }) },
  { type: 'columns', label: 'Columns', category: 'layout', icon: 'columns', takesLayout: true, defaultFactory: () => ({ type: 'columns', columns: [[], []], ratio: 'equal', gap: 24, stackAt: 'mobile' }) },
  { type: 'gallery', label: 'Gallery', category: 'media', icon: 'images', takesLayout: true, defaultFactory: () => ({ type: 'gallery', images: [{ src: '', alt: '' }], display: 'grid', columns: 3, aspect: '4:3' }) },
  { type: 'timeline', label: 'Timeline', category: 'data', icon: 'clock', takesLayout: true, defaultFactory: () => ({ type: 'timeline', items: [{ title: '', text: '' }], style: 'line' }) },
  { type: 'stats', label: 'Stats', category: 'trust', icon: 'bar-chart', takesLayout: true, defaultFactory: () => ({ type: 'stats', items: [{ value: '', label: '', source: '' }], variant: 'cards' }) },
  { type: 'key_facts', label: 'Key facts', category: 'data', icon: 'info', takesLayout: true, defaultFactory: () => ({ type: 'key_facts', title: 'Key facts', items: [{ label: '', value: '' }] }) },
  { type: 'audio', label: 'Audio', category: 'media', icon: 'headphones', takesLayout: true, defaultFactory: () => ({ type: 'audio', src: '', transcript: '', controls: true }) },
  { type: 'testimonial', label: 'Testimonial', category: 'trust', icon: 'message-quote', takesLayout: true, defaultFactory: () => ({ type: 'testimonial', quote: '', attribution: '', consentRef: '' }) },
  { type: 'map', label: 'Map', category: 'media', icon: 'map-pin', takesLayout: true, defaultFactory: () => ({ type: 'map', address: '' }) },
  { type: 'embed', label: 'Embed', category: 'media', icon: 'code', takesLayout: true, defaultFactory: () => ({ type: 'embed', provider: 'youtube', url: '', consentRequired: true }) },
] as const;
export function blockMeta(type: string): BlockMeta | undefined { return BLOCK_META.find((meta) => meta.type === type); }
export function makeDefaultBlock(type: BlockType): KnownBlock { return blockMeta(type)?.defaultFactory() ?? { type: 'paragraph', text: '' }; }
// [END CANONICAL BLOCK SCHEMA]
```

**Decisions encoded above (normative):**

- `rich` is the span array on `paragraph`, `quote`, `callout`, and each `AccordionItem`. `list` keeps `items: string[]` and gains parallel `richItems?: RichSpan[][]`, so legacy arrays stay byte-identical.
- `gallery` uses `display` (`grid|carousel`), not `layout`, because `layout` is the reserved design object.
- `takesLayout` is `true` for every type. Nested column children accept a `layout`, but the v1 editor hides the design panel inside columns.
- `BLOCK_META` is the only source of labels, categories, icons and factories. `BlockEditor` and `PagesListPage` must not keep a second block list.

### 1.1 Shared helpers in both `blockDesign.ts` files

Keep existing exports. Add these pure exports (no React runtime imports beyond the existing `CSSProperties` type import):

```ts
export interface HeadingAnchor { key: string; id: string; level: HeadingLevel; text: string; }
export interface TocNode { anchor: HeadingAnchor; depth: number; children: TocNode[]; }
export function slugifyHeading(text: string): string;
export function collectHeadingAnchors(blocks: Block[], prefix?: string): HeadingAnchor[];
export function buildTocTree(anchors: HeadingAnchor[], minLevel: number, maxLevel: number, maxDepth: number): TocNode[];
```

- `key` is the block path (`0`, `3.1`, `3.1.2`) so a heading can find its id even when a TOC precedes it. `BlockRenderer` computes `collectHeadingAnchors(blocks)` once and passes `key -> id` down.
- `slugifyHeading`: trim → `NFKD` → remove combining marks → lowercase → collapse runs outside `[a-z0-9]+` to `-` → trim `-` → cap 60 → fallback `section`. Duplicate ids get `-2`, `-3`… in document order, including headings inside `columns`.
- `collectHeadingAnchors` recurses into `columns` in reading order, never into unknown blocks, and excludes TOC itself. `buildTocTree` filters `minLevel..maxLevel`, clamps `depth = level - minLevel + 1` to `1..maxDepth`, and nests by depth.
- `layoutToCss`, `CALLOUT_SHAPE_STYLES`, `calloutLabel`, `tableColumnCount` are unchanged.

---

## 2. Backend sanitisation (validate and keep)

### 2.1 Constants and URL allow-lists

Add to `sanitize.py` (keep existing constants):

```python
MAX_COLUMNS = 3; MIN_COLUMNS = 2; MAX_COLUMN_BLOCKS = 20; MAX_NESTED_BLOCKS = 60
MAX_RICH_SPANS = 500; MAX_RICH_TEXT = 20_000; MAX_GALLERY_IMAGES = 24
MAX_REFERENCES = 100; MAX_STATS = 6; MAX_KEY_FACTS = 10; MAX_DOWNLOAD_BYTES = 1_073_741_824
EMBED_PROVIDERS = {"youtube", "vimeo", "spotify", "google_maps"}
```

| Helper | Accepts | Rejects / result |
|---|---|---|
| `safe_href(value)` | trimmed `http://…`, `https://…`, site-relative `/…` (not `//`), `mailto:…`, `tel:…`; ≤2048 chars | `javascript:`, `data:`, `blob:`, `file:`, `ftp:`, `vbscript:`, protocol-relative `//`, backslash-relative `/\`, empty, whitespace/control chars → `""` |
| `safe_media_url(value)` | `http(s)://…` or site-relative `/…` including `/uploads/…`; ≤2048 | every other scheme, `data:`, `//`, controls → `""` |
| `safe_image_url(value)` | existing `safe_url` plus `data:image/(png\|jpeg\|jpg\|gif\|webp);base64,`; ≤8 MB | `data:image/svg+xml`, any other `data:`, `//`, unsafe scheme → `""` |
| `safe_upload_url(value)` | site-relative `/uploads/…` only; ≤2048 | absolute/external URLs → `""` (download must use library files) |
| `_sanitize_link(value)` | dict with valid `href`, optional real `newTab` | invalid → `None`; never invents a link |
| `_sanitize_rich(value)` | list of spans (see §2.3) | non-list / empty result → `None` |
| `_sanitize_columns(value, depth)` | list of 2–3 block arrays, depth guard | pads/truncates, never raises |

`_clean_text` remains the fixed-point HTML stripper. All string fields use it; no text is ever reinterpreted as HTML.

### 2.2 Per-block rules

All new blocks are known types and always survive sanitisation (except a non-object block or a type failing the slug rule). “Omit” means the key is absent from storage; “empty” means present with a safe empty value. `layout` is validated by `_sanitize_layout` and attached last.

| Block | Allowed fields and ranges | Invalid / missing behaviour |
|---|---|---|
| `button` | `label` 0–80; `href` page href; `variant` primary\|secondary\|ghost; `size` sm\|md\|lg; `align` left\|center\|right; `newTab` bool | label always present (may be `""`); invalid href omitted; invalid enum omitted |
| `hero` | `eyebrow` ≤80; `title` 0–200; `subtitle` ≤400; `imageSrc` image URL; `imageAlt` ≤250; `height` sm\|md\|lg; `overlay` 0–80; `align` left\|center; `primaryCta`/`secondaryCta` `{label 1–80, href page URL, newTab?}` | title always present; imageSrc only stored when `imageAlt` non-empty (else drop both); CTA stored only with non-empty label **and** valid href; overlay clamped |
| `accordion` | `heading` ≤200; `items` 0–50 of `{question 0–200, answer 0–5000, rich 0–500 spans}`; `allowMultiple` bool; `defaultOpen` none\|first\|all | items non-list → `[]`; item kept when question or answer/rich non-empty; rich overrides answer text; empty array preserved |
| `cards` | `items` 0–12 of `{imageSrc image, imageAlt ≤250, title ≤120, text ≤400, href page, ctaLabel ≤60, newTab bool}`; `columns` 1–3; `variant` image-top\|compact; `linkWholeCard` bool | item kept when title/text/imageSrc non-empty; invalid image/href omitted; ctaLabel only with href; cap 12 |
| `steps` | `heading` ≤200; `items` 0–20 of `{title ≤120, text ≤1000}`; `style` numbered\|plain | item kept when title or text non-empty; cap 20; empty array preserved |
| `checklist` | `title` ≤200; `items` 0–50 of `{text ≤300, note ≤200}`; `style` check\|number | item kept when text non-empty; cap 50 |
| `download` | `fileSrc` upload URL; `label` ≤120; `description` ≤300; `fileType` pdf\|docx\|image\|other (server-derived); `fileSizeBytes` 0–1 GiB; `newTab` bool | invalid fileSrc → `""`; label always present; `fileType` always derived from extension; client `fileType` ignored |
| `toc` | `title` ≤120; `minLevel`/`maxLevel` 1–4; `maxDepth` 1–3; `sticky` bool | invalid levels omitted; if `min > max`, swap; renderer defaults 2/4/2 |
| `references` | `title` ≤120; `items` 0–100 of `{text ≤300, url page URL, publisher ≤200, year 1800–2100}`; `numbered` bool | item kept with text even if url invalid; invalid url omitted; out-of-range year omitted; cap 100 |
| `video` | `src` media URL; `poster` media URL; `captionsSrc` media URL ending `.vtt`; `title` ≤200; `autoplay`, `loop`, `muted`, `controls` bool | invalid URLs omitted / `src: ""`; `controls` always stored `true`; if `autoplay`, `muted` forced true; cap title |
| `columns` | `columns` 2–3 arrays of blocks; `ratio` equal\|wide-left\|wide-right; `gap` 0–64; `stackAt` mobile\|tablet | non-list → `[[], []]`; pad to 2 / truncate to 3; each column ≤20 blocks; total ≤60; nested `columns` dropped |
| `gallery` | `images` 0–24 of `{src image, alt ≤250, caption ≤300}`; `display` grid\|carousel; `columns` 2–4; `lightbox` bool; `aspect` square\|4:3\|16:9\|natural | image kept only with valid src; invalid src dropped; cap 24 |
| `timeline` | `items` 0–20 of `{label ≤80, title ≤120, text ≤600}`; `style` line\|cards | item kept when any text present; cap 20 |
| `stats` | `items` 0–6 of `{value ≤20, label ≤80, source ≤200, note ≤200}`; `variant` cards\|inline | item kept when any field non-empty; empty `source` preserved (pre-publish flags it); cap 6 |
| `key_facts` | `title` ≤120; `items` 0–10 of `{label ≤80, value ≤200}` | item kept when either field non-empty; cap 10 |
| `audio` | `src` media URL; `title` ≤200; `transcript` ≤20000; `controls` bool | invalid src → `""`; transcript always present (may be `""`); `controls` forced `true` |
| `testimonial` | `quote` ≤1000; `attribution` ≤120; `context` ≤200; `consentRef` ≤120; `avatarSrc` image URL | quote/attribution/consentRef always present (may be `""`); invalid avatar omitted |
| `map` | `address` ≤300; `lat` -90–90; `lng` -180–180; `zoom` 1–20; `label` ≤120; `staticImageSrc` image URL; `directionsUrl` page URL | address always present; invalid numbers omitted; lat/lng clamped; invalid directions omitted; no iframe stored |
| `embed` | `provider` youtube\|vimeo\|spotify\|google_maps; `url` provider-matching URL; `title` ≤200; `consentRequired` bool | invalid provider → `youtube`; non-matching URL → `""`; block survives |

**Existing eight:** outputs stay frozen. `paragraph`, `quote`, `callout` gain only `rich`; `list` gains only `richItems`; all others untouched. Existing legacy tests remain the regression net.

### 2.3 Rich text normalisation (exact)

`_sanitize_rich(value, fallback_text)`:

1. Non-list / non-tuple → `None`.
2. Each span (max 500) must be a dict; `text = _clean_text(span["text"], 5000)`; skip empty.
3. `marks`: list only; lowercase; keep only `bold`, `italic`, `superscript`, `subscript`; drop unknown/duplicate/non-strings; canonical order bold → italic → sup → sub. No marks → omit.
4. `link`: `_sanitize_link`; invalid drops the link, **keeps span text**. Valid link stores trimmed `href` (≤2048) and real `newTab` only.
5. Stop when total span text reaches 20,000 chars; return `None` if nothing survives.
6. With a valid rich array, re-derive `text = "".join(span["text"] for span in rich)`; this replaces the plain field. Add no spaces between spans. If projection is empty, drop `rich` and keep the original plain text.
7. Store `rich` only on paragraph, quote, callout and accordion items; `richItems` only on list. Other types may carry `rich` as preserved unknown extra (never rendered).

Idempotency: `sanitize(sanitize(x)) == sanitize(x)`.

### 2.4 Columns recursion

- `_sanitize_block(block, depth=0)`; `columns` allowed only at `depth == 0`. At `depth > 0`, drop the block and continue siblings.
- Column arrays contain ordinary known blocks or preserved unknown blocks. Each child is sanitised exactly once, then byte-capped; a child failing slug/type check is dropped.
- Caps: 2–3 columns, ≤20 blocks per column, ≤60 nested blocks total. Over-cap trailing blocks are dropped; the outer block is then byte-capped. Empty columns are legal. `columns` never nests.

### 2.5 Unknown fields and byte caps

- `KNOWN_PAYLOAD_KEYS` gains every new field in §2.2 plus `rich`, `richItems`, `layout`.
- Other keys are deep-sanitised by `_sanitize_extra`: strings → `_clean_text`; containers recurse to depth 8 / 200 entries; deny `__proto__`, `constructor`, `prototype`, `dangerouslySetInnerHTML`, `className`, `style`, `on*` at every level. Max 50 extra keys per block.
- `MAX_BLOCK_BYTES` (256 KiB) still applies. For `gallery`/`references`/`cards`/`checklist`/`accordion`/`timeline`/`stats`/`key_facts`, drop trailing items first; for `columns`, drop trailing child blocks from the last column first; then run generic longest-string truncation. **No new block is deleted solely for being over cap**; empty an impossible required scalar and keep the block.
- Unknown block preservation: valid slug → `{type, …, layout?}`, max 50 extras; invalid type → dropped.

---

## 3. `content_text` extraction

Replace generic `_block_text` with a per-type extractor. Unknown blocks contribute nothing. Only these fields contribute; `layout`, colours, URLs, numeric metadata and `consentRef` never do.

| Block | Contributes |
|---|---|
| heading / paragraph / quote | `text` + `cite` (quote only) |
| list | every `items` string |
| callout | `label` + `text` |
| image | `alt` only |
| divider | nothing |
| table | header cells then every row cell |
| button | `label` |
| hero | `eyebrow`, `title`, `subtitle`, each CTA `label` |
| accordion | `heading`, every `question`, every `answer` |
| cards | every `title`, `text`, `ctaLabel` (not `href`) |
| steps | `heading`, every `title`, `text` |
| checklist | `title`, every `text`, `note` |
| download | `label`, `description` (not `fileSrc`, `fileType`, size) |
| toc | `title` only (generated headings would duplicate search text) |
| references | `title`, every `text`, `publisher`, `year` (not `url`) |
| video | `title` (not `src`, `poster`, captions) |
| columns | recurse into every column in reading order |
| gallery | every `alt` and `caption` (not `src`) |
| timeline | every `label`, `title`, `text` |
| stats | every `value`, `label`, `source`, `note` |
| key_facts | `title`, every `label`, `value` |
| audio | `title`, `transcript` |
| testimonial | `quote`, `attribution`, `context` — **never `consentRef`** |
| map | `address`, `label` (not lat/lng/zoom/URLs) |
| embed | `title`, provider name (not URL) |

Join with a single space; existing final `strip_html` collapses whitespace. Table newlines become
spaces. Rich content is already projected into `text`, so do not append `rich` twice.

---

## 4. Renderer contract (site + admin preview)

### 4.1 Shared rules

- `<prefix>` = `pv` in `frontend/`, `content` in `site/`. Classes follow existing naming style.
- `layoutToCss(block.layout)` is spread **last** onto the block root (image drops `textAlign`; callout legacy rule unchanged).
- All text is JSX escaped. Only `\n` becomes `<br/>` (shared `Multiline`). No HTML parser.
- Navigating links are `<a>`; local-state controls are `<button type="button">`. External new tabs get `target="_blank" rel="noopener noreferrer"`.
- Repeated items use `ul`/`ol`; full-width sections use `<section>`; media uses `<figure>`/`<figcaption>`.

### 4.2 Rich text renderer

`RichText.tsx` (byte-identical both apps) accepts `{ rich?: RichSpan[]; text: string }`.

- Absent/empty `rich` → render `text` with newlines as `<br/>`.
- Otherwise each span is a text node in fixed nest: `<a>` (if link) → `<strong>` → `<em>` → `<sup>` → `<sub>` → text. Unknown marks ignored; invalid link dropped but text remains.
- `newTab` adds `target="_blank" rel="noopener noreferrer"`. Never use `dangerouslySetInnerHTML`; never interpret a span as HTML.

### 4.3 Semantic HTML per block

| Block | HTML contract |
|---|---|
| `button` | Valid href → `<a class="<prefix>-btn …" href>`; no href → `<span class="…" aria-disabled="true">`. Variant/size/align classes; `newTab` adds target/rel. |
| `hero` | `<section class="<prefix>-hero <prefix>-hero--{height}">`; eyebrow `<p>`, title `<h2>`, subtitle `<p>`; optional `<img alt="{imageAlt}">`; decorative overlay `<div aria-hidden="true">` with `rgba(0,0,0,overlay/100)`; CTAs use button contract. |
| `accordion` | `<section>` with optional `<h2>`; each item: `<div><button id="q-{key}-{i}" aria-expanded aria-controls="a-{key}-{i}" type="button">{question}</button><div id="a-{key}-{i}" role="region" aria-labelledby="q-{key}-{i}" hidden={!open}><RichText/></div></div>`. Answers always in DOM; `defaultOpen` sets initial state; `allowMultiple=false` closes siblings; native Enter/Space. |
| `cards` | `<ul class="<prefix>-cards <prefix>-cards--{columns}">`; each `<li>` contains `<article>` (or one `<a>` when `linkWholeCard` + href); image or `<div role="img" aria-label="Image placeholder">`; title `<p class="…__title"><strong>…</strong></p>` (not heading); text `<p>`; CTA `<a>`/span. |
| `steps` | `<section>`; heading `<h2>` when present; `<ol>` for numbered, `<ul>` for plain; `<li>` has `<strong>` title + optional `<p>` text (no heading jump). |
| `checklist` | `<section>`; title `<h2>` when present; number → `<ol>`, check → `<ul>`; icon `<span aria-hidden="true">✓</span>`; static text only — no input/state/API. |
| `download` | `<a href="{fileSrc}?download=1" download>` (or target/rel when `newTab`); icon `aria-hidden`; label; description; `<span>` with fileType + formatted size. Invalid fileSrc → `<div role="note">Attachment unavailable</div>`. |
| `toc` | `<nav class="<prefix>-toc" aria-labelledby="{key}-toc-title">`; `<h2 id="{key}-toc-title">` (default “On this page”); nested `<ol>` from `buildTocTree`; links `href="#{anchor.id}"`. Zero headings → title only. `sticky` adds a class only. |
| `references` | `<section>`; title `<h2>` when present; `numbered !== false` → `<ol>`, else `<ul>`; `<li>` text, optional `<cite>publisher, year</cite>`, optional `<a href={url} rel="noreferrer">`; invalid URL leaves plain text. |
| `video` | `<figure>`; `<video controls preload="metadata" poster autoplay? loop? muted? playsInline>` with `<source src type>`; autoplay emitted only when muted; `<track kind="captions" src label="Captions" default>` when present; `<figcaption>` title. No iframe. |
| `columns` | `<div class="<prefix>-columns <prefix>-columns--{ratio} <prefix>-columns--stack-{stackAt}" style="layout; gap:{gap}px">`; each `<div class="…__col">` renders nested `BlockView` in order. Stack at ≤640 px for mobile, ≤900 px for tablet. |
| `gallery` | `<ul class="<prefix>-gallery <prefix>-gallery--{display} <prefix>-gallery--{aspect}">`; `<li><figure><img loading="lazy" alt={alt}><figcaption>{caption}</figcaption></figure></li>`. `columns` sets grid/carousel width; `aspect` sets `aspect-ratio` and `object-fit: cover` except natural. `lightbox` is site-only: image wrapped in `<button aria-label="View … larger">` opening native `<dialog>` with focus trap and Esc. No autoplay. |
| `timeline` | `<ol class="<prefix>-timeline <prefix>-timeline--{style}">`; `<li>` optional `<span class="…__label">`, `<strong>` title, optional `<p>` text. |
| `stats` | `<ul class="<prefix>-stats <prefix>-stats--{variant}">`; `<li>` with `<p class="…__value">`, `<p class="…__label">`, `<cite class="…__source">`, optional note. Missing source renders `Source not provided` with warning class. |
| `key_facts` | `<section>`; `<h2>` title (default “Key facts”); `<dl>` with `<div><dt>label</dt><dd>value</dd></div>`. |
| `audio` | `<figure>`; `<audio controls preload="metadata" src>`; `<figcaption>` title; transcript in `<details><summary>Transcript</summary><p>…</p></details>` (always in DOM). Invalid src → note. |
| `testimonial` | `<figure>`; `<blockquote><p>quote</p></blockquote>`; `<figcaption>attribution` + `<span>context</span>`; avatar `<img alt={attribution}>`. `consentRef` never rendered, never an attribute/text. |
| `map` | `<section>`; `<h2>` label when present; `<address>`; optional static `<figure><img alt="{label || address}">`; `directionsUrl` as `<a rel="noreferrer">`. Never emit live iframe/tile script/third-party request by default. Lat/lng/zoom are metadata only. |
| `embed` | `<div class="<prefix>-embed">`; provider + title visible; when `consentRequired !== false` first render is `<button type="button" aria-expanded="false">Load {provider} content</button>`; click swaps in `<iframe src={url} title={title || provider} loading="lazy" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen>`. Never render unknown provider or raw URL as HTML. |

Existing heading/paragraph/list/quote/callout/image/divider/table rendering is unchanged. Site heading
levels clamp to `<h2>` minimum; admin preview keeps stored level.

### 4.4 Embed allow-list

| Provider | Accepted URL pattern (after trim) |
|---|---|
| `youtube` | `https://www.youtube.com/embed/{id}` or `https://www.youtube-nocookie.com/embed/{id}`; id `[A-Za-z0-9_-]{6,}` |
| `vimeo` | `https://player.vimeo.com/video/{digits}` |
| `spotify` | `https://open.spotify.com/embed/(track\|album\|playlist\|episode\|show)/{id}` |
| `google_maps` | `https://www.google.com/maps/embed?pb=…` (query starts with `pb=`) |

Any other host, scheme or path is rejected by the sanitiser and renders placeholder text. The editor
may convert watch/short URLs to embed URLs, but the server stores only canonical URLs.

### 4.5 Accessibility checklist (renderer tests)

- One `<h1>` per public page (page title); new block headings never skip levels. Section headings are `<h2>`; item titles are `<strong>` unless a section heading exists; hero title is `<h2>`.
- Every image has `alt`; `alt=""` only for decorative images. Accordion buttons expose `aria-expanded`/`aria-controls`; answer regions are labelled.
- TOC is a labelled `<nav>` and every link resolves. Video supports captions; audio has a transcript; no autoplay with sound.
- Embed loads only after explicit consent button; iframe has a title. Focus is visible; all controls keyboard reachable; no mouse-only drag path (↑/↓ remains).
- Do not encode information by colour alone; stats/testimonial source is text.

---

## 5. Editor UX

### 5.1 Shared primitives (build once, reuse)

Add these in `frontend/src/components/` and use them in `BlockEditor.tsx`:

| Component | Contract |
|---|---|
| `ItemListEditor<T>` | Props: `items`, `onChange`, `makeItem`, `minItems`, `maxItems`, `addLabel`, `renderItem(item, index, update)`, `itemLabel(index)`, `disabled`. One row per item with ↑, ↓, Remove, Add. Buttons disabled (not hidden) at limits; add appends; remove respects min; move is pure. Serves accordion, cards, steps, checklist, references, gallery, timeline, stats, key_facts. |
| `RichTextField` | Plain `<textarea>` for visible text plus toolbar Bold, Italic, Superscript, Subscript, Link, Remove link. Uses `selectionStart`/`selectionEnd`; applies/removes marks by splitting spans; no `contenteditable`, no HTML. Writes `rich` + derived `text`; deletes `rich` when no marks/links remain. Shows read-only `RichText` preview below. |
| `LinkField` | URL input + “Pick page” modal (search admin pages, insert `/{slug}`) + optional “New tab” + Clear. Client hint for allow-list; server authoritative. |
| `MediaField` | Read-only URL input + “Choose from library” (`MediaPicker` with `accept` image/media/upload) + Clear. `MediaPicker` gets `accept` and filters by content type; manual URLs allowed but validated on save. |
| `ColorField`, number/enum controls | Keep `ColorControl`; number inputs use exact min/max/step and empty = delete; enum selects include a “—”/default option. |

Every write follows `onChange({ ...block, field: value })`. Clearing deletes the key. Never write
`undefined`, `null`, `0`-as-absent, or an empty `layout` object.

### 5.2 Per-block forms

The existing eight forms (heading, paragraph, list, quote, callout, image, divider, table) remain unchanged.

| Block | Controls |
|---|---|
| button | label; LinkField; variant; size; align; new-tab; design panel |
| hero | eyebrow, title, subtitle; image MediaField + alt; height; overlay 0–80; align; primary/secondary CTA groups (label + LinkField); design panel |
| accordion | optional heading; item list (question + RichTextField answer); allow-multiple; default-open none/first/all; design panel |
| cards | item list (image + alt, title, text, LinkField, CTA label); columns 1–3; variant; link-whole-card; design panel |
| steps | optional heading; item list (title, text); style numbered/plain; design panel |
| checklist | optional title; item list (text, note); style check/number; design panel |
| download | media picker restricted to documents; label, description; new-tab; read-only derived type/size; design panel |
| toc | title; min/max level 1–4; max-depth 1–3; sticky; note “Generated from heading blocks”; design panel |
| references | title; item list (text, LinkField, publisher, year 1800–2100); numbered; design panel |
| video | media picker for video, poster image, captions `.vtt`; title; autoplay/loop/muted; controls shown checked and disabled; design panel |
| columns | add/remove columns (2–3); ratio; gap 0–64; stack-at; each column is nested `BlockEditor` (`nested` prop) allowing all types except columns, max 20/column and 60 total; design panel outer only |
| gallery | image item list (media + alt + caption); display grid/carousel; columns 2–4; lightbox; aspect; design panel |
| timeline | item list (label, title, text); style line/cards; design panel |
| stats | item list (value, label, required source, note); variant cards/inline; inline error hint when source missing; design panel |
| key_facts | title; item list (label, value); design panel |
| audio | media picker for audio; title; transcript textarea (required, max 20,000); controls checked/disabled; design panel |
| testimonial | quote, attribution, context, consent reference (“Internal — never published”), avatar media; design panel |
| map | address, lat, lng, zoom 1–20, label; static image media; directions LinkField; design panel |
| embed | provider select (4); provider-specific URL + hint; title; consent-required (default checked); design panel |

### 5.3 Block list behaviour

- Add bar is generated from `BLOCK_META`, grouped by `category`; scrollable list, not 27 inline buttons.
- Every card toolbar: type label, drag handle, ↑, ↓, Duplicate, Remove.
- Duplicate uses `structuredClone` (or JSON deep copy), inserts immediately after the original, and deep-copies nested `columns`.
- Drag-and-drop uses HTML5 drag events on the handle; reorder on drop and save once. ↑/↓ remain the keyboard path. Arrange mode is not used for reordering; offsets untouched.
- `UnknownBlockCard` stays read-only (type + remove/move), never editable.
- `ColumnsEditor` passes `nested`; nested add bar excludes columns; nested design panels hidden.

---

## 6. Page features behaviour

### 6.1 SEO meta mapping

| UI field | Model column | Rule |
|---|---|---|
| `metaTitle` | `pages.meta_title` (existing) | trim; cap 70 on save (truncate, never reject) |
| `metaDescription` | `pages.meta_description` (existing) | trim; cap 160 on save |
| `canonicalPath` | `pages.canonical_path` (**new additive column**) | `safe_href` restricted to `http(s)` or `/…`; null when empty/invalid |
| `robots` | `pages.robots` (**new additive column**) | `index` \| `noindex`; null means `index` |
| `ogImage` | `pages.og_image` (**new additive column**) | `safe_media_url`; null when empty/invalid |
| `meta_keywords` | `pages.meta_keywords` (existing) | **legacy only**: keep stored data, remove from editor, never emit from new payloads |

Add `canonical_path`, `robots`, `og_image` to `PageBase`, `PageUpdate`, `PageInDB`, `PagePublic`, TS
`Page`/`PublicPage`/`PageCreatePayload`/`PageUpdatePayload`, and `ensure_schema`:

```python
ALTER TABLE pages ADD COLUMN IF NOT EXISTS canonical_path VARCHAR(2048);
ALTER TABLE pages ADD COLUMN IF NOT EXISTS robots VARCHAR(16);
ALTER TABLE pages ADD COLUMN IF NOT EXISTS og_image VARCHAR(2048);
```

`useDocumentMeta` gains `canonicalPath`, `robots`, `ogImage`, `url` and sets/restores:
`document.title`, `meta[name=description]`, `link[rel=canonical]`, `meta[name=robots]`,
`meta[property=og:title]`, `og:description`, `og:image`, `og:url`, `og:type=article`. Fallbacks:
title → page title → site default; description → excerpt → site default; canonical → current path;
robots → `index`; og:image omitted when absent. `noindex` is honoured. `ContentPage` passes
`data.elapsed` fields, not only title/description.

### 6.2 Templates API

`backend/app/services/templates.py` defines `TEMPLATES_VERSION = 1` and a list of sanitised recipes.
Add `GET /admin/pages/templates` **before** `GET /admin/pages/{page_id}`. Active user required.

```json
{"version":1,"templates":[{"id":"blank","label":"Blank","description":"An empty page.","content":{"format":"blocks-v1","blocks":[]}}]}
```

`content` is rebuilt by `sanitize_content` and deep-copied per request. The New Page dialog fetches
it, shows a select of cards, and posts the chosen `content` to the existing create endpoint. No
user-defined templates or write endpoint.

| Template id | Recipe (in order) |
|---|---|
| `blank` | `paragraph` with empty text (Blank must still create a paragraph) |
| `article` | heading 2, paragraph, toc, heading 2, paragraph, callout info, heading 2, list, references |
| `treatment` | hero (title placeholder), key_facts, heading 2, paragraph, steps numbered, callout warn, references |
| `condition` | hero, key_facts, heading 2, paragraph, accordion (3 empty items), references |
| `faq` | heading 2, accordion (3 empty items), callout info, references |
| `practitioner` | hero, heading 2, paragraph, key_facts, timeline |

Every recipe block is created through canonical defaults, then sanitised on the way out.

### 6.3 Duplicate page

`POST /admin/pages/{page_id}/duplicate` → `PageResponse`; any active user; add `duplicatePage(id)` to
`frontend/src/api/client.ts` and a “Duplicate” action on list/editor.

- First free slug in page language: `${slug}-copy`, then `${slug}-copy-2`, `${slug}-copy-3`… (cap search at 999; 409 if all taken). Slug cap 512.
- Copy title exactly, `excerpt`, `content` re-sanitised, `content_text` re-derived, `meta_title`, `meta_description`, `meta_keywords`, `canonical_path`, `robots`, `og_image`, `lang`, `group_id`, `translation_of_id`; copy contributors as new rows with current user as adder.
- Set `status="draft"`, `position=next_position(group)`, `is_homepage=False`, `featured=False`, `live_* = NULL`, `published_at = NULL`, `approved_by_id = NULL`, `submitted_by_id = NULL`, `reject_note = NULL`, `author_id = last_edited_by_id = current user`.
- Do not copy revisions or approval state. Log an audit entry. Never write raw client JSON: re-sanitise always.

### 6.4 Undo / redo

`frontend/src/lib/pageBuilder.ts` exports `useEditorHistory<T>(initial, limit = 50)` where `T` is
content state (`blocks` + `homeFields`):

- `past` holds pre-edit snapshots, `future` redo snapshots. Max **50** past states; drop oldest. Any new edit clears `future`; `undo()` moves current → future and restores past; `redo()` reverses.
- Coalescing: `push(next, { key, now })`; if `key` equals the last key and `now - lastTime < 750ms`, do not push another snapshot (top snapshot already represents the start of the typing run). Keys: `text:${blockIndex}:${field}`, `item:${blockIndex}:${itemIndex}:${field}`, `layout:${blockIndex}:${key}`. Structural operations (`add`, `remove`, `duplicate`, `reorder`, column add/remove) use a unique key and never coalesce.
- Drag reorder pushes one snapshot on drop, not dragover. A save does not push history or clear it; it updates the saved baseline, so undo after save correctly marks dirty.
- Keyboard: Ctrl/Cmd+Z undo; Ctrl/Cmd+Shift+Z and Ctrl+Y redo, intercepted while editor has focus; modals and media/link picker opt out. Native text undo is not used for content fields.

### 6.5 Unsaved-changes guard

- Keep existing dirty comparison and extend it with `canonicalPath`, `robots`, `ogImage`.
- Use React Router `useBlocker` (v6.26) for in-app route changes; modal has **Keep editing** and **Discard changes**. Add `beforeunload` while `dirty && !locked`.
- Language switching is an in-form action: if dirty, show the same modal before applying; Keep editing restores old select value.
- Successful save resets baseline and clears guard. Clean navigation never prompts. Locked pages (pending for volunteers) have no guard because they cannot be edited.

### 6.6 Revision history UI

- Backend `GET /admin/pages/{page_id}/revisions` gains `created_by_name` (join user; `null` if deleted). Frontend `Revision` gains `created_by_name?: string | null`.
- `PageManagePanel` shows time, author name (fallback “Unknown”), title and slug per revision.
- “Preview” opens a read-only modal/panel rendering `revision.content` with admin `BlockRenderer`, plus revision title/slug. It never mutates editor state.
- “Restore” is visible/enabled for admins only. Confirm: “Restore this version? The current content will be saved to history first.” `POST …/restore` is admin-only and must: create a revision of current page first; re-run `sanitize_content(rev.content)` and re-derive `content_text`; ensure restored slug is unique in its language or 409; restore title, slug, group and content only (revision model has no SEO/excerpt snapshot); trim to 20 revisions and write audit.
- After restore, refresh from server; preview and restored content must deep-equal modulo the sanitiser.

### 6.7 Pre-publish checks (non-blocking)

`getPrePublishChecks(page, content, groupPath)` in `frontend/src/lib/pageBuilder.ts` returns
`{ code, message, blockIndex? }[]`. Show in a “Checks” panel before Submit; Submit still works
(“Submit anyway”). Codes:

| Code | Trigger |
|---|---|
| `meta_description_missing` | `metaDescription` blank |
| `meta_title_missing` | `metaTitle` blank |
| `image_alt_missing` | image/hero/card/gallery image with `src` and blank alt |
| `empty_link_or_cta` | button/CTA/card CTA/link with blank label or missing href |
| `accordion_answer_empty` | accordion item with blank answer and rich |
| `references_missing` | slug/group path looks like treatment/therapy and no `references` block |
| `video_captions_missing` | video with `src` and no `captionsSrc` |
| `audio_transcript_missing` | audio with blank transcript |
| `stats_source_missing` | stats item with blank source |
| `testimonial_consent_missing` | testimonial with blank `consentRef` |
| `download_file_missing` | download with blank `fileSrc` |

No backend enforcement; these are editorial warnings.

### 6.8 Media delivery (download acceptance)

Extend `media.py` upload types to images (jpg/jpeg/png/webp/gif), pdf, docx, mp4/webm, mp3/m4a/ogg and
vtt; reject SVG, HTML, executables and unknown extensions; enforce per-kind size (image 10 MB, docs
20 MB, audio 50 MB, video 200 MB, vtt 1 MB). Replace the plain `/uploads` mount in `main.py` with a
safe `GET /uploads/{filename}` `FileResponse` route (register before the mount or remove the mount):
resolve only `Path(filename).name`; missing → 404; always send `X-Content-Type-Options: nosniff` and
`Content-Security-Policy: sandbox`; `?download=1` sends `Content-Disposition: attachment` with the
original filename; images/audio/video without it may be inline. Download blocks render
`{fileSrc}?download=1`.

---

## 7. Test matrix

| Area | Gate / test |
|---|---|
| Backend unit | `test_page_builder_schema.py`: legacy 8 + `home-v1` golden fixtures unchanged; `sanitize(sanitize(x)) == sanitize(x)` |
| Backend unit | Every new block: valid round-trip, each enum/range clamp, required-field fallback, cap/drop rule |
| Backend unit | Rich: mark whitelist, link validation, derived text, 500-span/20k caps, invalid span falls back to text |
| Backend unit | URLs: page/media/image/upload; `javascript:`, `data:image/svg+xml`, `//`, `blob:`, `vbscript:` rejected |
| Backend unit | Columns: depth 1, 2–3, per-column 20, total 60, nested columns dropped, byte cap shrinks not deletes |
| Backend unit | Unknown fields preserved; denied keys removed; unknown block placeholder data preserved |
| Backend unit | `content_text`: each block contributes only §3 fields; `consentRef`/decorative values absent |
| Backend unit | Templates: each recipe sanitises; no unsafe URL/HTML; Blank contains a paragraph |
| Backend unit | SEO validators truncate 70/160 and null invalid canonical/robots/og |
| Backend DB | `test_page_builder_db.py` (skip if PG down): create/update round-trip all blocks; `content_text` refreshed; duplicate semantics; restore sanitises + admin-only; templates endpoint shape |
| Admin build | `cd frontend && npm run build` clean, no `@ts-ignore`, canonical/blockDesign/RichText parity |
| Site build | `cd site && npm run build` clean, same parity |
| Live E2E | Insert one of each block → save → reload → submit → approve → `GET /api/v1/pages/{slug}` deep-equals stored content; admin preview and site render same semantics |
| Live E2E | TOC duplicate headings unique; every link resolves; zero-heading page has no dead links; heading edit updates TOC |
| Live E2E | Accordion answers in DOM, keyboard toggle, aria attributes, defaultOpen/allowMultiple |
| Live E2E | Button/hero/card/CTA payloads: `javascript:` blocked; `https`, `/path`, `mailto:`, `tel:` accepted; newTab rel correct |
| Live E2E | Download returns attachment + nosniff; video/audio attributes; no iframe from video/audio/map |
| Live E2E | Embed: unknown provider/URL rejected; click-to-load shows iframe only after press; provider/title present |
| Live E2E | SEO: 5 fields save/reload; title/description/canonical/robots/OG emitted; fallbacks; noindex |
| Live E2E | Duplicate: one new draft, `-copy`/`-copy-2`, contributors copied, revisions/approval/live cleared |
| Live E2E | Undo/redo: add/delete/edit/duplicate/reorder/layout, 50-step cap, coalescing, save/undo dirty |
| Live E2E | Dirty guard: route change/refresh/language switch, discard/keep, clean and saved navigation |
| Live E2E | Revisions: list author/time, read-only preview, admin restore creates a revision |
| XSS corpus | `<script>alert(1)</script>`, `<img src=x onerror=alert(1)>`, `<svg onload=…>`, `<iframe>`, `<style>`, `"><script>`, encoded/double-encoded variants, `javascript:`, `JaVaScRiPt:`, `java%73cript:`, `data:text/html`, `data:image/svg+xml`, `blob:`, `file:`, `ftp:`, `vbscript:`, `//evil`, `/\evil`, empty href; zero executable nodes in both apps |
| Backwards fixture | `page_builder_legacy.json`: all 2,099-page block shapes plus `home-v1`; sanitised JSON unchanged and legacy DOM unchanged |
| Parity | Canonical block identical; `blockDesign.ts` identical; `RichText.tsx` identical |

---

## 8. Rollout order and verification commands

1. **BACKEND schema + sanitiser + content_text + fixtures/tests.** This unblocks the contract first.
2. **Canonical types + shared `blockDesign.ts` + `RichText.tsx`** in ADMIN and SITE simultaneously; run parity before renderer work.
3. **ADMIN renderer + editor** (types → renderer → item list/rich/link/media → block editor → page features).
4. **SITE renderer + SEO head** (types → renderer → meta hook → CSS).
5. **Page features backend** (SEO columns, templates, duplicate, restore) and matching admin UI.
6. **Live E2E, XSS corpus, backwards fixture and parity** before merge. Columns merges last after recursion/TOC/search/mobile tests are green.

```bash
# Static gates (repo root)
cd /home/aut007/Downloads/medically_complicated_admin_panel
cd backend && ../.venv/bin/python -m pytest -q
cd ../frontend && npm run build
cd ../site && npm run build

# Parities (must print nothing / identical)
cd /home/aut007/Downloads/medically_complicated_admin_panel
diff -u frontend/src/lib/blockDesign.ts site/src/lib/blockDesign.ts
diff -u frontend/src/components/RichText.tsx site/src/components/RichText.tsx
python - <<'PY'
import pathlib, re, sys
def block(path):
    text = pathlib.Path(path).read_text()
    m = re.search(r"// \[BEGIN CANONICAL BLOCK SCHEMA\](.*?)// \[END CANONICAL BLOCK SCHEMA\]", text, re.S)
    if not m: sys.exit(f"markers missing in {path}")
    return m.group(1)
a, b = block("frontend/src/api/types.ts"), block("site/src/api/types.ts")
if a != b: sys.exit("canonical block differs between frontend and site")
print("canonical block identical:", len(a), "chars")
PY

# Backend unit / live setup (from backend/, as AGENTS.md requires)
cd backend
./start_pg.sh
source ../.venv/bin/activate
python init_and_seed.py
../.venv/bin/python -m pytest -q tests/test_page_builder_schema.py
../.venv/bin/python -m pytest -q tests/test_page_builder_db.py
python -m uvicorn app.main:app --reload --port 8000

# In a second terminal, from backend/
PYTHON=../.venv/bin/python ./smoke_test.sh
```

Definition of done: both builds exit `0`, pytest has `0 failed` (DB tests may `skip` when PG absent),
parity commands are empty/identical, live round-trip fetches every new block intact, XSS corpus
produces no executable node, and no legacy fixture changes.

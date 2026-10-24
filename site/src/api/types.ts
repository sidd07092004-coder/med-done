// Shared types for the public API (see backend/app/schemas/page.py and
// backend/app/schemas/navigation.py).

export interface Contributor {
  id: string
  name: string
  role: string
  page_id?: string
  created_at?: string
}

/** Normal page content: `{ format: "blocks-v1", blocks: [...] }`. */
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

export interface BlocksContent {
  format: 'blocks-v1'
  blocks: Block[]
}

/** Homepage content: `{ format: "home-v1", fields: {...} }`. */
export interface HomeFields {
  heroBtTitle?: string
  heroBtText?: string
  heroBtBtn?: string
  heroEnTitle?: string
  heroEnText?: string
  heroEnBtn?: string
  intro?: string
  nbTitle?: string
  nbText?: string
  nbList?: string
  nbBtn?: string
  neTitle?: string
  neText?: string
  neList?: string
  neBtn?: string
  stLede?: string
  exLede?: string
  exList?: string
  cmTitle?: string
  cmText?: string
  cmBtn1?: string
  cmBtn2?: string
  blLede?: string
  bl1?: string
  bl1s?: string
  bl2?: string
  bl2s?: string
  bl3?: string
  bl3s?: string
}

export interface HomeContent {
  format: 'home-v1'
  fields: HomeFields
}

export type PageContent = BlocksContent | HomeContent | Record<string, unknown> | null

export interface PagePublic {
  id: string
  title: string
  slug: string
  lang: string
  content: PageContent
  content_text: string | null
  excerpt: string | null
  group_id: string
  contributors: Contributor[]
  published_at: string | null
  updated_at: string
  meta_title: string | null
  meta_description: string | null
}

export interface NavigationGroup {
  id: string
  name: string
  /** Localized group names keyed by language code (`hr`, `tr`, `ar`). */
  name_translations?: Record<string, string>
  path: string | null
  parent_id: string | null
  position: number
  children: NavigationGroup[]
}

export interface NavigationPage {
  id: string
  title: string
  slug: string
  group_id: string
  position: number
}

export interface NavigationResponse {
  lang: string
  groups: NavigationGroup[]
  pages: NavigationPage[]
}

export function isBlocksContent(content: PageContent): content is BlocksContent {
  return (
    !!content &&
    typeof content === 'object' &&
    (content as { format?: unknown }).format === 'blocks-v1' &&
    Array.isArray((content as { blocks?: unknown }).blocks)
  )
}

export function isHomeContent(content: PageContent): content is HomeContent {
  return (
    !!content &&
    typeof content === 'object' &&
    (content as { format?: unknown }).format === 'home-v1' &&
    typeof (content as { fields?: unknown }).fields === 'object' &&
    (content as { fields?: unknown }).fields !== null
  )
}

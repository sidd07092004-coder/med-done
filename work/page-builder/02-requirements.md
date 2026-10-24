# Page Builder Expansion — Product Scope

**Status:** Draft for approval · **Owner:** Alex (PM) · **Date:** 2026-10-22
**Builds on:** `work/page-designer/02-requirements.md` (8 shipped blocks + `layout`, table, arrange mode).

## 0. What “add almost everything” means here

This is a medical/complementary-therapy content site, not a marketing landing-page toy. The
expansion is judged by **editorial leverage and trust**, not block count. We add the blocks health
writers use on article, treatment, diagnosis and guide pages; we cut anything that is decorative,
duplicates an existing capability, or creates a regulatory/security surface we cannot defend.

**Rules that apply to every new block**
- The content format stays `blocks-v1`. Every new field and block is **optional and additive**;
  a page with none of them must serialise, store and render exactly as today.
- The backend **validates and keeps**; unknown fields survive. Unknown block types render a neutral
  placeholder (already shipped) — never disappear.
- Blocks remain a single vertical flow. Only `columns` nests, and only one level deep.
- All styling is validated primitives (numbers, enums, hex colours). No author CSS, classes or HTML.
- Priority: **MUST** = committed this release · **SHOULD** = next 1–2 releases · **COULD** = backlog,
  needs evidence · **CUT** = not building, with reason below.

---

## 1. Block catalogue

The eight shipped types (heading, paragraph, list, quote, callout, image, divider, table) are
unchanged and not re-scoped. Only **new** blocks are listed.

| Block | Purpose | Key fields (name: type / range) | Nested blocks | Priority |
|---|---|---|---|---|
| **button** | One clear action: book, find a practitioner, download a guide, call. | `label` str 1–80; `href` URL ≤2048; `variant` primary\|secondary\|ghost; `size` sm\|md\|lg; `align` left\|center\|right; `newTab` bool | No | **MUST** |
| **hero** | Page opener for treatment/condition/guide pages; carries the promise and primary action. | `eyebrow` str ≤80; `title` str 1–200; `subtitle` str ≤400; `imageSrc` URL; `imageAlt` str ≤250 (required with image); `height` sm\|md\|lg; `overlay` int 0–80 (%); `align` left\|center; `primaryCta`/`secondaryCta` `{label 1–80, href URL}` | No | **MUST** |
| **accordion / FAQ** | Progressive disclosure for common questions, safety notes, “what to expect”. Answers stay in the DOM. | `heading` str ≤200; `items` 1–50 × `{question str 1–200, answer RichText 1–5000}`; `allowMultiple` bool; `defaultOpen` none\|first\|all | No (answers are rich text) | **MUST** |
| **cards** | Grid of treatments, practitioners, related guides or linked resources. | `items` 1–12 × `{imageSrc? URL, imageAlt? 1–250, title 1–120, text ≤400, href? URL, ctaLabel? ≤60}`; `columns` int 1–3; `variant` image-top\|compact; `linkWholeCard` bool | No | **MUST** |
| **steps / process** | “What happens during your visit”, treatment protocol, aftercare sequence. | `heading` str ≤200; `items` 2–20 × `{title 1–120, text ≤1000}`; `style` numbered\|plain | No | **MUST** |
| **checklist** | Pre-appointment prep, symptom checklist, questions to ask. Static, not a form. | `title` str ≤200; `items` 1–50 × `{text 1–300, note? ≤200}`; `style` check\|number | No | **MUST** |
| **download / attachment** | Patient forms, guides, aftercare PDFs. | `fileSrc` URL (uploads only); `label` 1–120; `description` ≤300; `fileType` pdf\|docx\|image\|other (server-derived); `fileSizeBytes` int; `newTab` bool | No | **MUST** |
| **table-of-contents** | Auto-nav for long article/guide pages; reduces scroll and supports print/SEO. | `title` ≤120 (default “On this page”); `minLevel` int 1–4; `maxLevel` int 1–4; `maxDepth` int 1–3; `sticky` bool | No (reads headings) | **MUST** |
| **references / sources** | First-class citations for medical claims and further reading. | `title` ≤120; `items` 1–100 × `{text 1–300, url? URL, publisher? ≤200, year? int 1800–2100}`; `numbered` bool | No | **MUST** |
| **video** | Privacy-safe treatment demos, exercise guidance, practitioner introductions. | `src` URL (mp4/webm); `poster` URL; `captionsSrc` URL (.vtt); `title` ≤200; `autoplay` bool (default false); `loop` bool; `muted` bool; `controls` bool (locked true) | No | **MUST** |
| **columns** | Side-by-side image + text, two related notes, comparison layout. Stacks on mobile. | `columns` 2–3 × `Block[]`; `ratio` equal\|wide-left\|wide-right; `gap` int 0–64; `stackAt` mobile\|tablet | **Yes — depth 1 only** | **SHOULD** |
| **gallery** | Clinic photos, remedy images, consented before/after sets. No autoplay. | `images` 1–24 × `{src URL, alt 1–250, caption? ≤300}`; `layout` grid\|carousel; `columns` 2–4; `lightbox` bool; `aspect` square\|4:3\|16:9\|natural | No | **SHOULD** |
| **timeline** | Patient journey, treatment history, “what to expect over 6 weeks”. | `items` 1–20 × `{label ≤80, title 1–120, text ≤600}`; `style` line\|cards | No | **SHOULD** |
| **stats / metrics** | Evidence at a glance (“92% would recommend”, “15 years”). Source is mandatory. | `items` 1–6 × `{value 1–20, label 1–80, source 1–200, note? ≤200}`; `variant` cards\|inline | No | **SHOULD** |
| **key facts** | Medical summary box: onset, duration, who it affects, when to seek help. | `title` ≤120 (default “Key facts”); `items` 1–10 × `{label 1–80, value 1–200}` | No | **SHOULD** |
| **audio** | Guided meditation, breathing exercise, podcast clip. Transcript required. | `src` URL (mp3/m4a/ogg); `title` ≤200; `transcript` 1–20000; `controls` bool | No | **COULD** |
| **testimonial** | Patient quote. Only with recorded consent and legal sign-off. | `quote` 1–1000; `attribution` 1–120; `context` ≤200; `consentRef` 1–120 (internal, never rendered); `avatarSrc? URL` | No | **COULD** |
| **map** | Clinic location without third-party tracking by default. | `address` 1–300; `lat` number -90–90; `lng` number -180–180; `zoom` int 1–20; `label` ≤120; `staticImageSrc? URL`; `directionsUrl? URL` | No | **COULD** |
| **embed** | Named third-party media only (YouTube, Vimeo, Spotify, Google Maps). | `provider` enum (allow-list); `url` provider URL; `title` ≤200; `consentRequired` bool (default true) | No | **COULD** |
| **tabs** | — | — | — | **CUT — merge into accordion** |
| **pricing** | — | — | — | **CUT — use table/cards** |
| **code** | — | — | — | **CUT** |
| **spacer** | — | — | — | **CUT — use `layout` margins** |

### 1.1 Why the cuts and merges

- **tabs → accordion.** Tabs hide content from print, search snippets and emergency scanning, and
  are awkward on mobile. The accordion keeps every question visible and the answers in the DOM.
- **pricing → table/cards.** A price list is a table; a treatment offer is a card. A dedicated
  pricing block implies variants, currency switching and checkout semantics this site does not have,
  and “was/now” discount UI is a regulatory liability in health advertising.
- **code.** No health-editor use case. It adds a syntax-highlighting dependency and another XSS
  surface for zero editorial value.
- **spacer.** `layout.marginTop` / `marginBottom` already do this on any block. Empty blocks pollute
  search text, revisions and screen-reader output.
- **generic embed.** Arbitrary iframes are a security, cookie-consent and availability risk. Replaced
  by `video`, `audio`, `map` and a provider-allow-listed `embed`; no author-supplied `<iframe>`.
- **columns is SHOULD, not MUST.** Nested blocks are the highest-risk change in this scope. Ship it
  behind a flag only after the recursive sanitiser, search text, TOC and mobile-stacking tests pass.
- **key facts and references are additions** the brief did not list. They earn their place because
  trust and sourcing are the product’s differentiator on medical pages.

---

## 2. Inline rich text

**Decision: support bold, italic and links. No underline, no strikethrough, no inline code.**
Underline is confusable with links (accessibility); strikethrough on clinical guidance reads as a
retraction and is unsafe; inline code has no place in patient-facing prose.

**Storage model — structured runs, not HTML.** Rich fields carry `rich?: RichSpan[]`
(`RichSpan = {text 1–5000, marks?: ('bold'|'italic'|'superscript'|'subscript')[],
link?: {href URL ≤2048, newTab bool}}`, max 500 spans). The existing `text` string remains the
plain-text projection; when `rich` is present the backend re-derives `text` from it so search and
legacy consumers never drift. Blocks with no `rich` render exactly as today.

**Where it applies (v1):** paragraph, list items, quote, callout text, accordion answers.
**Deliberately plain:** headings (TOC/anchor integrity), table cells (data integrity), cards,
steps, checklist, references. Extend later only with evidence.

**Tag whitelist (render-time mapping, not an HTML parser):**
`strong`, `em`, `a`, `br`, `sup`, `sub` — nothing else. Allowed attributes: `a[href]` only.
No `u`, `s`, `code`, `span`, `div`, `img`, `style`, `class`, `id`, or event attributes.

**Link protocols:** `https:`, `http:` (for legacy content), site-relative `/…`, `mailto:`, `tel:`.
Rejected: `javascript:`, `data:`, `blob:`, `file:`, `ftp:`, `vbscript:`, protocol-relative `//…`,
and empty hrefs. Hrefs are trimmed, length-capped and re-validated on every save.

**Security rule:** no text field is ever interpreted as HTML. The renderer maps the closed set of
marks to React elements and renders every string as a text node; it never uses
`dangerouslySetInnerHTML`. Unrecognised marks are dropped, never passed through. `newTab` links get
`rel="noopener noreferrer"`. Invalid runs fall back to their plain text; invalid links lose the link,
not the text.

---

## 3. Page features (create / update)

| Feature | What it does | Priority |
|---|---|---|
| **SEO meta** | `metaTitle` ≤70, `metaDescription` ≤160, `canonicalPath` ≤2048, `robots` index\|noindex, `ogImage` URL. Public page emits title, description, canonical, robots and OG tags; sensible fallbacks to page title/excerpt. Existing `meta_keywords` is legacy: keep stored data, remove from the editor. | **MUST** |
| **Templates / starters** | “New page” offers Blank, Article/Guide, Treatment, Condition/Diagnosis, FAQ, Practitioner bio. Server-defined, versioned block recipes that prefill a draft; fully editable. Not user-editable templates. | **MUST** |
| **Duplicate page** | Deep-copies title, content and meta into a new draft; slug becomes `-copy`, `-copy-2`; clears `status`, `live_*`, `published_at`, approvals and revisions; copies contributors. | **MUST** |
| **Block duplicate / reorder / drag** | Duplicate inserts a deep copy after the original. Drag handle reorders; the existing ↑/↓ buttons remain as the keyboard path. Arrange mode (visual offsets) stays separate and is not used for reordering. | **MUST** |
| **Undo / redo** | In-editor history for content and block operations (add, delete, edit, duplicate, reorder, layout change), 50 steps, coalescing rapid typing, Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z. Does not replace server revisions. | **MUST** |
| **Unsaved-changes guard** | Blocks route changes, refresh/close and language switching while dirty; “Discard / Keep editing”. Clears after a successful save. | **MUST** |
| **Revision history UI** | List revisions (time, author, title/slug), preview a revision read-only, restore with confirmation. Restore is admin-only and creates a new revision rather than deleting history. Backend endpoints already exist. | **MUST** |
| **Autosave** | Drafts only; ~2 s after typing stops, with a visible “Saved HH:MM” state. Paused on validation errors, open modals and pending/published pages. Never overwrites a newer server revision silently. | **SHOULD** |
| **Import / export (page)** | Export one page as versioned JSON; import creates a draft (never overwrites by default). Full-site import/export already exists and is not re-scoped. | **SHOULD** |
| **Pre-publish checks** | Non-blocking warnings: missing meta description, image without alt, empty link/CTA, accordion answer empty, treatment page without references, video without captions, audio without transcript. | **SHOULD** |
| **Draft preview link** | Tokenised, `noindex`, read-only public render for reviewers and clinicians before approval. Expiring link. | **SHOULD** |
| **Scheduled publish** | Approved page publishes at `publishAt` in the site timezone; cancellable. Requires a scheduler/worker and an audit entry. | **COULD** |

---

## 4. Non-goals

- **Arbitrary HTML, JavaScript, CSS, custom classes, raw `<iframe>`, theme/font editing.** Security
  and brand control; styling is primitives only.
- **A general website/landing-page builder** (global header/footer/nav editing, popups, countdown
  timers, funnel/A-B testing, personalisation).
- **E-commerce:** pricing plans, checkout, payments, discounts.
- **Forms, surveys, quizzes, polls, appointment booking or patient intake.** CTAs link out.
- **User-generated content:** comments, patient story submissions, ratings.
- **Multi-user real-time collaboration / CRDT.**
- **AI generation, summarisation or auto-translation** of content.
- **Media transcoding, streaming or a full DAM.** Use the existing upload library; no video hosting.
- **Nested columns deeper than one level; free absolute x/y canvas; per-cell table formatting.**
- **Analytics, heatmaps, sitemap/SEO dashboards.**
- **Background job infrastructure** beyond what scheduled publish would require.
- **Replacing or removing any shipped block, workflow state or endpoint.**

---

## 5. Acceptance criteria

### Blocks (one per MUST)
1. **Round-trip:** each MUST block can be inserted, edited, saved, reloaded, submitted, approved and
   fetched from the public API with every field intact (deep-equal JSON, modulo intentional HTML
   stripping) and renders identically in the admin preview and public site.
2. **button:** `javascript:alert(1)` and `data:text/html,…` hrefs are rejected or emptied; `https://`,
   `/path`, `mailto:` and `tel:` are accepted; `newTab` links render `rel="noopener noreferrer"`.
3. **hero:** image requires non-empty `alt`; CTA hrefs use the same allow-list; overlay stays 0–80;
   the heading renders as a real heading in document order.
4. **accordion:** every answer is present in the DOM (not fetched on open); Enter/Space toggles;
   `aria-expanded` and `aria-controls` are correct; `defaultOpen` and `allowMultiple` behave as set.
5. **cards:** 1–12 items render in the chosen column count; a missing image renders a placeholder,
   not a broken image; every card href passes the URL allow-list.
6. **steps:** renders an ordered list (`<ol>`) when `style=numbered`; 2–20 items; no item is dropped
   by the sanitiser.
7. **checklist:** renders static list content, submits nothing, and exposes no checkbox state as a
   form control or API call.
8. **download:** file is served with `Content-Disposition: attachment` and `X-Content-Type-Options:
   nosniff`; only the allow-listed types are accepted; SVG/HTML uploads are rejected; label, type and
   size render.
9. **table-of-contents:** links are generated from heading blocks in document order; duplicate heading
   text yields unique anchors; every link resolves; changing a heading updates the TOC; no dead
   anchors on pages with zero headings.
10. **references:** 1–100 entries render numbered (when enabled); external URLs pass the allow-list;
    an invalid URL keeps the citation text and drops only the link.
11. **video:** only self-hosted media URLs are accepted; no third-party iframe is emitted; a captions
    track renders when provided; autoplay requires `muted`; controls are always present.

### Inline rich text
12. Bold, italic, superscript, subscript, line breaks and links round-trip through save/load/publish;
    the plain `text` projection matches the visible run text.
13. Text containing `<script>`, `<img onerror=…>`, `<style>`, `<iframe>` or any unlisted tag is
    rendered as literal text; no element is created from author input.
14. Links with `javascript:`, `data:`, `blob:`, `file:`, `ftp:`, `vbscript:` or `//` are not rendered
    as links; the link text remains. Invalid spans fall back to plain text rather than failing a save.
15. Blocks without `rich` render exactly as before; no page is migrated or rewritten.

### Page features
16. **SEO:** all five fields save and reload; the public page emits `<title>`, description, canonical,
    robots and OG tags; missing values fall back to title/excerpt; `noindex` is honoured.
17. **Templates:** each starter creates an editable draft with the expected blocks; content passes the
    same sanitiser; no template can inject HTML or unsafe URLs; Blank still creates an empty paragraph.
18. **Duplicate:** creates exactly one new draft; copies content/meta/contributors; does not copy
    revisions, approval fields, `live_*` or `published_at`; slugs remain unique per language.
19. **Duplicate/reorder:** duplicating inserts a deep copy after the original; reordering persists
    after reload; the keyboard path works without a mouse; arrange-mode offsets are unchanged.
20. **Undo/redo:** add, delete, edit, duplicate, reorder and layout changes are undoable; redo restores
    them; history is capped at 50; a save does not corrupt history.
21. **Unsaved guard:** navigating away dirty prompts; navigating away clean does not; saving then
    navigating does not prompt.
22. **Revisions:** list shows time/author; preview is read-only; restore is admin-only and creates a
    new revision; restored content matches the preview exactly.

### Backwards compatibility
23. All 2,000+ seeded pages render with the same DOM structure and inline styles before and after the
    change; no new keys are added to untouched content; `sanitize(sanitize(x)) == sanitize(x)`.
24. All eight existing block types and `home-v1` continue to work through create → save → publish.
25. The canonical block schema and shared design helpers remain byte-identical between `frontend/`
    and `site/` (the existing parity gate).

### Security
26. No field, mark, URL or block can execute script in either app; the XSS test corpus
    (`<script>`, `<img onerror>`, `javascript:`, `data:text/html`, encoded variants) produces zero
    executable nodes.
27. Every URL-bearing field uses one server-side allow-list (`https`, `http`, `/`, `mailto`, `tel`
    where appropriate; `data:image` only for the existing image `src`); invalid values are dropped or
    emptied, never stored raw.
28. `embed` accepts only its named providers and a matching URL pattern; `video`/`audio`/`download`
    accept only upload-library URLs; no author-controlled iframe or file type.
29. Nested `columns` enforce depth 1, 2–3 columns, block-count and byte caps; a recursive payload
    cannot exceed the existing per-block byte cap or cause unbounded processing.
30. Restore, duplicate and import re-run the sanitiser; they never write raw client JSON.

---

## 6. Risks

| # | Risk | Mitigation |
|---|---|---|
| 1 | **Schema drift across backend + two frontends.** Three copies of the contract; a field added in one renderer silently disappears or crashes another. | Backend-first rollout; canonical schema block + shared design helper kept byte-identical; golden fixtures for every block; contract tests in both apps; all fields optional and versioned additively. |
| 2 | **Rich-text / URL XSS.** A run, href or provider URL becomes an injection vector. | Structured runs, no HTML parsing, closed mark set, single URL allow-list, no `dangerouslySetInnerHTML`, CSP, XSS corpus in CI, renderer-level escaping tests. |
| 3 | **Nested columns destabilise the whole pipeline.** Recursion in sanitiser, search text, TOC, revisions, mobile stacking and performance. | Depth 1, 2–3 columns, block/node/byte caps, mobile stacking mandatory, feature flag, dedicated recursion and round-trip tests; defer to SHOULD until green. |
| 4 | **Regulatory / editorial trust.** Unsourced stats, testimonials, price claims or implied cures create legal and reputational exposure in HR/TR/AR/EU markets. | `stats.source` required; `testimonial.consentRef` required and legal sign-off before enabling; templates carry disclaimers; pre-publish warnings; no pricing/discount block; editorial guidance for before/after imagery. |
| 5 | **Third-party media privacy and accessibility.** Video/map embeds leak IP/cookies; uncaptioned media excludes users and may breach accessibility obligations. | Self-hosted video/audio and static maps by default; click-to-load consent for named providers; captions field on video, transcript required on audio, alt required on images; no autoplay with sound. |

---

## 7. Release slices

- **Slice 1 (MUST):** backend validators + rich-text model; button, hero, accordion, cards, steps,
  checklist, download, TOC, references, video; SEO meta, templates, duplicate page, block
  duplicate/reorder, undo/redo, unsaved guard, revision UI; full backwards-compat and security gates.
- **Slice 2 (SHOULD):** columns (flagged), gallery, timeline, stats, key facts; autosave, page
  import/export, pre-publish checks, draft preview link.
- **Slice 3 (COULD):** audio, testimonial, map, named embed, scheduled publish — each only with the
  legal/privacy gate above satisfied.

**Approval gate:** the MUST acceptance criteria are green, the existing 2,000+ pages render
unchanged, and this scope is approved before any source edit begins. This document changes no code.

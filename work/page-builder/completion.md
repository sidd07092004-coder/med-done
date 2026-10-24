# Task: page-builder expansion (all blocks)
- **Status**: COMPLETE
- **Phase**: 5-Report

## Objective
Expanded the page builder from 8 blocks to 27, with layout/design on every element, rich text, all page creation/update features, full admin/editor parity, and public-site rendering.

## Waves executed
| Wave | Owner | Status |
|------|-------|--------|
| 0 | PM + Prompt Engineer | DONE (02-requirements.md, 03-prompt.md) |
| 1 | Backend | DONE — sanitiser + content_text + all 19 new blocks + rich text + columns |
| 2 | Backend | DONE — SEO columns, templates, duplicate, revisions+restore, media delivery/hardening |
| 3 | Shared | DONE — canonical types + blockDesign + RichText byte-identical |
| 4 | Admin | DONE — renderer for all 27 blocks |
| 5 | Admin | DONE — editor primitives + forms for all blocks + arrange/toolbar UX |
| 6 | Admin | DONE — SEO panel, templates, duplicate, undo/redo, dirty guard, pre-publish checks, revisions UI |
| 7 | Site | DONE — renderer for all blocks + SEO meta + RTL-safe styles |

## What was added
### Blocks (19 new, 8 existing)
button, hero, accordion/FAQ, cards, steps, checklist, download, toc, references, video, columns (depth 1), gallery, timeline, stats, key_facts, audio, testimonial, map, embed. Plus full `layout` + per-block design everywhere.

### Rich text
Structured `RichSpan[]` on paragraph, list items, quote, callout, accordion answers. Bold/italic/sup/sub, links with allow-list, no HTML/`dangerouslySetInnerHTML`. Plain text projected for search.

### Page features
SEO meta (title/desc/canonical/robots/OG), server-defined templates, duplicate page, block duplicate/move/drag, undo/redo (50 steps/coalescing), unsaved-changes guard, revision preview/restore, pre-publish checks.

## Verification
| Gate | Result |
|---|---|
| Backend tests | **351 passed, 86 skipped, 0 failed** |
| Admin build | clean |
| Site build | clean |
| Canonical block | byte-identical (13142 chars) |
| `blockDesign.ts` | byte-identical |
| `RichText.tsx` | byte-identical |
| XSS/URL allow-lists + columns recursion | enforced in sanitiser |
| Legacy content | backwards compatible |

## Notes
- Nothing committed (not requested). Working tree contains this expansion plus all prior changes.
- `backend/` nested git remains; root repo is authoritative.
- Columns limited to depth 1, 2–3 columns by design.
- Embed is consent-click-to-load with named providers only.
- Testimonial `consentRef` is never rendered to the public.

# 05 — Validation report: page designer

**Date:** 2026-10-22
**Reviewer:** code-review agent (read-only review, no source file was modified)
**Scope:** the page-designer change set in this repo — backend sanitiser / schema / CRUD / routes,
admin frontend (`frontend/`), public site (`site/`) — validated against the contract in
`work/page-designer/02-requirements.md` (E.1–E.8, F.1–F.12) and
`work/page-designer/03-prompt.md` (§0.4 success criteria, §5.2 cross-agent invariants).

## Verdict: ❌ FAIL — 3 blocking issues

The feature is **structurally sound and 9 of 10 invariants hold**: the schema is additive, the
legacy corpus is untouched, the two apps are byte-parity, the homepage regression is repaired, and
the whole test suite plus both production builds are green. It nonetheless fails because
**(1)** the sanitiser is still not idempotent and loses author text on a second save,
**(2)** the new per-block byte cap silently *deletes* whole blocks, and **(3)** the core backend
file is not staged in the nested `backend/` repository, so the feature can ship without it.

| Severity | Count | IDs |
|---|---|---|
| 🔴 Blocking | 3 | B1, B2, B3 |
| 🟡 Non-blocking | 4 | N1–N4 |
| 💭 Nit | 4 | T1–T4 |

---

## 1. How this was verified

| Check | Command | Result |
|---|---|---|
| Backend suite | `cd backend && ../.venv/bin/python -m pytest -q` | **85 passed, 74 skipped**, 21 warnings (8.6 s) — 0 failures |
| DB round-trip suite (not silently skipped) | `../.venv/bin/python -m pytest tests/test_designer_roundtrip.py -q -rs` | **9 passed** (PG 16 on `127.0.0.1:5433` reachable) |
| Admin build | `cd frontend && npm run build` | ✅ `tsc -b && vite build` clean (8.71 s) |
| Site build | `cd site && npm run build` | ✅ clean (6.85 s) |
| Cross-app parity | `diff -q frontend/src/lib/blockDesign.ts site/src/lib/blockDesign.ts` | ✅ identical |
| Canonical schema parity | `[BEGIN/END CANONICAL BLOCK SCHEMA]` sections of `frontend/src/api/types.ts` vs `site/src/api/types.ts` | ✅ byte-identical |
| Live corpus stability | re-sanitised all **2 084** rows of `pages` | 0 semantic diffs, 0 key-order diffs, 0 non-idempotent pages |
| Legacy purity (E.3.1) | SQL over `pages` for `"layout"` / `"table"` / `"shape"` / `"textColor"` | 1 hit — the DB test fixture `designer-roundtrip-26b486b4`, **0 seeded pages** |
| Sanitiser property fuzz | 20 000 generated strings, `s(s(x)) == s(x)` | **3 failures (0.01 %)** — see B1 |
| Block-cap behaviour | oversized image / list / unknown blocks | **silently dropped** — see B2 |

The 74 skipped tests are the alias shim `backend/tests/test_sanitize_schema.py:1-11`
(`from tests.test_content_schema import *` + module-level `pytestmark = skip`). It is a deliberate
compatibility file, but it makes 74 of 159 collected tests report as "skipped" — cosmetic, see T4.

---

## 2. Invariant results

| # | Invariant | Contract ref | Result | Evidence |
|---|---|---|---|---|
| 1 | **Security** — no XSS, no author-controlled CSS/class injection | E.8.1–E.8.6 | ✅ PASS | `backend/app/services/sanitize.py:113` (`bleach.clean(tags=[], strip=True)`), `:118-128` (`safe_url` → `https?://`, `/`, `data:image/` only, ≤ 8 MB), `:96` (`_HEX_RE`), `:71-79` (denied `style`, `className`, `dangerouslySetInnerHTML`, `__proto__`, `constructor`, `prototype`, `on*`), `:243-249` (`_is_denied_key`, case-insensitive), `:148-198` (numeric clamping). No `dangerouslySetInnerHTML` in either app; the site re-validates the callout variant before using it as a class suffix (`site/src/components/BlockRenderer.tsx:41-46`). `<script>` → `alert(1)`, `javascript:` src → block dropped, `backgroundColor:"red"` → dropped. |
| 2 | **Legacy content stability** — 2 099 seeded pages unchanged, no defaults materialised | E.3.1–E.3.3, §1.1 rule 3 | ✅ PASS | Live DB: 2 084/2 084 pages contain no new keys; re-sanitising every stored page yields a **byte-equal** result (0 diffs). `_sanitize_layout` returns `None` for `{}`/`null`/`[]` (`sanitize.py:275-304`) so no empty `layout` is stored. Legacy callout keeps the site’s variant CSS with no inline style (`site/src/components/BlockRenderer.tsx:53-70`); legacy image/paragraph get `style={{}}` → no attribute (`site/src/components/BlockRenderer.tsx:162-186`); site `<h2>` floor preserved (`site/src/components/BlockRenderer.tsx:123`). |
| 3 | **Sanitiser idempotency** — `s(s(x)) == s(x)` | F.6, §0.4 "Sanitiser idempotency" | ❌ **FAIL → B1** | `backend/app/services/sanitize.py:108-113` applies the *fixed point* to `html.unescape` only, then runs `bleach.clean` once. The two are not commutative, so the composition is not a fixed point. Repro: `"&lt&lt/&gt!"` → `"&lt;!"` → `""` (**text lost on the 2nd save**). 3/20 000 fuzz cases fail; the only test coverage is `backend/tests/test_content_schema.py:134-153` (two benign inputs). |
| 4 | **Round-trip retention** — every new field survives save→reload→publish | E.2.1–E.2.7, §0.4 "New-field retention" | ✅ PASS | `backend/tests/test_designer_roundtrip.py` (9 tests, all green): `test_roundtrip_all_new_blocks:108`, `test_roundtrip_update_keeps_new_fields:123`. `layout` `:275-304`, callout design `:326-339`, image sizing `:307-323`, table `:342-386`. `live_content` snapshot + revisions carry the fields automatically (E.2.4/E.2.5). Search sees table cells (`backend/app/services/content_text.py:40-48`). |
| 5 | **Table normalisation** — padded/truncated, bounded, no cell injection | §5.1 table row, E.1.3 | ✅ PASS | `sanitize.py:63-66` (200 rows × 50 cols × 2 000 chars, 50 header cells), `:228-241` (`_clean_row` pads short rows, drops non-list rows, cleans every cell), `:342-386` (`header`/`rows`/`align`/colours/bools), `:465` (`test_table_bytes_cap_truncates_rows`). |
| 6 | **Homepage** — one per language, deterministic, 404 (never 500) | E.7.1–E.7.5 | ✅ PASS | `backend/app/schemas/page.py:63-64` (`PageUpdate.is_homepage/featured`), `backend/app/crud/crud_page.py:22-31` (lang-scoped `_unset_other_homepages`), `:44-45` / `:59-61` (called on create/update when the flag is `True`), `backend/app/api/v1/routes/public.py:30-35` (`ORDER BY position, created_at, id` + `LIMIT 1` + `scalars().first()` — no `MultipleResultsFound`), `:39` (clean 404). DB tests `test_homepage_exclusive_on_create:138`, `test_homepage_update_unsets_previous:166`, `test_public_homepage_fallback_deterministic:197`. |
| 7 | **No feature removed / workflow intact** | E.6.1–E.6.4 | ✅ PASS | All seven original block types still handled (`sanitize.py:415-461`). Volunteer 403 on the admin-only flags (`backend/app/api/v1/routes/pages.py:82-88` create, `:138-145` update) and the frontend never sends them as a volunteer (`frontend/src/pages/PageEditorPage.tsx:211-215`) → volunteers are **not** blocked from normal editing. Approve/reject/unpublish and the pending-page lock are untouched by the diff. `home-v1` format still supported (`sanitize.py:511-516`). |
| 8 | **Cross-app contract parity** | §5.2 invariants 1–6, E.4.6 | ✅ PASS | `blockDesign.ts` byte-identical in both apps → `layoutToCss()` (`frontend/src/lib/blockDesign.ts:79-97`) cannot diverge. Canonical block schema byte-identical. `layout` is the last style spread on every root element (`frontend/src/components/BlockRenderer.tsx:67`, `site/src/components/BlockRenderer.tsx:89`), except the image where `textAlign` is deliberately dropped (`site/src/components/BlockRenderer.tsx:165`). No raw HTML — all text is JSX-escaped, only `\n` → `<br>` is synthesised. Public API keeps serving `content` (F.7/R28) — `backend/tests/test_designer_roundtrip.py:243`. |
| 9 | **Arrange / responsive safety** | §0.4 "Responsive safety", R19 | ✅ PASS (1 🟡 → N1) | `frontend/src/lib/arrange.ts` is pure and clamped: `moveBox:60-73` (offset 0…90), `resizeBox:82-94`, `applyArrangeBox:104-127` (default box → *no keys written*, so legacy blocks stay byte-identical). Width/offset clamp matches the renderers (`blockDesign.ts:88-90`: `min(width, max(0, 100 - abs(offset)))`). Arranging is off by default and adds no DOM/CSS when off. |
| 10 | **Release hygiene / no dead or stale code** | F.9 | ❌ **FAIL → B3** | `backend/app/services/sanitize.py` — the file this whole feature hangs on — is **untracked** in the nested `backend/` repo (`git -C backend status` → `?? app/services/sanitize.py`; its HEAD `a978cc1` has no `app/services/sanitize.py` at all). The root repo tracks it (109 `backend/*` files) and sees it as modified. Whichever repo is cut for release wins. |

---

## 3. Blocking issues

### 🔴 B1 — The sanitiser is still not idempotent → author text is silently lost on the second save

**Where:** `backend/app/services/sanitize.py:99-115` (`_clean_text`)

The rewrite made `html.unescape` a fixed point (`:108-112`) and then calls `bleach.clean` once
(`:113`). Folding *only* the unescape into a fixed point does not make the **pair**
(`unescape` → `bleach.clean`) a fixed point, because `bleach` escapes stray `<` back into `&lt;`
and strips partial tag / bogus-comment constructs:

```
pass 1:  "&lt&lt/&gt!"  --unescape-->  "<</>!"  --bleach-->  "&lt;!"
pass 2:  "&lt;!"       --unescape-->  "<!"     --bleach-->  ""          <-- the text is gone
```

**Repro (verified against the live code):**

```python
from app.services.sanitize import sanitize_content
one = lambda t: sanitize_content({"format": "blocks-v1", "blocks": [{"type": "paragraph", "text": t}]})
print(repr(one("&lt&lt/&gt!")["blocks"][0]["text"]))   # '&lt;!'
print(repr(one(one("&lt&lt/&gt!")["blocks"][0]["text"])["blocks"][0]["text"]))  # ''  <- lost
```

Other confirmed inputs that lose text on the second save: `"<<!&gt/&gt"` → `"&lt;/&gt;"` → `""`,
`"&lt;</>!>t"` → `"&lt;!&gt;t"` → `"t"`, `"&lt;<!>t "` → `"&lt;t "` → `""`.

**Why it matters:** F.6 and §0.4 both make idempotency a *success criterion* ("the property that
guarantees a save/load/save cycle never drifts"). The failure mode is silent content loss: an
author writes text containing an HTML entity next to a `<!`/`</` fragment (escaped markup pasted
from another CMS is the realistic trigger), saves, edits something else, saves again — and part of
their paragraph is gone. The rate is low (~0.01 % of adversarial strings, 0 of 2 084 real pages
today), but the blast radius is authored medical copy.

**Minimal fix** (verified in isolation: 0 failures in 20 000 fuzz cases, and byte-identical output
for every security spot-check — `<script>alert(1)</script>` → `alert(1)`,
`"&amp;lt;script&amp;gt;"` → `""`, `"A & B"` → `"A &amp; B"`, ordinary prose unchanged):

```python
def _clean_text(value: Any, limit: int = MAX_TEXT) -> str:
    if value is None:
        return ""
    text = str(value)
    # Fold the *whole* pipeline (unescape + strip) to a fixed point, not just the unescape.
    for _ in range(10):
        nxt = bleach.clean(html.unescape(text), tags=[], attributes={}, strip=True)
        if nxt == text:
            break
        text = nxt
    return text.replace("\x00", "")[:limit]
```

**Test to add** (`backend/tests/test_content_schema.py`, next to the entity tests at `:134`):

```python
@pytest.mark.parametrize("text", ["&lt&lt/&gt!", "<<!&gt/&gt", "&lt;</>!>t", "&lt;<!>t "])
def test_clean_text_is_a_fixed_point(text):
    once = sanitize_content(blocks({"type": "paragraph", "text": text}))
    assert sanitize_content(once) == once
```

…plus a property test over a corpus (the fuzz above) so the property, not two hand-picked
strings, is what the suite enforces.

---

### 🔴 B2 — The per-block byte cap silently *deletes* whole blocks

**Where:** `backend/app/services/sanitize.py:489-500` (`_enforce_block_cap`), applied at
`:521-528` (`sanitize_content`)

```python
def _enforce_block_cap(block):                       # :489
    if len(json.dumps(block, ...)) <= MAX_BLOCK_BYTES: # :491
        return block
    table = block.get("table") if block.get("type") == "table" else None
    if isinstance(table, dict):                       # :494
        rows = table.get("rows")
        while isinstance(rows, list) and rows:        # :496
            rows.pop()                                # :497  (rows dropped from the end — per F.3)
            if len(json.dumps(block, ...)) <= MAX_BLOCK_BYTES:
                return block
    return None                                       # :500  <-- every non-table block is DELETED
```

`sanitize_content` then drops the `None` silently (`:526-527`). Verified behaviour:

| Input | Result |
|---|---|
| `image` with a 200 KiB `data:image/png;base64,…` src | kept |
| `image` with a **260 KiB** data-URL src | **whole block deleted** (no error, no log) |
| `image` with a 1 MB data-URL src | **whole block deleted** |
| `list` with 130 items × 2 000 chars | kept |
| `list` with **131** items × 2 000 chars | **whole block deleted** |
| `list` with 500 items × 2 000 chars (the sanitiser’s own `MAX_ITEMS` limit) | **whole block deleted** |
| `table` with 200 rows × 2 000 chars | truncated to 130 rows (per F.3) |

**Why it matters:**

1. **It contradicts the sanitiser’s own limits.** `MAX_ITEMS = 500` × `MAX_CELL_CHARS`/item
   `2000` = ~1 MB is *permitted* by `_sanitize_block` (`:436`), and `safe_url` explicitly allows
   `data:image/` up to 8 MB (`:126-128`) — both are then deleted by the byte cap. A list of 131
   items or a base64 image over 256 KiB is legal input that the server accepts with HTTP 200 and
   silently discards.
2. **It is reachable from the admin UI.** The list editor is a free-text textarea split on `\n`
   with no item or length cap (`frontend/src/pages/BlockEditor.tsx:964-965`) and the image
   “Image URL” input has no `maxLength` (`frontend/src/pages/BlockEditor.tsx:1164-1170`), so an
   author can produce an over-cap block in seconds. They then hit **Save**, get **“Saved.”**, and
   the block is gone.
3. **It is a regression.** The old sanitiser had no byte cap at all — the old code preserved
   everything it understood.
4. **F.3 only prescribes the table case** (“if the serialised block exceeds 256 KB, *the table* is
   truncated (rows dropped from the end) before storage”). Deleting non-table blocks is beyond the
   contract, and the only test for the cap (`backend/tests/test_content_schema.py:465-471`) covers
   the table path — the delete path is untested.

**Minimal fix:** never delete a block because of its size — shrink it instead, and only the table
path per F.3. Prototype verified: a 500 × 2 000 list shrinks to 130 items / 260 565 bytes (block
kept), and a 300 KB data-URL image keeps its block with a truncated src.

```python
def _enforce_block_cap(block: Dict[str, Any]) -> Dict[str, Any]:
    """Keep a block below MAX_BLOCK_BYTES by SHRINKING it — never by deleting it."""
    def size(b): return len(json.dumps(b, ensure_ascii=False, default=str))
    if size(block) <= MAX_BLOCK_BYTES:
        return block
    if block.get("type") == "list" and isinstance(block.get("items"), list):
        while block["items"] and size(block) > MAX_BLOCK_BYTES:
            block["items"].pop()          # drop trailing items, keep the block
        return block
    if block.get("type") == "table":
        rows = (block.get("table") or {}).get("rows")
        while isinstance(rows, list) and rows and size(block) > MAX_BLOCK_BYTES:
            rows.pop()                    # F.3 behaviour, unchanged
        return block
    # image / unknown blocks: keep the block, shrink the largest string
    ...
    return block                          # <- never `None`
```

For the image case, decide explicitly what a >256 KiB inline payload should do (truncate the
data URL, or reject the `src` with a visible validation error) — but do it in a way the author can
see, and surface it in the editor. A page-level total cap (e.g. 8 MiB) with an explicit **422**
“page content is too large” is a better backstop than silent per-block deletion.

**Tests to add** (`backend/tests/test_content_schema.py`):

```python
def test_oversized_list_block_is_not_deleted():
    out = one({"type": "list", "items": ["z" * 2000 for _ in range(500)]})
    assert out, "an over-cap list must not be dropped"

def test_oversized_image_block_is_not_deleted():
    out = one({"type": "image", "src": "data:image/png;base64," + "A" * 300_000})
    assert out, "an over-cap image must not be dropped"
```

---

### 🔴 B3 — The core backend file is not staged in the nested `backend/` repository

**Where:** `backend/` is simultaneously a nested Git repo (`.git`, HEAD `a978cc1`, branch `dev`)
**and** tracked by the root repo (109 files). F.9 documents exactly this hazard.

```
$ git -C backend status --porcelain | grep services
 M app/services/content_text.py
?? app/services/sanitize.py          <-- the file the whole feature lives in

$ git -C backend ls-files app/services/
app/services/__pycache__/content_text.cpython-312.pyc
app/services/content_text.py          <-- sanitize.py does not exist in the nested repo's HEAD
```

The root repo *does* track it (`git diff --stat` → `backend/app/services/sanitize.py | 482 +++-`),
but the nested repo's committed tree has **no `sanitize.py` at all**. Consequences:

* If the release is cut from the nested repo, `app/services/sanitize.py` is missing →
  `from app.services.sanitize import sanitize_content` fails at import → **the API does not start**
  (or, if the file is merely untracked and added later, the old strip-and-drop sanitiser ships and
  the feature loses every new field on save — exactly the root cause this project set out to fix).
* If the release is cut from the root, the nested repo's tree stays stale and the next
  `git -C backend commit` will either lose the change or bundle the 20 unrelated modified/untracked
  files that are already sitting in that repo (audit-log, media, stats, translations, bootstrap…).

**Minimal fix — pick one source of truth and make it explicit:**

*Option A (recommended, smallest):* stage the page-designer backend files in **both** repositories
and commit them separately, so neither tree is missing them:

```bash
git -C backend add app/services/sanitize.py app/services/content_text.py app/schemas/page.py \
                  app/crud/crud_page.py app/api/v1/routes/pages.py app/api/v1/routes/public.py \
                  tests/test_content_schema.py tests/test_designer_roundtrip.py tests/test_sanitize_schema.py
git add backend/app backend/tests frontend/src site/src
```

*Option B (cleaner long term):* remove the nested `.git` and let the root repo be the single
source of truth for `backend/`, or add `backend/` to the root `.gitignore` and keep only the
nested repo. Either way the duplicate ownership has to end — today every backend edit has to be
remembered twice.

Also: `__pycache__/*.pyc` files are tracked in both repos and show up as noise in every
`git status` (F.9 says “ignore them, do not stage them deliberately”); they should be untracked.

---

## 4. Non-blocking issues

### 🟡 N1 — Negative `offsetX` can overflow the public layout
`backend/app/services/sanitize.py:286` accepts `offsetX` in `-100…100`; the Design panel slider and
number input mirror that (`frontend/src/pages/BlockEditor.tsx:311-337` — note the contract’s
§C.2.3 says the numeric input should be −50…50). `layoutToCss` maps it to a physical
`margin-left: -X%` (`frontend/src/lib/blockDesign.ts:91`), and the public site’s content column
has no `overflow-x` clip (`site/src/index.css` — only `:126`, `:321`, `:429`, `:661`), unlike the
admin preview (`frontend/src/index.css:1664`). Result: a deliberately negative offset makes the
block stick out of the content column and gives the public page a horizontal scrollbar.
*Fix:* either clamp `offsetX` to `0…100` in the sanitiser (arrange mode already never produces a
negative offset — `frontend/src/lib/arrange.ts:65-69`) or add `overflow-x: clip` to the site’s
content column.

### 🟡 N2 — The admin preview never uses the legacy callout path, the site does
`site/src/components/BlockRenderer.tsx:53-70` implements the R15/D6 carve-out (a callout without a
design key keeps the legacy variant CSS, no inline style), but the admin renderer
(`frontend/src/components/BlockRenderer.tsx:50-94`) always applies the new inline style. The admin’s
legacy rendering *was* already inline style, so nothing regresses visually — but the two apps now
take different code paths for the same input, which is exactly the divergence E.4.6 is meant to
catch, and the admin does not re-validate `variant` before using it as a class suffix
(`frontend/src/components/BlockRenderer.tsx:72`; the site does at `:41-46`). The backend slug rule
(`sanitize.py:208-213`) plus React’s attribute escaping make this safe today.
*Fix:* port `variantSlug()` to the admin renderer for parity and defence in depth.

### 🟡 N3 — No total-page size cap
`MAX_BLOCKS = 2000` (`sanitize.py:59`) × `MAX_BLOCK_BYTES = 262 144` implies a theoretical 512 MB
page. The byte cap does not bound the page.
*Fix:* add a page-level cap with an explicit 422 rather than relying on per-block truncation.

### 🟡 N4 — Stale documentation
`AGENTS.md` states “the public API always serves `live_*`”. The code deliberately serves
`page.content` (F.7/R28 — the public API must keep serving `content` until `live_content` is
backfilled), and `backend/tests/test_designer_roundtrip.py:243` now pins that behaviour.
*Fix:* correct the `AGENTS.md` sentence to match F.7; the implementation is right, the doc is wrong.

---

## 5. Nits

* **T1** `CALLOUT_VARIANTS` (`backend/app/services/sanitize.py:53`) is now dead — custom slugs are
  allowed (`_slug` at `:208-213`). Either use it as the *default-label* map or delete it.
* **T2** `site/src/lib/blockDesign.ts` exports `CALLOUT_SHAPES` / `CalloutShape`, which the site
  never imports. It must stay byte-identical to the admin copy (parity gate), so the fix is a
  comment, not an edit.
* **T3** Pydantic v2 deprecation warnings: `.dict()` at
  `backend/app/crud/crud_page.py:35` and `:51`, `backend/app/api/v1/routes/pages.py:136`, and
  `backend/tests/test_content_schema.py:642/645/649`. Switch to `model_dump()`.
* **T4** The alias shim `backend/tests/test_sanitize_schema.py` makes 74 of 159 collected tests
  report as *skipped*. It satisfies the “both filenames must exist” requirement, but the skip
  markers make CI output misleading.

---

## 6. Could not verify

* **No browser/DOM run.** `ArrangeOverlay` was reviewed statically (`frontend/src/components/ArrangeOverlay.tsx`,
  `frontend/src/lib/arrange.ts` — both pure/clamped) and the admin build is clean, but drag-resize
  behaviour, the keyboard fallback and the 360 px no-horizontal-scroll criterion (§0.4) were not
  exercised in a real browser.
* **No Docker/runtime validation** — Docker is not installed locally, so `deploy.sh` /
  `docker-entrypoint.sh` were not executed.
* **Live HTTP round trip** — the API was exercised through the DB-backed pytest suite and direct
  SQL/ORM inspection rather than a running uvicorn + `curl` session (E.2.1–E.2.7 are covered by
  `tests/test_designer_roundtrip.py`, but the literal curl steps of §6.3 were not re-run).
* **Production DB** — the corpus check ran against the local dev database (2 084 pages, `en` only);
  the contract mentions 2 099 seeded pages, so the local seed is 15 pages short of the documented
  figure. This does not affect any verdict (the check was a full sweep of what exists).

---

## 7. Summary

The hard part of this feature — the additive, validate-and-keep schema, the byte-parity between
the two apps, the additive-only legacy path, the homepage repair and the admin-only flag guards —
is done well and is backed by green tests. The failures are all in the *new* code that the feature
added around that core:

1. the fixed-point rewrite fixed only half of the pipeline, so the sanitiser still drifts and can
   delete author text on a second save (B1);
2. the new byte cap deletes blocks instead of shrinking them, and it deletes inputs that the
   sanitiser’s own limits explicitly permit (B2);
3. the release packaging can drop the feature’s core file entirely, because the nested repository
   has never tracked it (B3).

Fix B1 (one function, one property test), B2 (shrink instead of delete, two tests) and B3 (stage
in both repos or delete one of them) and this becomes a **PASS**.

### Top 3 risks

1. **Silent author-text loss on re-save** (B1) — a contract requirement (F.6) that is still
   unmet, with a data-loss failure mode and only two hand-picked strings of test coverage.
2. **Silent block deletion on save** (B2) — reachable from the admin UI (uncapped list textarea,
   uncapped image-URL input), returns HTTP 200 “Saved.”, and is a regression against the previous
   sanitiser.
3. **Shipping without the sanitiser** (B3) — the nested repo’s tree has no `sanitize.py`; a release
   cut from it either fails to start or silently reintroduces the strip-and-drop behaviour that
   this whole project exists to fix.

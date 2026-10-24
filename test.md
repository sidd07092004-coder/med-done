# Swagger API Retest

## Run Context

- Date: 2026-10-24. All requests in this retest were executed from the Swagger UI at `http://127.0.0.1:8080/docs`.
- OpenAPI showed 48 operations. Every operation was exercised at least once across the initial anonymous pass and this authenticated retest; write paths were also tested with valid and invalid input where safe.
- This is API-level coverage, not line-by-line coverage of every implementation branch. Valid `/admin/import` was intentionally not run because it replaces all groups and pages.
- Admin login used `admin@example.com`; password is `[REDACTED]` here. QA volunteer login used the generated test account listed below; its password is also redacted.
- Tokens/passwords and large pre-existing user/content/export bodies are not copied into this file. Small test responses are captured directly; large list/export responses include response counts and representative fields.
- No application code was modified.

## Test Data

| Fixture | ID / value | Final state |
|---|---|---|
| QA root group | `d1f36be8-01cd-47e5-bf0b-534915db90a2`, `QA-SWAGGER-20261024-UPDATED` | Retained for manual testing. |
| QA child group | `d40fb704-36cd-425f-8c17-248aefec54f4`, `QA-SWAGGER-CHILD` | Retained as a root group after move testing. |
| QA English page | `ee06d260-c76a-4ba1-8a60-d8f336324cd7`, slug `qa-swagger-20261024` | Retained as draft, unpublished, `is_homepage=false`, in the QA root group. |
| QA Croatian translation | `66ce62df-2d89-4b5d-8339-4d787cbe35f2` | Retained as draft. |
| QA volunteer | `2a44d0d1-aa40-4789-9655-f419d94cc8ff`, `qa.swagger.20261024@example.com` | Retained, active, role `volunteer`. Password is not recorded. |
| QA contributor | `af74a53f-f6e4-49d4-afa9-e2121e82677d` | Removed during contributor DELETE test. |
| Duplicate page | `64f04e69-d3d6-4e8e-abf4-8c157cf73c43` | Deleted after duplicate/delete test; subsequent GET returned 404. |
| Temporary media | `ee769a7e-63ab-46e3-b12c-00406c3de338` | Deleted after upload/list/delete tests. |
| Delete-probe user/group | IDs recorded in tool run; names `QA Delete Probe`, `QA-SWAGGER-DELETE-PROBE` | Deleted successfully. |

The main page was created with this request body:

```json
{
	"title": "QA Swagger Page",
	"slug": "qa-swagger-20261024",
	"group_id": "d1f36be8-01cd-47e5-bf0b-534915db90a2",
	"lang": "en",
	"content": {
		"format": "blocks-v1",
		"blocks": [
			{"type": "heading", "level": 2, "text": "QA fixture heading"},
			{"type": "paragraph", "text": "Created through Swagger for API workflow testing."}
		]
	},
	"excerpt": "QA fixture",
	"is_homepage": false,
	"featured": false,
	"position": 50,
	"meta_title": "QA metadata",
	"meta_description": "Initial page description",
	"meta_keywords": ["qa", "swagger"],
	"canonical_path": "/qa-swagger-20261024",
	"robots": "index",
	"og_image": "/uploads/test-image.png",
	"status": "draft"
}
```

## Auth

| Request | Body / query | Response |
|---|---|---|
| `POST /api/v1/auth/login` | Form `grant_type=password`, `username=admin@example.com`, `password=[REDACTED]` | `200`; `token_type=bearer`, `expires_in=3600`, admin user `f54bd387-36d9-4667-8ab1-5dbda216738c`. Token redacted. |
| `POST /api/v1/auth/login/json` | `{"email":"admin@example.com","password":"[REDACTED]"}` | `200`; same admin user and token fields. Token redacted. |
| `POST /api/v1/auth/login/json` | Correct email, incorrect password | `400 {"detail":"Incorrect email or password"}`. |
| `POST /api/v1/auth/login/json` | `{"email":"not-an-email","password":"x"}` | `422`; Pydantic reports invalid email address. |
| `GET /api/v1/auth/me` | Bearer admin token | `200`; admin identity returned. |
| `GET /api/v1/auth/verify` | Bearer admin token | `200 {"valid":true,"user":{...admin identity...}}`. |
| `POST /api/v1/auth/login/json` | QA volunteer, correct password (redacted) after deactivation | `400 {"detail":"Inactive user"}`. |
| `POST /api/v1/auth/login/json` | QA volunteer, correct password after reactivation | `200`; volunteer identity and bearer token returned. Token redacted. |

## Users

| Request | Body / path | Response |
|---|---|---|
| `GET /admin/users/` | None | Admin `200`; four pre-existing users at that point. Volunteer `403 Not enough permissions`. |
| `POST /admin/users/` | `.test` email domain, valid remaining fields | `422`; email validator rejects reserved special-use domain. No user created. |
| `POST /admin/users/` | `{"email":"qa.swagger.20261024@example.com","name":"QA Swagger Volunteer","role":"volunteer","is_active":true,"password":"[REDACTED]"}` | `200`; created user `2a44d0d1-aa40-4789-9655-f419d94cc8ff`. |
| `POST /admin/users/` | Same email again | `400 {"detail":"Email already registered"}`. |
| `POST /admin/users/` | Email `qa.invalidrole.20261024@example.com`, role `owner` | `400 {"detail":"Role must be one of ['admin', 'volunteer']"}`. |
| `GET /admin/users/{user_id}` | QA volunteer ID | `200`; active volunteer returned. |
| `PATCH /admin/users/{user_id}` | `{"name":"QA Swagger Volunteer Updated","is_active":false}` | `200`; inactive state and new name returned. |
| `PATCH /admin/users/{user_id}` | `{"role":"owner"}` | `400`; invalid role rejected. |
| `PATCH /admin/users/{user_id}` | `{"is_active":true,"role":"admin"}`, then `{"role":"volunteer"}` | Both `200`; QA user's role transitions were restored to `volunteer`. |
| `DELETE /admin/users/{user_id}` | Disposable `QA Delete Probe` ID | `200 {"message":"User deleted"}`; subsequent GET returned `404 User not found`. |
| `GET` or `DELETE /admin/users/{user_id}` | UUID `00000000-0000-0000-0000-000000000001` | `404 {"detail":"User not found"}`. |

## Groups

| Request | Body / path | Response |
|---|---|---|
| `GET /admin/groups/` | Admin | `200`; tree returned. Volunteer also received `200` (`array(9)` root groups at that time). |
| `POST /admin/groups/` | `{"name":"QA-SWAGGER-20261024","name_translations":{"hr":"<b>Provjera</b>","tr":" Test ","invalid":"ignored"},"parent_id":null,"position":9000}` | `200`; created parent group `d1f36be8-01cd-47e5-bf0b-534915db90a2`; translation response was `{"hr":"Provjera","tr":"Test"}` (HTML/whitespace cleaned, unsupported language dropped). |
| `POST /admin/groups/` | Child `{"name":"QA-SWAGGER-CHILD","name_translations":{"hr":"Dijete"},"parent_id":"d1f36be8-01cd-47e5-bf0b-534915db90a2","position":2}` | `200`; child ID `d40fb704-36cd-425f-8c17-248aefec54f4`; path initially `QA-SWAGGER-20261024/QA-SWAGGER-CHILD`. |
| `GET /admin/groups/{group_id}` | Parent ID | `200`; returned group data. Missing UUID returned `404 Group not found`. |
| `PATCH /admin/groups/{group_id}` | Parent rename, position `9001`, translations `{ "ar":"<b>\u0645\u0631\u0627\u062c\u0639\u0629</b>", "en":"ignored" }` | `200`; renamed path updated; returned translation `\u0645\u0631\u0627\u062c\u0639\u0629`, dropped unsupported English key. |
| `PATCH /admin/groups/{group_id}/move` | `{"parent_id":"<same group id>","position":0}` | `400 {"detail":"A group cannot be its own parent"}`. |
| `PATCH /admin/groups/{group_id}` | Set parent to its own child ID | `400 {"detail":"Cannot move a group inside one of its own subgroups"}`. |
| `DELETE /admin/groups/{group_id}` | Parent while QA child exists | `400 {"detail":"Cannot delete group with subgroups"}`. |
| `DELETE /admin/groups/{group_id}` | QA child while nested under QA parent, repeated twice | `500 Internal Server Error` both times; group remained. It was later moved to root and retained. |
| `PATCH /admin/groups/{group_id}/move` | QA child `{"parent_id":null,"position":9002}` | `200`; child is now a root group, response position normalized to `9`. |
| `POST /admin/groups/`, then `DELETE /admin/groups/{group_id}` | Empty root `QA-SWAGGER-DELETE-PROBE` | Create `200`; delete `200 {"message":"Group deleted"}`. |
| `POST /admin/groups/` as volunteer | `{"name":"QA-VOLUNTEER-FORBIDDEN"}` | `403 {"detail":"Not enough permissions"}`; no group created. |

## Pages / Workflow

| Request | Body / path | Response |
|---|---|---|
| `GET /admin/pages/` | `group_id=<QA parent>&lang=en&status=draft&q=qa-swagger-20261024&include_homepage=false` | `200`; matched QA page. No-filter list returned `200` with 18 pages at that point. Invalid `group_id=not-a-uuid` returned `422 uuid_parsing`. |
| `POST /admin/pages/` | Full QA page JSON above | `200`; ID `ee06d260-c76a-4ba1-8a60-d8f336324cd7`, status `draft`, derived `content_text` correct. |
| `POST /admin/pages/` | Same slug/body again | `409 {"detail":"A page with slug 'qa-swagger-20261024' (en) already exists"}`. |
| `GET /admin/pages/templates` | None | `200`; six templates: blank, article, treatment, condition, faq, practitioner. |
| `GET /admin/pages/queue` | None | `200 []` before submitting QA page. |
| `GET /admin/pages/{page_id}` | QA ID | `200`; page returned. Missing UUID returned `404 Page not found`. |
| `PATCH /admin/pages/{page_id}` | `{"title":"QA Swagger Page Updated","content":{"format":"blocks-v1","blocks":[{"type":"paragraph","text":"<script>alert(1)</script><b>Sanitizer check</b>"}]},"meta_title":"<80 X characters>","meta_description":"<180 D characters>","canonical_path":"javascript:alert(1)","robots":"follow","og_image":"javascript:alert(1)"}` | `200`; script/HTML tags removed from content, derived text `alert(1)Sanitizer check`; title capped at 70 chars, description at 160; unsafe canonical/robots/image became `null`. |
| `PATCH /admin/pages/{page_id}` | `{"slug":"test-page-1"}` | `409` duplicate slug. |
| `GET /admin/pages/{page_id}/revisions` | QA ID | `200`; revision `c4156358-1fe4-41e0-a8dd-24cfc2311253` captured initial title/slug/group. |
| `POST /admin/pages/{page_id}/revisions/{rev_id}/restore` | QA page and above revision ID | `200`; restored initial title/content/group; restore remains editable and created its own snapshot. |
| `POST /admin/pages/{page_id}/duplicate` | QA page ID | `200`; created draft slug `qa-swagger-20261024-copy`, ID `64f04e69-d3d6-4e8e-abf4-8c157cf73c43`. |
| `DELETE /admin/pages/{page_id}` then GET same ID | Duplicate page ID | Delete `200 {"message":"Page deleted"}`; GET `404 Page not found`. |
| `PATCH /admin/pages/{page_id}/move` | `{"group_id":"d40fb704-36cd-425f-8c17-248aefec54f4","position":1}` | `200`; page moved to child; later revision restore returned it to QA parent. |
| `POST /admin/pages/{page_id}/submit` | QA page | `200`, status `pending`. Re-submit while pending returned `400 Page not in draft/rejected state`. |
| `POST /admin/pages/{page_id}/reject` | `{"reject_note":"QA rejection edge-case note"}` | `200`, status `rejected`, note preserved. |
| `POST /admin/pages/{page_id}/submit`, then `/approve` | QA page | Both `200`; status became `pending`, then `published`; live slug set. |
| `GET /api/v1/pages/qa-swagger-20261024?lang=en` | Published QA page | `200`; returned the page's live title/content. |
| `POST /admin/pages/{page_id}/unpublish` | Published QA page | `200`; status returned to `draft`, live slug cleared. |
| `POST /admin/pages/{page_id}/approve`, `/reject`, `/unpublish` | QA page while draft | Each returned `400` with the appropriate invalid-state detail. |
| `POST /admin/pages/{page_id}/translations` | `{"lang":"fr"}` | `400 Unsupported language`. |
| `POST /admin/pages/{page_id}/translations` | `{"lang":"hr"}` | `200`; created Croatian translation `66ce62df-2d89-4b5d-8339-4d787cbe35f2`. Repeated request returned `409 Translation already exists for hr`. |
| `GET /admin/pages/{page_id}/translations` | QA page ID | `200`; `hr` points to the Croatian draft; `tr` and `ar` are `null`. |
| `POST /admin/pages/{page_id}/contributors` | `{"name":"   ","role":"Tester"}` | `400 Contributor name is required`. |
| `POST /admin/pages/{page_id}/contributors` | `{"name":"QA Contributor","role":"Tester"}` | `200`; contributor ID `af74a53f-f6e4-49d4-afa9-e2121e82677d`. GET list returned it; matching DELETE returned `200 Contributor removed`. |
| `DELETE /admin/pages/{page_id}/contributors/{contributor_id}` | Contributor created on QA page, but path `page_id` set to existing `test-page-1` page | `200 Contributor removed`; the unrelated QA contributor was deleted. See confirmed issue below. |
| Volunteer `PATCH /admin/pages/{page_id}` | Pending QA page, `{"title":"QA blocked pending edit"}` | `403 Page is pending approval and locked`. |
| Volunteer `POST /admin/pages/{page_id}/approve` | Pending QA page | `403 Not enough permissions`. |
| Volunteer `POST /admin/pages/` | QA page body with `is_homepage=true` | `403 Only admins can set is_homepage or featured`. No page created. |
| Admin publish/unpublish homepage pass | Set QA page `is_homepage=true`, submit, approve, GET homepage, unpublish, then set flag false | Every step `200`; homepage GET returned QA page. Final QA page state is draft, unpublished, `is_homepage=false`. |

## Groups Outside CRUD

| Request | Input | Response |
|---|---|---|
| `GET /admin/stats` | None | `200`; response keys include `total_pages`, `published`, `pending`, `draft`, `rejected`, `coverage_pct`, `groups`, `max_depth`, `translations`, `contributors`, `approval_queue`; `total_pages=13` at request time. |
| `GET /admin/audit-logs` | `limit=5&skip=0` | `200`; `total=305`, first five returned. |
| `GET /admin/audit-logs` | `limit=5&skip=0&action=Moved&target_type=group` | `200`; `total=44`, five matching group-move events returned. |
| `GET /admin/audit-logs` | `limit=5&skip=0&action=QA&target_type=group` | `200`; `total=0`, `items=[]`. |
| `GET /admin/export` | None | `200`; `schemaVersion=2`; at export time counts were 5 users, 15 groups, 18 pages, 288 audit entries. Existing export data is not copied into this file. |
| `POST /admin/import` | `{}` or `{"groups":[],"pages":[]}` | Both `400 Import payload is missing groups and pages`; no content replacement occurred. **Valid import intentionally skipped.** |

## Media

| Request | Input | Response |
|---|---|---|
| `POST /admin/media/upload` | Temporary 59-byte text file named `swagger-probe.png`, MIME `image/png` | `200`; ID `ee769a7e-63ab-46e3-b12c-00406c3de338`, `content_type=image/png`, `size_bytes=59`. |
| `POST /admin/media/upload` | Temporary `swagger-probe.svg` | `400 {"detail":"Unsupported file type"}`. |
| `GET /admin/media/` | None | `200`; listed the uploaded QA record and two pre-existing media records. |
| `DELETE /admin/media/{media_id}` | QA media ID | `200 {"message":"Media deleted"}`; subsequent list no longer contained QA media. |
| `DELETE /admin/media/{media_id}` | Missing UUID | `404 {"detail":"Media not found"}`. |
| Volunteer `DELETE /admin/media/{media_id}` | Missing UUID | `403 Not enough permissions`, confirming role gate precedes resource lookup. |

## Public / Health

| Request | Input | Response |
|---|---|---|
| `GET /api/v1/homepage` | `lang=en` before QA homepage was published | `404 Homepage not found`; after publishing QA homepage, `200` with QA page. |
| `GET /api/v1/pages` | `lang=en` | `200`; existing published page list returned. |
| `GET /api/v1/pages` | `lang=hr` | `200 []` (no published Croatian pages at that time). |
| `GET /api/v1/pages/{slug}` | `slug=test-page-1&lang=en` | `200`; existing published page `16148da0-f338-4106-acb4-f0aecc3ea0e3`. |
| `GET /api/v1/pages/{slug}` | `slug=missing-test-slug&lang=en` | `404 Page not found`. |
| `GET /api/v1/navigation` | `lang=en`, also `lang=hr` | Both `200`; response contains group tree and published pages for selected language. |
| `GET /` | None | `200 {"message":"Medically Complicated Admin API","version":"1.0.0"}`. |
| `GET /health` | None | `200 {"status":"ok"}`. |

## Confirmed Issues / Risks

1. **Medium: nested group deletion returns HTTP 500.** `DELETE /admin/groups/d40fb704-36cd-425f-8c17-248aefec54f4` returned `500 Internal Server Error` twice while the empty QA child group had parent `d1f36be8-01cd-47e5-bf0b-534915db90a2`. The group remained readable. Deleting a separate empty root group returned `200`, so this is specific to the nested-group case. No fix was made.
2. **High data-loss risk: import uses multiple commits before completion (source-level finding).** [`backend/app/api/v1/routes/data.py`](backend/app/api/v1/routes/data.py) commits after deleting pages/groups, commits after rebuilding groups, then converts page values such as `position` with unguarded `int(...)`. A malformed page can fail after destructive commits and leave content empty/partial. Valid import was not run against live data.
3. **Cross-page contributor deletion.** `DELETE /admin/pages/{page_id}/contributors/{contributor_id}` accepted a `page_id` for a different page and deleted the contributor by ID alone (`200`). Route does not verify the contributor belongs to the supplied page. The test used only the QA-created contributor; it is now removed.
4. **Upload validation trusts extension and declared MIME, not file signature.** A 59-byte plain-text file named `.png` was accepted as `image/png`. The QA media row was deleted afterward. This can cause mislabeled or malformed media to be served as an image.
5. **Swagger UI validation is client-side for some invalid query values.** `limit=1001` was blocked by Swagger's own max-1000 validation before an HTTP request; backend behavior for that invalid value was not observed. Do not count that as a server `422` test.

## Manual Fixtures

- Admin account remains the existing `admin@example.com`; do not store its password/token here.
- Volunteer account: `qa.swagger.20261024@example.com`, ID `2a44d0d1-aa40-4789-9655-f419d94cc8ff`, role `volunteer`, active. Its test password was not added to this file.
- Group tree fixtures: QA root group `d1f36be8-01cd-47e5-bf0b-534915db90a2` and QA child/root group `d40fb704-36cd-425f-8c17-248aefec54f4`.
- QA page: `ee06d260-c76a-4ba1-8a60-d8f336324cd7`, slug `qa-swagger-20261024`, final status `draft`, unpublished. The Croatian translation remains linked.
- Import, code-level branch coverage, upload size-limit boundaries, malformed uploaded file signatures beyond the single `.png` probe, and complete non-admin workflow coverage against a separate database remain unverified.

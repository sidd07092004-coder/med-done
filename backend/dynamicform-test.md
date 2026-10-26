# Dynamic Forms: Swagger API Test Report

## 1. Purpose and scope

This report records a backend-only dynamic-form API test through Swagger UI and
Playwright. No frontend was tested or modified. API requests described as
executed below were made through Swagger UI's **Try it out** and **Execute**
controls; no curl, direct HTTP client, or script issued API requests.

The run stopped after page creation exposed that the form definition was not
persisted. Public submission, upload, and review requests were not sent against
a page without a published form. The existing implementation guide,
`backend/dynamicform.md`, was not changed.

## 2. Prerequisites and Swagger URL

The repository instructions in `AGENTS.md` say to run the backend from
`backend/`, start PostgreSQL with `./start_pg.sh`, activate the repository-root
virtual environment, initialize/seed with `python init_and_seed.py`, and run
`python -m uvicorn app.main:app --reload --port 8000`. A fresh local server
normally serves Swagger at `http://127.0.0.1:8000/docs`.

For this run, the reachable Swagger UI was
`http://127.0.0.1:8080/docs`. Its title was “Medically Complicated Admin API”
version 1.0.0. The generated OpenAPI link in that UI was
`/api/v1/openapi.json`. The schema and operation forms were inspected in the
browser. Swagger OAuth2 authorization used the development admin initialized
by the repository seed setup; credentials and the resulting bearer token are
intentionally omitted from this report.

To repeat safely, use a development database and authorized development admin.
Authorize from Swagger's **Authorize** dialog. Do not paste a token into this
guide or screenshots. A separate, unauthenticated Swagger tab was used for the
logged-out authorization check so the test tab's session remained untouched.

## 3. Observed OpenAPI contract

These routes and methods were present in the live schema. Administrative
operations below were marked with OAuth2 bearer security; public submission
operations had no security requirement.

| Operation | Request/authentication confirmed in OpenAPI |
| --- | --- |
| `GET /admin/groups/` | OAuth2 bearer; returns a group tree. |
| `POST /admin/pages/` | OAuth2 bearer; JSON `PageCreate`; the response schema is `PageResponse`; observed success status is 200. |
| `GET /admin/pages/{page_id}` | OAuth2 bearer; UUID path parameter. |
| `DELETE /admin/pages/{page_id}` | OAuth2 bearer; UUID path parameter. |
| `GET /admin/forms/{page_id}/config` | OAuth2 bearer; UUID path parameter. |
| `GET /admin/forms/{page_id}/submissions` | OAuth2 bearer; optional `submission_status`, `limit` (default 50), and `offset` (default 0). |
| `GET /admin/forms/{page_id}/submissions/{submission_id}` | OAuth2 bearer; UUID path parameters. |
| `PATCH /admin/forms/{page_id}/submissions/{submission_id}` | OAuth2 bearer; JSON `FormSubmissionReview` with required `status` and `review_data` object. |
| `POST /api/v1/forms/{slug}/submissions` | Public; JSON `FormSubmissionCreate` with required `responses` object; optional `lang` query, default `en`; documented success 201. |
| `POST /api/v1/forms/{slug}/submissions/upload` | Public; multipart `responses` string, `file_fields` string array, and `files` array; optional `lang` query, default `en`; documented success 201. |

The upload receipt schema was `FormSubmissionReceipt` (`id`, `status`, and
`message`). Admin submission responses use `FormSubmissionResponse`, including
`responses`, `review_fields`, `review_data`, and `status`. Review status values
in the implementation/schema are `new`, `reviewing`, `approved`, `rejected`,
`resolved`, and `spam`.

In Swagger's multipart **Try it out** form, `file_fields` and `files` appeared
as `array<string>` controls with an **Add string item** button. There was no
binary file picker for `files`. Thus this UI did not provide a reliable way to
submit the required binary file through the mandated Swagger-only workflow.

## 4. Synthetic page configuration used

The actual slug was unique to this run and is generalized below. The group was
selected from the live `GET /admin/groups/` result by its name, `Volunteer`; its
UUID is omitted. The created content body was:

```json
{
  "title": "Synthetic Dynamic Form QA",
  "slug": "qa-dynamic-form-<timestamp>-<suffix>",
  "group_id": "<UUID returned for the Volunteer group>",
  "lang": "en",
  "status": "published",
  "content": {
    "format": "blocks-v1",
    "blocks": [],
    "form": {
      "enabled": true,
      "title": "Synthetic volunteer application",
      "submit_label": "Send test application",
      "success_message": "Synthetic test response recorded.",
      "fields": [
        {
          "name": "email",
          "label": "Synthetic email",
          "type": "email",
          "required": true
        },
        {
          "name": "interest",
          "label": "Test interest",
          "type": "select",
          "required": true,
          "options": [
            { "label": "Option A", "value": "option-a" },
            { "label": "Option B", "value": "option-b" }
          ]
        },
        {
          "name": "updates",
          "label": "Receive updates",
          "type": "boolean",
          "required": false
        },
        {
          "name": "attachment",
          "label": "Synthetic PDF",
          "type": "file",
          "required": true,
          "accept": [".pdf"],
          "max_size_mb": 1
        }
      ],
      "review_fields": [
        {
          "name": "decision_remark",
          "label": "Decision remark",
          "type": "textarea",
          "required": true
        },
        {
          "name": "priority",
          "label": "Priority",
          "type": "select",
          "required": false,
          "options": ["normal", "urgent"]
        }
      ]
    }
  }
}
```

The invalid configuration probe used the same synthetic title, slug, group,
language, and draft status, with this content:

```json
{
  "format": "blocks-v1",
  "blocks": [],
  "form": {
    "enabled": true,
    "fields": [
      { "name": "duplicate", "label": "First", "type": "text" },
      { "name": "duplicate", "label": "Second", "type": "text" }
    ]
  }
}
```

No public submission JSON body was executed. The live schema's JSON shape was
`{"responses":{"email":"synthetic@example.test","interest":"option-a"}}`;
this is only an illustrative, unexecuted shape, not a test result. No multipart
fields were submitted and no binary file was created or uploaded.

## 5. Swagger steps and observed results

Every executed step below used the relevant Swagger operation, **Try it out**,
filled its path/body fields, and clicked **Execute**. The timestamped slug,
page UUID, group UUID, user identity, and bearer token are generalized or
omitted.

### A. Admin configuration

1. Open `GET /admin/groups/`, select **Try it out**, then **Execute**.
   Expected: 200 and an available group list. Observed: **200**, 9 groups; the
   `Volunteer` group was present with `pages_count: 0`. Pass.
2. Open `POST /admin/pages/`, submit the duplicate-name draft body above.
   Expected: 422 for duplicate form field names. Observed: **422** with
   `{"detail":"Duplicate form field name: duplicate"}`. Pass. No page was
   created by this probe.
3. Submit the published page body above through the same operation. Expected:
   200 and a published page whose live snapshot contains the form. Observed:
   **200**, `status: "published"`, and `live_slug` matched the temporary slug,
   but both `content` and `live_content` contained only
   `{"blocks":[],"format":"blocks-v1"}`. The form was absent. Fail: the
   published snapshot did not contain the requested form.
4. Open `GET /admin/forms/{page_id}/config`, enter the returned temporary page
   UUID, and Execute. Expected: 200 with the form definition. Observed: **404**
   with `{"detail":"Page has no form configuration"}`. Fail.
5. The direct-publish response had `status: "published"`, so no submit/approve
   transition was needed. However, because the response did not contain
   `live_content.form`, the required published-form prerequisite was not met.

The first duplicate-name request occurred after navigating away from Swagger
for OpenAPI inspection and returned 401 `{"detail":"Not authenticated"}`;
no page was created. After authorizing again in Swagger, the protected group
request returned 200 and the duplicate-name request returned the 422 above.

### B. Public JSON submissions

The following operations were not executed because the page's saved and live
content had no form. Expected codes below are expectations from the current
validator contract, not observed outcomes.

1. `POST /api/v1/forms/{slug}/submissions`, omit required `email`:
   expected 422; **NOT RUN**.
2. Submit an unknown response name:
   expected 422; **NOT RUN**.
3. Submit `interest: "not-an-option"`:
   expected 422; **NOT RUN**.
4. Submit valid `email` and `interest` without file data:
   expected 201; **NOT RUN**.
5. No submission receipt or submission ID was returned during this run.

### C. Multipart file submission

1. Open `POST /api/v1/forms/{slug}/submissions/upload` in Swagger. Its live
   request form showed `responses` as text, `file_fields` as `array<string>`,
   and `files` as `array<string>` with **Add string item**. No binary upload
   control was rendered.
2. The required synthetic PDF was not created or selected, and **Execute** was
   not clicked. A real upload could not be represented reliably in the Swagger
   form, and the published page also lacked its form definition. Valid upload,
   metadata retrieval, extension/MIME/signature failures, and missing-file
   behavior are all **NOT RUN**. No upload claims are made.

### D. Admin submission review

No submissions existed because neither JSON nor multipart submission was
executed. The following are **NOT RUN**: listing submissions and status-filtered
lists; retrieving detail or checking its `review_fields` snapshot; approving
without a remark; partial `reviewing`; approving with review data; rejecting a
second submission; and confirming `approved`/`rejected` filters.

### E. Logged-out authorization check

1. Open a separate Swagger tab without authorizing.
2. Execute `GET /admin/groups/` through **Try it out**.
3. Observed: **401** with `{"detail":"Not authenticated"}` and no bearer
   Authorization header. Pass. This request did not disturb the authorized
   test tab.

## 6. Results summary

| Test case | Expected status | Observed status | Result | Notes |
| --- | ---: | ---: | --- | --- |
| List groups (authorized) | 200 | 200 | PASS | 9 groups; selected `Volunteer`, initially 0 pages. |
| Duplicate field name on page create | 422 | 422 | PASS | Detail: `Duplicate form field name: duplicate`. |
| Initial duplicate probe after Swagger navigation | 422 | 401 | FAIL (attempt) | Swagger had lost in-memory authorization; no page was created. Authenticated retry passed. |
| Create/publish page with form | 200, form present in live snapshot | 200, form absent | FAIL | `content` and `live_content` omitted `form`. |
| Read saved form config | 200 | 404 | FAIL | `Page has no form configuration`. |
| JSON missing required field | 422 | NOT RUN | BLOCKED | Form absent from published snapshot. |
| JSON unknown field | 422 | NOT RUN | BLOCKED | Form absent from published snapshot. |
| JSON invalid select choice | 422 | NOT RUN | BLOCKED | Form absent from published snapshot. |
| Valid JSON submission | 201 | NOT RUN | BLOCKED | Form absent from published snapshot. |
| Valid multipart upload and metadata | 201 | NOT RUN | BLOCKED | Form absent; Swagger rendered no binary file control. |
| Multipart upload failure cases | 422 / 413 as applicable | NOT RUN | BLOCKED | No request was sent. |
| Admin submission list/detail/review/filter tests | 200 / 422 as applicable | NOT RUN | BLOCKED | No submissions existed. |
| Logged-out admin groups request | 401 | 401 | PASS | `Not authenticated`; no Authorization header. |
| Delete temporary page | 200 | 200 | PASS | `{"message":"Page deleted"}`. |
| Verify temporary page is gone | 404 | 404 | PASS | `{"detail":"Page not found"}`. |

## 7. Response excerpts

IDs, account identity, and tokens are omitted or generalized.

Duplicate field validation:

```json
{
  "detail": "Duplicate form field name: duplicate"
}
```

Published page response excerpt:

```json
{
  "id": "<temporary-page-UUID>",
  "status": "published",
  "slug": "qa-dynamic-form-<timestamp>-<suffix>",
  "live_slug": "qa-dynamic-form-<timestamp>-<suffix>",
  "content": { "blocks": [], "format": "blocks-v1" },
  "live_content": { "blocks": [], "format": "blocks-v1" }
}
```

Form config response:

```json
{
  "detail": "Page has no form configuration"
}
```

Cleanup responses:

```json
{"message":"Page deleted"}
```

```json
{"detail":"Page not found"}
```

## 8. Cleanup and remaining data

1. Use Swagger `DELETE /admin/pages/{page_id}` for only the page created in
   this run. Observed: 200 `{"message":"Page deleted"}`.
2. Use Swagger `GET /admin/pages/{page_id}` with the same ID. Observed: 404
   `{"detail":"Page not found"}`.
3. No form submission or file upload was created, so there were no temporary
   submissions, media records, or upload files to remove. No other page, group,
   or submission was changed.

## 9. Limitations and implementation finding

The main blocker was observed in the actual API response, not inferred from
unit tests: `POST /admin/pages/` returned 200 and a published page, but the
response omitted `form` from both `content` and `live_content`. The subsequent
admin form config request returned 404. This prevents valid public submissions
and safe admin review tests for this page.

The source path is consistent with that behavior: page creation runs content
through `sanitize_content`, and the sanitizer's normal-page result contains
`format` and `blocks` only. This report does not change application code; the
implementation guide `backend/dynamicform.md` remains unchanged.

Separately, Swagger UI did not render a binary file input for the `files`
multipart array. Under the required browser/Swagger-only constraint, the file
upload endpoint and its content/type/size checks were not tested.

The backend suite result **379 passed, 86 skipped** was previously reported
before this Swagger run. It was not rerun here and is context only, not evidence
that any Swagger API test passed.

## 10. Follow-up fix and verification

After the Swagger run, the page-content persistence issue was fixed. The
observed root cause was `sanitize_content()`: the page routes validated
`content.form`, but the sanitizer rebuilt `blocks-v1` and `home-v1` content
without retaining that top-level form object. The sanitizer now preserves and
deep-sanitizes the form configuration for both content formats. Existing page
validation still runs before persistence.

Regression tests now verify that:

- `sanitize_content()` retains form fields and review fields and is idempotent.
- `CRUDPage.create()` and `CRUDPage.update()` persist the form configuration.
- The page create route copies the form into both `content` and the
  `live_content` snapshot for a directly published page.

Observed verification after the fix:

| Verification | Result |
| --- | --- |
| Focused sanitizer, page round-trip, and dynamic-form test set | 345 passed |
| Direct page-create route test for stored and live form content | 2 passed |
| Full backend test suite | 383 passed, 88 skipped |
| Python compile check and `git diff --check` | Passed |
| Local health endpoint check | 200 `{"status":"ok"}` |

These results verify the code and persistence regression; they do **not** mean
the previously blocked public JSON submission, multipart upload, or admin
review tests have been completed through Swagger. Those Swagger operations
remain **NOT RUN** in the recorded browser run. Retest them through Swagger
after restarting/reloading the backend and authorizing as an admin. The
multipart file operation also remains subject to the Swagger UI limitation
recorded above: its `files` control did not provide a binary file picker. In
the follow-up session, the local health endpoint returned 200, but the browser
Swagger page had no admin authorization, so no new authenticated Swagger
requests were made.
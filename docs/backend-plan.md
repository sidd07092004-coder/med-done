# FastAPI + PostgreSQL Backend Plan for Medically Complicated Admin Panel

## 1. Problem Statement & Why a Dynamic Backend

### Current State
The prototype `mc-admin-proto-v8_2.html` is a fully functional client-side admin panel that stores all state in `localStorage` (`mc-admin-proto-v8`). It demonstrates complete functionality including:

- 2078 hierarchical pages with nested groups and URL slugs
- Full approval workflow (draft/pending/published/rejected)
- Role-based access (admin/volunteer) with UI restrictions
- Rich text editing, translations, credits, revisions, audit logging
- Homepage section management, stats, export/import

### Why We Need a Dynamic Backend
1. **Data Persistence & Collaboration**: Multiple admins/volunteers need to work on the same content simultaneously; localStorage is per-browser and non-shared
2. **Security & Access Control**: The prototype explicitly warns sign-in is a demo - production requires server-side auth, RBAC enforcement, and audit trails
3. **Content Delivery**: Public site needs to read published content from a database (not browser localStorage)
4. **Scalability**: 2078 pages + growth requires proper querying, indexing, and structured storage
5. **Workflow Integrity**: Approval logic, publishing, and locks must be enforced server-side, not client-side
6. **Media Management**: Base64 inline images in prototype won't scale - need proper file storage
7. **Compliance**: Medical content requires audit logging, versioning, and proper access controls; "do not enter real patient data" note indicates need for compliant architecture

---

## 2. Goals & "Done" Definition

### Primary Goals
- Migrate all prototype functionality to a production-ready FastAPI + PostgreSQL backend
- Support both admin API (authenticated, RBAC-enforced) and public read API (for frontend/public site)
- Preserve the exact data model and workflows from the prototype

### Definition of "Done" (MVP)
- [ ] Database schema implemented with migrations (Alembic)
- [ ] FastAPI app with all required endpoints, proper validation, error handling
- [ ] Authentication (JWT/OAuth) with secure password handling
- [ ] RBAC enforced server-side (only admins can publish/approve/manage users/groups)
- [ ] Approval workflow working identically to prototype (draft → submit → pending → approve/publish or reject → draft)
- [ ] Pages with groups hierarchy, slugs, translations (hr/tr/ar), credits, revisions
- [ ] Homepage sections management
- [ ] Audit log for all write operations
- [ ] Public API serves published content by slug with proper 404s
- [ ] Admin can export/import data (JSON) via API
- [ ] HTML sanitization on save (prevent XSS)
- [ ] Basic file upload/storage for images (replace base64)
- [ ] API documented (OpenAPI/Swagger)
- [ ] Tests for core workflows (auth, RBAC, publishing)

---

## 3. Scope Boundaries

### In Scope (MVP)
- User authentication & session management
- Role-based access control (admin, volunteer)
- Groups CRUD with hierarchical nesting (unlimited depth)
- Pages CRUD with status workflow, slugs, body (HTML), live vs working copy
- Translations (en/hr/tr/ar) as separate page records
- Credits/contributors tracking
- Version history/revisions on content changes
- Audit/change log (immutable)
- Homepage sections (key-value fields)
- Public read endpoints for published content
- Approval queue endpoints
- Stats/analytics summary endpoints
- Export/Import JSON
- Image upload endpoint (file storage)
- HTML sanitization
- Soft deletes where appropriate

### Out of Scope (Post-MVP / Requires Separate Work)
- Real SSO/SAML integration (prototype notes this needs to be built)
- Patient data handling / PHI (explicitly forbidden in prototype; needs separate compliance/GDPR review)
- Email notifications (approval/rejection notifications to volunteers)
- Webhooks/integrations
- Advanced search/full-text search (Postgres tsvector can be added later)
- CDN integration beyond basic storage
- Multi-tenancy
- i18n UI beyond content translations
- Rate limiting at scale (basic rate limiting included)

---

## 4. Database Schema (PostgreSQL)

### 4.1 `users` - Authentication & Roles
```sql
users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','volunteer')),
  password_hash TEXT, -- nullable for SSO future
  is_active BOOLEAN DEFAULT true,
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
)
```

### 4.2 `groups` - Hierarchical Navigation
```sql
groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  parent_id UUID REFERENCES groups(id) ON DELETE RESTRICT,
  position INTEGER DEFAULT 0, -- for explicit ordering (drag-drop)
  path TEXT, -- denormalized full path e.g. "bt/diagnosis/symptoms"
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
)
```
Notes: `path` can be computed from hierarchy; useful for lookups. Prevent deleting groups that contain pages/subgroups.

### 4.3 `pages` - Content Pages
```sql
pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  slug TEXT NOT NULL, -- URL path e.g. "bt/diagnosis/symptoms/general"
  lang TEXT NOT NULL DEFAULT 'en' CHECK (lang IN ('en','hr','tr','ar')),
  status TEXT NOT NULL CHECK (status IN ('draft','pending','published','rejected')),
  body TEXT, -- HTML content (sanitized)
  fields JSONB, -- for homepage: {heroBtTitle, ...}
  is_homepage BOOLEAN DEFAULT false,
  
  -- Workflow/approval fields
  author_id UUID REFERENCES users(id),
  last_edited_by_id UUID REFERENCES users(id),
  submitted_by_id UUID REFERENCES users(id),
  approved_by_id UUID REFERENCES users(id),
  reject_note TEXT,
  
  -- Live published version snapshot
  live_title TEXT,
  live_slug TEXT,
  live_body TEXT,
  live_group_id UUID REFERENCES groups(id),
  live_fields JSONB,
  
  -- Translation linkage (for non-en, links to en base)
  translation_of_id UUID REFERENCES pages(id) ON DELETE SET NULL,
  reviewer TEXT, -- translation reviewer name/text
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(slug, lang) -- same URL path per language
)
```
Indexes: `(slug, lang, status)`, `(group_id)`, `(status)`, `(is_homepage)`, `(translation_of_id)`, GIN on `(fields)`, `(live_fields)`.

### 4.4 `page_contributors` (Credits)
```sql
page_contributors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT NOT NULL, -- matches ROLES in proto
  added_by_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
)
```
Roles: 'Writer','Editor','Medical reviewer','Translator','Patient contributor'

### 4.5 `page_revisions` (Version History)
```sql
page_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  title TEXT,
  body TEXT,
  fields JSONB,
  group_id UUID REFERENCES groups(id),
  slug TEXT,
  created_by_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
)
```
Immutable audit trail of content snapshots.

### 4.6 `audit_logs` (Change Log)
```sql
audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  user_name TEXT NOT NULL,
  action TEXT NOT NULL, -- e.g. "Published", "Submitted for approval", "Created group"
  target TEXT NOT NULL, -- e.g. page title/group name
  target_type TEXT, -- 'page','group','user','translation'
  target_id UUID,
  metadata JSONB, -- extra context
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
)
```
Append-only; never updated/deleted.

### 4.7 `media_files` (Image/File Storage)
```sql
media_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  storage_path TEXT NOT NULL, -- path/key in filesystem/S3
  public_url TEXT,
  uploaded_by_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
)
```
Replaces base64 embedding from prototype.

---

## 5. API Surface

### 5.1 Auth
| Method | Endpoint | Auth | RBAC | Description |
|---|---|---|---|---|
| POST | `/auth/login` | Public | - | Login with email/password, returns JWT access token |
| POST | `/auth/logout` | Auth | Any | Logout (token revocation if using blacklist) |
| POST | `/auth/refresh` | Auth | Any | Refresh access token |
| GET | `/auth/me` | Auth | Any | Current user info |

### 5.2 Users (Admin Management)
| Method | Endpoint | Auth | RBAC | Description |
|---|---|---|---|---|
| GET | `/admin/users` | Auth | Admin | List all users |
| POST | `/admin/users` | Auth | Admin | Create user |
| GET | `/admin/users/{user_id}` | Auth | Admin | Get user |
| PATCH | `/admin/users/{user_id}` | Auth | Admin | Update user (role, name, active) |
| DELETE | `/admin/users/{user_id}` | Auth | Admin | Remove user (prevent removing last admin) |

### 5.3 Groups
| Method | Endpoint | Auth | RBAC | Description |
|---|---|---|---|---|
| GET | `/admin/groups` | Auth | Any (read) | List all groups with hierarchy/tree |
| POST | `/admin/groups` | Auth | Admin | Create group (with parent_id, position) |
| GET | `/admin/groups/{group_id}` | Auth | Any | Get group |
| PATCH | `/admin/groups/{group_id}` | Auth | Admin | Update group (name, parent, position) |
| DELETE | `/admin/groups/{group_id}` | Auth | Admin | Delete group (validate no children/pages) |
| PATCH | `/admin/groups/reorder` | Auth | Admin | Bulk reorder/nest groups (for drag-drop) |

### 5.4 Pages (Admin)
| Method | Endpoint | Auth | RBAC | Description |
|---|---|---|---|---|
| GET | `/admin/pages` | Auth | Any | List pages (filter by group_id, lang, status, search) |
| POST | `/admin/pages` | Auth | Any | Create page (draft) |
| GET | `/admin/pages/{page_id}` | Auth | Any | Get page with full details (revisions, contributors, translations) |
| PATCH | `/admin/pages/{page_id}` | Auth | Any | Update page (save draft). Enforces lock if pending & not admin |
| DELETE | `/admin/pages/{page_id}` | Auth | Admin | Delete page |
| POST | `/admin/pages/{page_id}/submit` | Auth | Any | Submit for approval (draft→pending) |
| POST | `/admin/pages/{page_id}/approve` | Auth | Admin | Approve & publish (pending→published; copies to live_*) |
| POST | `/admin/pages/{page_id}/reject` | Auth | Admin | Reject (pending→rejected; requires reject_note) |
| POST | `/admin/pages/{page_id}/unpublish` | Auth | Admin | Unpublish (published→draft; clears live_*) |
| POST | `/admin/pages/{page_id}/revisions/{rev_id}/restore` | Auth | Any* | Restore revision into working copy (*locked if pending) |
| POST | `/admin/pages/{page_id}/translations` | Auth | Any | Create translation (hr/tr/ar) from English base |
| GET | `/admin/pages/queue` | Auth | Admin | Get approval queue (pending pages) |
| PATCH | `/admin/pages/reorder` | Auth | Admin | Reorder pages within groups |

### 5.5 Contributors
| Method | Endpoint | Auth | RBAC | Description |
|---|---|---|---|---|
| GET | `/admin/pages/{page_id}/contributors` | Auth | Any | List contributors |
| POST | `/admin/pages/{page_id}/contributors` | Auth | Any | Add contributor |
| DELETE | `/admin/pages/{page_id}/contributors/{contrib_id}` | Auth | Any | Remove contributor |

### 5.6 Media
| Method | Endpoint | Auth | RBAC | Description |
|---|---|---|---|---|
| POST | `/admin/media/upload` | Auth | Any | Upload image/file (multipart). Returns public_url |
| GET | `/admin/media` | Auth | Any | List uploaded media |
| DELETE | `/admin/media/{media_id}` | Auth | Admin | Delete media |

### 5.7 Audit & Stats & Data
| Method | Endpoint | Auth | RBAC | Description |
|---|---|---|---|---|
| GET | `/admin/audit-logs` | Auth | Admin | List change log (paginated, filterable) |
| GET | `/admin/stats` | Auth | Admin | Get stats (counts by status, coverage %, groups, contributors, activity) |
| GET | `/admin/export` | Auth | Admin | Export full data as JSON |
| POST | `/admin/import` | Auth | Admin | Import full data as JSON (replace/merge? default replace with validation) |

### 5.8 Public API (Read-Only)
| Method | Endpoint | Auth | RBAC | Description |
|---|---|---|---|---|
| GET | `/api/v1/pages/{slug}` | Public | - | Get published page by slug (supports lang via query `?lang=en|hr|tr|ar`). Returns live content (title, slug, body, fields, contributors, lang). 404 if not published. |
| GET | `/api/v1/pages` | Public | - | List published pages (pagination, filter by group/lang) |
| GET | `/api/v1/groups` | Public | - | Get public navigation tree (from published structure) |
| GET | `/api/v1/homepage` | Public | - | Get published homepage (convenience endpoint, slug='home') |
| GET | `/api/v1/sitemap` | Public | - | Generate sitemap.xml of published pages |

---

## 6. Constraints & Requirements

### Authentication & Security
- JWT access tokens (short-lived, e.g. 15-60 min). Refresh tokens with rotation if longer sessions needed
- Password hashing with bcrypt/argon2
- Enforce RBAC on all write/admin endpoints (server-side - never trust client)
- CORS configured for React frontend
- Rate limiting (e.g. slowapi) on auth/login and uploads
- Input validation with Pydantic for all requests
- HTML sanitization on body/fields content (e.g. bleach) - allow safe HTML (p,h2,h3,ul,ol,li,a,img,blockquote) but strip scripts/styles/on* events
- SQL injection protection via SQLAlchemy ORM
- File upload validation: restrict to images (png/jpg/jpeg/webp/gif/svg with care), size limits (e.g. 5-10MB), sanitize filenames
- Audit all state-changing operations (write to audit_logs)
- Prevent orphaned data: validate group deletions (no pages/subgroups)

### Business Rules (from prototype)
- Volunteers can save drafts and submit for approval; cannot publish/approve/reject
- Only admins publish, approve, reject, manage groups, users
- Pages awaiting approval (status=pending) are locked for volunteers (cannot edit)
- Editing a live page never changes live version until approved (working copy separate from live_*)
- At least one admin must remain (prevent last admin removal/demotion)
- Unique slug per language
- Translations follow same approval workflow as English
- Homepage stored with `fields` JSON; body derived/rendered on save (or computed)
- Reject requires note; approval clears reject_note

### Data Integrity
- Soft deletes optional; hard deletes restricted to admins with validation
- Revisions immutable (never edit, only create)
- Audit logs immutable (append-only)
- Transactions for multi-step operations (approve publishes live + updates status)

---

## 7. Technology Stack

| Component | Choice | Rationale |
|---|---|---|
| Framework | FastAPI | Async, Pydantic, OpenAPI auto-docs, great for REST APIs |
| Database | PostgreSQL 14+ | Reliable, JSONB support, full-text search if needed |
| ORM/Migrations | SQLAlchemy 2.0 + Alembic | Industry standard |
| Auth | python-jose + passlib[bcrypt] or Authlib | JWT + secure passwords |
| Validation | Pydantic v2 | Request/response validation |
| Sanitization | bleach | HTML sanitization (XSS prevention) |
| File Storage | Local filesystem (dev), S3/MinIO (prod) | Flexible |
| Config | pydantic-settings | Env-based config |
| Testing | pytest + httpx | FastAPI testing |
| Migrations | Alembic | Schema versioning |

---

## 8. Implementation Priority Order

### Phase 1: Foundation (Core Data Model) - High Priority
1. Project structure (app/, models/, schemas/, routers/, services/, core/, alembic/)
2. DB setup, SQLAlchemy models, Alembic migrations
3. Config & environment (.env.example)
4. Basic health check endpoint

### Phase 2: Auth & RBAC - High Priority
1. User model + auth endpoints (login/refresh/me)
2. JWT middleware/dependencies
3. RBAC dependencies (require_admin, require_auth)
4. Seed initial admin user + bootstrap groups/pages from prototype data structure

### Phase 3: Groups & Navigation - High Priority
1. Groups CRUD + hierarchy + reorder
2. Tree structure endpoints

### Phase 4: Pages Core (CRUD + Workflow) - High Priority
1. Pages CRUD with status management
2. Draft/submit/approve/reject/unpublish workflow
3. Live vs working copy logic
4. Slug validation & uniqueness

### Phase 5: Advanced Page Features - Medium Priority
1. Revisions (create on changes, restore)
2. Contributors/credits
3. Translations (hr/tr/ar) creation & management
4. Homepage sections (fields JSON)

### Phase 6: Media, Audit, Admin Ops - Medium Priority
1. File upload/storage + media endpoints
2. HTML sanitization on save
3. Audit log service (auto-log all writes)
4. Approval queue, stats endpoints

### Phase 7: Public API & Polish - Medium Priority
1. Public read endpoints (`/api/v1/*`)
2. Sitemap generation
3. Export/Import JSON endpoints
4. OpenAPI docs review, error handling, tests

### Phase 8: Data Migration & Integration - Lower Priority
1. Import seed data from prototype's PAGES/structure (2078 pages) - can be loaded from exported JSON or parsed from HTML
2. React frontend integration (update to call API instead of localStorage)

---

## 9. Success Criteria (Measurable)

| Criterion | Target | Verification |
|---|---|---|
| All admin operations work via API | 100% parity with prototype flows | Manual test of each workflow (create/edit/submit/approve/reject) |
| RBAC enforced server-side | Zero privilege escalation possible | Test volunteer cannot publish/approve as API call |
| Public API only returns published | Correct filtering | GET unpublished slug returns 404 |
| Approval lock enforced | Volunteers cannot edit pending | Attempt PATCH on pending page as volunteer → 403/locked error |
| Revisions tracked | Every content change creates revision | Count revisions increases on edit |
| Audit log complete | All writes logged | audit_logs has entries for each operation |
| HTML sanitized | No script tags in stored body | XSS test cases blocked |
| Slug uniqueness enforced | DB constraint prevents dupes | Try creating duplicate slug/lang |
| Data export/import roundtrip | Lossless | Export → clear DB → import → data matches |

---

## 10. Open Questions / Decisions Needed

1. **Authentication method**: JWT only for MVP, or add OAuth later? Prototype had no real auth - need to choose.
2. **File storage**: Local filesystem for dev, S3 for prod? Need deployment env clarification.
3. **Import behavior**: Replace entire DB on import (as prototype does) or merge? Prototype's import replaces everything - follow that.
4. **Homepage rendering**: Store both `fields` and computed `body` (as prototype does) or compute on-the-fly from fields? Prototype stores both - easier for compatibility.
5. **Slug format validation**: Enforce URL-safe slugs (lowercase, hyphens, slashes as separators)?
6. **Soft deletes**: For pages/groups? Prototype deletes immediately - MVP can do hard deletes with validations.
7. **Pagination defaults**: Large lists (2078 pages, audit logs) need pagination.

---

## 11. Next Steps

1. Create project structure with FastAPI app
2. Define SQLAlchemy models per schema above
3. Generate Alembic migrations
4. Implement auth + RBAC
5. Implement core CRUD for groups/pages with workflow
6. Add sanitization, audit logging, media upload
7. Build public API
8. Write tests for critical paths
9. Seed with prototype structure (can extract PAGES/groups programmatically from HTML)

**Ready to proceed to implementation.** This plan covers all functionality present in the prototype and adds necessary production safeguards.
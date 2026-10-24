# Medically Complicated — Admin Panel (Frontend)

Admin SPA (React 18 + TypeScript + Vite 5) for managing users, groups (tree), and pages. It uses the backend admin API under `/admin` and auth under `/api/v1`.

## Prerequisites

- Node.js 18+ (tested with Vite 5)
- Backend API running at `http://127.0.0.1:8000` with Postgres 5433 + seeded data. See [backend/README.md](../backend/README.md) for full backend setup instructions.

## Install dependencies

```bash
cd frontend
npm install
```

## Development

1. Ensure the backend is running.
2. Start the dev server:

```bash
npm run dev
```

The admin panel runs on `http://127.0.0.1:5173`.

### Dev proxy

Vite proxies API calls to the backend:
- `/api` → `http://127.0.0.1:8000`
- `/admin` → `http://127.0.0.1:8000`
- `/uploads` → `http://127.0.0.1:8000`

This keeps browser requests same-origin in dev. See `frontend/vite.config.ts` for details.

## Build

```bash
npm run build
```

Output is in `frontend/dist/`.

## Preview production build

```bash
npm run preview
```

## Login (seed credentials)

| Role  | Email               | Password |
|-------|---------------------|----------|
| Admin | `admin@example.com` | `admin123` |

These match the seed data from `backend/init_and_seed.py`. Volunteers can be created via `POST /admin/users/`.

## Scope / features

The admin app covers the core CMS workflow and RBAC:

- **Auth**: login (OAuth2 form against `/api/v1/auth/login`), token storage, me/verify
- **Users**: CRUD (admin-only operations enforced server-side)
- **Groups**: tree management (unlimited nesting)
- **Pages**: create/edit, workflow states (`draft → submit → pending → approve → published`), reject (with note), unpublish, revisions/restore, translations
- **Content model**: pages store JSONB `content` plus extracted `content_text`. Public pages served from live snapshots.

## Notes

- Admin endpoints are under `/admin/*`; auth/public under `/api/v1/*`.
- Server-side RBAC applies: only `admin` may approve/reject/unpublish and manage users/groups; volunteers cannot publish and pending pages are locked against volunteer edits.
- See [backend/README.md](../backend/README.md) for the full API surface, workflow, and OpenAPI (`/api/v1/openapi.json`).
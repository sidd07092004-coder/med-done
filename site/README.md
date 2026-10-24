# Medically Complicated — Public Site

Public-facing React SPA for the Medically Complicated project. It renders the homepage (`home-v1`) and content pages (`blocks-v1`), builds the navigation from the public API, and supports nested slugs.

## Prerequisites

- Node.js 18+ (tested with Vite 5)
- Backend API running at `http://127.0.0.1:8000` with Postgres 5433 + seeded data. See [backend/README.md](../backend/README.md) for full backend setup instructions.

## Install dependencies

```bash
cd site
npm install
```

## Development

1. Ensure the backend is running (default `http://127.0.0.1:8000`).
2. Start the dev server:

```bash
npm run dev
```

The site runs on `http://127.0.0.1:5174`.

### Dev proxy

Vite proxies API calls to the backend:
- `/api` → `http://127.0.0.1:8000`

This keeps browser requests same-origin in dev. See `site/vite.config.ts` for details.

## Build

```bash
npm run build
```

Output is in `site/dist/`.

## Preview production build

```bash
npm run preview
```

## Public endpoints consumed

The site uses these public endpoints (all return published content only):

- `GET /api/v1/homepage?lang=en` → `PagePublic`
- `GET /api/v1/pages?lang=en` → `PagePublic[]` (flat list)
- `GET /api/v1/pages/{slug}` → `PagePublic`. **Nested slugs containing slashes** are supported (e.g. `bt/diagnosis`) because the backend uses a `:path` converter. Returns `404 {"detail":"Page not found"}` if missing/unpublished.
- `GET /api/v1/navigation?lang=en` → site menu tree + flat pages list

`PagePublic` shape: `{id,title,slug,lang,content,content_text,excerpt,group_id,contributors,published_at,updated_at,meta_title,meta_description}`. Content types: `blocks-v1` (heading/paragraph/list/quote/callout/image/divider) and `home-v1` (`fields`).

## Production deployment note (history fallback)

This is a client-side routed SPA. Content pages use nested routes (e.g. `/bt/diagnosis`). When serving the built files, **any non-`/api` request must return `index.html`** (history API fallback). Without this, direct navigation/refresh to nested routes will return 404 from the static file server.

Recommended server configs:
- **nginx**: `try_files $uri $uri/ /index.html;`
- **Apache**: `.htaccess` with `FallbackResource /index.html` or mod_rewrite
- **Vercel/Netlify**: use `_redirects` with `/* /index.html 200`

Also ensure `/api` is proxied to the backend in production (or CORS is configured appropriately).

## Notes

- Language defaults to `en`. Navigation and page lookups are language-scoped.
- The site only consumes published content; draft/pending/rejected pages are not exposed.
- See [backend/README.md](../backend/README.md) for the full public API documentation and OpenAPI (`/api/v1/openapi.json`).
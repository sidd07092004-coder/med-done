import type { NavigationResponse, PagePublic } from './types'

// Same-origin base: Vite proxies `/api` to the FastAPI backend in dev, and in
// production the site is served from the same origin as the API.
const API_BASE = '/api/v1'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: 'application/json' },
    signal,
  })
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = (await res.json()) as { detail?: string }
      if (body?.detail) detail = body.detail
    } catch {
      // Non-JSON error body — keep the status text.
    }
    throw new ApiError(res.status, detail)
  }
  return (await res.json()) as T
}

const langQuery = (lang: string) => `?lang=${encodeURIComponent(lang)}`

export function fetchHomepage(lang: string, signal?: AbortSignal): Promise<PagePublic> {
  return getJson<PagePublic>(`/homepage${langQuery(lang)}`, signal)
}

export function fetchPages(lang: string, signal?: AbortSignal): Promise<PagePublic[]> {
  return getJson<PagePublic[]>(`/pages${langQuery(lang)}`, signal)
}

/**
 * Fetch a single published page by slug. Nested slugs contain slashes
 * (`bt/diagnosis`); the backend accepts them via a `:path` converter.
 */
export function fetchPageBySlug(
  slug: string,
  lang: string,
  signal?: AbortSignal,
): Promise<PagePublic> {
  const clean = stripSlashes(slug)
  const encoded = clean
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  return getJson<PagePublic>(`/pages/${encoded}${langQuery(lang)}`, signal)
}

export function fetchNavigation(
  lang: string,
  signal?: AbortSignal,
): Promise<NavigationResponse> {
  return getJson<NavigationResponse>(`/navigation${langQuery(lang)}`, signal)
}

export function stripSlashes(path: string): string {
  return path.replace(/^\/+|\/+$/g, '')
}

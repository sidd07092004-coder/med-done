// Thin fetch wrapper around the FastAPI backend.
//
// The Vite dev proxy forwards /api, /admin and /uploads to 127.0.0.1:8000,
// so every request here is same-origin. In a production build the app must be
// served from the same origin as the API (or a reverse proxy must be added).

import type {
  AuditLogFilters,
  AuditLogPage,
  Contributor,
  ExportData,
  Group,
  ImportPayload,
  ImportResult,
  MediaFile,
  Page,
  PageCreatePayload,
  PageFilters,
  PageUpdatePayload,
  PublicPage,
  Revision,
  StatsResponse,
  TemplateCatalogue,
  TokenResponse,
  TranslationList,
  User,
  UserCreatePayload,
  UserUpdatePayload,
} from './types';

export const TOKEN_KEY = 'mc_admin_token';

export class ApiError extends Error {
  status: number;
  detail: unknown;
  constructor(status: number, message: string, detail?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

// ---------------------------------------------------------------------------
// Auth token plumbing
// ---------------------------------------------------------------------------

let token: string | null = null;
try {
  token = localStorage.getItem(TOKEN_KEY);
} catch {
  token = null;
}

let unauthorizedHandler: (() => void) | null = null;

export function getToken(): string | null {
  return token;
}

export function setToken(next: string | null): void {
  token = next;
  try {
    if (next) localStorage.setItem(TOKEN_KEY, next);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable — keep in memory only */
  }
}

/** Register the callback invoked when the API answers 401. */
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  unauthorizedHandler = fn;
}

// ---------------------------------------------------------------------------
// Core request
// ---------------------------------------------------------------------------

interface RequestOptions extends Omit<RequestInit, 'body'> {
  /** Serialised as JSON and sent with Content-Type: application/json. */
  json?: unknown;
  /** Sent as application/x-www-form-urlencoded. */
  form?: URLSearchParams;
  body?: BodyInit | null;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { json, form, headers: rawHeaders, ...rest } = options;
  const headers = new Headers(rawHeaders);

  let body: BodyInit | null | undefined = rest.body;
  if (json !== undefined) {
    body = JSON.stringify(json);
    headers.set('Content-Type', 'application/json');
  } else if (form !== undefined) {
    body = form;
    headers.set('Content-Type', 'application/x-www-form-urlencoded');
  }

  if (token) headers.set('Authorization', `Bearer ${token}`);
  headers.set('Accept', 'application/json');

  let res: Response;
  try {
    res = await fetch(path, { ...rest, headers, body });
  } catch (err) {
    throw new ApiError(0, 'Network error — is the backend running?', err);
  }

  if (res.status === 401) {
    setToken(null);
    unauthorizedHandler?.();
    throw new ApiError(401, 'Your session has expired. Please sign in again.');
  }

  if (!res.ok) {
    let detail: unknown;
    let message = `${res.status} ${res.statusText}`;
    try {
      const data = await res.json();
      detail = data?.detail ?? data;
      if (typeof detail === 'string') message = detail;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message, detail);
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    search.set(key, String(value));
  });
  const s = search.toString();
  return s ? `?${s}` : '';
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export function login(email: string, password: string): Promise<TokenResponse> {
  const form = new URLSearchParams();
  form.set('username', email);
  form.set('password', password);
  return request<TokenResponse>('/api/v1/auth/login', { method: 'POST', form });
}

export function loginJson(email: string, password: string): Promise<TokenResponse> {
  return request<TokenResponse>('/api/v1/auth/login/json', {
    method: 'POST',
    json: { email, password },
  });
}

export function fetchMe(): Promise<User> {
  return request<User>('/api/v1/auth/me');
}

export function verifyToken(): Promise<{ valid: boolean; user: User }> {
  return request<{ valid: boolean; user: User }>('/api/v1/auth/verify');
}

// ---------------------------------------------------------------------------
// Groups (admin)
// ---------------------------------------------------------------------------

export function fetchGroups(): Promise<Group[]> {
  return request<Group[]>('/admin/groups/');
}

export function createGroup(payload: {
  name: string;
  parent_id?: string | null;
  position?: number;
  name_translations?: Record<string, string>;
}): Promise<Group> {
  return request<Group>('/admin/groups/', { method: 'POST', json: payload });
}

export function updateGroup(
  id: string,
  payload: {
    name?: string;
    parent_id?: string | null;
    position?: number;
    name_translations?: Record<string, string>;
  },
): Promise<Group> {
  return request<Group>(`/admin/groups/${id}`, { method: 'PATCH', json: payload });
}

export function deleteGroup(id: string): Promise<{ message: string }> {
  return request<{ message: string }>(`/admin/groups/${id}`, { method: 'DELETE' });
}

/** Reparent and/or reorder a group (drag-and-drop in the group tree). */
export function moveGroup(
  id: string,
  payload: { parent_id: string | null; position?: number },
): Promise<Group> {
  return request<Group>(`/admin/groups/${id}/move`, { method: 'PATCH', json: payload });
}

// ---------------------------------------------------------------------------
// Pages (admin)
// ---------------------------------------------------------------------------

export function fetchPages(filters: PageFilters = {}): Promise<Page[]> {
  // The backend query parameter is `include_homepage` (the contract calls it
  // `is_homepage`); map it so the homepage is included when requested.
  const includeHomepage = filters.include_homepage ?? filters.is_homepage;
  return request<Page[]>(
    `/admin/pages/${qs({
      group_id: filters.group_id,
      status: filters.status,
      lang: filters.lang,
      q: filters.q,
      include_homepage: includeHomepage,
    })}`,
  );
}

/**
 * Locate the single homepage record. The list endpoint hides the homepage by
 * default, so we ask for it explicitly.
 */
export async function fetchHomepagePage(): Promise<Page | null> {
  const pages = await request<Page[]>('/admin/pages/?include_homepage=true');
  return pages.find((p) => p.is_homepage || p.slug === 'home') ?? null;
}

export function fetchPage(id: string): Promise<Page> {
  return request<Page>(`/admin/pages/${id}`);
}

export function createPage(payload: PageCreatePayload): Promise<Page> {
  return request<Page>('/admin/pages/', { method: 'POST', json: payload });
}

/** Starter recipes for the New Page dialog (GET /admin/pages/templates). */
export function fetchTemplates(): Promise<TemplateCatalogue> {
  return request<TemplateCatalogue>('/admin/pages/templates');
}

/** Copy a page into a new draft and return it (POST /admin/pages/{id}/duplicate). */
export function duplicatePage(id: string): Promise<Page> {
  return request<Page>(`/admin/pages/${id}/duplicate`, { method: 'POST' });
}

export function updatePage(id: string, payload: PageUpdatePayload): Promise<Page> {
  return request<Page>(`/admin/pages/${id}`, { method: 'PATCH', json: payload });
}

export function deletePage(id: string): Promise<{ message: string }> {
  return request<{ message: string }>(`/admin/pages/${id}`, { method: 'DELETE' });
}

export function movePage(
  id: string,
  payload: { group_id: string; position?: number },
): Promise<Page> {
  return request<Page>(`/admin/pages/${id}/move`, { method: 'PATCH', json: payload });
}

export function submitPage(id: string): Promise<Page> {
  return request<Page>(`/admin/pages/${id}/submit`, { method: 'POST' });
}

export function approvePage(id: string): Promise<Page> {
  return request<Page>(`/admin/pages/${id}/approve`, { method: 'POST' });
}

export function rejectPage(id: string, rejectNote: string): Promise<Page> {
  return request<Page>(`/admin/pages/${id}/reject`, {
    method: 'POST',
    json: { reject_note: rejectNote },
  });
}

export function unpublishPage(id: string): Promise<Page> {
  return request<Page>(`/admin/pages/${id}/unpublish`, { method: 'POST' });
}

export function fetchQueue(): Promise<Page[]> {
  return request<Page[]>('/admin/pages/queue');
}

// ---------------------------------------------------------------------------
// Public API (no auth)
// ---------------------------------------------------------------------------

export function fetchPublicPage(slug: string, lang = 'en'): Promise<PublicPage> {
  return request<PublicPage>(`/api/v1/pages/${encodeURIComponent(slug)}${qs({ lang })}`);
}

export function fetchHomepage(lang = 'en'): Promise<PublicPage> {
  return request<PublicPage>(`/api/v1/homepage${qs({ lang })}`);
}

export function fetchPublicPages(lang = 'en'): Promise<PublicPage[]> {
  return request<PublicPage[]>(`/api/v1/pages${qs({ lang })}`);
}

// ---------------------------------------------------------------------------
// Stats / audit (admin) — wired for completeness
// ---------------------------------------------------------------------------

export function fetchStats(): Promise<StatsResponse> {
  return request<StatsResponse>('/admin/stats');
}

export function fetchAuditLogs(filters: AuditLogFilters = {}): Promise<AuditLogPage> {
  const { page = 1, limit = 50, user_id, action, target_type } = filters;
  // The backend accepts skip/limit; keep the page/limit signature from the contract.
  const skip = Math.max(0, (page - 1) * limit);
  return request<AuditLogPage>(
    `/admin/audit-logs${qs({ skip, limit, user_id, action, target_type })}`,
  );
}

// ---------------------------------------------------------------------------
// Users (admin)
// ---------------------------------------------------------------------------

export function fetchUsers(): Promise<User[]> {
  return request<User[]>('/admin/users/');
}

export function createUser(payload: UserCreatePayload): Promise<User> {
  return request<User>('/admin/users/', { method: 'POST', json: payload });
}

export function updateUser(id: string, payload: UserUpdatePayload): Promise<User> {
  return request<User>(`/admin/users/${id}`, { method: 'PATCH', json: payload });
}

export function deleteUser(id: string): Promise<{ message: string }> {
  return request<{ message: string }>(`/admin/users/${id}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Media library
// ---------------------------------------------------------------------------

export function fetchMedia(): Promise<MediaFile[]> {
  return request<MediaFile[]>('/admin/media/');
}

export function uploadMedia(file: File): Promise<MediaFile> {
  const body = new FormData();
  body.append('file', file);
  // Do NOT set Content-Type: the browser adds the multipart boundary.
  return request<MediaFile>('/admin/media/upload', { method: 'POST', body });
}

export function deleteMedia(id: string): Promise<{ message: string }> {
  return request<{ message: string }>(`/admin/media/${id}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Revisions
// ---------------------------------------------------------------------------

export function fetchRevisions(pageId: string): Promise<Revision[]> {
  return request<Revision[]>(`/admin/pages/${pageId}/revisions`);
}

export function restoreRevision(pageId: string, revisionId: string): Promise<Page> {
  return request<Page>(`/admin/pages/${pageId}/revisions/${revisionId}/restore`, {
    method: 'POST',
  });
}

// ---------------------------------------------------------------------------
// Translations
// ---------------------------------------------------------------------------

export function fetchTranslations(pageId: string): Promise<TranslationList> {
  return request<TranslationList>(`/admin/pages/${pageId}/translations`);
}

export function createTranslation(pageId: string, lang: string): Promise<Page> {
  return request<Page>(`/admin/pages/${pageId}/translations`, {
    method: 'POST',
    json: { lang },
  });
}

// ---------------------------------------------------------------------------
// Contributors (credits)
// ---------------------------------------------------------------------------

export function fetchContributors(pageId: string): Promise<Contributor[]> {
  return request<Contributor[]>(`/admin/pages/${pageId}/contributors`);
}

export function addContributor(
  pageId: string,
  payload: { name: string; role: string },
): Promise<Contributor> {
  return request<Contributor>(`/admin/pages/${pageId}/contributors`, {
    method: 'POST',
    json: payload,
  });
}

export function removeContributor(
  pageId: string,
  contributorId: string,
): Promise<{ message: string }> {
  return request<{ message: string }>(`/admin/pages/${pageId}/contributors/${contributorId}`, {
    method: 'DELETE',
  });
}

// ---------------------------------------------------------------------------
// Export / import (admin)
// ---------------------------------------------------------------------------

export function exportData(): Promise<ExportData> {
  return request<ExportData>('/admin/export');
}

export function importData(payload: ImportPayload): Promise<ImportResult> {
  return request<ImportResult>('/admin/import', { method: 'POST', json: payload });
}

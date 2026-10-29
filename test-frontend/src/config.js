
export const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || ""
).replace(/\/+$/, "");

export const FONT_BASE_URL = (
  import.meta.env.VITE_FONT_BASE_URL ||
  import.meta.env.VITE_API_BASE_URL ||
  ""
).replace(/\/+$/, "");

export function apiUrl(path) {
  const normalizedPath = path.startsWith("/")
    ? path
    : `/${path}`;

  return `${API_BASE_URL}${normalizedPath}`;
}

export function fontUrl(path) {
  const normalizedPath = path.startsWith("/")
    ? path
    : `/${path}`;

  return `${FONT_BASE_URL}${normalizedPath}`;
}

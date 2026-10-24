import { useLocation } from 'react-router-dom'

export const DEFAULT_LANG = 'en'

/**
 * Reads the optional `?lang=` query param and passes it through to API calls as
 * the active language. Falls back to `en`. Derived directly from the current
 * location so the header, document attributes and API requests all agree in the
 * same render as the URL change.
 */
export function useLang(): string {
  const { search } = useLocation()
  const value = new URLSearchParams(search).get('lang')
  return value && value.trim() ? value.trim() : DEFAULT_LANG
}

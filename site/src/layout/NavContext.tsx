import { createContext, useContext, type ReactNode } from 'react'
import { fetchNavigation } from '../api/publicApi'
import type { NavigationResponse } from '../api/types'
import { useApi } from '../hooks/useApi'
import { useLang } from '../hooks/useLang'

interface NavContextValue {
  nav: NavigationResponse | null
  loading: boolean
  error: Error | null
}

const NavContext = createContext<NavContextValue>({ nav: null, loading: true, error: null })

/** Fetches the site menu once and shares it with the header and page views. */
export function NavProvider({ children }: { children: ReactNode }) {
  const lang = useLang()
  const { data, loading, error } = useApi((signal) => fetchNavigation(lang, signal), [lang])

  return <NavContext.Provider value={{ nav: data, loading, error }}>{children}</NavContext.Provider>
}

export function useNav(): NavContextValue {
  return useContext(NavContext)
}

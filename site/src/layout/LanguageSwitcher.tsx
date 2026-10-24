import { Link, useLocation } from 'react-router-dom'
import { useLang } from '../hooks/useLang'

export const LANGUAGES = [
  { code: 'en', short: 'EN', name: 'English' },
  { code: 'hr', short: 'HR', name: 'Croatian' },
  { code: 'tr', short: 'TR', name: 'Turkish' },
  { code: 'ar', short: 'AR', name: 'Arabic' },
] as const

type LanguageCode = (typeof LANGUAGES)[number]['code']

interface LanguageSwitcherProps {
  variant?: 'desktop' | 'mobile'
  /** Called after a language is chosen (used to close the mobile panel). */
  onNavigate?: () => void
}

/**
 * Build the URL for a language while keeping the current route, hash and any
 * unrelated query params. English is the default and therefore has no `lang`
 * param; every other language is stored as `?lang=xx`.
 */
export function languageTarget(
  pathname: string,
  search: string,
  hash: string,
  code: LanguageCode,
): { pathname: string; search: string; hash: string } {
  const params = new URLSearchParams(search)
  if (code === 'en') params.delete('lang')
  else params.set('lang', code)
  const query = params.toString()
  return { pathname, search: query ? `?${query}` : '', hash }
}

export function LanguageSwitcher({ variant = 'desktop', onNavigate }: LanguageSwitcherProps) {
  const location = useLocation()
  const active = useLang().toLowerCase()

  return (
    <nav className={`lang-switcher lang-switcher--${variant}`} aria-label="Language">
      <ul className="lang-switcher__list">
        {LANGUAGES.map((language) => {
          const current = active === language.code
          return (
            <li className="lang-switcher__item" key={language.code}>
              <Link
                to={languageTarget(location.pathname, location.search, location.hash, language.code)}
                className="lang-switcher__link"
                aria-label={language.name}
                aria-current={current ? 'true' : undefined}
                onClick={onNavigate}
              >
                {language.short}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

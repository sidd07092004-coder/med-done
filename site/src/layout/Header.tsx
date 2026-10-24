import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { buildNavModel } from '../lib/navigation'
import { LanguageSwitcher } from './LanguageSwitcher'
import { useNav } from './NavContext'
import { NavMenu } from './NavMenu'

export function Header() {
  const { nav, loading, error } = useNav()
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()

  // Close the mobile panel whenever the route (or language) changes.
  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname, location.search])

  const model = nav ? buildNavModel(nav) : null

  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link to="/" className="brand" aria-label="Medically Complicated — home">
          <span className="brand__mark" aria-hidden="true">
            MC
          </span>
          <span className="brand__name">
            Medically <em>Complicated</em>
          </span>
        </Link>

        {loading && (
          <span className="nav-status" role="status">
            Loading menu…
          </span>
        )}
        {!loading && error && (
          <span className="nav-status nav-status--error" role="status">
            Menu unavailable
          </span>
        )}
        {model && <NavMenu variant="desktop" nodes={model.nodes} rootPages={model.rootPages} />}

        <LanguageSwitcher variant="desktop" />

        <button
          type="button"
          className="hamburger"
          aria-expanded={mobileOpen}
          aria-controls="mobile-nav"
          onClick={() => setMobileOpen((open) => !open)}
        >
          <span className="sr-only">{mobileOpen ? 'Close menu' : 'Open menu'}</span>
          <span className="hamburger__bars" aria-hidden="true" data-open={mobileOpen} />
        </button>
      </div>

      {mobileOpen && (
        <div className="mobile-panel" id="mobile-nav">
          <LanguageSwitcher variant="mobile" onNavigate={() => setMobileOpen(false)} />
          {model && (
            <NavMenu
              variant="mobile"
              nodes={model.nodes}
              rootPages={model.rootPages}
              onNavigate={() => setMobileOpen(false)}
            />
          )}
        </div>
      )}
    </header>
  )
}

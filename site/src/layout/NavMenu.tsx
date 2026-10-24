import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { NavigationPage } from '../api/types'
import { pageHref, type NavNode } from '../lib/navigation'

interface NavMenuProps {
  nodes: NavNode[]
  rootPages: NavigationPage[]
  variant: 'desktop' | 'mobile'
  /** Called after a link is activated (used to close the mobile panel). */
  onNavigate?: () => void
}

function Chevron() {
  return (
    <svg className="nav__chevron" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
      <path d="M3 6l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Recursively renders a group's own pages plus its nested subgroups. */
function GroupPanel({ node, onNavigate }: { node: NavNode; onNavigate?: () => void }) {
  return (
    <div className="group-panel">
      {node.pages.length > 0 && (
        <ul className="group-panel__pages">
          {node.pages.map((page) => (
            <li key={page.id}>
              <Link to={pageHref(page.slug)} onClick={onNavigate} className="group-panel__link">
                {page.title}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {node.children.map((child) => (
        <section className="group-panel__section" key={child.group.id}>
          <p className="group-panel__heading">{child.group.name}</p>
          <GroupPanel node={child} onNavigate={onNavigate} />
        </section>
      ))}
    </div>
  )
}

function isHomePage(page: NavigationPage): boolean {
  return pageHref(page.slug) === '/'
}

/** Desktop: disclosure buttons that reveal a dropdown panel of links. */
function DesktopNav({ nodes, rootPages, onNavigate }: Omit<NavMenuProps, 'variant'>) {
  const [openId, setOpenId] = useState<string | null>(null)
  const navRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (openId === null) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenId(null)
    }
    const onPointer = (event: PointerEvent) => {
      if (navRef.current && !navRef.current.contains(event.target as Node)) {
        setOpenId(null)
      }
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [openId])

  return (
    <nav className="nav nav--desktop" aria-label="Primary" ref={navRef}>
      <ul className="nav__list" onMouseLeave={() => setOpenId(null)}>
        {nodes.map((node) => {
          const open = openId === node.group.id
          const panelId = `nav-panel-${node.group.id}`
          return (
            <li
              className="nav__item"
              key={node.group.id}
              onMouseEnter={() => setOpenId(node.group.id)}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                  setOpenId((current) => (current === node.group.id ? null : current))
                }
              }}
            >
              <button
                type="button"
                className="nav__trigger"
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => setOpenId(open ? null : node.group.id)}
              >
                <span>{node.group.name}</span>
                <Chevron />
              </button>
              {open && (
                <div className="nav__panel" id={panelId}>
                  <GroupPanel node={node} onNavigate={onNavigate} />
                </div>
              )}
            </li>
          )
        })}
        {rootPages
          .filter((page) => !isHomePage(page))
          .map((page) => (
            <li className="nav__item" key={page.id}>
              <Link className="nav__link" to={pageHref(page.slug)} onClick={onNavigate}>
                {page.title}
              </Link>
            </li>
          ))}
      </ul>
    </nav>
  )
}

/** Mobile: an accordion of groups plus root-level links. */
function MobileNav({ nodes, rootPages, onNavigate }: Omit<NavMenuProps, 'variant'>) {
  const [openId, setOpenId] = useState<string | null>(null)

  return (
    <nav className="nav nav--mobile" aria-label="Primary mobile">
      <ul className="nav__list">
        {nodes.map((node) => {
          const open = openId === node.group.id
          const panelId = `mnav-panel-${node.group.id}`
          return (
            <li className="nav__item" key={node.group.id}>
              <button
                type="button"
                className="nav__trigger nav__trigger--mobile"
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => setOpenId(open ? null : node.group.id)}
              >
                <span>{node.group.name}</span>
                <Chevron />
              </button>
              {open && (
                <div className="nav__panel nav__panel--mobile" id={panelId}>
                  <GroupPanel node={node} onNavigate={onNavigate} />
                </div>
              )}
            </li>
          )
        })}
        {rootPages
          .filter((page) => !isHomePage(page))
          .map((page) => (
            <li className="nav__item" key={page.id}>
              <Link className="nav__link nav__link--mobile" to={pageHref(page.slug)} onClick={onNavigate}>
                {page.title}
              </Link>
            </li>
          ))}
      </ul>
    </nav>
  )
}

export function NavMenu({ nodes, rootPages, variant, onNavigate }: NavMenuProps) {
  if (variant === 'desktop') {
    return <DesktopNav nodes={nodes} rootPages={rootPages} onNavigate={onNavigate} />
  }
  return <MobileNav nodes={nodes} rootPages={rootPages} onNavigate={onNavigate} />
}

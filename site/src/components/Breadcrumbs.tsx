import { Link } from 'react-router-dom'

export interface Crumb {
  label: string
  /** When absent, the crumb is rendered as plain text (groups have no URL). */
  to?: string
}

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  if (!items.length) return null
  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      <ol className="breadcrumbs__list">
        {items.map((item, i) => {
          const isLast = i === items.length - 1
          return (
            <li className="breadcrumbs__item" key={`${item.label}-${i}`}>
              {item.to && !isLast ? (
                <Link className="breadcrumbs__link" to={item.to}>
                  {item.label}
                </Link>
              ) : (
                <span className="breadcrumbs__current" aria-current={isLast ? 'page' : undefined}>
                  {item.label}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

import { Link } from 'react-router-dom'
import { useDocumentMeta } from '../hooks/useDocumentMeta'

export function NotFoundPage() {
  useDocumentMeta({
    title: 'Page not found — Medically Complicated',
    description: 'The page you were looking for could not be found.',
  })

  return (
    <main id="main" className="not-found">
      <p className="not-found__code" aria-hidden="true">
        404
      </p>
      <h1 className="not-found__title">We couldn’t find that page</h1>
      <p className="not-found__text">
        The page may have been moved, unpublished, or never existed. Let’s get you back on track.
      </p>
      <div className="not-found__actions">
        <Link className="btn btn--primary" to="/">
          Back to home
        </Link>
        <Link className="btn btn--ghost" to="/bt">
          Brain tumors
        </Link>
        <Link className="btn btn--ghost" to="/en">
          Endometriosis
        </Link>
      </div>
    </main>
  )
}

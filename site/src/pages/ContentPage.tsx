import { useLocation } from 'react-router-dom'
import { fetchPageBySlug, stripSlashes } from '../api/publicApi'
import { isBlocksContent, type NavigationResponse, type PagePublic } from '../api/types'
import { BlockRenderer } from '../components/BlockRenderer'
import { Breadcrumbs, type Crumb } from '../components/Breadcrumbs'
import { useApi } from '../hooks/useApi'
import { useDocumentMeta } from '../hooks/useDocumentMeta'
import { useLang } from '../hooks/useLang'
import { groupChain } from '../lib/navigation'
import { useNav } from '../layout/NavContext'
import { NotFoundPage } from './NotFoundPage'

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'long', year: 'numeric' }).format(date)
}

function buildCrumbs(nav: NavigationResponse | null, page: PagePublic): Crumb[] {
  const crumbs: Crumb[] = [{ label: 'Home', to: '/' }]
  if (nav) {
    for (const group of groupChain(nav, page.group_id)) {
      crumbs.push({ label: group.name })
    }
  }
  crumbs.push({ label: page.title })
  return crumbs
}

export function ContentPage() {
  const location = useLocation()
  const lang = useLang()
  const { nav } = useNav()
  const slug = stripSlashes(location.pathname)

  const { data, loading, error, notFound } = useApi(
    (signal) => fetchPageBySlug(slug, lang, signal),
    [slug, lang],
  )

  const d: any = data
  useDocumentMeta({
    title: data ? data.meta_title || data.title : undefined,
    description: data ? data.meta_description || data.excerpt : undefined,
    metaTitle: data?.meta_title,
    metaDescription: data?.meta_description,
    excerpt: data?.excerpt,
    canonicalPath: d?.canonical_path ?? d?.canonicalPath,
    robots: d?.robots,
    ogImage: d?.og_image ?? d?.ogImage,
    url: data ? `${window.location.origin}${location.pathname}` : undefined,
  })

  if (loading) {
    return (
      <main id="main" className="state" role="status">
        <p className="state__text">Loading…</p>
      </main>
    )
  }

  if (notFound || error || !data) {
    return <NotFoundPage />
  }

  const contributors = data.contributors ?? []
  const content = data.content

  return (
    <main id="main" className="page">
      <div className="page__container">
        <Breadcrumbs items={buildCrumbs(nav, data)} />

        <article className="page__article">
          <header className="page__header">
            <h1 className="page__title">{data.title}</h1>
            {data.excerpt && <p className="page__excerpt">{data.excerpt}</p>}
            {data.updated_at && (
              <p className="page__meta">
                Last updated{' '}
                <time dateTime={data.updated_at}>{formatDate(data.updated_at)}</time>
              </p>
            )}
          </header>

          {isBlocksContent(content) ? (
            <BlockRenderer blocks={content.blocks} />
          ) : (
            <p className="muted">This page has no content yet.</p>
          )}

          {contributors.length > 0 && (
            <footer className="page__contributors">
              <h2 className="page__contributors-title">Contributors</h2>
              <ul className="contributors">
                {contributors.map((person) => (
                  <li className="contributors__item" key={person.id}>
                    <span className="contributors__name">{person.name}</span>
                    {person.role && <span className="contributors__role">{person.role}</span>}
                  </li>
                ))}
              </ul>
            </footer>
          )}
        </article>
      </div>
    </main>
  )
}

import { Link, useLocation } from 'react-router-dom'
import { fetchHomepage, fetchPageBySlug, ApiError } from '../api/publicApi'
import { isBlocksContent, isHomeContent, type HomeFields, type PagePublic } from '../api/types'
import { BlockRenderer } from '../components/BlockRenderer'
import { useApi } from '../hooks/useApi'
import { useDocumentMeta } from '../hooks/useDocumentMeta'
import { useLang } from '../hooks/useLang'
import { NotFoundPage } from './NotFoundPage'

const lines = (value?: string): string[] =>
  (value ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

const present = (value?: string): boolean => !!value && value.trim() !== ''

/** Fetch the homepage, falling back to the `home` slug when `/homepage` 404s. */
async function loadHome(lang: string, signal: AbortSignal): Promise<PagePublic> {
  try {
    return await fetchHomepage(lang, signal)
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      return await fetchPageBySlug('home', lang, signal)
    }
    throw err
  }
}

function HeroCard({
  title,
  text,
  btn,
  to,
  index,
}: {
  title?: string
  text?: string
  btn?: string
  to: string
  index: number
}) {
  if (!present(title) && !present(text) && !present(btn)) return null
  return (
    <article className={`hero__card hero__card--${index === 0 ? 'bt' : 'en'}`}>
      {present(title) && <h2 className="hero__title">{title}</h2>}
      {present(text) && <p className="hero__text">{text}</p>}
      {present(btn) && (
        <Link className="btn btn--primary" to={to}>
          {btn}
        </Link>
      )}
    </article>
  )
}

function GuideCard({
  title,
  text,
  list,
  btn,
  to,
  accent,
}: {
  title?: string
  text?: string
  list?: string
  btn?: string
  to: string
  accent: 'bt' | 'en'
}) {
  const items = lines(list)
  if (!present(title) && !present(text) && items.length === 0 && !present(btn)) return null
  return (
    <article className={`guide-card guide-card--${accent}`}>
      {present(title) && <h3 className="guide-card__title">{title}</h3>}
      {present(text) && <p className="guide-card__text">{text}</p>}
      {items.length > 0 && (
        <ul className="guide-card__list">
          {items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      )}
      {present(btn) && (
        <Link className="btn btn--ghost" to={to}>
          {btn}
        </Link>
      )}
    </article>
  )
}

function HomeLayout({ fields }: { fields: HomeFields }) {
  const hasHero = ['heroBtTitle', 'heroBtText', 'heroBtBtn', 'heroEnTitle', 'heroEnText', 'heroEnBtn'].some(
    (key) => present(fields[key as keyof HomeFields]),
  )
  const hasGuides = [
    'nbTitle',
    'nbText',
    'nbList',
    'nbBtn',
    'neTitle',
    'neText',
    'neList',
    'neBtn',
  ].some((key) => present(fields[key as keyof HomeFields]))
  const exploreItems = lines(fields.exList)
  const blogPosts = [
    { title: fields.bl1, summary: fields.bl1s },
    { title: fields.bl2, summary: fields.bl2s },
    { title: fields.bl3, summary: fields.bl3s },
  ].filter((post) => present(post.title) || present(post.summary))

  return (
    <>
      <header className="home-head">
        <h1 className="home-head__title">Medically Complicated</h1>
      </header>

      {hasHero && (
        <section className="hero" aria-label="Featured conditions">
          <div className="hero__grid">
            <HeroCard
              title={fields.heroBtTitle}
              text={fields.heroBtText}
              btn={fields.heroBtBtn}
              to="/bt"
              index={0}
            />
            <HeroCard
              title={fields.heroEnTitle}
              text={fields.heroEnText}
              btn={fields.heroEnBtn}
              to="/en"
              index={1}
            />
          </div>
        </section>
      )}

      {present(fields.intro) && (
        <section className="intro-band">
          <p className="intro-band__text">{fields.intro}</p>
        </section>
      )}

      {hasGuides && (
        <section className="section" aria-labelledby="newly-diagnosed-heading">
          <h2 className="section__title" id="newly-diagnosed-heading">
            Newly diagnosed
          </h2>
          <div className="guides">
            <GuideCard
              title={fields.nbTitle}
              text={fields.nbText}
              list={fields.nbList}
              btn={fields.nbBtn}
              to="/bt/diagnosis"
              accent="bt"
            />
            <GuideCard
              title={fields.neTitle}
              text={fields.neText}
              list={fields.neList}
              btn={fields.neBtn}
              to="/en/diagnosis"
              accent="en"
            />
          </div>
        </section>
      )}

      {(present(fields.stLede) || present(fields.exLede) || exploreItems.length > 0) && (
        <section className="section" aria-labelledby="start-here-heading">
          <h2 className="section__title" id="start-here-heading">
            Start here
          </h2>
          {present(fields.stLede) && <p className="section__lede">{fields.stLede}</p>}
          {present(fields.exLede) && <p className="section__sublede">{fields.exLede}</p>}
          {exploreItems.length > 0 && (
            <ul className="explore-list">
              {exploreItems.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      {(present(fields.cmTitle) || present(fields.cmText) || present(fields.cmBtn1) || present(fields.cmBtn2)) && (
        <section className="section" aria-labelledby="community-heading">
          <h2 className="section__title" id="community-heading">
            {present(fields.cmTitle) ? fields.cmTitle : 'Community'}
          </h2>
          {present(fields.cmText) && <p className="section__lede">{fields.cmText}</p>}
          <div className="community-actions">
            {present(fields.cmBtn1) && (
              <Link className="btn btn--primary" to="/community">
                {fields.cmBtn1}
              </Link>
            )}
            {present(fields.cmBtn2) && (
              <Link className="btn btn--ghost" to="/community">
                {fields.cmBtn2}
              </Link>
            )}
          </div>
        </section>
      )}

      {(present(fields.blLede) || blogPosts.length > 0) && (
        <section className="section" aria-labelledby="blog-heading">
          <h2 className="section__title" id="blog-heading">
            Commentary and reflection
          </h2>
          {present(fields.blLede) && <p className="section__lede">{fields.blLede}</p>}
          {blogPosts.length > 0 && (
            <div className="blog-grid">
              {blogPosts.map((post, i) => (
                <article className="blog-card" key={i}>
                  {present(post.title) && (
                    <h3 className="blog-card__title">
                      <Link to="/blog">{post.title}</Link>
                    </h3>
                  )}
                  {present(post.summary) && <p className="blog-card__summary">{post.summary}</p>}
                </article>
              ))}
            </div>
          )}
        </section>
      )}
    </>
  )
}

export function HomePage() {
  const lang = useLang()
  const location = useLocation()
  const { data, loading, error, notFound } = useApi((signal) => loadHome(lang, signal), [lang])

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
      <div className="state" role="status">
        <p className="state__text">Loading…</p>
      </div>
    )
  }

  if (notFound || error) {
    return <NotFoundPage />
  }

  if (!data) {
    return <NotFoundPage />
  }

  const content = data.content

  return (
    <main id="main" className="home">
      {isHomeContent(content) ? (
        <HomeLayout fields={content.fields} />
      ) : (
        <article className="page">
          <header className="page__header">
            <h1 className="page__title">{data.title}</h1>
          </header>
          {isBlocksContent(content) ? (
            <BlockRenderer blocks={content.blocks} />
          ) : (
            <p className="muted">This homepage has no content yet.</p>
          )}
        </article>
      )}
    </main>
  )
}

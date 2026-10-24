import { useEffect } from 'react'

const DEFAULT_TITLE = 'Medically Complicated'
const DEFAULT_DESCRIPTION =
  'Reliable medical information and lived experience for people affected by brain tumors and endometriosis.'

interface DocumentMeta {
  title?: string | null
  description?: string | null
  canonicalPath?: string | null
  robots?: string | null
  ogImage?: string | null
  url?: string | null
  excerpt?: string | null
  metaTitle?: string | null
  metaDescription?: string | null
}

function ensureMetaTag(attr: 'name' | 'property', key: string): HTMLMetaElement {
  let tag = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`)
  if (!tag) {
    tag = document.createElement('meta')
    tag.setAttribute(attr, key)
    document.head.appendChild(tag)
  }
  return tag
}

function ensureLinkTag(rel: string): HTMLLinkElement {
  let tag = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`)
  if (!tag) {
    tag = document.createElement('link')
    tag.setAttribute('rel', rel)
    document.head.appendChild(tag)
  }
  return tag
}

function resolveUrl(value?: string | null): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (trimmed.startsWith('/')) {
    if (typeof window === 'undefined') return trimmed
    return `${window.location.origin}${trimmed}`
  }
  return trimmed
}

function currentUrl(): string {
  if (typeof window === 'undefined') return '/'
  return `${window.location.origin}${window.location.pathname}`
}

/**
 * Sets document metadata for SEO and social sharing.
 */
export function useDocumentMeta(options: DocumentMeta = {}): void {
  const {
    title,
    description,
    canonicalPath,
    robots,
    ogImage,
    url,
    excerpt,
    metaTitle,
    metaDescription,
  } = options

  useEffect(() => {
    const previousTitle = document.title

    // Fallbacks per spec
    const resolvedTitle = (metaTitle?.trim() || title?.trim()) || DEFAULT_TITLE
    const resolvedDescription =
      (metaDescription?.trim() || description?.trim() || excerpt?.trim()) || DEFAULT_DESCRIPTION

    document.title = resolvedTitle

    const metaDesc = ensureMetaTag('name', 'description')
    const previousDesc = metaDesc.getAttribute('content')
    metaDesc.setAttribute('content', resolvedDescription)

    // Canonical
    const canonicalTag = ensureLinkTag('canonical')
    const previousCanonical = canonicalTag.getAttribute('href')
    const resolvedCanonical = resolveUrl(canonicalPath) || resolveUrl(url) || currentUrl()
    canonicalTag.setAttribute('href', resolvedCanonical)

    // Robots
    const robotsTag = ensureMetaTag('name', 'robots')
    const previousRobots = robotsTag.getAttribute('content')
    const robotsValue = typeof robots === 'string' ? robots.trim().toLowerCase() : ''
    if (robotsValue === 'noindex') {
      robotsTag.setAttribute('content', 'noindex')
    } else {
      robotsTag.setAttribute('content', 'index')
    }

    // OG tags
    const ogTitle = ensureMetaTag('property', 'og:title')
    const previousOgTitle = ogTitle.getAttribute('content')
    ogTitle.setAttribute('content', resolvedTitle)

    const ogDesc = ensureMetaTag('property', 'og:description')
    const previousOgDesc = ogDesc.getAttribute('content')
    ogDesc.setAttribute('content', resolvedDescription)

    const ogUrl = ensureMetaTag('property', 'og:url')
    const previousOgUrl = ogUrl.getAttribute('content')
    ogUrl.setAttribute('content', resolvedCanonical)

    const ogType = ensureMetaTag('property', 'og:type')
    const previousOgType = ogType.getAttribute('content')
    ogType.setAttribute('content', 'article')

    const ogImageTag = ensureMetaTag('property', 'og:image')
    const previousOgImage = ogImageTag.getAttribute('content')
    const resolvedOgImage = typeof ogImage === 'string' ? ogImage.trim() : ''
    if (resolvedOgImage) {
      ogImageTag.setAttribute('content', resolvedOgImage)
    } else {
      // og:image omitted if absent
      ogImageTag.remove()
    }

    return () => {
      document.title = previousTitle
      if (previousDesc !== null) {
        metaDesc.setAttribute('content', previousDesc)
      } else {
        metaDesc.setAttribute('content', DEFAULT_DESCRIPTION)
      }
      if (previousCanonical !== null) {
        canonicalTag.setAttribute('href', previousCanonical)
      } else {
        canonicalTag.remove()
      }
      if (previousRobots !== null) {
        robotsTag.setAttribute('content', previousRobots)
      } else {
        robotsTag.setAttribute('content', 'index')
      }
      if (previousOgTitle !== null) {
        ogTitle.setAttribute('content', previousOgTitle)
      } else {
        ogTitle.remove()
      }
      if (previousOgDesc !== null) {
        ogDesc.setAttribute('content', previousOgDesc)
      } else {
        ogDesc.remove()
      }
      if (previousOgUrl !== null) {
        ogUrl.setAttribute('content', previousOgUrl)
      } else {
        ogUrl.remove()
      }
      if (previousOgType !== null) {
        ogType.setAttribute('content', previousOgType)
      } else {
        ogType.remove()
      }
      if (previousOgImage !== null) {
        ogImageTag.setAttribute('content', previousOgImage)
        if (!ogImageTag.isConnected) document.head.appendChild(ogImageTag)
      }
      // if it didn't exist before and we removed it, leave it removed
    }
  }, [
    title,
    description,
    canonicalPath,
    robots,
    ogImage,
    url,
    excerpt,
    metaTitle,
    metaDescription,
  ])
}

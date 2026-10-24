import type { NavigationGroup, NavigationPage, NavigationResponse } from '../api/types'

export interface NavNode {
  group: NavigationGroup
  /** Pages published directly under this group. */
  pages: NavigationPage[]
  children: NavNode[]
}

export interface NavModel {
  /** Top-level nav items (children of the synthetic root group). */
  nodes: NavNode[]
  /** Pages attached directly to the root group (e.g. Home, Events). */
  rootPages: NavigationPage[]
}

function byPosition(a: NavigationPage, b: NavigationPage): number {
  return a.position - b.position || a.title.localeCompare(b.title)
}

/**
 * Turns the flat `/navigation` payload into a menu model. The backend returns
 * root groups only (each nesting its own `children`), so when there is a single
 * synthetic root ("Site pages") its children become the real top-level items and
 * any pages on the root itself are exposed as root-level links.
 */
export function buildNavModel(nav: NavigationResponse): NavModel {
  const pagesByGroup = new Map<string, NavigationPage[]>()
  for (const page of nav.pages) {
    const bucket = pagesByGroup.get(page.group_id)
    if (bucket) bucket.push(page)
    else pagesByGroup.set(page.group_id, [page])
  }

  const toNode = (group: NavigationGroup): NavNode => ({
    group,
    pages: (pagesByGroup.get(group.id) ?? []).slice().sort(byPosition),
    children: group.children.map(toNode),
  })

  const roots = nav.groups
  if (roots.length === 1) {
    const root = roots[0]
    return {
      nodes: root.children.map(toNode),
      rootPages: (pagesByGroup.get(root.id) ?? []).slice().sort(byPosition),
    }
  }

  const rootPages: NavigationPage[] = []
  for (const root of roots) rootPages.push(...(pagesByGroup.get(root.id) ?? []))
  rootPages.sort(byPosition)
  return { nodes: roots.map(toNode), rootPages }
}

/** URL for a page slug. The homepage slug maps to `/`. */
export function pageHref(slug: string): string {
  const clean = slug.replace(/^\/+|\/+$/g, '')
  return clean === '' || clean === 'home' ? '/' : `/${clean}`
}

/**
 * Group ancestry for a page's `group_id`, ordered root → leaf. When the tree has
 * a single synthetic root (e.g. "Site pages"), that container is removed so
 * breadcrumbs begin at the first meaningful section.
 */
export function groupChain(nav: NavigationResponse, groupId: string): NavigationGroup[] {
  const byId = new Map<string, NavigationGroup>()
  const index = (group: NavigationGroup) => {
    byId.set(group.id, group)
    group.children.forEach(index)
  }
  nav.groups.forEach(index)

  const chain: NavigationGroup[] = []
  let current = byId.get(groupId)
  const seen = new Set<string>()
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    chain.unshift(current)
    current = current.parent_id ? byId.get(current.parent_id) : undefined
  }

  if (nav.groups.length === 1 && chain.length && chain[0].id === nav.groups[0].id) {
    return chain.slice(1)
  }
  return chain
}

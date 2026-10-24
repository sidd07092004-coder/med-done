import type { Group } from '../api/types';

export interface FlatGroup {
  id: string;
  name: string;
  parentId: string | null;
  depth: number;
  path: string;
  pagesCount: number;
}

/** Depth-first flatten of the group tree, preserving order. */
export function flattenGroups(groups: Group[], depth = 0, parentPath = ''): FlatGroup[] {
  const out: FlatGroup[] = [];
  for (const g of groups) {
    const path = parentPath ? `${parentPath} / ${g.name}` : g.name;
    out.push({
      id: g.id,
      name: g.name,
      parentId: g.parent_id,
      depth,
      path,
      pagesCount: g.pages_count ?? 0,
    });
    if (g.children?.length) {
      out.push(...flattenGroups(g.children, depth + 1, path));
    }
  }
  return out;
}

/** Human-readable breadcrumb path for a single group id. */
export function groupPath(groups: Group[], id: string | null | undefined): string {
  if (!id) return 'All pages';
  const flat = flattenGroups(groups);
  return flat.find((g) => g.id === id)?.path ?? 'Unknown group';
}

/** Total number of pages in a group including descendants. */
export function groupSubtreeCount(group: Group): number {
  return (group.pages_count ?? 0) + (group.children ?? []).reduce((sum, c) => sum + groupSubtreeCount(c), 0);
}

/** Find a group node by id anywhere in the tree. */
export function findGroup(groups: Group[], id: string | null | undefined): Group | undefined {
  if (!id) return undefined;
  for (const g of groups) {
    if (g.id === id) return g;
    const child = findGroup(g.children ?? [], id);
    if (child) return child;
  }
  return undefined;
}

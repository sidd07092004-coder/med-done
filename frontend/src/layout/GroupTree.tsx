import { useState, type DragEvent } from 'react';
import type { Group } from '../api/types';
import { groupSubtreeCount } from '../lib/groups';

export interface GroupTreeProps {
  groups: Group[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Show admin controls (rename/delete/add) and enable drag-and-drop. */
  canManage?: boolean;
  /** Drop a group onto another group (parentId) or onto the root zone (null). */
  onMove?: (dragId: string, parentId: string | null) => void;
  /** Reorder a group among its siblings (-1 up / +1 down). */
  onReorder?: (group: Group, direction: -1 | 1) => void;
  onAddChild?: (parent: Group) => void;
  onRename?: (group: Group) => void;
  onDelete?: (group: Group) => void;
  busy?: boolean;
}

interface NodeContext {
  canManage: boolean;
  draggingId: string | null;
  dragOverId: string | null;
  onDragStart: (e: DragEvent, id: string) => void;
  onDragEnd: () => void;
  onDragOverNode: (e: DragEvent, id: string) => void;
  onDropNode: (e: DragEvent, id: string) => void;
  onReorder?: (group: Group, direction: -1 | 1) => void;
  onAddChild?: (parent: Group) => void;
  onRename?: (group: Group) => void;
  onDelete?: (group: Group) => void;
  busy: boolean;
}

interface TreeNodeProps extends NodeContext {
  node: Group;
  depth: number;
  selectedId: string | null;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
}

const LANGUAGES = [
  { key: 'hr', badge: 'HR', label: 'Croatian' },
  { key: 'tr', badge: 'TR', label: 'Turkish' },
  { key: 'ar', badge: 'AR', label: 'Arabic' },
] as const;

/** Compact, non-interactive markers for the translations a group has. */
function TranslationBadges({ translations }: { translations?: Record<string, string> }) {
  const present = LANGUAGES.filter((lang) => translations?.[lang.key]?.trim());
  if (!present.length) return null;

  return (
    <span
      className="tree-langs"
      role="img"
      aria-label={`Translated: ${present.map((lang) => lang.label).join(', ')}`}
    >
      {present.map((lang) => (
        <span className="lang-badge" key={lang.key} aria-hidden="true">
          {lang.badge}
        </span>
      ))}
    </span>
  );
}

function TreeNode(props: TreeNodeProps) {
  const {
    node,
    depth,
    selectedId,
    expanded,
    onToggle,
    onSelect,
    canManage,
    draggingId,
    dragOverId,
    onDragStart,
    onDragEnd,
    onDragOverNode,
    onDropNode,
    onReorder,
    onAddChild,
    onRename,
    onDelete,
    busy,
  } = props;

  const hasChildren = node.children.length > 0;
  const isOpen = expanded.has(node.id);
  const isSelected = selectedId === node.id;
  const count = groupSubtreeCount(node);
  const isDragging = draggingId === node.id;
  const isDropTarget = dragOverId === node.id && draggingId && draggingId !== node.id;

  const classes = ['tree-row'];
  if (isDragging) classes.push('dragging');
  if (isDropTarget) classes.push('drop-target');

  return (
    <li role="treeitem" aria-expanded={hasChildren ? isOpen : undefined} aria-selected={isSelected}>
      <div
        className={classes.join(' ')}
        style={{ paddingLeft: depth * 14 }}
        draggable={canManage}
        onDragStart={(e) => onDragStart(e, node.id)}
        onDragEnd={onDragEnd}
        onDragOver={(e) => onDragOverNode(e, node.id)}
        onDrop={(e) => onDropNode(e, node.id)}
      >
        {hasChildren ? (
          <button
            type="button"
            className="tree-chevron"
            onClick={() => onToggle(node.id)}
            aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${node.name}`}
            aria-expanded={isOpen}
          >
            <span aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
          </button>
        ) : (
          <span className="tree-chevron tree-chevron-spacer" aria-hidden="true" />
        )}

        <button
          type="button"
          className={`tree-label${isSelected ? ' selected' : ''}`}
          onClick={() => onSelect(node.id)}
          aria-current={isSelected ? 'true' : undefined}
          title={node.path ?? node.name}
        >
          <span className="tree-name-wrap">
            <span className="tree-name">{node.name}</span>
            <TranslationBadges translations={node.name_translations} />
          </span>
          <span className="tree-count" aria-label={`${count} pages`}>
            {count}
          </span>
        </button>

        {canManage && (
          <span className="tree-manage">
            <button
              type="button"
              className="icon-btn tiny"
              onClick={() => onReorder?.(node, -1)}
              disabled={busy}
              aria-label={`Move ${node.name} up`}
              title="Move up"
            >
              ↑
            </button>
            <button
              type="button"
              className="icon-btn tiny"
              onClick={() => onReorder?.(node, 1)}
              disabled={busy}
              aria-label={`Move ${node.name} down`}
              title="Move down"
            >
              ↓
            </button>
            <button
              type="button"
              className="icon-btn tiny"
              onClick={() => onAddChild?.(node)}
              disabled={busy}
              aria-label={`Add subgroup under ${node.name}`}
              title="Add subgroup"
            >
              +
            </button>
            <button
              type="button"
              className="icon-btn tiny"
              onClick={() => onRename?.(node)}
              disabled={busy}
              aria-label={`Rename ${node.name}`}
              title="Rename"
            >
              ✎
            </button>
            <button
              type="button"
              className="icon-btn tiny danger"
              onClick={() => onDelete?.(node)}
              disabled={busy}
              aria-label={`Delete ${node.name}`}
              title="Delete"
            >
              ✕
            </button>
          </span>
        )}
      </div>

      {hasChildren && isOpen && (
        <ul role="group" className="tree-group">
          {node.children.map((child) => (
            <TreeNode {...props} key={child.id} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function GroupTree({
  groups,
  selectedId,
  onSelect,
  canManage = false,
  onMove,
  onReorder,
  onAddChild,
  onRename,
  onDelete,
  busy = false,
}: GroupTreeProps) {
  // Start fully expanded so the structure is visible at a glance.
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const all = new Set<string>();
    const walk = (nodes: Group[]) => {
      for (const n of nodes) {
        if (n.children.length) {
          all.add(n.id);
          walk(n.children);
        }
      }
    };
    walk(groups);
    return all;
  });

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dragOverRoot, setDragOverRoot] = useState(false);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDragStart = (e: DragEvent, id: string) => {
    setDraggingId(id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
  };

  const handleDragEnd = () => {
    setDraggingId(null);
    setDragOverId(null);
    setDragOverRoot(false);
  };

  const handleDragOverNode = (e: DragEvent, id: string) => {
    if (!canManage || !draggingId) return;
    // Stop the event bubbling to ancestor rows, otherwise the outermost row
    // would win the highlight and drop target.
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    setDragOverRoot(false);
    setDragOverId(id);
  };

  const handleDropNode = (e: DragEvent, id: string) => {
    if (!canManage || !draggingId) return;
    e.preventDefault();
    e.stopPropagation();
    const dragId = draggingId;
    handleDragEnd();
    if (dragId !== id) onMove?.(dragId, id);
  };

  const handleRootDragOver = (e: DragEvent) => {
    if (!canManage || !draggingId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverId(null);
    setDragOverRoot(true);
  };

  const handleRootDrop = (e: DragEvent) => {
    if (!canManage || !draggingId) return;
    e.preventDefault();
    const dragId = draggingId;
    handleDragEnd();
    onMove?.(dragId, null);
  };

  if (!groups.length) {
    return <p className="sidebar-empty">No groups yet.</p>;
  }

  const ctx: NodeContext = {
    canManage,
    draggingId,
    dragOverId,
    onDragStart: handleDragStart,
    onDragEnd: handleDragEnd,
    onDragOverNode: handleDragOverNode,
    onDropNode: handleDropNode,
    onReorder,
    onAddChild,
    onRename,
    onDelete,
    busy,
  };

  return (
    <div className="group-tree-wrap">
      {canManage && (
        <div
          className={`tree-root-drop${dragOverRoot ? ' active' : ''}`}
          onDragOver={handleRootDragOver}
          onDragLeave={() => setDragOverRoot(false)}
          onDrop={handleRootDrop}
          aria-hidden={!draggingId}
        >
          {draggingId ? 'Drop here to move to the top level' : 'Drag a group here to make it a top-level group'}
        </div>
      )}
      <ul role="tree" aria-label="Page groups" className="group-tree">
        {groups.map((g) => (
          <TreeNode
            {...ctx}
            key={g.id}
            node={g}
            depth={0}
            selectedId={selectedId}
            expanded={expanded}
            onToggle={toggle}
            onSelect={onSelect}
          />
        ))}
      </ul>
    </div>
  );
}

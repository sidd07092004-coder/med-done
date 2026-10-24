import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createGroup, deleteGroup, fetchGroups, moveGroup, updateGroup } from '../api/client';
import type { Group } from '../api/types';
import { GroupDialog, type GroupFormValues } from '../components/GroupDialog';
import { GroupTree } from '../layout/GroupTree';

/** Ordered siblings of `group` within the tree (children of its parent, or roots). */
function siblingsOf(groups: Group[], group: Group): Group[] {
  if (!group.parent_id) return groups;
  const find = (nodes: Group[]): Group | null => {
    for (const n of nodes) {
      if (n.id === group.parent_id) return n;
      const found = find(n.children);
      if (found) return found;
    }
    return null;
  };
  return find(groups)?.children ?? groups;
}

type DialogState =
  | { mode: 'create'; parent: Group | null }
  | { mode: 'edit'; group: Group };

export function GroupManagerPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);

  const groupsQuery = useQuery({ queryKey: ['groups'], queryFn: fetchGroups });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['groups'] });
    queryClient.invalidateQueries({ queryKey: ['pages'] });
  };

  const settle = (ok: string) => {
    setError(null);
    setNotice(ok);
    refresh();
  };
  const fail = (err: Error) => {
    setNotice(null);
    setError(err.message);
  };

  const createMutation = useMutation({
    mutationFn: (payload: GroupFormValues & { parent_id: string | null }) =>
      createGroup({
        name: payload.name,
        parent_id: payload.parent_id,
        name_translations: payload.name_translations,
      }),
    onSuccess: (g) => {
      setDialog(null);
      settle(`Created “${g.name}”.`);
    },
    onError: fail,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, name, name_translations }: { id: string } & GroupFormValues) =>
      updateGroup(id, { name, name_translations }),
    onSuccess: (g) => {
      setDialog(null);
      settle(`Saved “${g.name}”.`);
    },
    onError: fail,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteGroup(id),
    onSuccess: () => settle('Group deleted.'),
    onError: fail,
  });

  const moveMutation = useMutation({
    mutationFn: ({ id, parent_id, position }: { id: string; parent_id: string | null; position?: number }) =>
      moveGroup(id, { parent_id, position }),
    onSuccess: () => settle('Group moved.'),
    onError: fail,
  });

  const busy =
    createMutation.isPending ||
    updateMutation.isPending ||
    deleteMutation.isPending ||
    moveMutation.isPending;

  const groups = groupsQuery.data ?? [];

  const openDialog = (next: DialogState) => {
    setError(null);
    setDialog(next);
  };

  const addRoot = () => openDialog({ mode: 'create', parent: null });

  const addChild = (parent: Group) => openDialog({ mode: 'create', parent });

  const rename = (group: Group) => openDialog({ mode: 'edit', group });

  const saveDialog = (values: GroupFormValues) => {
    if (!dialog) return;
    setError(null);
    if (dialog.mode === 'create') {
      createMutation.mutate({ ...values, parent_id: dialog.parent?.id ?? null });
    } else {
      updateMutation.mutate({ id: dialog.group.id, ...values });
    }
  };

  const remove = (group: Group) => {
    if (
      window.confirm(
        `Delete “${group.name}”? A group can only be deleted when it has no subgroups and no pages.`,
      )
    ) {
      deleteMutation.mutate(group.id);
    }
  };

  const reorder = (group: Group, direction: -1 | 1) => {
    const siblings = siblingsOf(groups, group);
    const index = siblings.findIndex((g) => g.id === group.id);
    if (index < 0) return;
    const target = index + direction;
    if (target < 0 || target >= siblings.length) return;
    moveMutation.mutate({ id: group.id, parent_id: group.parent_id, position: target });
  };

  return (
    <div className="page">
      <div className="crumb">Administration</div>
      <div className="page-head">
        <h2>Manage groups</h2>
        <button type="button" className="btn primary" onClick={addRoot} disabled={busy}>
          + New top-level group
        </button>
      </div>
      <p className="muted small">
        Drag a group onto another to nest it, or onto the dashed zone to move it to the top level.
        Use the ↑ ↓ buttons to reorder within a level. Renaming, deleting and adding are available on
        each row.
      </p>

      {notice && (
        <div className="alert alert-success" role="status">
          {notice}
        </div>
      )}
      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}

      {groupsQuery.isLoading && <div className="card">Loading groups…</div>}
      {groupsQuery.isError && (
        <div className="alert alert-error" role="alert">
          Could not load groups: {(groupsQuery.error as Error).message}
        </div>
      )}

      {groupsQuery.isSuccess && (
        <div className="card group-manager">
          <GroupTree
            groups={groups}
            selectedId={null}
            onSelect={(id) => navigate(`/pages?group=${id}`)}
            canManage
            busy={busy}
            onMove={(dragId, parentId) => moveMutation.mutate({ id: dragId, parent_id: parentId })}
            onReorder={reorder}
            onAddChild={addChild}
            onRename={rename}
            onDelete={remove}
          />
        </div>
      )}

      {dialog && (
        <GroupDialog
          mode={dialog.mode}
          parent={dialog.mode === 'create' ? dialog.parent : null}
          group={dialog.mode === 'edit' ? dialog.group : null}
          pending={
            dialog.mode === 'create' ? createMutation.isPending : updateMutation.isPending
          }
          error={error}
          onClose={() => setDialog(null)}
          onSubmit={saveDialog}
        />
      )}
    </div>
  );
}

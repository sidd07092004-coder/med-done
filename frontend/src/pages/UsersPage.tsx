import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createUser,
  deleteUser,
  fetchUsers,
  updateUser,
} from '../api/client';

import type { Role, User } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { formatDateTime } from '../lib/format';

export function UsersPage() {
  const queryClient = useQueryClient();
  const { user: me } = useAuth();

  const [dialogOpen, setDialogOpen] = useState(false);

  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editedName, setEditedName] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const usersQuery = useQuery({
    queryKey: ['users'],
    queryFn: fetchUsers,
  });

  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: ['users'],
    });

  // Update user name, role, or active status.
  const updateMutation = useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string;
      patch: Partial<Pick<User, 'name' | 'role' | 'is_active'>>;
    }) => updateUser(id, patch),

    onSuccess: async () => {
      setError(null);
      setNotice('User updated successfully.');

      setEditingUserId(null);
      setEditedName('');

      await refresh();
    },

    onError: (err: Error) => {
      setNotice(null);
      setError(err.message);
    },
  });

  // Delete user.
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteUser(id),

    onSuccess: async () => {
      setError(null);
      setNotice('User removed successfully.');

      await refresh();
    },

    onError: (err: Error) => {
      setNotice(null);
      setError(err.message);
    },
  });

  const busy = updateMutation.isPending || deleteMutation.isPending;

  // Start editing a user's name.
  const handleEditName = (user: User) => {
    setEditingUserId(user.id);
    setEditedName(user.name);

    setError(null);
    setNotice(null);
  };

  // Cancel name editing.
  const handleCancelEdit = () => {
    setEditingUserId(null);
    setEditedName('');

    setError(null);
  };

  // Save updated name.
  const handleSaveName = (user: User) => {
    const name = editedName.trim();

    if (!name) {
      setError('Name cannot be empty.');
      setNotice(null);
      return;
    }

    if (name === user.name) {
      handleCancelEdit();
      return;
    }

    setError(null);
    setNotice(null);

    updateMutation.mutate({
      id: user.id,
      patch: {
        name,
      },
    });
  };

  return (
    <div className="page">
      <div className="crumb">Administration</div>

      <div className="page-head">
        <h2>Users &amp; access</h2>

        <button
          type="button"
          className="btn primary"
          onClick={() => setDialogOpen(true)}
        >
          + Add user
        </button>
      </div>

      <p className="muted small">
        Admins can approve, publish and manage content. Volunteers can
        draft and submit pages.
      </p>

      {/* Success message */}
      {notice && (
        <div className="alert alert-success" role="status">
          {notice}
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}

      {/* Loading state */}
      {usersQuery.isLoading && (
        <div className="card">Loading users...</div>
      )}

      {/* API error */}
      {usersQuery.isError && (
        <div className="alert alert-error" role="alert">
          Could not load users:{' '}
          {(usersQuery.error as Error).message}
        </div>
      )}

      {/* Users table */}
      {usersQuery.isSuccess && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Email</th>
                <th scope="col">Role</th>
                <th scope="col">Status</th>
                <th scope="col">Last login</th>
                <th scope="col" className="col-actions">
                  Actions
                </th>
              </tr>
            </thead>

            <tbody>
              {usersQuery.data.map((u) => {
                const isSelf = me?.id === u.id;
                const isEditing = editingUserId === u.id;

                return (
                  <tr key={u.id}>
                    {/* NAME COLUMN */}
                    <td>
                      {isEditing ? (
                        <div className="row-actions">
                          <input
                            type="text"
                            value={editedName}
                            onChange={(e) => setEditedName(e.target.value)}
                            placeholder="Enter name"
                            aria-label={`Edit name for ${u.name}`}
                            autoFocus
                            disabled={busy}
                          />

                          <button
                            type="button"
                            className="btn small primary"
                            onClick={() => handleSaveName(u)}
                            disabled={busy}
                          >
                            {updateMutation.isPending ? 'Saving...' : 'Save'}
                          </button>

                          <button
                            type="button"
                            className="btn small"
                            onClick={handleCancelEdit}
                            disabled={busy}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="row-actions">
                          <span className="strong-link">{u.name}</span>

                          <button
                            type="button"
                            className="btn small"
                            onClick={() => handleEditName(u)}
                            disabled={busy}
                            aria-label={`Edit name for ${u.name}`}
                          >
                            Edit
                          </button>
                        </div>
                      )}
                    </td>

                    {/* EMAIL COLUMN */}
                    <td>{u.email}</td>

                    {/* ROLE COLUMN */}
                    <td>
                      <select
                        value={u.role}
                        onChange={(e) =>
                          updateMutation.mutate({
                            id: u.id,
                            patch: {
                              role: e.target.value as Role,
                            },
                          })
                        }
                        disabled={busy || isSelf}
                        aria-label={`Role for ${u.name}`}
                      >
                        <option value="admin">Admin</option>
                        <option value="volunteer">
                          Volunteer
                        </option>
                      </select>
                    </td>

                    {/* STATUS COLUMN */}
                    <td>
                      {u.is_active ? (
                        <span className="pill s-published">
                          Active
                        </span>
                      ) : (
                        <span className="pill s-draft">
                          Disabled
                        </span>
                      )}
                    </td>

                    {/* LAST LOGIN COLUMN */}
                    <td className="nowrap">
                      {formatDateTime(u.last_login)}
                    </td>

                    {/* ACTIONS COLUMN */}
                    <td className="col-actions">
                      <div className="row-actions">
                        <button
                          type="button"
                          className="btn small"
                          onClick={() =>
                            updateMutation.mutate({
                              id: u.id,
                              patch: {
                                is_active: !u.is_active,
                              },
                            })
                          }
                          disabled={busy || isSelf}
                        >
                          {u.is_active ? 'Disable' : 'Enable'}
                        </button>

                        <button
                          type="button"
                          className="btn small danger"
                          onClick={() => {
                            if (
                              window.confirm(
                                `Remove ${u.name}? This cannot be undone.`,
                              )
                            ) {
                              deleteMutation.mutate(u.id);
                            }
                          }}
                          disabled={busy || isSelf}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {/* Empty state */}
              {usersQuery.data.length === 0 && (
                <tr className="empty-row">
                  <td colSpan={6}>No users yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ADD USER DIALOG */}
      {dialogOpen && (
        <NewUserDialog
          onClose={() => setDialogOpen(false)}
          onCreated={() => {
            setDialogOpen(false);
            setNotice('User created successfully.');
            setError(null);
            void refresh();
          }}
        />
      )}
    </div>
  );
}

// --------------------------------------------------
// NEW USER DIALOG
// --------------------------------------------------

interface NewUserDialogProps {
  onClose: () => void;
  onCreated: () => void;
}

function NewUserDialog({
  onClose,
  onCreated,
}: NewUserDialogProps) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('volunteer');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      createUser({
        email: email.trim(),
        name: name.trim() || email.trim(),
        role,
        password,
        is_active: true,
      }),

    onSuccess: () => onCreated(),

    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    mutation.mutate();
  };

  return (
    <div
      className="modal-backdrop"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-user-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="new-user-title">Add user</h3>

        <form onSubmit={submit}>
          {error && (
            <div className="alert alert-error" role="alert">
              {error}
            </div>
          )}

          <label className="field">
            <span>Name</span>

            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </label>

          <label className="field">
            <span>Email</span>

            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>

          <label className="field">
            <span>Role</span>

            <select
              value={role}
              onChange={(e) =>
                setRole(e.target.value as Role)
              }
            >
              <option value="volunteer">Volunteer</option>
              <option value="admin">Admin</option>
            </select>
          </label>

          <label className="field">
            <span>Temporary password</span>

            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={6}
              required
            />
          </label>

          <div className="modal-actions">
            <button
              type="button"
              className="btn"
              onClick={onClose}
              disabled={mutation.isPending}
            >
              Cancel
            </button>

            <button
              type="submit"
              className="btn primary"
              disabled={mutation.isPending}
            >
              {mutation.isPending
                ? 'Creating...'
                : 'Create user'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
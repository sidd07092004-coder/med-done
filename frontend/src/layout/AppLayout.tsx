
import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { fetchGroups } from '../api/client';
import { useAuth } from '../auth/AuthContext';

import { Header } from './Header';
import { Sidebar } from './Sidebar';

export function AppLayout() {
  const { user } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const groupsQuery = useQuery({
    queryKey: ['groups'],
    queryFn: fetchGroups,
    enabled: Boolean(user),
    staleTime: 30_000,
  });

  return (
    <div className="app-shell min-h-screen bg-gradient-to-br from-[#e9e9e7] via-[#fffdf5] to-[#fff7c9]">
      {/* Header */}
      <Header
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
      />

      {/* Main application body */}
      <div className="app-body">
        {/* Sidebar */}
        <Sidebar
          groups={groupsQuery.data ?? []}
          loading={groupsQuery.isLoading}
          error={
            groupsQuery.isError
              ? (groupsQuery.error instanceof Error
                  ? groupsQuery.error.message
                  : 'Failed to load groups')
              : null
          }
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />

        {/* Mobile sidebar overlay */}
        {sidebarOpen && (
          <button
            type="button"
            className="sidebar-scrim"
            aria-label="Close navigation"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Page content */}
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

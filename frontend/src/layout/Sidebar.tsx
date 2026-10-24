import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchHomepagePage, fetchQueue } from '../api/client';
import type { Group } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { GroupTree } from './GroupTree';

interface SidebarProps {
  groups: Group[];
  loading: boolean;
  error: string | null;
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ groups, loading, error, open, onClose }: SidebarProps) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const navigate = useNavigate();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const selectedGroup = params.get('group');
  const [homepageBusy, setHomepageBusy] = useState(false);
  const [homepageError, setHomepageError] = useState<string | null>(null);

  const queueQuery = useQuery({
    queryKey: ['queue'],
    queryFn: fetchQueue,
    enabled: isAdmin,
  });

  const onPages = location.pathname.startsWith('/pages');
  const onReview = location.pathname.startsWith('/review');
  const onGroups = location.pathname.startsWith('/groups');
  const onMedia = location.pathname.startsWith('/media');
  const onStats = location.pathname.startsWith('/stats');
  const onUsers = location.pathname.startsWith('/users');
  const onAudit = location.pathname.startsWith('/audit-log');
  const onData = location.pathname.startsWith('/data');
  const navClass = (active: boolean) => `nav-item${active ? ' selected' : ''}`;

  const go = (to: string) => {
    navigate(to);
    onClose();
  };

  const openHomepage = async () => {
    setHomepageBusy(true);
    setHomepageError(null);
    try {
      const home = await fetchHomepagePage();
      if (!home) {
        setHomepageError('No homepage record found.');
        return;
      }
      go(`/pages/${home.id}`);
    } catch {
      setHomepageError('Could not load the homepage.');
    } finally {
      setHomepageBusy(false);
    }
  };

  return (
    <aside className={`sidebar${open ? ' open' : ''}`} aria-label="Primary">
      {isAdmin && (
        <>
          <div className="sec">Approvals</div>
          <button
            type="button"
            className={`nav-item${onReview ? ' selected' : ''}`}
            onClick={() => go('/review')}
            aria-current={onReview ? 'page' : undefined}
          >
            <span>Review queue</span>
            {queueQuery.data && <span className="nav-badge">{queueQuery.data.length}</span>}
          </button>
        </>
      )}

      <div className="sec">Site structure</div>
      <button
        type="button"
        className={`nav-item${onPages && !selectedGroup ? ' selected' : ''}`}
        onClick={() => go('/pages')}
        aria-current={onPages && !selectedGroup ? 'page' : undefined}
      >
        All pages
      </button>
      <button type="button" className="nav-item" onClick={openHomepage} disabled={homepageBusy}>
        {homepageBusy ? 'Opening homepage…' : 'Homepage (sections)'}
      </button>
      {homepageError && <p className="sidebar-error">{homepageError}</p>}

      <div className="sec">Groups</div>
      {loading && <p className="sidebar-empty">Loading groups…</p>}
      {error && <p className="sidebar-error">{error}</p>}
      {!loading && !error && (
        <GroupTree groups={groups} selectedId={selectedGroup} onSelect={(id) => go(`/pages?group=${id}`)} />
      )}
      {isAdmin && (
        <button type="button" className={navClass(onGroups)} onClick={() => go('/groups')}>
          Manage groups…
        </button>
      )}

      <div className="sec">Library</div>
      <button
        type="button"
        className={navClass(onMedia)}
        onClick={() => go('/media')}
        aria-current={onMedia ? 'page' : undefined}
      >
        Media library
      </button>

      {isAdmin && (
        <>
          <div className="sec">Administration</div>
          <button
            type="button"
            className={navClass(onStats)}
            onClick={() => go('/stats')}
            aria-current={onStats ? 'page' : undefined}
          >
            Stats dashboard
          </button>
          <button
            type="button"
            className={navClass(onUsers)}
            onClick={() => go('/users')}
            aria-current={onUsers ? 'page' : undefined}
          >
            Users &amp; access
          </button>
          <button
            type="button"
            className={navClass(onAudit)}
            onClick={() => go('/audit-log')}
            aria-current={onAudit ? 'page' : undefined}
          >
            Audit log
          </button>
          <button
            type="button"
            className={navClass(onData)}
            onClick={() => go('/data')}
            aria-current={onData ? 'page' : undefined}
          >
            Export &amp; import
          </button>
        </>
      )}
    </aside>
  );
}

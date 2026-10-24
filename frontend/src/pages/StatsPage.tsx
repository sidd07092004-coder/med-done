import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchStats } from '../api/client';
import type { CountStat, SectionStat } from '../api/types';
import { langName } from '../lib/format';

function pct(n: number, total: number): number {
  if (!total) return 0;
  return Math.round((n / total) * 100);
}

/** Horizontal share bar used across the dashboard. */
function Bar({ value, max, tone = 'default' }: { value: number; max: number; tone?: string }) {
  const width = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <span className="bar" aria-hidden="true">
      <span className={`bar-fill bar-${tone}`} style={{ width: `${width}%` }} />
    </span>
  );
}

function BarRow({ label, count, max, tone }: { label: string; count: number; max: number; tone?: string }) {
  return (
    <li className="bar-row">
      <span className="bar-row-label" title={label}>
        {label}
      </span>
      <Bar value={count} max={max} tone={tone} />
      <span className="bar-row-value">{count}</span>
    </li>
  );
}

function CountList({ items, empty, tone }: { items: CountStat[]; empty: string; tone?: string }) {
  if (!items.length) return <p className="muted small">{empty}</p>;
  const max = Math.max(...items.map((i) => i.count), 1);
  return (
    <ul className="bar-list">
      {items.map((i) => (
        <BarRow key={i.label} label={i.label} count={i.count} max={max} tone={tone} />
      ))}
    </ul>
  );
}

function SectionTable({ sections }: { sections: SectionStat[] }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Section</th>
            <th scope="col">Pages</th>
            <th scope="col">With text</th>
            <th scope="col">Coverage</th>
          </tr>
        </thead>
        <tbody>
          {sections.map((s) => (
            <tr key={s.name}>
              <td>{s.name}</td>
              <td>{s.total}</td>
              <td>{s.with_text}</td>
              <td>
                <span className="coverage">
                  <Bar value={s.with_text} max={s.total} tone="ok" />
                  <span className="coverage-pct">{pct(s.with_text, s.total)}%</span>
                </span>
              </td>
            </tr>
          ))}
          {sections.length === 0 && (
            <tr className="empty-row">
              <td colSpan={4}>No section data.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function StatsPage() {
  const statsQuery = useQuery({ queryKey: ['stats'], queryFn: fetchStats });

  if (statsQuery.isLoading) return <div className="card">Loading stats…</div>;
  if (statsQuery.isError) {
    return (
      <div className="page">
        <div className="alert alert-error" role="alert">
          Could not load stats: {(statsQuery.error as Error).message}
        </div>
      </div>
    );
  }
  const s = statsQuery.data;
  if (!s) return null;

  const kpis: { label: string; value: string | number; tone?: string }[] = [
    { label: 'Pages', value: s.total_pages },
    { label: 'Published', value: s.published, tone: 'ok' },
    { label: 'Pending', value: s.pending, tone: 'warn' },
    { label: 'Draft', value: s.draft },
    { label: 'Rejected', value: s.rejected, tone: 'bad' },
    { label: 'Coverage', value: `${s.coverage_pct}%` },
    { label: 'Groups', value: s.groups },
    { label: 'Max depth', value: s.max_depth },
    { label: 'Volunteers', value: s.volunteers },
    { label: 'Admins', value: s.admins },
  ];

  return (
    <div className="page">
      <div className="crumb">Insights</div>
      <div className="page-head">
        <h2>Stats dashboard</h2>
        <span className="muted small">
          {s.pages_with_text} of {s.total_pages} English pages have body text ·
          oldest pending {s.oldest_pending_days} day{s.oldest_pending_days === 1 ? '' : 's'}
        </span>
      </div>

      <div className="kpi-grid">
        {kpis.map((k) => (
          <div className={`kpi${k.tone ? ` kpi-${k.tone}` : ''}`} key={k.label}>
            <span className="kpi-value">{k.value}</span>
            <span className="kpi-label">{k.label}</span>
          </div>
        ))}
      </div>

      <div className="stat-columns">
        <section className="card">
          <h3>Content coverage by section</h3>
          <SectionTable sections={s.by_section} />
        </section>

        <section className="card">
          <h3>Translations</h3>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Language</th>
                  <th scope="col">Published</th>
                  <th scope="col">Pending</th>
                  <th scope="col">Draft</th>
                  <th scope="col">Rejected</th>
                  <th scope="col">Total</th>
                </tr>
              </thead>
              <tbody>
                {s.translations.map((t) => (
                  <tr key={t.lang}>
                    <td>{langName(t.lang)}</td>
                    <td>{t.published}</td>
                    <td>{t.pending}</td>
                    <td>{t.draft}</td>
                    <td>{t.rejected}</td>
                    <td>{t.total}</td>
                  </tr>
                ))}
                {s.translations.length === 0 && (
                  <tr className="empty-row">
                    <td colSpan={6}>No translations yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="card">
        <h3>Approval queue ({s.approval_queue.length})</h3>
        {s.approval_queue.length === 0 ? (
          <p className="muted">Nothing is waiting for approval.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Title</th>
                  <th scope="col">Group</th>
                  <th scope="col">Submitted by</th>
                  <th scope="col">Waiting</th>
                </tr>
              </thead>
              <tbody>
                {s.approval_queue.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link className="strong-link" to={`/pages/${p.id}`}>
                        {p.title}
                      </Link>
                    </td>
                    <td className="muted small">{p.group ?? '—'}</td>
                    <td>{p.submitted_by ?? '—'}</td>
                    <td className="nowrap">
                      {p.waiting_days} day{p.waiting_days === 1 ? '' : 's'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="stat-columns">
        <section className="card">
          <h3>Largest groups</h3>
          <CountList
            items={s.largest_groups.map((g) => ({ label: g.name, count: g.count }))}
            empty="No groups yet."
          />
        </section>

        <section className="card">
          <h3>Top contributors</h3>
          <CountList items={s.contributors} empty="No credits recorded yet." tone="ok" />
        </section>
      </div>

      <div className="stat-columns">
        <section className="card">
          <h3>Activity by action (7 days)</h3>
          <CountList items={s.activity_by_action} empty="No recorded activity in the last week." tone="info" />
        </section>

        <section className="card">
          <h3>Activity by user (7 days)</h3>
          <CountList items={s.activity_by_user} empty="No recorded activity in the last week." tone="info" />
        </section>
      </div>
    </div>
  );
}

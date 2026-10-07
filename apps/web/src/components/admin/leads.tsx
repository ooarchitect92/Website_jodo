'use client';
import { useEffect, useState } from 'react';
import { useAdminApi, DataTable } from './context';
export function Leads() {
  const { request, session } = useAdminApi();
  const [rows, setRows] = useState<any[]>([]),
    [error, setError] = useState(''),
    [filter, setFilter] = useState(''),
    [selected, setSelected] = useState<any>(null);
  async function load() {
    try {
      setRows(await request('admin/leads'));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  return (
    <>
      <div className="admin-toolbar">
        <input
          aria-label="Search leads"
          placeholder="Search institute or name…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <button className="button outline" onClick={load}>
          Refresh
        </button>
        {session.user.role === 'owner' && (
          <button
            className="button outline"
            onClick={async () => {
              const r = await fetch('/api/v1/admin/leads/export', {
                method: 'POST',
                headers: { 'X-CSRF-Token': session.csrf, 'Content-Type': 'application/json' },
                body: '{}',
              });
              if (!r.ok) {
                setError('Export failed');
                return;
              }
              const a = document.createElement('a');
              a.href = URL.createObjectURL(await r.blob());
              a.download = 'leads.csv';
              a.click();
              URL.revokeObjectURL(a.href);
            }}
          >
            Export protected CSV
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="error-card">
          {error}
        </p>
      )}
      <section className="admin-panel">
        <h2>Accepted enquiries</h2>
        <p>
          These are committed business records. A high declared-fit score is not qualification or a
          verified sale.
        </p>
        <DataTable
          rows={rows
            .filter((r) =>
              (r.fields.name + ' ' + r.fields.institute)
                .toLowerCase()
                .includes(filter.toLowerCase()),
            )
            .map((r) => ({
              ...r,
              name: r.fields.name,
              institute: r.fields.institute,
              scoreValue: r.score.score,
            }))}
          columns={[
            ['receipt', 'Receipt'],
            ['name', 'Name'],
            ['institute', 'Institute'],
            ['stage', 'Stage'],
            ['scoreValue', 'Declared fit'],
            ['attribution', 'Source context'],
          ]}
          actions={(r) => <button onClick={() => setSelected(r)}>Review</button>}
        />
      </section>
      {selected && (
        <section className="admin-panel">
          <div className="admin-toolbar">
            <h2>{selected.fields.institute}</h2>
            <button className="button outline" onClick={() => setSelected(null)}>
              Close details
            </button>
          </div>
          <div className="admin-grid">
            <div>
              <p>
                <strong>{selected.fields.name}</strong> · {selected.fields.role}
              </p>
              <p>
                {selected.fields.email}
                <br />
                {selected.fields.phone}
                <br />
                {selected.fields.city}
              </p>
              <p>
                Interest: {selected.fields.interest} · Students: {selected.fields.students}
              </p>
              <p>{selected.fields.message}</p>
              <p className="small">
                Declared, not independently verified. Source: {selected.fields.source}.
              </p>
            </div>
            <div>
              <h3>Why this score?</h3>
              {selected.score.contributions.map((c: any) => (
                <p key={c.reason}>
                  {c.points} · {c.reason}
                </p>
              ))}
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  try {
                    await request('admin/leads/' + selected.id + '/stage', 'POST', {
                      stage: f.get('stage'),
                      reason: f.get('reason'),
                      expectedVersion: selected.version,
                    });
                    setSelected(null);
                    await load();
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                <label className="field">
                  Move to stage
                  <select name="stage" defaultValue="contacted">
                    {['new', 'contacted', 'qualified', 'won', 'lost', 'spam'].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  Reason
                  <input name="reason" required minLength={3} maxLength={200} />
                </label>
                <button className="button primary">Record transition</button>
              </form>
              <p className="small">
                The API checks allowed transitions and current version. Notes never enter generic
                analytics.
              </p>
            </div>
          </div>
        </section>
      )}
    </>
  );
}

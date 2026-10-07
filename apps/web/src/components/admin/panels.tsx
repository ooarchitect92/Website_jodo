'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/client';
import { DataTable, useAdminApi } from './context';
export function Dashboard() {
  const { request } = useAdminApi();
  const [data, setData] = useState<any>(null),
    [error, setError] = useState('');
  useEffect(() => {
    request('admin/overview')
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <>
      {error ? (
        <p role="alert" className="error-card">
          {error}
        </p>
      ) : !data ? (
        <p>Loading current business records…</p>
      ) : (
        <>
          <div className="dashboard-stats">
            {[
              ['Published pages', data.stats.published],
              ['Accepted leads', data.stats.leads],
              ['New enquiries', data.stats.new_leads],
              ['Open tasks', data.stats.open_tasks],
            ].map(([title, n]) => (
              <div key={title} className="dashboard-stat">
                <span>{title}</span>
                <strong>{n}</strong>
              </div>
            ))}
          </div>
          <div className="admin-grid">
            <section className="admin-panel">
              <p className="eyebrow">Owner workspace</p>
              <h2>Your website, under control.</h2>
              <p>
                Create and review content, manage enquiries and inspect the evidence behind each
                action.
              </p>
              <p>{data.definition}</p>
              <p className="small">Last refreshed {new Date(data.updatedAt).toLocaleString()}</p>
            </section>
            <section className="admin-panel">
              <p className="eyebrow">Needs attention</p>
              <h2>{data.stats.attention} delivery records</h2>
              <p>
                Blocked external delivery is not a lost lead. Review the outbox before enabling any
                notification or integration.
              </p>
              <span className="status-pill warn">Production approval pending</span>
              <p className="small" style={{ marginTop: 20 }}>
                Content rights, privacy decisions, provider tests, recovery and owner acceptance
                remain separate launch gates.
              </p>
            </section>
          </div>
        </>
      )}
    </>
  );
}
export function Campaigns() {
  const { request } = useAdminApi();
  const [rows, setRows] = useState<any[]>([]),
    [error, setError] = useState(''),
    [copy, setCopy] = useState('');
  const load = () =>
    request<any[]>('admin/campaigns')
      .then(setRows)
      .catch((e) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);
  return (
    <>
      <form
        className="admin-panel admin-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          try {
            await request('admin/campaigns', 'POST', Object.fromEntries(f));
            await load();
            setError('');
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        <h2>Campaign link builder</h2>
        <p>Keep personal details and sensitive audience descriptions out of campaign parameters.</p>
        <div className="row">
          <label className="field">
            Display name
            <input name="name" required minLength={3} />
          </label>
          <label className="field">
            Destination path
            <input name="path" defaultValue="/contact-us/" required />
          </label>
          <label className="field">
            Source
            <select name="source">
              {['google', 'meta', 'email', 'partner', 'qr'].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Medium
            <select name="medium">
              {['cpc', 'paid_social', 'email', 'referral', 'qr'].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="field">
          Campaign code
          <input
            name="campaign"
            required
            pattern="[a-z0-9_-]{2,80}"
            placeholder="institute_demo_oct"
          />
        </label>
        <button className="button primary">Create campaign link</button>
        {error && (
          <p role="alert" className="error-card">
            {error}
          </p>
        )}
      </form>
      <section className="admin-panel">
        <h2>Saved links</h2>
        {copy && <p role="status">{copy}</p>}
        <DataTable
          rows={rows.map((r) => ({ ...r, name: r.definition.name }))}
          columns={[
            ['name', 'Campaign'],
            ['url', 'Generated URL'],
          ]}
          actions={(r) => (
            <button
              onClick={() =>
                navigator.clipboard
                  .writeText(r.url)
                  .then(() => setCopy('Copied campaign link.'))
                  .catch(() =>
                    setCopy('Clipboard unavailable. Select and copy the URL from the table.'),
                  )
              }
            >
              Copy
            </button>
          )}
        />
      </section>
    </>
  );
}
export function Media() {
  const { request, session } = useAdminApi();
  const [rows, setRows] = useState<any[]>([]),
    [message, setMessage] = useState('');
  const load = () =>
    request<any[]>('admin/media')
      .then(setRows)
      .catch((e) => setMessage(e.message));
  useEffect(() => {
    void load();
  }, []);
  return (
    <>
      <form
        className="admin-panel admin-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          try {
            await api('/v1/admin/media', {
              method: 'POST',
              headers: { 'X-CSRF-Token': session.csrf },
              body: new FormData(form),
            });
            form.reset();
            setMessage('Image validated, re-encoded and saved.');
            await load();
          } catch (e) {
            setMessage((e as Error).message);
          }
        }}
      >
        <h2>Media library</h2>
        <p>
          JPEG, PNG or WebP, up to 4 MB. Images are decoded and re-encoded; active SVG and document
          uploads are not allowed.
        </p>
        <label className="field">
          Image
          <input name="file" type="file" accept="image/png,image/jpeg,image/webp" required />
        </label>
        <label className="field">
          Alternative text
          <input name="alt" required minLength={3} maxLength={200} />
        </label>
        <label className="field">
          Rights / source permission
          <input name="rights" required minLength={5} maxLength={300} />
        </label>
        <button className="button primary">Validate and upload</button>
        {message && <p role="status">{message}</p>}
      </form>
      <div className="admin-media-grid">
        {rows.map((r) => (
          <article className="admin-media-card" key={r.id}>
            <img src={r.path} alt={r.alt} />
            <p>{r.alt}</p>
            <p>{r.path}</p>
            <p>{r.rights}</p>
            <button
              onClick={() =>
                navigator.clipboard
                  .writeText(r.path)
                  .then(() => setMessage('Image path copied.'))
                  .catch(() => setMessage('Select and copy the image path.'))
              }
            >
              Copy image path
            </button>
          </article>
        ))}
      </div>
    </>
  );
}
export function Settings() {
  const { request } = useAdminApi();
  const [rows, setRows] = useState<any[]>([]),
    [message, setMessage] = useState('');
  useEffect(() => {
    request<any[]>('admin/settings')
      .then(setRows)
      .catch((e) => setMessage(e.message));
  }, []);
  function edit(key: string, value: unknown) {
    setRows((all) => all.map((r) => (r.key === key ? { ...r, value } : r)));
  }
  async function save(r: any) {
    try {
      const changed = await request('admin/settings/' + r.key, 'PATCH', {
        expectedVersion: r.version,
        value: r.value,
      });
      setRows((all) => all.map((x) => (x.key === r.key ? changed : x)));
      setMessage('Settings saved. Public requests use the new configuration.');
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  return (
    <>
      {message && (
        <p role="status" className="admin-feedback">
          {message}
        </p>
      )}
      {rows.map((r) => (
        <section key={r.key} className="admin-panel admin-form">
          <h2>
            {r.key === 'navigation'
              ? 'Navigation'
              : r.key === 'brand'
                ? 'Brand settings'
                : 'Enquiry form copy'}
          </h2>
          {r.key === 'navigation' && (
            <>
              {r.value.map((v: any, n: number) => (
                <div className="row" key={n}>
                  <label className="field">
                    Menu label
                    <input
                      value={v.label}
                      onChange={(e) =>
                        edit(
                          r.key,
                          r.value.map((i: any, j: number) =>
                            j === n ? { ...i, label: e.target.value } : i,
                          ),
                        )
                      }
                    />
                  </label>
                  <label className="field">
                    Destination
                    <input
                      value={v.href}
                      onChange={(e) =>
                        edit(
                          r.key,
                          r.value.map((i: any, j: number) =>
                            j === n ? { ...i, href: e.target.value } : i,
                          ),
                        )
                      }
                    />
                  </label>
                </div>
              ))}
              <button
                className="button outline"
                onClick={() => edit(r.key, [...r.value, { label: 'New page', href: '/' }])}
              >
                Add navigation item
              </button>
            </>
          )}
          {r.key === 'brand' && (
            <>
              <label className="field">
                Site name
                <input
                  value={r.value.name}
                  onChange={(e) => edit(r.key, { ...r.value, name: e.target.value })}
                />
              </label>
              <label className="field">
                Approved blue palette
                <select
                  value={r.value.primary}
                  onChange={(e) => edit(r.key, { ...r.value, primary: e.target.value })}
                >
                  <option value="#2c67d3">Reference blue</option>
                  <option value="#2455a6">Deep blue</option>
                  <option value="#193b73">Navy</option>
                </select>
              </label>
            </>
          )}
          {r.key === 'form' && (
            <>
              {['title', 'notice', 'success'].map((k) => (
                <label className="field" key={k}>
                  {k}
                  <textarea
                    rows={3}
                    value={r.value[k]}
                    onChange={(e) => edit(r.key, { ...r.value, [k]: e.target.value })}
                  />
                </label>
              ))}
              <p className="small">
                Field types are fixed in this release. Changing sensitive data categories requires a
                reviewed schema change.
              </p>
            </>
          )}
          <div className="admin-toolbar" style={{ marginTop: 20 }}>
            <button className="button primary" onClick={() => save(r)}>
              Save version {r.version}
            </button>
          </div>
        </section>
      ))}
    </>
  );
}
export function Records({ area }: { area: string }) {
  const { request, session } = useAdminApi();
  const [rows, setRows] = useState<any[]>([]),
    [error, setError] = useState('');
  const map: Record<
    string,
    { path: string; title: string; cols: [string, string][]; note: string }
  > = {
    tasks: {
      path: 'tasks',
      title: 'Staff tasks',
      cols: [
        ['title', 'Task'],
        ['status', 'Status'],
        ['due_at', 'Due'],
      ],
      note: 'A completed task is an operator action, not a confirmed customer outcome.',
    },
    audit: {
      path: 'audit',
      title: 'Protected audit centre',
      cols: [
        ['id', 'Sequence'],
        ['actor', 'Actor'],
        ['action', 'Action'],
        ['object_id', 'Object'],
        ['created_at', 'Time'],
        ['hash', 'Integrity digest'],
      ],
      note: 'Append-only database records. Local signed export is implemented; independently trusted WORM storage is not configured.',
    },
    outbox: {
      path: 'outbox',
      title: 'Delivery and work queue',
      cols: [
        ['type', 'Event'],
        ['status', 'State'],
        ['attempts', 'Attempts'],
        ['last_error', 'Reason'],
        ['created_at', 'Created'],
      ],
      note: 'External destinations are disabled. Retry reuses the original event identity and never creates another lead.',
    },
    conversations: {
      path: 'conversations',
      title: 'Support requests',
      cols: [
        ['id', 'Conversation'],
        ['status', 'State'],
        ['created_at', 'Opened'],
        ['expires_at', 'Session expiry'],
      ],
      note: 'Guided product chat is implemented. A requested handoff creates a staff task; live agent messaging is not implemented.',
    },
    'privacy-requests': {
      path: 'privacy-requests',
      title: 'Privacy review queue',
      cols: [
        ['contact', 'Verification contact'],
        ['kind', 'Request'],
        ['status', 'State'],
        ['created_at', 'Received'],
      ],
      note: 'Requests require human identity verification. This release records requests but does not automate deletion or statutory deadlines.',
    },
    users: {
      path: 'users',
      title: 'Staff accounts',
      cols: [
        ['email', 'Email'],
        ['role', 'Role'],
        ['active', 'Active'],
        ['created_at', 'Created'],
      ],
      note: 'Provision unique staff accounts through the CLI. MFA is required. Session revocation is immediate on the API.',
    },
    integrations: {
      path: 'integrations',
      title: 'Provider activation register',
      cols: [
        ['name', 'Capability'],
        ['status', 'Actual status'],
      ],
      note: 'Configuration, implementation, activation and verification are separate states. No service is marked connected without evidence.',
    },
  };
  const def = map[area]!;
  const load = () =>
    request<any[]>('admin/' + def.path)
      .then(setRows)
      .catch((e) => setError(e.message));
  useEffect(() => {
    setRows([]);
    setError('');
    void load();
  }, [area]);
  return (
    <section className="admin-panel">
      <h2>{def.title}</h2>
      <p>{def.note}</p>
      <div className="admin-toolbar">
        <button className="button outline" onClick={load}>
          Refresh records
        </button>
        {area === 'audit' && (
          <button
            className="button outline"
            onClick={async () => {
              const r = await fetch('/api/v1/admin/content-export', {
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
              a.download = 'content-export.json';
              a.click();
              URL.revokeObjectURL(a.href);
            }}
          >
            Export content and revisions
          </button>
        )}
      </div>
      {error && (
        <p className="error-card" role="alert">
          {error}
        </p>
      )}
      <DataTable
        rows={rows}
        columns={def.cols}
        actions={
          ['tasks', 'outbox', 'users'].includes(area)
            ? (r) => (
                <button
                  onClick={async () => {
                    try {
                      if (
                        area === 'users' &&
                        !confirm('Revoke all sessions for this staff account?')
                      )
                        return;
                      await request(
                        area === 'tasks'
                          ? 'admin/tasks/' + r.id + '/complete'
                          : area === 'outbox'
                            ? 'admin/outbox/' + r.id + '/retry'
                            : 'admin/users/' + r.id + '/revoke-sessions',
                        'POST',
                        {},
                      );
                      await load();
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  {area === 'tasks'
                    ? 'Complete'
                    : area === 'outbox'
                      ? 'Retry eligible job'
                      : 'Revoke sessions'}
                </button>
              )
            : undefined
        }
      />
    </section>
  );
}

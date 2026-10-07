'use client';
import { useEffect, useState } from 'react';
import { Workflow } from '@core/contracts';
import { useAdminApi, DataTable } from './context';
export function Workflows() {
  const { request } = useAdminApi();
  const [rows, setRows] = useState<any[]>([]),
    [definition, setDefinition] = useState<Workflow>({
      name: 'Follow up on a new enquiry',
      nodes: [
        { type: 'task', title: 'Contact this institute' },
        { type: 'delay', minutes: 1440 },
        { type: 'exit_if_contacted' },
        { type: 'task', title: 'Review overdue enquiry' },
      ],
    }),
    [result, setResult] = useState<any>(null),
    [error, setError] = useState(''),
    [contacted, setContacted] = useState(false);
  async function load() {
    try {
      setRows(await request('admin/workflows'));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  return (
    <>
      <div className="admin-notice">
        This release supports durable linear staff-task workflows. Marketing sends, arbitrary
        branches and provider actions are not implemented. A pause stops new enrollment and further
        task execution; pending runs are retained.
      </div>
      <div className="admin-grid">
        <section className="admin-panel">
          <h2>Workflow builder</h2>
          <label className="field">
            Workflow name
            <input
              value={definition.name}
              onChange={(e) => setDefinition({ ...definition, name: e.target.value })}
            />
          </label>
          <div className="workflow-nodes">
            <div className="workflow-node">
              <strong>Trigger · Accepted enquiry</strong>
              <p>Only a committed lead can enroll. Browser clicks cannot.</p>
            </div>
            {definition.nodes.map((node, n) => (
              <div className="workflow-node" key={n}>
                <button
                  className="node-remove"
                  onClick={() =>
                    setDefinition({
                      ...definition,
                      nodes: definition.nodes.filter((_, i) => i !== n),
                    })
                  }
                >
                  Remove
                </button>
                <strong>
                  {node.type === 'task'
                    ? 'Create staff task'
                    : node.type === 'delay'
                      ? 'Wait'
                      : 'Stop if already contacted'}
                </strong>
                {node.type === 'task' && (
                  <label>
                    Task title
                    <input
                      value={node.title}
                      onChange={(e) =>
                        setDefinition({
                          ...definition,
                          nodes: definition.nodes.map((v, i) =>
                            i === n ? { type: 'task', title: e.target.value } : v,
                          ),
                        })
                      }
                    />
                  </label>
                )}
                {node.type === 'delay' && (
                  <label>
                    Delay in minutes
                    <input
                      type="number"
                      min={1}
                      max={10080}
                      value={node.minutes}
                      onChange={(e) =>
                        setDefinition({
                          ...definition,
                          nodes: definition.nodes.map((v, i) =>
                            i === n ? { type: 'delay', minutes: Number(e.target.value) } : v,
                          ),
                        })
                      }
                    />
                  </label>
                )}
              </div>
            ))}
          </div>
          <div className="admin-toolbar">
            <button
              className="button outline"
              onClick={() =>
                setDefinition({
                  ...definition,
                  nodes: [...definition.nodes, { type: 'task', title: 'Review lead' }],
                })
              }
            >
              + Task
            </button>
            <button
              className="button outline"
              onClick={() =>
                setDefinition({
                  ...definition,
                  nodes: [...definition.nodes, { type: 'delay', minutes: 60 }],
                })
              }
            >
              + Delay
            </button>
            <button
              className="button outline"
              onClick={() =>
                setDefinition({
                  ...definition,
                  nodes: [...definition.nodes, { type: 'exit_if_contacted' }],
                })
              }
            >
              + Exit condition
            </button>
          </div>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={contacted}
              onChange={(e) => setContacted(e.target.checked)}
            />
            Simulate a contacted lead
          </label>
          <div className="admin-toolbar">
            <button
              className="button outline"
              onClick={async () => {
                try {
                  setResult(
                    await request('admin/workflows/simulate', 'POST', { definition, contacted }),
                  );
                  setError('');
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Simulate safely
            </button>
            <button
              className="button primary"
              onClick={async () => {
                try {
                  await request('admin/workflows', 'POST', definition);
                  await load();
                  setError('');
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Save inactive workflow
            </button>
          </div>
          {error && (
            <p className="error-card" role="alert">
              {error}
            </p>
          )}
        </section>
        <section className="admin-panel">
          <h2>Simulation</h2>
          <p>No messages are sent and no production tasks are created by simulation.</p>
          {result ? (
            <pre className="json-view">{JSON.stringify(result, null, 2)}</pre>
          ) : (
            <div className="empty-state">
              Run a simulation to inspect timing and exit behaviour.
            </div>
          )}
          <h2 style={{ marginTop: 35 }}>Saved workflows</h2>
          <DataTable
            rows={rows.map((r) => ({
              ...r,
              name: r.definition.name,
              status: r.active ? 'Active' : 'Paused / inactive',
            }))}
            columns={[
              ['name', 'Name'],
              ['status', 'Status'],
            ]}
            actions={(r) => (
              <button
                onClick={async () => {
                  try {
                    await request('admin/workflows/' + r.id, 'PATCH', {
                      active: !r.active,
                      expectedVersion: r.version,
                    });
                    await load();
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                {r.active ? 'Pause' : 'Activate'}
              </button>
            )}
          />
        </section>
      </div>
    </>
  );
}

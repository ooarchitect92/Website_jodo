'use client';
import { useEffect, useRef, useState } from 'react';
import { Block, PageBody, pageSchema, blockSchema } from '@core/contracts';
import { BlockRenderer } from '../blocks';
import { useAdminApi } from './context';
export function ContentEditor({ id, onBack }: { id: string; onBack: () => void }) {
  const { request, session } = useAdminApi();
  const [record, setRecord] = useState<any>(null),
    [draft, setDraft] = useState<PageBody | null>(null),
    [status, setStatus] = useState('Loading…'),
    [error, setError] = useState(''),
    [conflict, setConflict] = useState(false),
    [reason, setReason] = useState('Reviewed content update'),
    [when, setWhen] = useState(''),
    [undo, setUndo] = useState<PageBody[]>([]),
    [redo, setRedo] = useState<PageBody[]>([]);
  const version = useRef(0),
    saved = useRef(''),
    saving = useRef(false),
    draftRef = useRef<PageBody | null>(null);
  const recoveryKey = 'jodo-draft:' + session.user.id + ':' + id;
  async function load() {
    try {
      const r = await request('admin/content/' + id);
      setRecord(r);
      setDraft(r.draft);
      draftRef.current = r.draft;
      version.current = r.version;
      saved.current = JSON.stringify(r.draft);
      setConflict(false);
      setError('');
      setStatus('Server-acknowledged draft · version ' + r.version);
      try {
        const value = sessionStorage.getItem(recoveryKey);
        if (value) {
          const local = JSON.parse(value);
          if (
            Date.now() - local.time < 3600000 &&
            JSON.stringify(local.body) !== saved.current &&
            confirm('Recover unsaved work from this tab? It will not be published automatically.')
          ) {
            const parsed = pageSchema.safeParse(local.body);
            if (parsed.success) {
              setDraft(parsed.data);
              draftRef.current = parsed.data;
              setStatus('Recovered local work — not yet saved');
            }
          }
        }
      } catch {}
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, [id]);
  function edit(next: PageBody) {
    if (draft) {
      setUndo((u) => [...u.slice(-19), draft]);
      setRedo([]);
    }
    setDraft(next);
    draftRef.current = next;
    setStatus('Unsaved changes');
    try {
      sessionStorage.setItem(recoveryKey, JSON.stringify({ body: next, time: Date.now() }));
    } catch {}
  }
  async function save() {
    const value = draftRef.current;
    if (!value || saving.current || conflict || JSON.stringify(value) === saved.current) return;
    const parsed = pageSchema.safeParse(value);
    if (!parsed.success) {
      setError(parsed.error.issues.map((x) => x.path.join('.') + ': ' + x.message).join('; '));
      setStatus('Validation required');
      return;
    }
    saving.current = true;
    setStatus('Saving…');
    const raw = JSON.stringify(value);
    const submitted = JSON.stringify(parsed.data);
    try {
      const r = await request('admin/content/' + id + '/draft', 'PATCH', {
        expectedVersion: version.current,
        body: parsed.data,
      });
      version.current = r.version;
      saved.current = submitted;
      if (JSON.stringify(draftRef.current) === raw) {
        draftRef.current = parsed.data;
        setDraft(parsed.data);
      }
      setRecord((old: any) => ({ ...old, version: r.version, state: r.state }));
      setStatus('Saved draft · version ' + r.version);
      setError('');
      if (JSON.stringify(draftRef.current) === submitted)
        try {
          sessionStorage.removeItem(recoveryKey);
        } catch {}
    } catch (e) {
      setError((e as Error).message);
      setStatus('Not saved');
      if ((e as { status?: number }).status === 409) setConflict(true);
    } finally {
      saving.current = false;
    }
  }
  useEffect(() => {
    if (!draft) return;
    const t = setTimeout(() => void save(), 1800);
    return () => clearTimeout(t);
  }, [draft, record?.version, conflict]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (draftRef.current && JSON.stringify(draftRef.current) !== saved.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  async function action(action: string, revisionId?: string) {
    if (!record || saving.current) return;
    if (draftRef.current && JSON.stringify(draftRef.current) !== saved.current) {
      setError('Save and wait for acknowledgment before changing workflow state.');
      return;
    }
    if (
      ['trash', 'restore', 'unpublish', 'rollback'].includes(action) &&
      !confirm(
        `${action.toUpperCase()}: ${record.slug}\nThis changes public availability. Source history remains protected.\nReason: ${reason}`,
      )
    )
      return;
    try {
      await request('admin/content/' + id + '/action', 'POST', {
        action,
        expectedVersion: version.current,
        reason,
        ...(revisionId ? { revisionId } : {}),
        ...(action === 'schedule' && when ? { scheduledAt: new Date(when).toISOString() } : {}),
      });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  if (!draft || !record)
    return (
      <div className="admin-panel">
        <p>{status}</p>
        {error && <p role="alert">{error}</p>}
      </div>
    );
  const setBlock = (index: number, patch: Partial<Block>) =>
    edit({ ...draft, blocks: draft.blocks.map((b, n) => (n === index ? { ...b, ...patch } : b)) });
  function move(index: number, delta: number) {
    const list = [...draft!.blocks];
    const target = index + delta;
    if (target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target]!, list[index]!];
    edit({ ...draft!, blocks: list });
  }
  return (
    <>
      <div className="admin-toolbar">
        <button
          className="button outline"
          onClick={() => {
            if (
              JSON.stringify(draftRef.current) !== saved.current &&
              !confirm('Leave the editor with unacknowledged changes?')
            )
              return;
            onBack();
          }}
        >
          ← All content
        </button>
        <span className="status-pill">
          {record.kind} · {record.state}
          {record.deleted_at ? ' · in trash' : ''}
        </span>
        <span className="save-state" role="status">
          {status}
        </span>
        <button className="button primary" onClick={save} disabled={conflict}>
          Save now
        </button>
        <button
          className="button outline"
          disabled={!undo.length}
          onClick={() => {
            const v = undo.at(-1)!;
            setRedo((r) => [...r, draft]);
            setUndo((u) => u.slice(0, -1));
            setDraft(v);
            draftRef.current = v;
          }}
        >
          Undo
        </button>
        <button
          className="button outline"
          disabled={!redo.length}
          onClick={() => {
            const v = redo.at(-1)!;
            setUndo((u) => [...u, draft]);
            setRedo((r) => r.slice(0, -1));
            setDraft(v);
            draftRef.current = v;
          }}
        >
          Redo
        </button>
      </div>
      {error && (
        <div className="error-card" role="alert">
          {error}
          {conflict && (
            <>
              <p>
                Your local changes remain in this tab. Download them before reloading the current
                server revision.
              </p>
              <button
                className="button outline"
                onClick={() => {
                  const a = document.createElement('a');
                  a.href = URL.createObjectURL(
                    new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' }),
                  );
                  a.download = 'conflicting-draft.json';
                  a.click();
                  URL.revokeObjectURL(a.href);
                }}
              >
                Download local draft
              </button>
              <button
                className="button outline"
                onClick={() => {
                  try {
                    sessionStorage.removeItem(recoveryKey);
                  } catch {}
                  void load();
                }}
              >
                Reload server revision
              </button>
            </>
          )}
        </div>
      )}
      <div className="editor-layout">
        <div className="editor-fields">
          <section className="admin-panel">
            <h2>Page details</h2>
            <p>{record.slug}</p>
            <label className="field">
              Page title
              <input
                value={draft.title}
                maxLength={200}
                onChange={(e) => edit({ ...draft, title: e.target.value })}
              />
            </label>
            <label className="field">
              Search / social description
              <textarea
                rows={3}
                maxLength={300}
                value={draft.description}
                onChange={(e) => edit({ ...draft, description: e.target.value })}
              />
            </label>
            <label className="field">
              Category
              <input
                value={draft.category}
                onChange={(e) => edit({ ...draft, category: e.target.value })}
              />
            </label>
            <label className="field">
              Cover image path
              <input
                value={draft.cover}
                onChange={(e) => edit({ ...draft, cover: e.target.value })}
              />
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={draft.indexable}
                onChange={(e) => edit({ ...draft, indexable: e.target.checked })}
              />
              Index this page after the site-wide launch gate is approved
            </label>
          </section>
          <section className="admin-panel">
            <h2>Approved sections</h2>
            <p>
              Reorder with buttons, edit structured fields and preview. Arbitrary HTML and
              JavaScript are not accepted.
            </p>
            {draft.blocks.map((b, index) => (
              <details className="block-editor" key={b.id}>
                <summary>
                  <span>
                    {index + 1}. {b.type} · {b.title.slice(0, 38) || 'New section'}
                  </span>
                  <span>⌄</span>
                </summary>
                <div className="block-editor-content">
                  {(
                    ['title', 'accent', 'eyebrow', 'label', 'href', 'image', 'imageAlt'] as const
                  ).map((key) => (
                    <label className="field" key={key}>
                      {(
                        {
                          imageAlt: 'Image alternative text',
                          href: 'Link destination',
                          label: 'Button label',
                        } as Record<string, string>
                      )[key] || key}
                      <input
                        value={b[key] || ''}
                        onChange={(e) =>
                          setBlock(index, {
                            [key]: key === 'title' ? e.target.value : e.target.value || undefined,
                          })
                        }
                      />
                    </label>
                  ))}
                  <label className="field">
                    Description / body
                    <textarea
                      rows={4}
                      value={b.text}
                      onChange={(e) => setBlock(index, { text: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    Background
                    <select
                      value={b.tone}
                      onChange={(e) => setBlock(index, { tone: e.target.value as Block['tone'] })}
                    >
                      {['white', 'lavender', 'gradient', 'blue'].map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>
                  </label>
                  {b.items.map((item, n) => (
                    <div className="inline-items" key={n}>
                      <strong className="small">Item {n + 1}</strong>
                      {(['title', 'text', 'image', 'href', 'label'] as const).map((k) => (
                        <label className="field" key={k}>
                          {k}
                          <input
                            value={item[k] || ''}
                            onChange={(e) =>
                              setBlock(index, {
                                items: b.items.map((i, j) =>
                                  j === n
                                    ? {
                                        ...i,
                                        [k]: ['title', 'text'].includes(k)
                                          ? e.target.value
                                          : e.target.value || undefined,
                                      }
                                    : i,
                                ),
                              })
                            }
                          />
                        </label>
                      ))}
                      <button
                        className="text-button"
                        onClick={() =>
                          setBlock(index, { items: b.items.filter((_, j) => j !== n) })
                        }
                      >
                        Remove item
                      </button>
                    </div>
                  ))}
                  <button
                    className="button outline"
                    onClick={() =>
                      setBlock(index, { items: [...b.items, { title: 'New item', text: '' }] })
                    }
                  >
                    Add item
                  </button>
                </div>
                <div className="block-actions">
                  <button disabled={index === 0} onClick={() => move(index, -1)}>
                    Move up
                  </button>
                  <button
                    disabled={index === draft.blocks.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    Move down
                  </button>
                  <button
                    onClick={() => {
                      if (
                        confirm('Remove this block from the draft? Published history is retained.')
                      )
                        edit({ ...draft, blocks: draft.blocks.filter((_, i) => i !== index) });
                    }}
                  >
                    Remove
                  </button>
                </div>
              </details>
            ))}
            <label className="field" style={{ marginTop: 24 }}>
              Add a section
              <select
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value)
                    edit({
                      ...draft,
                      blocks: [
                        ...draft.blocks,
                        blockSchema.parse({
                          id: crypto.randomUUID(),
                          type: e.target.value,
                          title: 'New section',
                          text: 'Describe this section.',
                        }),
                      ],
                    });
                  e.target.value = '';
                }}
              >
                <option value="">Choose a block type</option>
                {[
                  'hero',
                  'text',
                  'faq',
                  'products',
                  'features',
                  'steps',
                  'logos',
                  'cta',
                  'team',
                  'articles',
                  'stories',
                ].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
          </section>
          <section className="admin-panel">
            <h2>Review and publication</h2>
            <label className="field">
              Reason for this action
              <input value={reason} onChange={(e) => setReason(e.target.value)} minLength={3} />
            </label>
            <div className="admin-toolbar">
              <button className="button outline" onClick={() => action('review')}>
                Submit for review
              </button>
              {session.user.role === 'owner' && (
                <>
                  <button className="button outline" onClick={() => action('approve')}>
                    Approve draft
                  </button>
                  <button className="button primary" onClick={() => action('publish')}>
                    Publish approved draft
                  </button>
                </>
              )}
            </div>
            {session.user.role === 'owner' && (
              <>
                <label className="field">
                  Schedule approved draft (your local time)
                  <input
                    type="datetime-local"
                    value={when}
                    onChange={(e) => setWhen(e.target.value)}
                  />
                </label>
                <div className="admin-toolbar">
                  <button className="button outline" onClick={() => action('schedule')}>
                    Schedule
                  </button>
                  <button className="button outline" onClick={() => action('unpublish')}>
                    Unpublish
                  </button>
                  <button
                    className="button outline danger-button"
                    onClick={() => action(record.deleted_at ? 'restore' : 'trash')}
                  >
                    {record.deleted_at ? 'Restore to draft' : 'Move to no-expiry trash'}
                  </button>
                </div>
              </>
            )}
            <p className="small">
              Permanent purge is not exposed in this release. Trashed records do not expire
              automatically.
            </p>
            <h3>Published revisions</h3>
            {record.revisions.map((rev: any) => (
              <div className="admin-toolbar" key={rev.id}>
                <span className="small">
                  {new Date(rev.created_at).toLocaleString()} · {rev.id.slice(0, 8)}
                </span>
                {session.user.role === 'owner' && (
                  <button className="button outline" onClick={() => action('rollback', rev.id)}>
                    Publish this revision
                  </button>
                )}
              </div>
            ))}
          </section>
        </div>
        <aside className="editor-preview" aria-label="Draft preview">
          <div className="preview-label">Draft preview · not the live page · links disabled</div>
          <div className="preview-canvas" inert>
            <BlockRenderer blocks={draft.blocks} />
          </div>
        </aside>
      </div>
    </>
  );
}

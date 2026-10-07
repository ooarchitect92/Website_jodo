'use client';
import { useEffect, useState } from 'react';
import { useAdminApi, DataTable } from './context';
import { ContentEditor } from './content-editor';
export function ContentList() {
  const { request } = useAdminApi();
  const [rows, setRows] = useState<any[]>([]),
    [selected, setSelected] = useState(''),
    [filter, setFilter] = useState(''),
    [trash, setTrash] = useState(false),
    [error, setError] = useState(''),
    [create, setCreate] = useState(false);
  async function load() {
    try {
      setRows(await request('admin/content'));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  if (selected)
    return (
      <ContentEditor
        id={selected}
        onBack={() => {
          setSelected('');
          void load();
        }}
      />
    );
  return (
    <>
      <div className="admin-toolbar">
        <input
          aria-label="Search content"
          placeholder="Search title or route…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <label className="checkbox-row">
          <input type="checkbox" checked={trash} onChange={(e) => setTrash(e.target.checked)} />
          Show no-expiry trash
        </label>
        <button className="button primary" onClick={() => setCreate(!create)}>
          Create content
        </button>
      </div>
      {create && (
        <form
          className="admin-panel admin-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const title = String(f.get('title'));
            try {
              const r = await request('admin/content', 'POST', {
                slug: f.get('slug'),
                kind: f.get('kind'),
                body: {
                  title,
                  description: title + ' — learn more about this topic.',
                  blocks: [
                    {
                      id: crypto.randomUUID(),
                      type: f.get('kind') === 'page' ? 'hero' : 'text',
                      title,
                      text: 'Add approved content here.',
                      items: [],
                      tone: 'gradient',
                    },
                  ],
                  category: '',
                  cover: '',
                  author: 'Editorial team',
                  indexable: false,
                },
              });
              setSelected(r.id);
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          <h2>Create a draft</h2>
          <div className="row">
            <label className="field">
              Title
              <input name="title" required minLength={3} />
            </label>
            <label className="field">
              Route
              <input name="slug" required pattern="/[a-z0-9/-]+/" placeholder="/your-page/" />
            </label>
          </div>
          <label className="field">
            Collection
            <select name="kind">
              <option value="page">Page</option>
              <option value="post">Blog article</option>
              <option value="case">Case study</option>
            </select>
          </label>
          <button className="button primary">Create draft</button>
        </form>
      )}
      {error && (
        <p role="alert" className="error-card">
          {error}
        </p>
      )}
      <section className="admin-panel">
        <h2>{trash ? 'Protected content trash' : 'Pages, articles and case studies'}</h2>
        <p>
          {trash
            ? 'Only a manual restore changes these records. There is no automatic expiry.'
            : 'Drafts and live revisions are separate. Editing does not change the public page until approval and publication.'}
        </p>
        <DataTable
          rows={rows.filter(
            (r) =>
              !!r.deleted_at === trash &&
              (r.title + ' ' + r.slug).toLowerCase().includes(filter.toLowerCase()),
          )}
          columns={[
            ['title', 'Title'],
            ['slug', 'Route'],
            ['kind', 'Type'],
            ['state', 'Workflow'],
            ['version', 'Version'],
          ]}
          actions={(r) => <button onClick={() => setSelected(r.id)}>Edit / review</button>}
        />
      </section>
    </>
  );
}

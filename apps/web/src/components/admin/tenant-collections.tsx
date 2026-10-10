'use client';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { useAdminApi, DataTable } from './context';
import { TenantFormBuilder } from '../tenant-form-builder';
import type { TenantQuestion } from '../tenant-questions';

type Collection = {
  id: string;
  slug: string;
  title: string;
  version: number;
  fields: TenantQuestion[];
};
type Entry = {
  id: string;
  schemaVersion: number;
  createdAt: string;
  values: Record<string, string>;
};
type Snapshot = { version: number; title: string; fields: TenantQuestion[] };
type CollectionSummary = {
  total: number;
  currentVersion: number;
  byVersion: { version: number; count: number }[];
};

const starterField = (): TenantQuestion => ({
  key: 'field_' + crypto.randomUUID().slice(0, 8),
  label: 'New field',
  kind: 'short_text',
  required: true,
  options: [],
});

export function TenantCollections() {
  const { request, session } = useAdminApi();
  const [collections, setCollections] = useState<Collection[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [versions, setVersions] = useState<Snapshot[]>([]);
  const [summary, setSummary] = useState<CollectionSummary | null>(null);
  const [createFields, setCreateFields] = useState<TenantQuestion[]>([]);
  const [extraFields, setExtraFields] = useState<TenantQuestion[]>([]);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submittedKey = useRef('');
  const submittedPayload = useRef('');
  const collection = collections.find((item) => item.id === selectedId) || null;
  const canEdit = session.tenant.role === 'owner' && !session.tenant.readOnly;

  async function refresh() {
    try {
      const list = await request<Collection[]>('admin/tenant/collections');
      setCollections(list);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function loadDetails(id: string) {
    try {
      const [saved, history, counts] = await Promise.all([
        request<Entry[]>('admin/tenant/collections/' + id + '/entries'),
        request<Snapshot[]>('admin/tenant/collections/' + id + '/versions'),
        request<CollectionSummary>('admin/tenant/collections/' + id + '/summary'),
      ]);
      setEntries(saved);
      setVersions(history);
      setSummary(counts);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    setCollections([]);
    setSelectedId('');
    setEntries([]);
    setVersions([]);
    setSummary(null);
    setExtraFields([]);
    submittedKey.current = '';
    void refresh();
  }, [session.tenant.id]);

  useEffect(() => {
    setEntries([]);
    setVersions([]);
    setSummary(null);
    setExtraFields([]);
    submittedKey.current = '';
    submittedPayload.current = '';
    if (selectedId) void loadDetails(selectedId);
  }, [session.tenant.id, selectedId]);

  async function createCollection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const form = event.currentTarget;
      const values = new FormData(form);
      const created = await request<Collection>('admin/tenant/collections', 'POST', {
        slug: values.get('slug'),
        title: values.get('title'),
        fields: createFields,
      });
      await refresh();
      setCreateFields([]);
      setSelectedId(created.id);
      setStatus('Private collection created. Existing data was not modified.');
      form.reset();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function publishRevision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!collection) return;
    setBusy(true);
    setError('');
    try {
      const values = new FormData(event.currentTarget);
      await request('admin/tenant/collections/' + collection.id + '/revisions', 'POST', {
        title: values.get('title'),
        expectedVersion: collection.version,
        fields: [...collection.fields, ...extraFields],
      });
      setExtraFields([]);
      await refresh();
      await loadDetails(collection.id);
      setStatus('New collection version saved. Previous fields and records were preserved.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function addEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!collection) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const payload = {
      version: collection.version,
      values: Object.fromEntries(
        collection.fields.map((field) => [field.key, String(values.get(field.key) || '')]),
      ),
    };
    const serialized = JSON.stringify(payload);
    if (submittedPayload.current && submittedPayload.current !== serialized) {
      setError('Your previous save may have completed. Retry with the same values or reload.');
      return;
    }
    if (!submittedKey.current) submittedKey.current = crypto.randomUUID();
    submittedPayload.current = serialized;
    setBusy(true);
    setError('');
    try {
      await request('admin/tenant/collections/' + collection.id + '/entries', 'POST', {
        ...payload,
        submissionKey: submittedKey.current,
      });
      submittedKey.current = '';
      submittedPayload.current = '';
      form.reset();
      await loadDetails(collection.id);
      setStatus('Encrypted collection record saved and audited.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="admin-panel">
        <h2>Private custom collections</h2>
        <p>
          Build internal, tenant-owned records. Published fields can only be extended; existing
          records and schema versions are never deleted. These are not public forms or payment
          instructions. Do not use them for financial credentials or sensitive personal data.
        </p>
        {error && (
          <p className="error-card" role="alert">
            {error}
          </p>
        )}
        {status && (
          <p className="admin-feedback" role="status">
            {status}
          </p>
        )}
        <div className="admin-toolbar">
          <button className="button outline" type="button" onClick={refresh}>
            Refresh collections
          </button>
        </div>
        <DataTable
          rows={collections}
          columns={[
            ['title', 'Collection'],
            ['slug', 'Identifier'],
            ['version', 'Schema version'],
          ]}
          actions={(row) => (
            <button type="button" onClick={() => setSelectedId(row.id)}>
              Open collection
            </button>
          )}
        />
      </section>

      {canEdit && (
        <section className="admin-panel">
          <h2>Create a collection</h2>
          <form onSubmit={createCollection}>
            <label className="field">
              Internal identifier
              <input
                name="slug"
                required
                pattern="[a-z][a-z0-9_]{2,39}"
                maxLength={40}
                placeholder="campus_checklist"
              />
            </label>
            <label className="field">
              Collection title
              <input name="title" required minLength={3} maxLength={100} />
            </label>
            <TenantFormBuilder fields={createFields} onChange={setCreateFields} />
            <button className="button primary" disabled={busy || createFields.length === 0}>
              Create private collection
            </button>
          </form>
        </section>
      )}

      {collection && (
        <section className="admin-panel">
          <h2>{collection.title}</h2>
          <p>Schema version {collection.version} · Internal use only</p>
          {summary && (
            <>
              <p>
                <strong>{summary.total}</strong> saved records across all versions
              </p>
              <DataTable
                rows={summary.byVersion}
                columns={[
                  ['version', 'Schema version'],
                  ['count', 'Saved records'],
                ]}
              />
              <p className="small muted">
                Counts cover all records, not just the 100 most recently displayed below.
              </p>
            </>
          )}
          <p>Current fields: {collection.fields.map((field) => field.label).join(', ')}</p>
          <details>
            <summary>Version history ({versions.length})</summary>
            <DataTable
              rows={versions}
              columns={[
                ['version', 'Version'],
                ['title', 'Title'],
                ['fields', 'Fields at publication'],
              ]}
            />
          </details>
          <h3>Add an internal record</h3>
          <form key={collection.id + '-' + collection.version} onSubmit={addEntry}>
            {collection.fields.map((field) => (
              <label className="field" key={field.key}>
                {field.label}
                {field.kind === 'long_text' ? (
                  <textarea name={field.key} maxLength={1000} required={field.required} />
                ) : field.kind === 'choice' ? (
                  <select name={field.key} required={field.required} defaultValue="">
                    <option value="">Choose…</option>
                    {field.options.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input name={field.key} maxLength={160} required={field.required} />
                )}
              </label>
            ))}
            <button className="button primary" disabled={busy || session.tenant.readOnly}>
              Save encrypted record
            </button>
          </form>
          <h3>Recent saved records</h3>
          <DataTable
            rows={entries.map((row) => ({
              id: row.id,
              schemaVersion: row.schemaVersion,
              createdAt: row.createdAt,
              values: row.values,
            }))}
            columns={[
              ['createdAt', 'Created'],
              ['schemaVersion', 'Schema version'],
              ['values', 'Saved fields'],
            ]}
          />
          {canEdit && (
            <form onSubmit={publishRevision}>
              <h3>Extend the schema</h3>
              <p>Existing fields are locked; only add new fields or change the collection title.</p>
              <label className="field">
                New title
                <input
                  name="title"
                  defaultValue={collection.title}
                  minLength={3}
                  maxLength={100}
                  required
                />
              </label>
              <TenantFormBuilder fields={extraFields} onChange={setExtraFields} />
              <button
                className="button primary"
                disabled={busy || collection.fields.length + extraFields.length > 8}
              >
                Publish new schema version
              </button>
            </form>
          )}
        </section>
      )}
    </>
  );
}

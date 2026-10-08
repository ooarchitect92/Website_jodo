'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { DataTable, useAdminApi } from './context';

type AcademicOverview = {
  students: Array<{
    id: string;
    student_reference: string;
    full_name: string;
    date_of_birth?: string | null;
    status: string;
    branch_code?: string | null;
    branch_name?: string | null;
    academic_year?: string | null;
  }>;
  guardians: Array<{
    id: string;
    display_name: string;
    email?: string | null;
    phone?: string | null;
    verification_status: string;
    active_links: number;
  }>;
  catalogue: Array<{
    id: string;
    kind: string;
    code: string;
    label: string;
    parent_id?: string | null;
    parent_label?: string | null;
    status: string;
    version: number;
  }>;
  imports: Array<{
    id: string;
    source_system: string;
    status: string;
    row_count: number;
    valid_count: number;
    error_count: number;
    committed_count: number;
  }>;
  conflicts: Array<{
    id: string;
    source_system: string;
    entity_type: string;
    external_id: string;
    field_key: string;
    status: string;
  }>;
};

export function AcademicOperations() {
  const { request, session } = useAdminApi();
  const [data, setData] = useState<AcademicOverview | null>(null);
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState<any>(null);
  const [selectedStudent, setSelectedStudent] = useState('');
  const [selectedGuardian, setSelectedGuardian] = useState('');

  async function load() {
    try {
      setData(await request<AcademicOverview>('admin/academic/overview'));
      setMessage('');
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  useEffect(() => {
    void load();
  }, [session.tenant.id]);

  const activeCatalogue = useMemo(
    () => data?.catalogue.filter((item) => item.status === 'active') || [],
    [data],
  );

  async function submit(
    event: FormEvent<HTMLFormElement>,
    path: string,
    build: (form: FormData) => unknown,
    success: string,
  ) {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await request(path, 'POST', build(new FormData(form)));
      form.reset();
      setMessage(success);
      await load();
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  if (!data)
    return (
      <section className="admin-panel">
        <p className="eyebrow">CAP-016 · CAP-020</p>
        <h2>Students, guardians & ERP context</h2>
        <p>{message || 'Loading academic records…'}</p>
      </section>
    );

  return (
    <>
      {message && (
        <p className="admin-feedback" role="status">
          {message}
        </p>
      )}

      <section className="admin-panel">
        <div className="admin-toolbar">
          <div>
            <p className="eyebrow">EDU-01 · EDU-07</p>
            <h2>Academic customer context</h2>
            <p>
              Student identity, guardian access, academic dimensions and imports are tenant-scoped.
              A contact match never grants access by itself.
            </p>
          </div>
          <span className="status-pill">{session.tenant.name}</span>
        </div>
        <div className="dashboard-stats">
          <div className="dashboard-stat">
            <span>Students</span>
            <strong>{data.students.length}</strong>
          </div>
          <div className="dashboard-stat">
            <span>Guardians</span>
            <strong>{data.guardians.length}</strong>
          </div>
          <div className="dashboard-stat">
            <span>Catalogue items</span>
            <strong>{activeCatalogue.length}</strong>
          </div>
          <div className="dashboard-stat">
            <span>Open ERP conflicts</span>
            <strong>{data.conflicts.filter((item) => item.status === 'open').length}</strong>
          </div>
        </div>
      </section>

      <section className="admin-grid">
        <form
          className="admin-panel admin-form"
          onSubmit={(event) =>
            submit(
              event,
              'admin/academic/students',
              (form) => ({
                studentReference: String(form.get('studentReference') || ''),
                fullName: String(form.get('fullName') || ''),
                ...(String(form.get('dateOfBirth') || '')
                  ? { dateOfBirth: String(form.get('dateOfBirth')) }
                  : {}),
              }),
              'Student record created.',
            )
          }
        >
          <p className="eyebrow">CAP-016 · EDU-01</p>
          <h2>Create student</h2>
          <label className="field">
            Student reference
            <input name="studentReference" required pattern="[A-Za-z0-9._/-]{2,80}" />
          </label>
          <label className="field">
            Full name
            <input name="fullName" required minLength={2} maxLength={160} />
          </label>
          <label className="field">
            Date of birth
            <input type="date" name="dateOfBirth" />
          </label>
          <button className="button primary">Create student</button>
        </form>

        <form
          className="admin-panel admin-form"
          onSubmit={(event) =>
            submit(
              event,
              'admin/academic/guardians',
              (form) => ({
                displayName: String(form.get('displayName') || ''),
                ...(String(form.get('email') || '') ? { email: String(form.get('email')) } : {}),
                ...(String(form.get('phone') || '') ? { phone: String(form.get('phone')) } : {}),
              }),
              'Guardian record created. Relationship access is still separate.',
            )
          }
        >
          <p className="eyebrow">CAP-016 · EDU-03</p>
          <h2>Create guardian / payer identity</h2>
          <label className="field">
            Display name
            <input name="displayName" required minLength={2} maxLength={160} />
          </label>
          <label className="field">
            Email
            <input type="email" name="email" />
          </label>
          <label className="field">
            Phone
            <input name="phone" />
          </label>
          <button className="button primary">Create guardian</button>
        </form>
      </section>

      <form
        className="admin-panel admin-form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!selectedStudent || !selectedGuardian) {
            setMessage('Choose both a student and guardian.');
            return;
          }
          const form = new FormData(event.currentTarget);
          try {
            await request('admin/academic/students/' + selectedStudent + '/guardians', 'POST', {
              guardianId: selectedGuardian,
              relationship: String(form.get('relationship') || 'guardian'),
              payerRole: String(form.get('payerRole') || 'authorised'),
              verified: form.get('verified') === 'on',
            });
            setMessage('Guardian relationship saved.');
            await load();
          } catch (error) {
            setMessage((error as Error).message);
          }
        }}
      >
        <p className="eyebrow">EDU-02 · EDU-03</p>
        <h2>Link guardian to student</h2>
        <p>
          Relationship evidence is explicit. Sharing a phone number or email never automatically
          grants access to another learner.
        </p>
        <div className="row">
          <label className="field">
            Student
            <select value={selectedStudent} onChange={(e) => setSelectedStudent(e.target.value)}>
              <option value="">Select student</option>
              {data.students.map((student) => (
                <option key={student.id} value={student.id}>
                  {student.student_reference} · {student.full_name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Guardian
            <select value={selectedGuardian} onChange={(e) => setSelectedGuardian(e.target.value)}>
              <option value="">Select guardian</option>
              {data.guardians.map((guardian) => (
                <option key={guardian.id} value={guardian.id}>
                  {guardian.display_name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="row">
          <label className="field">
            Relationship
            <select name="relationship" defaultValue="guardian">
              <option value="mother">Mother</option>
              <option value="father">Father</option>
              <option value="guardian">Guardian</option>
              <option value="self">Self</option>
              <option value="sponsor">Sponsor</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="field">
            Payer role
            <select name="payerRole" defaultValue="authorised">
              <option value="primary">Primary payer</option>
              <option value="authorised">Authorised payer</option>
              <option value="view_only">View only</option>
              <option value="none">No payer role</option>
            </select>
          </label>
        </div>
        <label>
          <input type="checkbox" name="verified" /> Relationship evidence has been verified
        </label>
        <button className="button primary">Save relationship</button>
      </form>

      <section className="admin-grid">
        <form
          className="admin-panel admin-form"
          onSubmit={(event) =>
            submit(
              event,
              'admin/academic/catalogue',
              (form) => ({
                kind: String(form.get('kind') || 'course'),
                code: String(form.get('code') || ''),
                label: String(form.get('label') || ''),
                ...(String(form.get('parentId') || '')
                  ? { parentId: String(form.get('parentId')) }
                  : {}),
              }),
              'Catalogue item created.',
            )
          }
        >
          <p className="eyebrow">CAP-017 · EDU-04</p>
          <h2>Academic catalogue</h2>
          <div className="row">
            <label className="field">
              Dimension
              <select name="kind" defaultValue="course">
                <option value="course">Course</option>
                <option value="grade">Grade</option>
                <option value="batch">Batch</option>
                <option value="transport">Transport</option>
                <option value="hostel">Hostel</option>
              </select>
            </label>
            <label className="field">
              Code
              <input name="code" required pattern="[A-Za-z0-9._/-]{2,60}" />
            </label>
          </div>
          <label className="field">
            Label
            <input name="label" required minLength={2} maxLength={160} />
          </label>
          <label className="field">
            Optional parent
            <select name="parentId" defaultValue="">
              <option value="">No parent</option>
              {activeCatalogue.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.kind} · {item.code} · {item.label}
                </option>
              ))}
            </select>
          </label>
          <button className="button primary">Create catalogue item</button>
        </form>

        <section className="admin-panel">
          <p className="eyebrow">Version-safe catalogue</p>
          <h2>Active and retired dimensions</h2>
          {data.catalogue.map((item) => (
            <div className="record-row" key={item.id}>
              <strong>
                {item.kind} · {item.code}
              </strong>
              <span>{item.label}</span>
              <span>{item.parent_label || 'root'}</span>
              <span className="status-pill">{item.status}</span>
              {item.status === 'active' && (
                <button
                  type="button"
                  className="button outline"
                  onClick={async () => {
                    try {
                      await request('admin/academic/catalogue/' + item.id + '/retire', 'POST', {});
                      setMessage('Catalogue item retired without deleting historical references.');
                      await load();
                    } catch (error) {
                      setMessage((error as Error).message);
                    }
                  }}
                >
                  Retire
                </button>
              )}
            </div>
          ))}
        </section>
      </section>

      <form
        className="admin-panel admin-form"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          try {
            const rows = JSON.parse(String(form.get('rows') || '[]'));
            const result = await request<any>('admin/academic/imports/preview', 'POST', {
              sourceSystem: String(form.get('sourceSystem') || ''),
              rows,
            });
            setPreview(result);
            setMessage(
              'Import preview created. No student records were written. Review row errors before commit.',
            );
            await load();
          } catch (error) {
            setMessage((error as Error).message);
          }
        }}
      >
        <p className="eyebrow">CAP-019 · CAP-020 · EDU-07</p>
        <h2>Bulk import dry run</h2>
        <p>
          Preview validates rows, detects duplicate student references and preserves source-system
          IDs. Commit is a separate idempotent action.
        </p>
        <label className="field">
          Source system
          <input name="sourceSystem" defaultValue="erp" required minLength={2} maxLength={80} />
        </label>
        <label className="field">
          Rows as JSON array
          <textarea
            name="rows"
            rows={8}
            required
            defaultValue={JSON.stringify(
              [
                {
                  studentReference: 'STU-001',
                  fullName: 'Synthetic Student',
                  externalId: 'ERP-001',
                },
              ],
              null,
              2,
            )}
          />
        </label>
        <button className="button primary">Run dry preview</button>
        {preview?.batch && (
          <div className="admin-notice">
            <strong>
              Batch {preview.batch.id} · {preview.batch.status}
            </strong>
            <p>
              Valid {preview.batch.valid_count ?? preview.rows?.filter((r: any) => r.status === 'valid').length ?? 0}
              {' · '}errors {preview.batch.error_count ?? preview.rows?.filter((r: any) => r.status === 'error').length ?? 0}
            </p>
            {preview.batch.status === 'previewed' && (
              <button
                type="button"
                className="button"
                onClick={async () => {
                  try {
                    const result = await request<any>(
                      'admin/academic/imports/' + preview.batch.id + '/commit',
                      'POST',
                      {},
                    );
                    setMessage(
                      'Import committed: ' +
                        String(result.committed_count) +
                        ' row(s), status ' +
                        result.status +
                        '.',
                    );
                    setPreview(null);
                    await load();
                  } catch (error) {
                    setMessage((error as Error).message);
                  }
                }}
              >
                Commit validated rows
              </button>
            )}
          </div>
        )}
      </form>

      <section className="admin-panel">
        <p className="eyebrow">EDU-01</p>
        <h2>Students</h2>
        <DataTable
          rows={data.students}
          columns={[
            ['student_reference', 'Reference'],
            ['full_name', 'Student'],
            ['branch_code', 'Branch'],
            ['academic_year', 'Academic year'],
            ['status', 'Status'],
          ]}
        />
      </section>

      <section className="admin-grid">
        <section className="admin-panel">
          <p className="eyebrow">EDU-03</p>
          <h2>Guardians</h2>
          <DataTable
            rows={data.guardians}
            columns={[
              ['display_name', 'Name'],
              ['verification_status', 'Verification'],
              ['active_links', 'Active links'],
            ]}
          />
        </section>
        <section className="admin-panel">
          <p className="eyebrow">CAP-019</p>
          <h2>Import history</h2>
          <DataTable
            rows={data.imports}
            columns={[
              ['source_system', 'Source'],
              ['status', 'Status'],
              ['row_count', 'Rows'],
              ['committed_count', 'Committed'],
              ['error_count', 'Errors'],
            ]}
          />
        </section>
      </section>

      <section className="admin-panel">
        <p className="eyebrow">CAP-020</p>
        <h2>ERP conflict queue</h2>
        <p>
          Financial and identity conflicts require an explicit resolution. This view never applies
          “last write wins” automatically.
        </p>
        <DataTable
          rows={data.conflicts}
          columns={[
            ['source_system', 'Source'],
            ['entity_type', 'Entity'],
            ['external_id', 'External ID'],
            ['field_key', 'Field'],
            ['status', 'Status'],
          ]}
          actions={(row) =>
            row.status === 'open' ? (
              <button
                type="button"
                className="button outline"
                onClick={async () => {
                  try {
                    await request('admin/academic/conflicts/' + row.id + '/resolve', 'POST', {
                      resolution: 'resolved_local',
                      note: 'Kept the tenant-authorised local value after operator review',
                    });
                    setMessage('ERP conflict resolved in favour of the authorised local value.');
                    await load();
                  } catch (error) {
                    setMessage((error as Error).message);
                  }
                }}
              >
                Keep local
              </button>
            ) : null
          }
        />
      </section>
    </>
  );
}

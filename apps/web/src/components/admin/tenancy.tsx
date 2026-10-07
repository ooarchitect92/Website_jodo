'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useAdminApi } from './context';

type TenantOverview = {
  tenant: {
    id: string;
    slug: string;
    display_name: string;
    legal_name: string | null;
    status: string;
    locale: string;
  };
  onboarding: {
    current_step: string;
    draft: Record<string, unknown>;
    version: number;
    updated_at: string;
  } | null;
  entities: Array<{
    id: string;
    name: string;
    registration_reference?: string | null;
    status: string;
  }>;
  branches: Array<{
    id: string;
    legal_entity_id: string;
    legal_entity_name: string;
    code: string;
    name: string;
    city?: string | null;
    state?: string | null;
    status: string;
  }>;
  academicYears: Array<{
    id: string;
    label: string;
    starts_on: string;
    ends_on: string;
    status: string;
  }>;
  brandVersions: Array<{
    id: string;
    name: string;
    primary_colour: string;
    accent_colour: string;
    support_email?: string | null;
    locale: string;
    status: string;
    version: number;
  }>;
  domains: Array<{
    id: string;
    hostname: string;
    status: string;
    verified_at?: string | null;
  }>;
  members: Array<{
    id: string;
    user_id: string;
    email: string;
    role_key: string;
    status: string;
    branch_id?: string | null;
  }>;
  roles: Array<{
    id: string;
    role_key: string;
    name: string;
    description: string;
    grants: string[];
    explicit_denies: string[];
    status: string;
    version: number;
  }>;
  approvals: Array<{
    id: string;
    role_id: string;
    role_key: string;
    name: string;
    version: number;
    requested_by: string;
    status: string;
    decision_reason?: string | null;
  }>;
  permissionCatalogue: string[];
  workspaceRole: string;
};

export function TenancyStudio() {
  const { request, session } = useAdminApi();
  const [data, setData] = useState<TenantOverview | null>(null);
  const [message, setMessage] = useState('');
  const [domainInstruction, setDomainInstruction] = useState<{
    name: string;
    value: string;
  } | null>(null);

  async function load() {
    try {
      setData(await request<TenantOverview>('admin/tenant/overview'));
      setMessage('');
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  useEffect(() => {
    void load();
  }, [session.tenant.id]);

  const owner = data?.workspaceRole === 'owner';

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
        <h2>Organisation & access</h2>
        <p>{message || 'Loading workspace configuration…'}</p>
      </section>
    );

  const pendingApprovals = data.approvals.filter((approval) => approval.status === 'pending');

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
            <p className="eyebrow">CAP-001 · CAP-006</p>
            <h2>{data.tenant.display_name}</h2>
            <p>
              Workspace <strong>{data.tenant.slug}</strong> · tenant role{' '}
              <strong>{data.workspaceRole}</strong>
            </p>
          </div>
          <span className="status-pill">{data.tenant.status}</span>
        </div>
        <div className="dashboard-stats">
          <div className="dashboard-stat">
            <span>Legal entities</span>
            <strong>{data.entities.length}</strong>
          </div>
          <div className="dashboard-stat">
            <span>Branches</span>
            <strong>{data.branches.length}</strong>
          </div>
          <div className="dashboard-stat">
            <span>Members</span>
            <strong>{data.members.filter((member) => member.status === 'active').length}</strong>
          </div>
          <div className="dashboard-stat">
            <span>Role approvals</span>
            <strong>{pendingApprovals.length}</strong>
          </div>
        </div>
        <p className="small">
          Workspace membership, organisation metadata and role releases are tenant-scoped. Existing
          business modules are still being migrated to full tenant isolation, so additional live
          workspaces must remain disabled until those migrations and cross-tenant tests are complete.
        </p>
      </section>

      <form
        className="admin-panel admin-form"
        onSubmit={(event) =>
          submit(
            event,
            'admin/tenant/onboarding',
            (form) => ({
              section: 'organisation',
              data: {
                legalName: String(form.get('legalName') || ''),
                institutionType: String(form.get('institutionType') || ''),
                intendedCollectionModel: String(form.get('intendedCollectionModel') || ''),
                supportEmail: String(form.get('supportEmail') || ''),
              },
            }),
            'Onboarding draft saved.',
          )
        }
      >
        <p className="eyebrow">TEN-01 · Resumable onboarding</p>
        <h2>Business registration draft</h2>
        <p>
          This draft does not activate payment rails or claim partner approval. It records the
          owner-supplied organisation context for later review.
        </p>
        <div className="row">
          <label className="field">
            Legal / operating name
            <input name="legalName" required minLength={2} maxLength={160} disabled={!owner} />
          </label>
          <label className="field">
            Institution type
            <select name="institutionType" defaultValue="school" disabled={!owner}>
              <option value="school">School</option>
              <option value="college">College</option>
              <option value="university">University</option>
              <option value="coaching">Coaching / test prep</option>
              <option value="edtech">EdTech / skilling</option>
              <option value="other">Other</option>
            </select>
          </label>
        </div>
        <div className="row">
          <label className="field">
            Intended collection model
            <select name="intendedCollectionModel" defaultValue="one_time_and_recurring" disabled={!owner}>
              <option value="one_time">One-time payments</option>
              <option value="recurring">Recurring collections</option>
              <option value="one_time_and_recurring">One-time + recurring</option>
            </select>
          </label>
          <label className="field">
            Support email
            <input type="email" name="supportEmail" disabled={!owner} />
          </label>
        </div>
        <button className="button primary" disabled={!owner}>
          Save onboarding section
        </button>
      </form>

      <section className="admin-grid">
        <form
          className="admin-panel admin-form"
          onSubmit={(event) =>
            submit(
              event,
              'admin/tenant/organisation/entities',
              (form) => ({
                name: String(form.get('name') || ''),
                ...(String(form.get('registrationReference') || '')
                  ? { registrationReference: String(form.get('registrationReference')) }
                  : {}),
                ...(String(form.get('taxReferenceMasked') || '')
                  ? { taxReferenceMasked: String(form.get('taxReferenceMasked')) }
                  : {}),
              }),
              'Legal entity created.',
            )
          }
        >
          <p className="eyebrow">TEN-03</p>
          <h2>Legal entities</h2>
          <label className="field">
            Entity name
            <input name="name" required minLength={2} maxLength={160} disabled={!owner} />
          </label>
          <label className="field">
            Registration reference
            <input name="registrationReference" maxLength={120} disabled={!owner} />
          </label>
          <label className="field">
            Masked tax reference
            <input
              name="taxReferenceMasked"
              maxLength={80}
              placeholder="Masked / display-safe only"
              disabled={!owner}
            />
          </label>
          <button className="button primary" disabled={!owner}>
            Add legal entity
          </button>
          {data.entities.map((entity) => (
            <div className="record-row" key={entity.id}>
              <strong>{entity.name}</strong>
              <span>{entity.registration_reference || 'No registration reference'}</span>
              <span className="status-pill">{entity.status}</span>
            </div>
          ))}
        </form>

        <form
          className="admin-panel admin-form"
          onSubmit={(event) =>
            submit(
              event,
              'admin/tenant/organisation/branches',
              (form) => ({
                legalEntityId: String(form.get('legalEntityId') || ''),
                code: String(form.get('code') || ''),
                name: String(form.get('name') || ''),
                ...(String(form.get('city') || '') ? { city: String(form.get('city')) } : {}),
                ...(String(form.get('state') || '') ? { state: String(form.get('state')) } : {}),
              }),
              'Branch created.',
            )
          }
        >
          <p className="eyebrow">TEN-03</p>
          <h2>Campuses / branches</h2>
          <label className="field">
            Legal entity
            <select name="legalEntityId" required defaultValue="" disabled={!owner}>
              <option value="" disabled>
                Select entity
              </option>
              {data.entities.map((entity) => (
                <option value={entity.id} key={entity.id}>
                  {entity.name}
                </option>
              ))}
            </select>
          </label>
          <div className="row">
            <label className="field">
              Branch code
              <input name="code" required pattern="[A-Za-z0-9_-]{2,40}" disabled={!owner} />
            </label>
            <label className="field">
              Branch name
              <input name="name" required minLength={2} maxLength={120} disabled={!owner} />
            </label>
          </div>
          <div className="row">
            <label className="field">
              City
              <input name="city" maxLength={100} disabled={!owner} />
            </label>
            <label className="field">
              State
              <input name="state" maxLength={100} disabled={!owner} />
            </label>
          </div>
          <button className="button primary" disabled={!owner || !data.entities.length}>
            Add branch
          </button>
          {data.branches.map((branch) => (
            <div className="record-row" key={branch.id}>
              <strong>{branch.code}</strong>
              <span>{branch.name}</span>
              <span>{branch.legal_entity_name}</span>
              <span className="status-pill">{branch.status}</span>
            </div>
          ))}
        </form>
      </section>

      <form
        className="admin-panel admin-form"
        onSubmit={(event) =>
          submit(
            event,
            'admin/tenant/organisation/academic-years',
            (form) => ({
              label: String(form.get('label') || ''),
              startsOn: String(form.get('startsOn') || ''),
              endsOn: String(form.get('endsOn') || ''),
            }),
            'Academic year created.',
          )
        }
      >
        <p className="eyebrow">CAP-002</p>
        <h2>Academic years</h2>
        <div className="row">
          <label className="field">
            Label
            <input name="label" placeholder="2026-27" required disabled={!owner} />
          </label>
          <label className="field">
            Starts
            <input type="date" name="startsOn" required disabled={!owner} />
          </label>
          <label className="field">
            Ends
            <input type="date" name="endsOn" required disabled={!owner} />
          </label>
        </div>
        <button className="button primary" disabled={!owner}>
          Add academic year
        </button>
        {data.academicYears.map((year) => (
          <div className="record-row" key={year.id}>
            <strong>{year.label}</strong>
            <span>
              {year.starts_on} → {year.ends_on}
            </span>
            <span className="status-pill">{year.status}</span>
          </div>
        ))}
      </form>

      <section className="admin-grid">
        <form
          className="admin-panel admin-form"
          onSubmit={(event) =>
            submit(
              event,
              'admin/tenant/brand',
              (form) => ({
                name: String(form.get('name') || ''),
                primaryColour: String(form.get('primaryColour') || '#0f766e'),
                accentColour: String(form.get('accentColour') || '#f97316'),
                ...(String(form.get('supportEmail') || '')
                  ? { supportEmail: String(form.get('supportEmail')) }
                  : {}),
                locale: String(form.get('locale') || 'en-IN'),
              }),
              'Brand draft created. Existing documents remain unchanged.',
            )
          }
        >
          <p className="eyebrow">TEN-04 · Brand versioning</p>
          <h2>Tenant brand draft</h2>
          <label className="field">
            Display name
            <input name="name" required minLength={2} maxLength={120} disabled={!owner} />
          </label>
          <div className="row">
            <label className="field">
              Primary colour
              <input type="color" name="primaryColour" defaultValue="#0f766e" disabled={!owner} />
            </label>
            <label className="field">
              Accent colour
              <input type="color" name="accentColour" defaultValue="#f97316" disabled={!owner} />
            </label>
          </div>
          <label className="field">
            Support email
            <input type="email" name="supportEmail" disabled={!owner} />
          </label>
          <label className="field">
            Locale
            <select name="locale" defaultValue="en-IN" disabled={!owner}>
              <option value="en-IN">English (India)</option>
              <option value="hi-IN">Hindi-ready</option>
            </select>
          </label>
          <button className="button primary" disabled={!owner}>
            Save brand draft
          </button>
          {data.brandVersions.slice(0, 5).map((brand) => (
            <div className="record-row" key={brand.id}>
              <strong>
                v{brand.version} · {brand.name}
              </strong>
              <span>
                {brand.primary_colour} / {brand.accent_colour}
              </span>
              <span className="status-pill">{brand.status}</span>
            </div>
          ))}
        </form>

        <form
          className="admin-panel admin-form"
          onSubmit={async (event) => {
            event.preventDefault();
            const form = event.currentTarget;
            try {
              const result = await request<{
                id: string;
                dns: { name: string; value: string };
              }>('admin/tenant/domains', 'POST', {
                hostname: String(new FormData(form).get('hostname') || ''),
              });
              setDomainInstruction(result.dns);
              form.reset();
              setMessage('Domain challenge created. Add the TXT record before verification.');
              await load();
            } catch (error) {
              setMessage((error as Error).message);
            }
          }}
        >
          <p className="eyebrow">TEN-05 · Domain ownership</p>
          <h2>Custom domains</h2>
          <label className="field">
            Hostname
            <input name="hostname" placeholder="fees.example.edu" required disabled={!owner} />
          </label>
          <button className="button primary" disabled={!owner}>
            Create verification challenge
          </button>
          {domainInstruction && (
            <div className="admin-notice">
              <strong>TXT record</strong>
              <p>
                Name: <code>{domainInstruction.name}</code>
              </p>
              <p>
                Value: <code>{domainInstruction.value}</code>
              </p>
            </div>
          )}
          {data.domains.map((domain) => (
            <div className="record-row" key={domain.id}>
              <strong>{domain.hostname}</strong>
              <span className="status-pill">{domain.status}</span>
              {domain.status === 'pending' && owner ? (
                <button
                  type="button"
                  className="button outline"
                  onClick={async () => {
                    try {
                      await request('admin/tenant/domains/' + domain.id + '/verify', 'POST', {});
                      setMessage('Domain ownership verified.');
                      await load();
                    } catch (error) {
                      setMessage((error as Error).message);
                    }
                  }}
                >
                  Verify DNS
                </button>
              ) : (
                <span>{domain.verified_at || '—'}</span>
              )}
            </div>
          ))}
        </form>
      </section>

      <section className="admin-panel">
        <p className="eyebrow">TEN-06 · Workspace memberships</p>
        <h2>Team access</h2>
        <p>
          Authentication is global; authorisation is attached to an explicit workspace membership.
        </p>
        {data.members.map((member) => (
          <div className="record-row" key={member.id}>
            <strong>{member.email}</strong>
            <span>{member.role_key}</span>
            <span>{member.branch_id ? 'branch-scoped' : 'workspace scope'}</span>
            <span className="status-pill">{member.status}</span>
          </div>
        ))}
      </section>

      <section className="admin-grid">
        <form
          className="admin-panel admin-form"
          onSubmit={(event) =>
            submit(
              event,
              'admin/tenant/roles',
              (form) => ({
                roleKey: String(form.get('roleKey') || ''),
                name: String(form.get('name') || ''),
                description: String(form.get('description') || ''),
                grants: form.getAll('grants').map(String),
                explicitDenies: form.getAll('explicitDenies').map(String),
              }),
              'Role draft created. Submit it for independent approval before release.',
            )
          }
        >
          <p className="eyebrow">TEN-07 · RBAC + deny rules</p>
          <h2>Create custom role version</h2>
          <div className="row">
            <label className="field">
              Role key
              <input name="roleKey" pattern="[a-z][a-z0-9_.-]{1,79}" required disabled={!owner} />
            </label>
            <label className="field">
              Name
              <input name="name" required minLength={2} maxLength={100} disabled={!owner} />
            </label>
          </div>
          <label className="field">
            Description
            <input name="description" maxLength={300} disabled={!owner} />
          </label>
          <fieldset>
            <legend>Grants</legend>
            <div className="payer-component-grid">
              {data.permissionCatalogue.map((permission) => (
                <label key={'grant:' + permission}>
                  <input type="checkbox" name="grants" value={permission} disabled={!owner} />{' '}
                  {permission}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>Explicit denies</legend>
            <div className="payer-component-grid">
              {data.permissionCatalogue.map((permission) => (
                <label key={'deny:' + permission}>
                  <input
                    type="checkbox"
                    name="explicitDenies"
                    value={permission}
                    disabled={!owner}
                  />{' '}
                  {permission}
                </label>
              ))}
            </div>
          </fieldset>
          <button className="button primary" disabled={!owner}>
            Create role draft
          </button>
        </form>

        <section className="admin-panel">
          <p className="eyebrow">Maker-checker</p>
          <h2>Role release queue</h2>
          <p>
            A role maker cannot approve their own privilege release. Material role changes require
            another active tenant owner.
          </p>
          {data.roles.slice(0, 20).map((role) => (
            <div className="record-row" key={role.id}>
              <strong>
                {role.name} · v{role.version}
              </strong>
              <span>{role.role_key}</span>
              <span>{role.grants.length} grant(s)</span>
              <span className="status-pill">{role.status}</span>
              {role.status === 'draft' && owner && role.role_key !== 'owner' && (
                <button
                  type="button"
                  className="button outline"
                  onClick={async () => {
                    try {
                      await request('admin/tenant/roles/' + role.id + '/request-publish', 'POST', {});
                      setMessage('Role release submitted for independent approval.');
                      await load();
                    } catch (error) {
                      setMessage((error as Error).message);
                    }
                  }}
                >
                  Request publish
                </button>
              )}
            </div>
          ))}
          {!!pendingApprovals.length && <h3>Pending approvals</h3>}
          {pendingApprovals.map((approval) => (
            <div className="record-row" key={approval.id}>
              <strong>
                {approval.name} · v{approval.version}
              </strong>
              <span>{approval.role_key}</span>
              <span className="status-pill">{approval.status}</span>
              {owner && approval.requested_by !== session.user.id ? (
                <div className="admin-toolbar">
                  <button
                    type="button"
                    className="button"
                    onClick={async () => {
                      try {
                        await request(
                          'admin/tenant/approvals/' + approval.id + '/decide',
                          'POST',
                          { decision: 'approve', reason: 'Independent tenant-owner approval' },
                        );
                        setMessage('Role release approved.');
                        await load();
                      } catch (error) {
                        setMessage((error as Error).message);
                      }
                    }}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className="button outline"
                    onClick={async () => {
                      try {
                        await request(
                          'admin/tenant/approvals/' + approval.id + '/decide',
                          'POST',
                          { decision: 'reject', reason: 'Independent tenant-owner rejection' },
                        );
                        setMessage('Role release rejected.');
                        await load();
                      } catch (error) {
                        setMessage((error as Error).message);
                      }
                    }}
                  >
                    Reject
                  </button>
                </div>
              ) : (
                <span className="small">Independent owner required</span>
              )}
            </div>
          ))}
        </section>
      </section>
    </>
  );
}

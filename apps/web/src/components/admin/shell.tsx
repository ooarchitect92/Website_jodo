'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/client';
import { AdminContext, Session } from './context';
import { canViewAdminArea, safeAdminArea } from './access';
import { ContentList } from './content-list';
import { Leads } from './leads';
import { TenantEnquiries } from './tenant-enquiries';
import { TenantNotifications } from './tenant-notifications';
import { TenantCollections } from './tenant-collections';
import { Workflows } from './workflows';
import { Dashboard, Campaigns, Media, Settings, Records } from './panels';
import { FeeOperations } from './fees';
import { TenancyStudio } from './tenancy';
import { AcademicOperations } from './academic';
import { FeePlanStudio } from './fee-plans';
const sections = [
  ['overview', 'Overview'],
  ['content', 'Content & publishing'],
  ['leads', 'Leads'],
  ['enquiries', 'Institution enquiries'],
  ['notifications', 'Notifications'],
  ['collections', 'Custom collections'],
  ['fees', 'Fee operations'],
  ['fee-plans', 'Fee plans & receivables'],
  ['academic', 'Students & academic'],
  ['tenant', 'Organisation & access'],
  ['tasks', 'Staff tasks'],
  ['media', 'Media library'],
  ['campaigns', 'Campaign links'],
  ['workflows', 'Task workflows'],
  ['conversations', 'Support requests'],
  ['settings', 'Navigation & settings'],
  ['outbox', 'Delivery queue'],
  ['audit', 'Audit & exports'],
  ['privacy-requests', 'Privacy requests'],
  ['users', 'Staff sessions'],
  ['integrations', 'Integration status'],
];
export function AdminShell() {
  const [session, setSession] = useState<Session | null>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [area, setArea] = useState('overview');
  async function sync() {
    try {
      setSession(await api<Session>('/v1/auth/me'));
    } catch {
      setSession(null);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void sync();
    const restore = () => {
      setSession(null);
      setLoading(true);
      void sync();
    };
    const visibility = () => {
      if (document.visibilityState === 'visible') void sync();
    };
    window.addEventListener('pageshow', restore);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('pageshow', restore);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
  async function logout() {
    if (!session) return;
    try {
      await api('/v1/auth/logout', {
        method: 'POST',
        headers: { 'X-CSRF-Token': session.csrf },
        body: '{}',
      });
      setSession(null);
      setArea('overview');
      try {
        for (const key of Object.keys(sessionStorage))
          if (key.startsWith('jodo-draft:')) sessionStorage.removeItem(key);
      } catch {}
    } catch (e) {
      setError((e as Error).message);
    }
  }
  if (loading)
    return (
      <main id="main" className="admin-login">
        <p role="status">Checking the staff session…</p>
      </main>
    );
  if (!session)
    return (
      <main id="main" className="admin-login">
        <form
          className="login-card"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            try {
              const f = new FormData(e.currentTarget);
              setSession(
                await api<Session>('/v1/auth/login', {
                  method: 'POST',
                  body: JSON.stringify(Object.fromEntries(f)),
                }),
              );
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="brand brand-wordmark" aria-label="Owner workspace">
            <span className="brand-mark" aria-hidden="true">
              ◆
            </span>
            <strong>Owner workspace</strong>
          </div>
          <h1>Your owner workspace.</h1>
          <p>Manage content, enquiries and fee operations for this installation.</p>
          <label className="field">
            Staff email
            <input type="email" name="email" autoComplete="username" required />
          </label>
          <label className="field">
            Password
            <input type="password" name="password" autoComplete="current-password" required />
          </label>
          <label className="field">
            Authenticator code
            <input
              name="otp"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              autoComplete="one-time-code"
              required
            />
          </label>
          {error && (
            <p className="error-card" role="alert">
              {error}
            </p>
          )}
          <button className="button primary" disabled={busy}>
            {busy ? 'Verifying…' : 'Sign in securely'}
          </button>
          <p className="small" style={{ marginTop: 20 }}>
            No default password is included. Provision your owner with{' '}
            <code>npm run create:owner</code>.
          </p>
          <Link href="/" className="small">
            ← Back to the website
          </Link>
        </form>
      </main>
    );
  const activeArea = safeAdminArea(session.tenant.role, area);
  const render = () => {
    switch (activeArea) {
      case 'overview':
        return <Dashboard />;
      case 'content':
        return <ContentList />;
      case 'leads':
        return <Leads />;
      case 'enquiries':
        return <TenantEnquiries />;
      case 'notifications':
        return <TenantNotifications openEnquiries={() => setArea('enquiries')} />;
      case 'collections':
        return <TenantCollections />;
      case 'campaigns':
        return <Campaigns />;
      case 'workflows':
        return <Workflows />;
      case 'fees':
        return <FeeOperations />;
      case 'fee-plans':
        return <FeePlanStudio />;
      case 'academic':
        return <AcademicOperations />;
      case 'tenant':
        return <TenancyStudio />;
      case 'media':
        return <Media />;
      case 'settings':
        return <Settings />;
      default:
        return <Records key={activeArea} area={activeArea} />;
    }
  };
  return (
    <AdminContext.Provider value={session}>
      <div className="admin-root admin-shell">
        <aside className="admin-sidebar">
          <Link href="/" className="admin-logo">
            Platform<span className="yellow-dot">.</span> studio
          </Link>
          <p>TENANT CONSOLE · SAAS BLUEPRINT 2.0</p>
          <nav className="admin-nav" aria-label="Owner navigation">
            {sections
              .filter(([key]) => canViewAdminArea(session.tenant.role, key!))
              .map(([key, title]) => (
                <button
                  className={activeArea === key ? 'selected' : ''}
                  key={key}
                  onClick={() => setArea(key!)}
                >
                  {title}
                </button>
              ))}
            <Link href="/" target="_blank">
              Open public website ↗
            </Link>
          </nav>
        </aside>
        <main id="main" className="admin-main">
          <div className="admin-topbar">
            <div>
              <h1>{sections.find((s) => s[0] === activeArea)?.[1]}</h1>
              <p>
                {session.user.email} · {session.tenant.name} · {session.tenant.role}
              </p>
            </div>
            <div className="admin-top-actions">
              {session.workspaces.length > 1 && (
                <label className="small">
                  Workspace
                  <select
                    aria-label="Active workspace"
                    value={session.tenant.id}
                    onChange={async (event) => {
                      try {
                        await api('/v1/auth/switch-tenant', {
                          method: 'POST',
                          headers: { 'X-CSRF-Token': session.csrf },
                          body: JSON.stringify({ tenantId: event.target.value }),
                        });
                        setArea('overview');
                        setLoading(true);
                        await sync();
                      } catch (error) {
                        setError((error as Error).message);
                      }
                    }}
                  >
                    {session.workspaces.map((workspace) => (
                      <option value={workspace.id} key={workspace.id}>
                        {workspace.name} · {workspace.role}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <span className="status-pill">MFA session</span>
              <button onClick={logout}>Sign out</button>
            </div>
          </div>
          <div className="admin-notice">
            Production-gated build. Fee schedules and external payment evidence are supported; live
            payment, lending and advertising providers remain disabled until separately configured
            and verified.
          </div>
          {session.tenant.readOnly && (
            <div role="status" className="admin-notice">
              <strong>Read-only institution.</strong>
              <p>This workspace is restricted. Existing records remain available for review.</p>
              <p>Changes are blocked. Switch to another active institution if you have access.</p>
            </div>
          )}
          {error && (
            <p role="alert" className="error-card">
              {error}
            </p>
          )}
          {render()}
        </main>
      </div>
    </AdminContext.Provider>
  );
}

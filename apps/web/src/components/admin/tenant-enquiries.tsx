'use client';
import { FormEvent, useEffect, useState } from 'react';
import { DataTable, useAdminApi } from './context';
import { TenantFormBuilder } from '../tenant-form-builder';
import type { TenantQuestion } from '../tenant-questions';

type FormConfig = {
  enabled: boolean;
  revision?: number;
  title?: string;
  notice?: string;
  success?: string;
  fields?: TenantQuestion[];
};
type Enquiry = {
  id: string;
  receipt: string;
  stage: string;
  version: number;
  createdAt: string;
  fields: {
    name: string;
    email: string;
    phone: string;
    message: string;
    answers?: Record<string, string>;
  };
};
type EnquiryAnalytics = {
  days: number;
  since: string;
  received: number;
  waiting: number;
  reviewed: number;
  byStage: Record<string, number>;
  daily: { date: string; count: number }[];
  definition: string;
};

type History = {
  id: string;
  from: string;
  to: string;
  staff: string;
  reason: string;
  createdAt: string;
};

export function TenantEnquiries() {
  const { request, session } = useAdminApi();
  const [rows, setRows] = useState<Enquiry[]>([]);
  const [config, setConfig] = useState<FormConfig>({ enabled: false });
  const [questions, setQuestions] = useState<TenantQuestion[]>([]);
  const [selected, setSelected] = useState<Enquiry | null>(null);
  const [history, setHistory] = useState<History[]>([]);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [reportDays, setReportDays] = useState('30');
  const [analytics, setAnalytics] = useState<EnquiryAnalytics | null>(null);

  async function load() {
    try {
      const records = await request<Enquiry[]>('admin/tenant/enquiries');
      setRows(records);
      setSelected((current) => records.find((r) => r.id === current?.id) || null);
      if (session.tenant.role === 'owner') {
        const saved = await request<FormConfig>('admin/tenant/enquiry-form');
        setConfig(saved);
        setQuestions(saved.fields || []);
      }
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    setSelected(null);
    setHistory([]);
    setAnalytics(null);
    void load();
  }, [session.tenant.id]);

  async function loadAnalytics() {
    try {
      setAnalytics(
        await request<EnquiryAnalytics>('admin/tenant/enquiries/analytics?days=' + reportDays),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    setAnalytics(null);
    void loadAnalytics();
  }, [session.tenant.id, reportDays]);

  async function exportEnquiries() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/v1/admin/tenant/enquiries/export', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf },
        body: '{}',
      });
      if (!response.ok) throw new Error('Enquiry export was not completed.');
      const href = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = href;
      link.download = 'institution-enquiries.csv';
      link.click();
      URL.revokeObjectURL(href);
      setNotice('Protected enquiry CSV downloaded. Store the file securely.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function showHistory(row: Enquiry) {
    setSelected(row);
    try {
      setHistory(await request<History[]>('admin/tenant/enquiries/' + row.id + '/history'));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function configure(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const values = new FormData(event.currentTarget);
    try {
      const saved = await request<FormConfig>('admin/tenant/enquiry-form', 'POST', {
        title: values.get('title'),
        notice: values.get('notice'),
        success: values.get('success'),
        enabled: values.get('enabled') === 'on',
        fields: questions,
        expectedRevision: config.revision,
      });
      setConfig(saved);
      setQuestions(saved.fields || []);
      setNotice(
        'Institution enquiry settings saved. Changes take effect on the next public visit.',
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function changeStage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    setError('');
    const values = new FormData(event.currentTarget);
    try {
      await request('admin/tenant/enquiries/' + selected.id + '/stage', 'POST', {
        stage: values.get('stage'),
        expectedVersion: selected.version,
        reason: values.get('reason'),
      });
      setNotice('Enquiry stage saved with an audit record.');
      await load();
      await loadAnalytics();
      setHistory(await request<History[]>('admin/tenant/enquiries/' + selected.id + '/history'));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const stageChoices: Record<string, string[]> = {
    new: ['contacted', 'closed', 'spam'],
    contacted: ['qualified', 'closed', 'spam'],
    qualified: ['contacted', 'closed'],
    closed: ['contacted'],
    spam: ['new'],
  };
  const shown = rows.filter((row) =>
    (row.receipt + ' ' + row.fields.name + ' ' + row.fields.email)
      .toLowerCase()
      .includes(filter.toLowerCase()),
  );
  return (
    <>
      <section className="admin-panel">
        <div className="admin-toolbar">
          <div>
            <h2>Enquiry activity</h2>
            <p>Accepted submissions only. No cookies, visitor analytics or contact data.</p>
          </div>
          <label className="field">
            Reporting period
            <select value={reportDays} onChange={(e) => setReportDays(e.target.value)}>
              <option value="7">Last 7 UTC days</option>
              <option value="30">Last 30 UTC days</option>
              <option value="90">Last 90 UTC days</option>
            </select>
          </label>
        </div>
        {analytics ? (
          <>
            <div className="admin-toolbar" aria-label="Enquiry totals">
              <p>
                <strong>{analytics.received}</strong> received
              </p>
              <p>
                <strong>{analytics.waiting}</strong> waiting for review
              </p>
              <p>
                <strong>{analytics.reviewed}</strong> moved beyond new
              </p>
            </div>
            <DataTable
              rows={Object.entries(analytics.byStage).map(([stage, count]) => ({ stage, count }))}
              columns={[
                ['stage', 'Current stage'],
                ['count', 'Enquiries'],
              ]}
            />
            <details>
              <summary>Daily accepted submissions ({analytics.days} UTC days)</summary>
              <DataTable
                rows={analytics.daily}
                columns={[
                  ['date', 'UTC date'],
                  ['count', 'Accepted enquiries'],
                ]}
              />
            </details>
            <p className="small muted">{analytics.definition}</p>
          </>
        ) : (
          <p role="status">Loading institution enquiry statistics…</p>
        )}
      </section>
      <section className="admin-panel">
        <div className="admin-toolbar">
          <div>
            <h2>Institution enquiry inbox</h2>
            <p>Only this institution's accepted enquiries are shown. No external reply is sent.</p>
          </div>
          <div className="admin-toolbar">
            {session.tenant.role === 'owner' && (
              <button className="button outline" onClick={exportEnquiries} disabled={busy}>
                Export protected CSV
              </button>
            )}
            <button className="button outline" onClick={load}>
              Refresh
            </button>
          </div>
        </div>
        <label className="field">
          Search this institution's enquiries
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Receipt, name or email"
          />
        </label>
        {error && (
          <p role="alert" className="error-card">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="admin-feedback">
            {notice}
          </p>
        )}
        <DataTable
          rows={shown.map((r) => ({
            ...r,
            name: r.fields.name,
            email: r.fields.email,
          }))}
          columns={[
            ['receipt', 'Receipt'],
            ['name', 'Name'],
            ['email', 'Email'],
            ['stage', 'Stage'],
            ['createdAt', 'Received'],
          ]}
          actions={(row) => <button onClick={() => showHistory(row as Enquiry)}>Review</button>}
        />
      </section>
      {selected && (
        <section className="admin-panel">
          <h2>Review {selected.receipt}</h2>
          <p>
            <strong>{selected.fields.name}</strong> · {selected.fields.email} ·{' '}
            {selected.fields.phone}
          </p>
          <p>{selected.fields.message}</p>
          {Object.entries(selected.fields.answers || {}).map(([key, value]) => (
            <p key={key}>
              <strong>{key}:</strong> {value}
            </p>
          ))}
          <form onSubmit={changeStage}>
            <label className="field">
              Next stage
              <select name="stage" required>
                {(stageChoices[selected.stage] || []).map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Internal reason (encrypted)
              <textarea name="reason" minLength={3} maxLength={500} required />
            </label>
            <button className="button primary" disabled={busy || session.tenant.readOnly}>
              {busy ? 'Saving…' : 'Record stage change'}
            </button>
          </form>
          <h3>Review history</h3>
          {history.length === 0 && <p>No stage changes recorded yet.</p>}
          {history.map((entry) => (
            <p key={entry.id}>
              {entry.from} → {entry.to} · {entry.staff} · {entry.reason}
            </p>
          ))}
        </section>
      )}
      {session.tenant.role === 'owner' && (
        <section className="admin-panel">
          <h2>Public enquiry form controls</h2>
          <p>
            Enabling requires an active institution website. Submissions remain within this
            institution; WhatsApp, SMS and email are not activated by this setting.
          </p>
          <form key={String(config.revision || 0)} onSubmit={configure}>
            <label className="field">
              Form title
              <input
                name="title"
                defaultValue={config.title || ''}
                minLength={3}
                maxLength={120}
                required
              />
            </label>
            <label className="field">
              Visitor privacy notice
              <textarea
                name="notice"
                defaultValue={config.notice || ''}
                minLength={30}
                maxLength={1000}
                required
              />
            </label>
            <label className="field">
              Confirmation text
              <input
                name="success"
                defaultValue={config.success || ''}
                minLength={5}
                maxLength={240}
                required
              />
            </label>
            <label className="checkbox-row">
              <input name="enabled" type="checkbox" defaultChecked={config.enabled} />
              Enable public enquiry capture
            </label>
            <TenantFormBuilder fields={questions} onChange={setQuestions} />
            <button className="button primary" disabled={busy || session.tenant.readOnly}>
              Save form controls
            </button>
          </form>
        </section>
      )}
    </>
  );
}

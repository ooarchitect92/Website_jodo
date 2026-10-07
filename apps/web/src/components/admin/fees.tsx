'use client';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useAdminApi } from './context';

type Installment = {
  id: string;
  sequence: number;
  dueDate: string;
  amountMinor: number | string;
  paidAmountMinor: number | string;
  status: string;
};
type Payer = {
  id: string;
  accountReference: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  preferredChannel: 'email' | 'whatsapp' | 'none';
  active: boolean;
  schedules: number;
};
type Schedule = {
  id: string;
  account_reference: string;
  payer_id?: string | null;
  currency: string;
  total_amount_minor: number | string;
  note: string;
  status: string;
  version: number;
  installments: Installment[];
};
const rupees = (minor: number | string) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(
    Number(minor || 0) / 100,
  );
const toMinor = (value: FormDataEntryValue | null) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error('Enter a valid positive amount');
  return Math.round(n * 100);
};

export function FeeOperations() {
  const { request } = useAdminApi();
  const [overview, setOverview] = useState<any>(null);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [mandates, setMandates] = useState<any[]>([]);
  const [settlements, setSettlements] = useState<any[]>([]);
  const [payers, setPayers] = useState<Payer[]>([]);
  const [communications, setCommunications] = useState<any[]>([]);
  const [message, setMessage] = useState('');
  const [installmentRows, setInstallmentRows] = useState([
    { dueDate: '', amount: '' },
  ]);

  const load = async () => {
    try {
      const [o, s, p, m, st, py, cm] = await Promise.all([
        request('admin/fees/overview'),
        request<Schedule[]>('admin/fees/schedules'),
        request<any[]>('admin/fees/payments'),
        request<any[]>('admin/fees/mandates'),
        request<any[]>('admin/fees/settlements'),
        request<Payer[]>('admin/payers'),
        request<any[]>('admin/fees/communications'),
      ]);
      setOverview(o);
      setSchedules(s);
      setPayments(p);
      setMandates(m);
      setSettlements(st);
      setPayers(py);
      setCommunications(cm);
      setMessage('');
    } catch (e) {
      setMessage((e as Error).message);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const activeInstallments = useMemo(
    () =>
      schedules.flatMap((s) =>
        s.status === 'active'
          ? s.installments
              .filter((i) => !['paid', 'cancelled'].includes(i.status))
              .map((i) => ({ ...i, schedule: s }))
          : [],
      ),
    [schedules],
  );

  async function createSchedule(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    try {
      await request('admin/fees/schedules', 'POST', {
        accountReference: String(f.get('accountReference') || ''),
        ...(String(f.get('payerId') || '') ? { payerId: String(f.get('payerId')) } : {}),
        currency: 'INR',
        note: String(f.get('note') || ''),
        installments: installmentRows.map((row) => ({
          dueDate: row.dueDate,
          amountMinor: toMinor(row.amount),
        })),
      });
      form.reset();
      setInstallmentRows([{ dueDate: '', amount: '' }]);
      setMessage('Draft fee schedule created. Review it before activation.');
      await load();
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

      <section className="admin-panel">
        <p className="eyebrow">Fee lifecycle</p>
        <h2>Collection operations dashboard</h2>
        <p>
          Schedules, installments, externally confirmed payment evidence, refunds, mandates,
          settlements and reconciliation share one audited ledger. This workspace does not move
          money by itself.
        </p>
        {overview && (
          <div className="dashboard-stats">
            {[
              ['Active schedules', overview.summary.active_schedules],
              ['Scheduled', rupees(overview.summary.scheduled_minor)],
              ['Confirmed net', rupees(overview.summary.confirmed_minor)],
              ['Outstanding', rupees(overview.summary.outstanding_minor)],
              ['Overdue', rupees(overview.summary.overdue_minor)],
            ].map(([label, value]) => (
              <div className="dashboard-stat" key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
        )}
      </section>

      <form
        className="admin-panel admin-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const f = new FormData(form);
          try {
            await request('admin/payers', 'POST', {
              accountReference: String(f.get('accountReference') || ''),
              displayName: String(f.get('displayName') || ''),
              ...(String(f.get('email') || '') ? { email: String(f.get('email')) } : {}),
              ...(String(f.get('phone') || '') ? { phone: String(f.get('phone')) } : {}),
              preferredChannel: String(f.get('preferredChannel') || 'email'),
              locale: 'en-IN',
            });
            form.reset();
            setMessage('Payer profile encrypted and saved.');
            await load();
          } catch (e) {
            setMessage((e as Error).message);
          }
        }}
      >
        <h2>Create payer profile</h2>
        <p>
          Contact details are encrypted at rest. Choose only a communication channel you are
          authorized to use.
        </p>
        <div className="row">
          <label className="field">
            Account reference
            <input name="accountReference" required pattern="[A-Za-z0-9_-]{2,80}" />
          </label>
          <label className="field">
            Display name
            <input name="displayName" required minLength={2} maxLength={120} />
          </label>
        </div>
        <div className="row">
          <label className="field">
            Email
            <input type="email" name="email" />
          </label>
          <label className="field">
            Phone
            <input name="phone" placeholder="+91..." />
          </label>
          <label className="field">
            Reminder channel
            <select name="preferredChannel" defaultValue="email">
              <option value="email">Email</option>
              <option value="whatsapp">WhatsApp (provider required)</option>
              <option value="none">No automated reminders</option>
            </select>
          </label>
        </div>
        <button className="button primary">Save payer profile</button>
      </form>

      <form className="admin-panel admin-form" onSubmit={createSchedule}>
        <h2>Create fee schedule</h2>
        <p>
          Use an internal, non-sensitive account reference. Store student names and banking
          information in an approved system, not in this field.
        </p>
        <div className="row">
          <label className="field">
            Account reference
            <input name="accountReference" required pattern="[A-Za-z0-9_-]{2,80}" />
          </label>
          <label className="field">
            Payer profile
            <select name="payerId" defaultValue="">
              <option value="">No portal/reminders yet</option>
              {payers.filter((p) => p.active).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName} · {p.accountReference}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Internal note
            <input name="note" maxLength={300} placeholder="Course / cohort context" />
          </label>
        </div>
        <h3>Installments</h3>
        {installmentRows.map((row, index) => (
          <div className="row" key={index}>
            <label className="field">
              Due date
              <input
                type="date"
                value={row.dueDate}
                required
                onChange={(e) =>
                  setInstallmentRows((rows) =>
                    rows.map((r, n) => (n === index ? { ...r, dueDate: e.target.value } : r)),
                  )
                }
              />
            </label>
            <label className="field">
              Amount (INR)
              <input
                inputMode="decimal"
                value={row.amount}
                required
                placeholder="25000"
                onChange={(e) =>
                  setInstallmentRows((rows) =>
                    rows.map((r, n) => (n === index ? { ...r, amount: e.target.value } : r)),
                  )
                }
              />
            </label>
            {installmentRows.length > 1 && (
              <button
                type="button"
                className="button outline"
                onClick={() => setInstallmentRows((rows) => rows.filter((_, n) => n !== index))}
              >
                Remove
              </button>
            )}
          </div>
        ))}
        <div className="admin-toolbar">
          <button
            type="button"
            className="button outline"
            onClick={() =>
              setInstallmentRows((rows) => [...rows, { dueDate: '', amount: '' }])
            }
          >
            Add installment
          </button>
          <button className="button primary">Create draft schedule</button>
        </div>
      </form>

      <section className="admin-panel">
        <div className="admin-toolbar">
          <div>
            <h2>Fee schedules</h2>
            <p>Draft schedules require explicit activation before payment evidence can be added.</p>
          </div>
          <button className="button outline" onClick={() => void load()}>
            Refresh
          </button>
        </div>
        <div className="fee-schedule-grid">
          {schedules.map((s) => (
            <article className="fee-schedule-card" key={s.id}>
              <div className="admin-toolbar">
                <div>
                  <p className="eyebrow">{s.status}</p>
                  <h3>{s.account_reference}</h3>
                </div>
                <strong>{rupees(s.total_amount_minor)}</strong>
              </div>
              {s.note && <p>{s.note}</p>}
              <div className="fee-installments">
                {s.installments.map((i) => (
                  <div key={i.id}>
                    <span>
                      #{i.sequence} · {new Date(i.dueDate).toLocaleDateString('en-IN')}
                    </span>
                    <span>{rupees(i.amountMinor)}</span>
                    <span className="status-pill">{i.status}</span>
                  </div>
                ))}
              </div>
              {s.status === 'draft' && (
                <button
                  className="button primary"
                  onClick={async () => {
                    try {
                      await request('admin/fees/schedules/' + s.id + '/activate', 'POST', {
                        expectedVersion: s.version,
                      });
                      setMessage('Fee schedule activated.');
                      await load();
                    } catch (e) {
                      setMessage((e as Error).message);
                    }
                  }}
                >
                  Activate schedule
                </button>
              )}
              {s.payer_id && (
                <button
                  className="button outline"
                  onClick={async () => {
                    try {
                      const result = await request<{ path: string; expiresHours: number }>(
                        'admin/fees/schedules/' + s.id + '/payer-link',
                        'POST',
                        { expiresHours: 72 },
                      );
                      const url = window.location.origin + result.path;
                      await navigator.clipboard.writeText(url);
                      setMessage('Secure 72-hour payer portal link copied to clipboard.');
                    } catch (e) {
                      setMessage((e as Error).message);
                    }
                  }}
                >
                  Copy payer portal link
                </button>
              )}
            </article>
          ))}
        </div>
      </section>

      <form
        className="admin-panel admin-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          try {
            await request('admin/fees/payments/external-confirmation', 'POST', {
              installmentId: String(f.get('installmentId')),
              amountMinor: toMinor(f.get('amount')),
              currency: 'INR',
              providerReference: String(f.get('providerReference')),
              idempotencyKey: crypto.randomUUID(),
              evidenceNote: String(f.get('evidenceNote')),
            });
            e.currentTarget.reset();
            setMessage('External payment evidence recorded and audited.');
            await load();
          } catch (e) {
            setMessage((e as Error).message);
          }
        }}
      >
        <h2>Record external payment confirmation</h2>
        <p>
          Use only after the payment processor or bank has independently confirmed the transaction.
          This action records evidence; it does not charge the payer.
        </p>
        <label className="field">
          Installment
          <select name="installmentId" required defaultValue="">
            <option value="" disabled>
              Select an unpaid installment
            </option>
            {activeInstallments.map((i) => (
              <option value={i.id} key={i.id}>
                {i.schedule.account_reference} · #{i.sequence} · {rupees(i.amountMinor)}
              </option>
            ))}
          </select>
        </label>
        <div className="row">
          <label className="field">
            Confirmed amount (INR)
            <input name="amount" inputMode="decimal" required />
          </label>
          <label className="field">
            Provider / bank reference
            <input name="providerReference" pattern="[A-Za-z0-9._:-]{3,120}" required />
          </label>
        </div>
        <label className="field">
          Evidence note
          <input
            name="evidenceNote"
            minLength={3}
            maxLength={300}
            required
            placeholder="Verified in processor settlement report"
          />
        </label>
        <button className="button primary">Record confirmation</button>
      </form>

      <section className="admin-grid">
        <div className="admin-panel">
          <h2>Recent payment evidence</h2>
          {!payments.length ? (
            <p>No payment evidence recorded.</p>
          ) : (
            payments.slice(0, 20).map((p) => (
              <div className="record-row" key={p.id}>
                <strong>{p.account_reference}</strong>
                <span>{rupees(Number(p.amount_minor) - Number(p.refunded_amount_minor))}</span>
                <span>{p.provider_reference}</span>
                <span className="status-pill">{p.status}</span>
              </div>
            ))
          )}
        </div>
        <div className="admin-panel">
          <h2>Mandates & settlements</h2>
          <p>
            {mandates.length} mandate record(s) · {settlements.length} settlement record(s) ·{' '}
            {communications.length} communication record(s).
          </p>
          <p className="small">
            Provider callbacks and money movement remain provider-specific integrations. The core
            ledger is ready to receive verified states without inventing them.
          </p>
        </div>
      </section>
    </>
  );
}

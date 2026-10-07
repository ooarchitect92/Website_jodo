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
  scope_type?: string;
  scope_reference?: string;
  gross_amount_minor?: number | string | null;
  concession_amount_minor?: number | string;
  components?: Array<{
    code: string;
    label: string;
    amountMinor: number | string;
    bankRouteKey?: string | null;
  }>;
  concessions?: Array<{
    code: string;
    label: string;
    amountMinor: number | string;
    reason: string;
  }>;
  late_fee?: {
    mode: string;
    graceDays: number;
    amountMinor: number | string;
    capMinor?: number | string | null;
  } | null;
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
  const [providerEvents, setProviderEvents] = useState<any[]>([]);
  const [providerStatus, setProviderStatus] = useState<any>(null);
  const [analytics, setAnalytics] = useState<any>(null);
  const [lateFees, setLateFees] = useState<any[]>([]);
  const [mandateSetups, setMandateSetups] = useState<any[]>([]);
  const [autopayAttempts, setAutopayAttempts] = useState<any[]>([]);
  const [message, setMessage] = useState('');
  const [installmentRows, setInstallmentRows] = useState([{ dueDate: '', amount: '' }]);
  const [componentRows, setComponentRows] = useState([
    { code: 'tuition', label: 'Tuition fee', amount: '', bankRouteKey: '' },
  ]);
  const [concessionRows, setConcessionRows] = useState<
    Array<{ code: string; label: string; amount: string; reason: string }>
  >([]);

  const load = async () => {
    try {
      const [o, s, p, m, st, py, cm, pe, ps, an, lf, ms, aa] = await Promise.all([
        request('admin/fees/overview'),
        request<Schedule[]>('admin/fees/schedules'),
        request<any[]>('admin/fees/payments'),
        request<any[]>('admin/fees/mandates'),
        request<any[]>('admin/fees/settlements'),
        request<Payer[]>('admin/payers'),
        request<any[]>('admin/fees/communications'),
        request<any[]>('admin/fees/provider-events'),
        request<any>('provider/payments/status'),
        request<any>('admin/fees/analytics'),
        request<any[]>('admin/fees/late-fees'),
        request<any[]>('admin/fees/mandate-setups'),
        request<any[]>('admin/fees/autopay-attempts'),
      ]);
      setOverview(o);
      setSchedules(s);
      setPayments(p);
      setMandates(m);
      setSettlements(st);
      setPayers(py);
      setCommunications(cm);
      setProviderEvents(pe);
      setProviderStatus(ps);
      setAnalytics(an);
      setLateFees(lf);
      setMandateSetups(ms);
      setAutopayAttempts(aa);
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
        scopeType: String(f.get('scopeType') || 'custom'),
        scopeReference: String(f.get('scopeReference') || 'custom'),
        currency: 'INR',
        components: componentRows.map((row) => ({
          code: row.code,
          label: row.label,
          amountMinor: toMinor(row.amount),
          ...(row.bankRouteKey ? { bankRouteKey: row.bankRouteKey } : {}),
        })),
        concessions: concessionRows.map((row) => ({
          code: row.code,
          label: row.label,
          amountMinor: toMinor(row.amount),
          reason: row.reason,
        })),
        ...(String(f.get('lateFeeAmount') || '')
          ? {
              lateFee: {
                mode: String(f.get('lateFeeMode') || 'fixed_once'),
                graceDays: Number(f.get('lateFeeGraceDays') || 0),
                amountMinor: toMinor(f.get('lateFeeAmount')),
                ...(String(f.get('lateFeeCap') || '')
                  ? { capMinor: toMinor(f.get('lateFeeCap')) }
                  : {}),
              },
            }
          : {}),
        note: String(f.get('note') || ''),
        installments: installmentRows.map((row) => ({
          dueDate: row.dueDate,
          amountMinor: toMinor(row.amount),
        })),
      });
      form.reset();
      setInstallmentRows([{ dueDate: '', amount: '' }]);
      setComponentRows([{ code: 'tuition', label: 'Tuition fee', amount: '', bankRouteKey: '' }]);
      setConcessionRows([]);
      setMessage(
        'Draft fee schedule created. Review components, concessions and installments before activation.',
      );
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
              {payers
                .filter((p) => p.active)
                .map((p) => (
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
        <div className="row">
          <label className="field">
            Fee scope
            <select name="scopeType" defaultValue="course">
              <option value="course">Course</option>
              <option value="batch">Batch</option>
              <option value="year">Year</option>
              <option value="student">Student</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          <label className="field">
            Scope reference
            <input
              name="scopeReference"
              required
              defaultValue="general"
              pattern="[A-Za-z0-9_./:-]{2,100}"
            />
          </label>
        </div>

        <h3>Fee components</h3>
        <p className="small">
          Break the fee into auditable heads such as tuition, transport or hostel. Optional bank
          route keys stay logical until a verified settlement provider mapping is activated.
        </p>
        {componentRows.map((row, index) => (
          <div className="row" key={'component-' + index}>
            <label className="field">
              Code
              <input
                value={row.code}
                required
                onChange={(e) =>
                  setComponentRows((rows) =>
                    rows.map((r, n) => (n === index ? { ...r, code: e.target.value } : r)),
                  )
                }
              />
            </label>
            <label className="field">
              Label
              <input
                value={row.label}
                required
                onChange={(e) =>
                  setComponentRows((rows) =>
                    rows.map((r, n) => (n === index ? { ...r, label: e.target.value } : r)),
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
                onChange={(e) =>
                  setComponentRows((rows) =>
                    rows.map((r, n) => (n === index ? { ...r, amount: e.target.value } : r)),
                  )
                }
              />
            </label>
            <label className="field">
              Bank route key
              <input
                value={row.bankRouteKey}
                placeholder="optional"
                onChange={(e) =>
                  setComponentRows((rows) =>
                    rows.map((r, n) => (n === index ? { ...r, bankRouteKey: e.target.value } : r)),
                  )
                }
              />
            </label>
            {componentRows.length > 1 && (
              <button
                type="button"
                className="button outline"
                onClick={() => setComponentRows((rows) => rows.filter((_, n) => n !== index))}
              >
                Remove
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          className="button outline"
          onClick={() =>
            setComponentRows((rows) => [
              ...rows,
              {
                code: 'fee_' + (rows.length + 1),
                label: 'Fee component',
                amount: '',
                bankRouteKey: '',
              },
            ])
          }
        >
          Add fee component
        </button>

        <h3>Concessions / scholarships</h3>
        {concessionRows.map((row, index) => (
          <div className="row" key={'concession-' + index}>
            <label className="field">
              Code
              <input
                value={row.code}
                required
                onChange={(e) =>
                  setConcessionRows((rows) =>
                    rows.map((r, n) => (n === index ? { ...r, code: e.target.value } : r)),
                  )
                }
              />
            </label>
            <label className="field">
              Label
              <input
                value={row.label}
                required
                onChange={(e) =>
                  setConcessionRows((rows) =>
                    rows.map((r, n) => (n === index ? { ...r, label: e.target.value } : r)),
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
                onChange={(e) =>
                  setConcessionRows((rows) =>
                    rows.map((r, n) => (n === index ? { ...r, amount: e.target.value } : r)),
                  )
                }
              />
            </label>
            <label className="field">
              Reason
              <input
                value={row.reason}
                required
                onChange={(e) =>
                  setConcessionRows((rows) =>
                    rows.map((r, n) => (n === index ? { ...r, reason: e.target.value } : r)),
                  )
                }
              />
            </label>
            <button
              type="button"
              className="button outline"
              onClick={() => setConcessionRows((rows) => rows.filter((_, n) => n !== index))}
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          className="button outline"
          onClick={() =>
            setConcessionRows((rows) => [
              ...rows,
              {
                code: 'concession_' + (rows.length + 1),
                label: 'Concession',
                amount: '',
                reason: '',
              },
            ])
          }
        >
          Add concession
        </button>

        <h3>Late-fee policy</h3>
        <div className="row">
          <label className="field">
            Mode
            <select name="lateFeeMode" defaultValue="fixed_once">
              <option value="fixed_once">Fixed once</option>
              <option value="daily_fixed">Daily fixed</option>
            </select>
          </label>
          <label className="field">
            Grace days
            <input name="lateFeeGraceDays" type="number" min={0} max={60} defaultValue={0} />
          </label>
          <label className="field">
            Late fee amount (INR)
            <input name="lateFeeAmount" inputMode="decimal" placeholder="leave blank to disable" />
          </label>
          <label className="field">
            Maximum late fee (INR)
            <input name="lateFeeCap" inputMode="decimal" placeholder="optional cap" />
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
            onClick={() => setInstallmentRows((rows) => [...rows, { dueDate: '', amount: '' }])}
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
              <p className="small">
                {s.scope_type || 'custom'} · {s.scope_reference || 'custom'} · Gross{' '}
                {rupees(s.gross_amount_minor || s.total_amount_minor)} · Concessions{' '}
                {rupees(s.concession_amount_minor || 0)}
              </p>
              {s.note && <p>{s.note}</p>}
              {!!s.components?.length && (
                <div className="fee-component-list">
                  {s.components.map((component) => (
                    <span key={component.code}>
                      {component.label}: {rupees(component.amountMinor)}
                    </span>
                  ))}
                </div>
              )}
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
                <div className="admin-toolbar">
                  <button
                    className="button outline"
                    onClick={async () => {
                      try {
                        const result = await request<{ path: string; expiresHours: number }>(
                          'admin/fees/schedules/' + s.id + '/payer-link',
                          'POST',
                          {
                            expiresHours: 72,
                            paymentMode: 'full_balance',
                            allowCustomAmount: false,
                            allowComponentSelection: false,
                          },
                        );
                        const url = window.location.origin + result.path;
                        await navigator.clipboard.writeText(url);
                        setMessage('Secure 72-hour full-balance payer link copied to clipboard.');
                      } catch (e) {
                        setMessage((e as Error).message);
                      }
                    }}
                  >
                    Copy full-balance link
                  </button>
                  <button
                    className="button outline"
                    onClick={async () => {
                      try {
                        const result = await request<{ path: string; expiresHours: number }>(
                          'admin/fees/schedules/' + s.id + '/payer-link',
                          'POST',
                          {
                            expiresHours: 72,
                            paymentMode: 'flexible',
                            allowCustomAmount: true,
                            allowComponentSelection: true,
                            minAmountMinor: 100,
                          },
                        );
                        const url = window.location.origin + result.path;
                        await navigator.clipboard.writeText(url);
                        setMessage(
                          'Secure 72-hour smart collection link copied. It allows custom and fee-head payments subject to server-side balance checks.',
                        );
                      } catch (e) {
                        setMessage((e as Error).message);
                      }
                    }}
                  >
                    Copy smart collection link
                  </button>
                </div>
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

      <section className="admin-panel">
        <div className="admin-toolbar">
          <div>
            <p className="eyebrow">Provider integrity</p>
            <h2>Signed payment callbacks</h2>
          </div>
          <span className="status-pill">{providerStatus?.webhookMode || 'disabled'}</span>
        </div>
        <p>
          Browser redirects never mark an installment paid. Only staff-confirmed evidence or a
          verified, replay-safe provider event can update the ledger.
        </p>
        <div className="record-row">
          <strong>{providerStatus?.provider || 'No provider configured'}</strong>
          <span>{providerEvents.length} event(s)</span>
          <span>{providerEvents.filter((event) => event.status === 'applied').length} applied</span>
          <span className="status-pill">
            {providerStatus?.webhookMode === 'signed_hmac'
              ? 'signature verification on'
              : 'blocked'}
          </span>
        </div>
        {providerEvents.slice(0, 8).map((event) => (
          <div className="record-row" key={event.id}>
            <strong>{event.event_type}</strong>
            <span>{event.provider_event_id}</span>
            <span>{event.failure_code || event.provider}</span>
            <span className="status-pill">{event.status}</span>
          </div>
        ))}
      </section>

      <section className="admin-panel">
        <div className="admin-toolbar">
          <div>
            <p className="eyebrow">Collection intelligence</p>
            <h2>Fee analytics</h2>
          </div>
          <span className="status-pill">
            {lateFees.filter((x) => x.status === 'assessed').length} active late fee(s)
          </span>
        </div>
        <div className="dashboard-stats">
          {(analytics?.byScope || []).slice(0, 4).map((row: any) => (
            <div className="dashboard-stat" key={row.scope_type + ':' + row.scope_reference}>
              <span>
                {row.scope_type} · {row.scope_reference}
              </span>
              <strong>{rupees(row.paid_minor)}</strong>
              <small>{rupees(row.outstanding_minor)} outstanding</small>
            </div>
          ))}
        </div>
        {!!lateFees.length && (
          <div className="fee-schedule-grid">
            {lateFees.slice(0, 8).map((fee) => (
              <div className="record-row" key={fee.id}>
                <strong>{fee.account_reference}</strong>
                <span>{rupees(fee.amount_minor)}</span>
                <span>
                  Installment #{fee.sequence} · {fee.status}
                </span>
                {fee.status === 'assessed' ? (
                  <button
                    className="button outline"
                    onClick={async () => {
                      const reason = window.prompt('Reason for waiving this late fee?');
                      if (!reason) return;
                      try {
                        await request('admin/fees/late-fees/' + fee.id + '/waive', 'POST', {
                          reason,
                        });
                        setMessage('Late fee waived with an audit record.');
                        await load();
                      } catch (e) {
                        setMessage((e as Error).message);
                      }
                    }}
                  >
                    Waive
                  </button>
                ) : (
                  <span className="status-pill">{fee.status}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

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
          <h2>Mandates, AutoPay & settlements</h2>
          <p>
            {mandates.length} mandate record(s) · {mandateSetups.length} setup attempt(s) ·{' '}
            {autopayAttempts.length} automated debit attempt(s) · {settlements.length} settlement
            record(s) · {communications.length} communication record(s).
          </p>
          <p className="small">
            Hosted mandate setup and due-date debit submission activate only when an approved
            provider endpoint is configured. Payer bank credentials, UPI PINs and OTPs are never
            collected by this console. Verified callbacks remain the source of truth for final
            payment and mandate status.
          </p>
          <div className="record-row">
            <strong>Recurring provider</strong>
            <span>{providerStatus?.provider || 'Not configured'}</span>
            <span>{providerStatus?.autopayMode || 'disabled'}</span>
            <span className="status-pill">
              {autopayAttempts.filter((attempt) => attempt.status === 'confirmed').length} confirmed
            </span>
          </div>
          {autopayAttempts.slice(0, 8).map((attempt) => (
            <div className="record-row" key={attempt.id}>
              <strong>{attempt.account_reference}</strong>
              <span>
                #{attempt.sequence} · {rupees(attempt.amount_minor)}
              </span>
              <span>
                attempt {attempt.attempt_no}
                {attempt.failure_code ? ' · ' + attempt.failure_code : ''}
              </span>
              <span className="status-pill">{attempt.status}</span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

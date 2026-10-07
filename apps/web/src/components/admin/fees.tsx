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
type FeeHead = {
  id: string;
  code: string;
  name: string;
  settlement_account_key?: string | null;
  active: boolean;
  usages: number;
};
type CollectionPage = {
  id: string;
  slug: string;
  schedule_id: string;
  account_reference: string;
  title: string;
  status: string;
  intents: number;
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
  const [providerEvents, setProviderEvents] = useState<any[]>([]);
  const [providerStatus, setProviderStatus] = useState<any>(null);
  const [feeHeads, setFeeHeads] = useState<FeeHead[]>([]);
  const [collectionPages, setCollectionPages] = useState<CollectionPage[]>([]);
  const [adjustments, setAdjustments] = useState<any[]>([]);
  const [message, setMessage] = useState('');
  const [installmentRows, setInstallmentRows] = useState([{ dueDate: '', amount: '' }]);
  const [componentRows, setComponentRows] = useState([{ feeHeadId: '', amount: '' }]);

  const load = async () => {
    try {
      const [o, s, p, m, st, py, cm, pe, ps, fh, cp, ad] = await Promise.all([
        request('admin/fees/overview'),
        request<Schedule[]>('admin/fees/schedules'),
        request<any[]>('admin/fees/payments'),
        request<any[]>('admin/fees/mandates'),
        request<any[]>('admin/fees/settlements'),
        request<Payer[]>('admin/payers'),
        request<any[]>('admin/fees/communications'),
        request<any[]>('admin/fees/provider-events'),
        request<any>('provider/payments/status'),
        request<FeeHead[]>('admin/fees/structure/heads'),
        request<CollectionPage[]>('admin/fees/collection-pages'),
        request<any[]>('admin/fees/structure/adjustments'),
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
      setFeeHeads(fh);
      setCollectionPages(cp);
      setAdjustments(ad);
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

      <section className="admin-grid">
        <form
          className="admin-panel admin-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const f = new FormData(form);
            try {
              await request('admin/fees/structure/heads', 'POST', {
                code: String(f.get('code') || '').toUpperCase(),
                name: String(f.get('name') || ''),
                ...(String(f.get('settlementAccountKey') || '')
                  ? { settlementAccountKey: String(f.get('settlementAccountKey')) }
                  : {}),
              });
              form.reset();
              setMessage('Fee head created.');
              await load();
            } catch (e) {
              setMessage((e as Error).message);
            }
          }}
        >
          <h2>Fee heads</h2>
          <p>Define reusable components such as tuition, transport or hostel fees.</p>
          <label className="field">
            Code
            <input name="code" required pattern="[A-Za-z0-9_]{2,40}" placeholder="TUITION" />
          </label>
          <label className="field">
            Name
            <input name="name" required minLength={2} maxLength={100} />
          </label>
          <label className="field">
            Settlement account key
            <input
              name="settlementAccountKey"
              pattern="[A-Za-z0-9_-]{2,80}"
              placeholder="Internal routing key, not bank credentials"
            />
          </label>
          <button className="button primary">Create fee head</button>
          <p className="small">{feeHeads.length} configured fee head(s).</p>
        </form>

        <form
          className="admin-panel admin-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const f = new FormData(form);
            try {
              await request('admin/fees/structure/adjustments', 'POST', {
                installmentId: String(f.get('installmentId')),
                kind: String(f.get('kind')),
                amountMinor: toMinor(f.get('amount')),
                reason: String(f.get('reason')),
              });
              form.reset();
              setMessage('Fee adjustment applied and audited.');
              await load();
            } catch (e) {
              setMessage((e as Error).message);
            }
          }}
        >
          <h2>Discounts & late fees</h2>
          <p>Every change is a ledger adjustment and can be reversed without erasing history.</p>
          <label className="field">
            Installment
            <select name="installmentId" required defaultValue="">
              <option value="" disabled>
                Select installment
              </option>
              {schedules.flatMap((s) =>
                s.installments
                  .filter((i) => i.status !== 'cancelled')
                  .map((i) => (
                    <option key={i.id} value={i.id}>
                      {s.account_reference} · #{i.sequence} · {rupees(i.amountMinor)}
                    </option>
                  )),
              )}
            </select>
          </label>
          <label className="field">
            Adjustment type
            <select name="kind" defaultValue="discount">
              <option value="discount">Discount</option>
              <option value="concession">Concession</option>
              <option value="waiver">Waiver</option>
              <option value="late_fee">Late fee</option>
            </select>
          </label>
          <label className="field">
            Amount (INR)
            <input name="amount" inputMode="decimal" required />
          </label>
          <label className="field">
            Reason
            <input name="reason" minLength={3} maxLength={300} required />
          </label>
          <button className="button primary">Apply adjustment</button>
          <p className="small">{adjustments.length} adjustment record(s).</p>
        </form>
      </section>

      <form
        className="admin-panel admin-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const f = new FormData(form);
          try {
            await request('admin/fees/structure/components', 'POST', {
              installmentId: String(f.get('installmentId')),
              components: componentRows.map((row) => ({
                feeHeadId: row.feeHeadId,
                amountMinor: toMinor(row.amount),
              })),
            });
            form.reset();
            setComponentRows([{ feeHeadId: '', amount: '' }]);
            setMessage('Fee-head structure saved for the draft installment.');
            await load();
          } catch (e) {
            setMessage((e as Error).message);
          }
        }}
      >
        <h2>Installment fee structure</h2>
        <p>
          Break a draft installment into fee heads. Component totals must equal the installment
          amount.
        </p>
        <label className="field">
          Draft installment
          <select name="installmentId" required defaultValue="">
            <option value="" disabled>
              Select draft installment
            </option>
            {schedules
              .filter((s) => s.status === 'draft')
              .flatMap((s) =>
                s.installments.map((i) => (
                  <option key={i.id} value={i.id}>
                    {s.account_reference} · #{i.sequence} · {rupees(i.amountMinor)}
                  </option>
                )),
              )}
          </select>
        </label>
        {componentRows.map((row, index) => (
          <div className="row" key={index}>
            <label className="field">
              Fee head
              <select
                value={row.feeHeadId}
                required
                onChange={(e) =>
                  setComponentRows((rows) =>
                    rows.map((item, n) =>
                      n === index ? { ...item, feeHeadId: e.target.value } : item,
                    ),
                  )
                }
              >
                <option value="" disabled>
                  Select fee head
                </option>
                {feeHeads
                  .filter((head) => head.active)
                  .map((head) => (
                    <option value={head.id} key={head.id}>
                      {head.code} · {head.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="field">
              Amount (INR)
              <input
                value={row.amount}
                inputMode="decimal"
                required
                onChange={(e) =>
                  setComponentRows((rows) =>
                    rows.map((item, n) =>
                      n === index ? { ...item, amount: e.target.value } : item,
                    ),
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
            setComponentRows((rows) => [...rows, { feeHeadId: '', amount: '' }])
          }
        >
          Add fee head
        </button>{' '}
        <button className="button primary">Save structure</button>
      </form>

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

      <form
        className="admin-panel admin-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const f = new FormData(form);
          try {
            const result = await request<any>('admin/fees/collection-pages', 'POST', {
              scheduleId: String(f.get('scheduleId')),
              title: String(f.get('title')),
              description: String(f.get('description') || ''),
              allowFull: Boolean(f.get('allowFull')),
              allowPartial: Boolean(f.get('allowPartial')),
              allowCustom: Boolean(f.get('allowCustom')),
            });
            form.reset();
            await navigator.clipboard.writeText(window.location.origin + result.path);
            setMessage('Collection page created and its protected link copied to clipboard.');
            await load();
          } catch (e) {
            setMessage((e as Error).message);
          }
        }}
      >
        <h2>Collection pages</h2>
        <p>
          Create shareable, non-indexed amount-selection pages for approved fee schedules. These
          pages do not collect money until a hosted payment provider is activated.
        </p>
        <label className="field">
          Active schedule
          <select name="scheduleId" required defaultValue="">
            <option value="" disabled>
              Select schedule
            </option>
            {schedules
              .filter((s) => ['active', 'completed'].includes(s.status))
              .map((s) => (
                <option value={s.id} key={s.id}>
                  {s.account_reference} · {rupees(s.total_amount_minor)}
                </option>
              ))}
          </select>
        </label>
        <div className="row">
          <label className="field">
            Page title
            <input name="title" minLength={3} maxLength={120} required />
          </label>
          <label className="field">
            Description
            <input name="description" maxLength={600} />
          </label>
        </div>
        <fieldset>
          <legend>Allowed amount modes</legend>
          <div className="collection-modes">
            <label>
              <input type="checkbox" name="allowFull" defaultChecked /> Full
            </label>
            <label>
              <input type="checkbox" name="allowPartial" /> Partial
            </label>
            <label>
              <input type="checkbox" name="allowCustom" /> Custom
            </label>
          </div>
        </fieldset>
        <button className="button primary">Create collection page</button>
        <div className="fee-schedule-grid">
          {collectionPages.slice(0, 6).map((page) => (
            <article className="fee-schedule-card" key={page.id}>
              <strong>{page.title}</strong>
              <p>
                {page.account_reference} · {page.intents} prepared intent(s)
              </p>
              <div className="admin-toolbar">
                <span className="status-pill">{page.status}</span>
                <button
                  type="button"
                  className="button outline"
                  onClick={() => {
                    void navigator.clipboard.writeText(
                      window.location.origin + '/collect/' + page.slug + '/',
                    );
                    setMessage('Collection page link copied.');
                  }}
                >
                  Copy link
                </button>
              </div>
            </article>
          ))}
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

      <section className="admin-panel">
        <div className="admin-toolbar">
          <div>
            <p className="eyebrow">Provider integrity</p>
            <h2>Signed payment callbacks</h2>
          </div>
          <span className="status-pill">{providerStatus?.mode || 'disabled'}</span>
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
            {providerStatus?.mode === 'signed_hmac' ? 'signature verification on' : 'blocked'}
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
            Signed normalized payment and mandate callbacks can now update the internal ledger when
            explicitly configured. Hosted checkout, raw card/UPI credential handling, bank
            settlement ingestion and lending remain provider-specific and disabled until verified.
          </p>
        </div>
      </section>
    </>
  );
}

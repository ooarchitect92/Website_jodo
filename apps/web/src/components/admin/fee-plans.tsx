'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { DataTable, useAdminApi } from './context';

function toMinor(value: FormDataEntryValue | null) {
  const parsed = Number(String(value || '').replace(/,/g, ''));
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error('Enter a valid positive INR amount');
  return Math.round(parsed * 100);
}
function rupees(value: unknown) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(
    Number(value || 0) / 100,
  );
}

type Plan = {
  id: string;
  plan_key: string;
  version: number;
  name: string;
  status: string;
  total_minor: string | number;
  component_count: number;
  installment_count: number;
  created_by: string;
};
type Overview = {
  plans: Plan[];
  assignments: any[];
  adjustments: any[];
  credits: any[];
  changes: any[];
  ageing: Array<{ bucket: string; obligations: number; outstanding_minor: string | number }>;
};

export function FeePlanStudio() {
  const { request, session } = useAdminApi();
  const [data, setData] = useState<Overview | null>(null);
  const [students, setStudents] = useState<any[]>([]);
  const [payers, setPayers] = useState<any[]>([]);
  const [schedules, setSchedules] = useState<any[]>([]);
  const [message, setMessage] = useState('');
  const [components, setComponents] = useState([
    { code: 'tuition', label: 'Tuition', amount: '50000', category: 'fee' },
  ]);
  const [installments, setInstallments] = useState([{ dueDate: '', amount: '50000' }]);

  async function load() {
    try {
      const [overview, academic, payerRows, scheduleRows] = await Promise.all([
        request<Overview>('admin/fee-plans/overview'),
        request<any>('admin/academic/overview'),
        request<any[]>('admin/payers'),
        request<any[]>('admin/fees/schedules'),
      ]);
      setData(overview);
      setStudents(academic.students || []);
      setPayers(payerRows || []);
      setSchedules(scheduleRows || []);
      setMessage('');
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  useEffect(() => {
    void load();
  }, [session.tenant.id]);

  const activeSchedules = useMemo(
    () => schedules.filter((schedule) => ['active', 'completed'].includes(schedule.status)),
    [schedules],
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
        <p className="eyebrow">CAP-021 · CAP-025</p>
        <h2>Fee plans & receivables</h2>
        <p>{message || 'Loading fee-plan controls…'}</p>
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
            <p className="eyebrow">CAP-021 → CAP-025</p>
            <h2>Fee-plan lifecycle & receivables</h2>
            <p>
              Draft, validate and independently approve fee plans before assignment. Payments,
              approved adjustments and credits remain separate accounting facts.
            </p>
          </div>
          <button className="button outline" onClick={() => void load()}>
            Refresh
          </button>
        </div>
        <div className="dashboard-stats">
          <div className="dashboard-stat">
            <span>Effective plans</span>
            <strong>{data.plans.filter((plan) => plan.status === 'effective').length}</strong>
          </div>
          <div className="dashboard-stat">
            <span>Active assignments</span>
            <strong>{data.assignments.filter((item) => item.status === 'active').length}</strong>
          </div>
          <div className="dashboard-stat">
            <span>Pending adjustments</span>
            <strong>{data.adjustments.filter((item) => item.status === 'pending').length}</strong>
          </div>
          <div className="dashboard-stat">
            <span>Open change requests</span>
            <strong>{data.changes.filter((item) => item.status === 'pending').length}</strong>
          </div>
        </div>
      </section>

      <form
        className="admin-panel admin-form"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = event.currentTarget;
          try {
            await request('admin/fee-plans', 'POST', {
              planKey: String(new FormData(form).get('planKey') || ''),
              name: String(new FormData(form).get('name') || ''),
              components: components.map((component) => ({
                code: component.code,
                label: component.label,
                amountMinor: toMinor(component.amount),
                category: component.category,
              })),
              installments: installments.map((installment) => ({
                dueDate: installment.dueDate,
                amountMinor: toMinor(installment.amount),
              })),
              eligibility: {},
              note: String(new FormData(form).get('note') || ''),
            });
            setMessage('Fee-plan draft created. Validate it before requesting approval.');
            await load();
          } catch (error) {
            setMessage((error as Error).message);
          }
        }}
      >
        <p className="eyebrow">EDU-05 · CAP-021</p>
        <h2>Create versioned fee plan</h2>
        <div className="row">
          <label className="field">
            Plan key
            <input
              name="planKey"
              required
              pattern="[A-Za-z0-9._/-]{2,80}"
              placeholder="grade10_2027"
            />
          </label>
          <label className="field">
            Plan name
            <input
              name="name"
              required
              minLength={2}
              maxLength={160}
              placeholder="Grade 10 annual fees"
            />
          </label>
        </div>

        <h3>Fee components</h3>
        {components.map((component, index) => (
          <div className="row" key={'component-' + index}>
            <label className="field">
              Code
              <input
                value={component.code}
                onChange={(e) =>
                  setComponents((rows) =>
                    rows.map((row, n) => (n === index ? { ...row, code: e.target.value } : row)),
                  )
                }
              />
            </label>
            <label className="field">
              Label
              <input
                value={component.label}
                onChange={(e) =>
                  setComponents((rows) =>
                    rows.map((row, n) => (n === index ? { ...row, label: e.target.value } : row)),
                  )
                }
              />
            </label>
            <label className="field">
              Amount (INR)
              <input
                value={component.amount}
                inputMode="decimal"
                onChange={(e) =>
                  setComponents((rows) =>
                    rows.map((row, n) => (n === index ? { ...row, amount: e.target.value } : row)),
                  )
                }
              />
            </label>
            <label className="field">
              Category
              <select
                value={component.category}
                onChange={(e) =>
                  setComponents((rows) =>
                    rows.map((row, n) =>
                      n === index ? { ...row, category: e.target.value } : row,
                    ),
                  )
                }
              >
                <option value="fee">Fee</option>
                <option value="deposit">Deposit</option>
                <option value="transport">Transport</option>
                <option value="hostel">Hostel</option>
                <option value="exam">Exam</option>
                <option value="other">Other</option>
              </select>
            </label>
            {components.length > 1 && (
              <button
                type="button"
                className="button outline"
                onClick={() => setComponents((rows) => rows.filter((_, n) => n !== index))}
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
            setComponents((rows) => [
              ...rows,
              {
                code: 'component_' + (rows.length + 1),
                label: 'Fee component',
                amount: '',
                category: 'fee',
              },
            ])
          }
        >
          Add component
        </button>

        <h3>Collection schedule</h3>
        {installments.map((installment, index) => (
          <div className="row" key={'installment-' + index}>
            <label className="field">
              Due date
              <input
                type="date"
                value={installment.dueDate}
                onChange={(e) =>
                  setInstallments((rows) =>
                    rows.map((row, n) => (n === index ? { ...row, dueDate: e.target.value } : row)),
                  )
                }
                required
              />
            </label>
            <label className="field">
              Amount (INR)
              <input
                value={installment.amount}
                inputMode="decimal"
                onChange={(e) =>
                  setInstallments((rows) =>
                    rows.map((row, n) => (n === index ? { ...row, amount: e.target.value } : row)),
                  )
                }
                required
              />
            </label>
            {installments.length > 1 && (
              <button
                type="button"
                className="button outline"
                onClick={() => setInstallments((rows) => rows.filter((_, n) => n !== index))}
              >
                Remove
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          className="button outline"
          onClick={() => setInstallments((rows) => [...rows, { dueDate: '', amount: '' }])}
        >
          Add installment
        </button>
        <label className="field">
          Internal note
          <input name="note" maxLength={500} />
        </label>
        <button className="button primary">Create draft fee plan</button>
      </form>

      <section className="admin-panel">
        <p className="eyebrow">DRAFT → VALIDATED → APPROVED → EFFECTIVE</p>
        <h2>Plan release queue</h2>
        <div className="fee-schedule-grid">
          {data.plans.map((plan) => (
            <article className="fee-schedule-card" key={plan.id}>
              <div className="admin-toolbar">
                <div>
                  <p className="eyebrow">{plan.status}</p>
                  <h3>
                    {plan.name} · v{plan.version}
                  </h3>
                  <p>{plan.plan_key}</p>
                </div>
                <strong>{rupees(plan.total_minor)}</strong>
              </div>
              <p className="small">
                {plan.component_count} component(s) · {plan.installment_count} installment(s)
              </p>
              <div className="admin-toolbar">
                {plan.status === 'draft' && (
                  <button
                    className="button"
                    onClick={async () => {
                      try {
                        await request('admin/fee-plans/' + plan.id + '/validate', 'POST', {});
                        setMessage('Fee plan validated.');
                        await load();
                      } catch (error) {
                        setMessage((error as Error).message);
                      }
                    }}
                  >
                    Validate
                  </button>
                )}
                {plan.status === 'validated' && (
                  <button
                    className="button"
                    onClick={async () => {
                      try {
                        await request(
                          'admin/fee-plans/' + plan.id + '/request-approval',
                          'POST',
                          {},
                        );
                        setMessage('Fee plan sent for independent approval.');
                        await load();
                      } catch (error) {
                        setMessage((error as Error).message);
                      }
                    }}
                  >
                    Request approval
                  </button>
                )}
                {plan.status === 'pending_approval' &&
                  (plan.created_by === session.user.id ? (
                    <span className="small">Independent owner must approve</span>
                  ) : (
                    <button
                      className="button"
                      onClick={async () => {
                        try {
                          await request('admin/fee-plans/' + plan.id + '/approve', 'POST', {});
                          setMessage('Fee plan approved.');
                          await load();
                        } catch (error) {
                          setMessage((error as Error).message);
                        }
                      }}
                    >
                      Approve
                    </button>
                  ))}
                {plan.status === 'approved' && (
                  <button
                    className="button primary"
                    onClick={async () => {
                      try {
                        await request('admin/fee-plans/' + plan.id + '/effective', 'POST', {});
                        setMessage('Fee plan is now effective.');
                        await load();
                      } catch (error) {
                        setMessage((error as Error).message);
                      }
                    }}
                  >
                    Make effective
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>

      <form
        className="admin-panel admin-form"
        onSubmit={(event) =>
          submit(
            event,
            'admin/fee-plans/' +
              String(new FormData(event.currentTarget).get('planId')) +
              '/assign',
            (form) => ({
              studentId: String(form.get('studentId') || ''),
              accountReference: String(form.get('accountReference') || ''),
              ...(String(form.get('payerId') || '')
                ? { payerId: String(form.get('payerId')) }
                : {}),
            }),
            'Effective fee plan assigned and active student receivable schedule created.',
          )
        }
      >
        <p className="eyebrow">CAP-021 · fee.assign</p>
        <h2>Assign effective plan to student</h2>
        <div className="row">
          <label className="field">
            Effective plan
            <select name="planId" required defaultValue="">
              <option value="" disabled>
                Select plan
              </option>
              {data.plans
                .filter((plan) => plan.status === 'effective')
                .map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name} · v{plan.version}
                  </option>
                ))}
            </select>
          </label>
          <label className="field">
            Student
            <select name="studentId" required defaultValue="">
              <option value="" disabled>
                Select student
              </option>
              {students.map((student) => (
                <option key={student.id} value={student.id}>
                  {student.student_reference} · {student.full_name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="row">
          <label className="field">
            Receivable account reference
            <input name="accountReference" required pattern="[A-Za-z0-9_-]{2,80}" />
          </label>
          <label className="field">
            Optional payer
            <select name="payerId" defaultValue="">
              <option value="">No payer linked yet</option>
              {payers.map((payer) => (
                <option key={payer.id} value={payer.id}>
                  {payer.account_reference} · {payer.display_name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button className="button primary">Assign plan</button>
      </form>

      <section className="admin-panel">
        <p className="eyebrow">CAP-024 · RPT-04</p>
        <h2>Outstanding ageing</h2>
        <div className="dashboard-stats">
          {data.ageing.map((row) => (
            <div className="dashboard-stat" key={row.bucket}>
              <span>{row.bucket.replaceAll('_', '–')} days</span>
              <strong>{rupees(row.outstanding_minor)}</strong>
              <small>{row.obligations} obligation(s)</small>
            </div>
          ))}
        </div>
      </section>

      <section className="admin-grid">
        <form
          className="admin-panel admin-form"
          onSubmit={(event) =>
            submit(
              event,
              'admin/fee-plans/adjustments',
              (form) => ({
                scheduleId: String(form.get('scheduleId') || ''),
                kind: String(form.get('kind') || 'concession'),
                amountMinor: toMinor(form.get('amount')),
                reason: String(form.get('reason') || ''),
              }),
              'Adjustment request created. A different owner must approve it before application.',
            )
          }
        >
          <p className="eyebrow">CAP-022</p>
          <h2>Request fee adjustment</h2>
          <label className="field">
            Schedule
            <select name="scheduleId" defaultValue="" required>
              <option value="" disabled>
                Select schedule
              </option>
              {activeSchedules.map((schedule) => (
                <option key={schedule.id} value={schedule.id}>
                  {schedule.account_reference} · {rupees(schedule.total_amount_minor)}
                </option>
              ))}
            </select>
          </label>
          <div className="row">
            <label className="field">
              Type
              <select name="kind" defaultValue="concession">
                <option value="concession">Concession</option>
                <option value="scholarship">Scholarship</option>
                <option value="waiver">Waiver</option>
                <option value="write_off">Write-off</option>
              </select>
            </label>
            <label className="field">
              Amount (INR)
              <input name="amount" inputMode="decimal" required />
            </label>
          </div>
          <label className="field">
            Reason
            <input name="reason" minLength={3} maxLength={500} required />
          </label>
          <button className="button primary">Request adjustment</button>
        </form>

        <form
          className="admin-panel admin-form"
          onSubmit={(event) =>
            submit(
              event,
              'admin/fee-plans/credits',
              (form) => ({
                accountReference: String(form.get('accountReference') || ''),
                source: String(form.get('source') || 'external_advance'),
                amountMinor: toMinor(form.get('amount')),
                ...(String(form.get('payerId') || '')
                  ? { payerId: String(form.get('payerId')) }
                  : {}),
                ...(String(form.get('evidenceReference') || '')
                  ? { evidenceReference: String(form.get('evidenceReference')) }
                  : {}),
                note: String(form.get('note') || ''),
              }),
              'Advance/unapplied credit recorded separately from revenue and payment status.',
            )
          }
        >
          <p className="eyebrow">CAP-023 · RPT-07</p>
          <h2>Record unapplied / advance credit</h2>
          <label className="field">
            Account reference
            <input name="accountReference" required minLength={2} maxLength={120} />
          </label>
          <div className="row">
            <label className="field">
              Source
              <select name="source" defaultValue="external_advance">
                <option value="external_advance">Confirmed external advance</option>
                <option value="opening_balance">Opening balance</option>
                <option value="transfer_credit">Transfer credit</option>
              </select>
            </label>
            <label className="field">
              Amount (INR)
              <input name="amount" inputMode="decimal" required />
            </label>
          </div>
          <label className="field">
            Payer
            <select name="payerId" defaultValue="">
              <option value="">No payer selected</option>
              {payers.map((payer) => (
                <option key={payer.id} value={payer.id}>
                  {payer.display_name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Evidence reference
            <input name="evidenceReference" maxLength={160} />
          </label>
          <label className="field">
            Note
            <input name="note" maxLength={500} />
          </label>
          <button className="button primary">Record credit</button>
        </form>
      </section>

      <form
        className="admin-panel admin-form"
        onSubmit={(event) =>
          submit(
            event,
            'admin/fee-plans/changes',
            (form) => ({
              scheduleId: String(form.get('scheduleId') || ''),
              ...(String(form.get('assignmentId') || '')
                ? { assignmentId: String(form.get('assignmentId')) }
                : {}),
              changeType: String(form.get('changeType') || 'withdrawal'),
              reason: String(form.get('reason') || ''),
              payload: {},
            }),
            'Receivable change request created. Execution requires independent approval.',
          )
        }
      >
        <p className="eyebrow">CAP-025 · EDU-08</p>
        <h2>Withdrawal / transfer / plan-change control</h2>
        <div className="row">
          <label className="field">
            Schedule
            <select name="scheduleId" defaultValue="" required>
              <option value="" disabled>
                Select schedule
              </option>
              {activeSchedules.map((schedule) => (
                <option key={schedule.id} value={schedule.id}>
                  {schedule.account_reference}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Assignment
            <select name="assignmentId" defaultValue="">
              <option value="">No assignment selected</option>
              {data.assignments
                .filter((item) => item.status === 'active')
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.student_reference} · {item.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="field">
            Change
            <select name="changeType" defaultValue="withdrawal">
              <option value="withdrawal">Withdrawal</option>
              <option value="transfer">Transfer</option>
              <option value="plan_change">Plan change</option>
              <option value="write_off">Write-off request</option>
            </select>
          </label>
        </div>
        <label className="field">
          Reason
          <input name="reason" minLength={3} maxLength={500} required />
        </label>
        <button className="button primary">Request controlled change</button>
      </form>

      <section className="admin-grid">
        <section className="admin-panel">
          <h2>Assignments</h2>
          <DataTable
            rows={data.assignments}
            columns={[
              ['student_reference', 'Student'],
              ['name', 'Plan'],
              ['version', 'Version'],
              ['status', 'Status'],
            ]}
          />
        </section>
        <section className="admin-panel">
          <h2>Credits</h2>
          <DataTable
            rows={data.credits}
            columns={[
              ['account_reference', 'Account'],
              ['source', 'Source'],
              ['amount_minor', 'Amount minor'],
              ['applied_minor', 'Applied minor'],
              ['status', 'Status'],
            ]}
          />
        </section>
      </section>

      <section className="admin-grid">
        <section className="admin-panel">
          <h2>Adjustment approval queue</h2>
          {data.adjustments.map((adjustment) => (
            <div className="record-row" key={adjustment.id}>
              <strong>{adjustment.account_reference}</strong>
              <span>{adjustment.kind}</span>
              <span>{rupees(adjustment.amount_minor)}</span>
              <span className="status-pill">{adjustment.status}</span>
              {adjustment.status === 'pending' && adjustment.requested_by !== session.user.id && (
                <button
                  className="button outline"
                  onClick={async () => {
                    try {
                      await request(
                        'admin/fee-plans/adjustments/' + adjustment.id + '/decide',
                        'POST',
                        {
                          decision: 'approve',
                          reason: 'Independent owner approval after receivable review',
                        },
                      );
                      setMessage('Adjustment approved.');
                      await load();
                    } catch (error) {
                      setMessage((error as Error).message);
                    }
                  }}
                >
                  Approve
                </button>
              )}
              {adjustment.status === 'approved' && (
                <button
                  className="button"
                  onClick={async () => {
                    try {
                      await request(
                        'admin/fee-plans/adjustments/' + adjustment.id + '/apply',
                        'POST',
                        {},
                      );
                      setMessage('Approved adjustment applied without fabricating a payment.');
                      await load();
                    } catch (error) {
                      setMessage((error as Error).message);
                    }
                  }}
                >
                  Apply
                </button>
              )}
            </div>
          ))}
        </section>

        <section className="admin-panel">
          <h2>Receivable-change queue</h2>
          {data.changes.map((change) => (
            <div className="record-row" key={change.id}>
              <strong>{change.account_reference}</strong>
              <span>{change.change_type}</span>
              <span className="status-pill">{change.status}</span>
              {change.status === 'pending' && change.requested_by !== session.user.id && (
                <button
                  className="button outline"
                  onClick={async () => {
                    try {
                      await request('admin/fee-plans/changes/' + change.id + '/decide', 'POST', {
                        decision: 'approve',
                        reason: 'Independent owner approval after obligation review',
                      });
                      setMessage('Receivable change approved.');
                      await load();
                    } catch (error) {
                      setMessage((error as Error).message);
                    }
                  }}
                >
                  Approve
                </button>
              )}
              {change.status === 'approved' && change.change_type !== 'write_off' && (
                <button
                  className="button"
                  onClick={async () => {
                    try {
                      await request(
                        'admin/fee-plans/changes/' + change.id + '/execute',
                        'POST',
                        {},
                      );
                      setMessage('Approved receivable change executed.');
                      await load();
                    } catch (error) {
                      setMessage((error as Error).message);
                    }
                  }}
                >
                  Execute
                </button>
              )}
            </div>
          ))}
        </section>
      </section>
    </>
  );
}

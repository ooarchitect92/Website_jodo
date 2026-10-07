import type { Metadata } from 'next';
import { randomUUID } from 'node:crypto';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Secure payer portal',
  description: 'Review fee schedules and payment receipts.',
  robots: { index: false, follow: false, noarchive: true },
};

type Props = {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ checkout?: string; mandate?: string }>;
};
const money = (minor: number | string) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(
    Number(minor || 0) / 100,
  );

async function load(token: string) {
  if (!/^[A-Za-z0-9_-]{30,100}$/.test(token)) return null;
  const base = process.env.API_INTERNAL_URL || 'http://127.0.0.1:4000';
  const r = await fetch(base + '/v1/payer/' + encodeURIComponent(token), {
    cache: 'no-store',
    signal: AbortSignal.timeout(5000),
  });
  if (!r.ok) return null;
  return r.json();
}

export default async function PayerPortal({ params, searchParams }: Props) {
  const { token } = await params;
  const query = await searchParams;
  const data = await load(token);
  if (!data) notFound();
  const paid = data.installments.reduce(
    (sum: number, i: any) => sum + Number(i.paid_amount_minor || 0),
    0,
  );
  const outstanding = data.installments.reduce(
    (sum: number, i: any) =>
      sum + Math.max(0, Number(i.amount_minor || 0) - Number(i.paid_amount_minor || 0)),
    0,
  );
  return (
    <main id="main" className="payer-portal">
      <header className="payer-portal-header">
        <div className="brand brand-wordmark">
          <span className="brand-mark" aria-hidden="true">
            ◆
          </span>
          <strong>{process.env.NEXT_PUBLIC_BRAND_NAME || 'YourCompany'}</strong>
        </div>
        <span className="status-pill">Secure schedule view</span>
      </header>

      <section className="payer-hero">
        <p className="eyebrow">Fee account · {data.payer.accountReference}</p>
        <h1>Hello, {data.payer.displayName}.</h1>
        <p className="lead">
          Review your installments, payments and receipts from one protected view.
        </p>
        <p className="small">
          Payment link mode:{' '}
          <strong>
            {data.paymentPolicy?.mode === 'flexible' ? 'Flexible collection' : 'Full balance'}
          </strong>
          {data.paymentPolicy?.mode === 'flexible' &&
            ' · Custom and fee-head options are enforced by the server.'}
        </p>
        {query.checkout && (
          <p className="admin-message" role="status">
            {query.checkout === 'invalid'
              ? 'The payment request was invalid and no checkout was created.'
              : 'The payment provider is temporarily unavailable. No successful collection has been recorded.'}
          </p>
        )}
        {query.mandate && (
          <p className="admin-message" role="status">
            {query.mandate === 'invalid'
              ? 'The recurring payment request was invalid.'
              : 'Recurring payment setup is temporarily unavailable. No automatic debit has been authorized.'}
          </p>
        )}
        <div className="dashboard-stats">
          <div className="dashboard-stat">
            <span>Schedule total</span>
            <strong>{money(data.schedule.totalAmountMinor)}</strong>
          </div>
          <div className="dashboard-stat">
            <span>Recorded paid</span>
            <strong>{money(paid)}</strong>
          </div>
          <div className="dashboard-stat">
            <span>Outstanding</span>
            <strong>{money(outstanding)}</strong>
          </div>
        </div>
      </section>

      <section className="payer-card">
        <div className="admin-toolbar">
          <div>
            <p className="eyebrow">Installment plan</p>
            <h2>Upcoming and completed fees</h2>
          </div>
          <span className="status-pill">{data.schedule.status}</span>
        </div>
        <div className="payer-table" role="table" aria-label="Fee installments">
          <div className="payer-row payer-row-head" role="row">
            <span>Installment</span>
            <span>Due date</span>
            <span>Amount</span>
            <span>Paid</span>
            <span>Status</span>
          </div>
          {data.installments.map((i: any) => {
            const remaining = Math.max(
              0,
              Number(i.amount_minor || 0) - Number(i.paid_amount_minor || 0),
            );
            const payable =
              data.providerConnected &&
              data.schedule.status === 'active' &&
              remaining > 0 &&
              !['paid', 'cancelled'].includes(i.status);
            return (
              <div className="payer-row" role="row" key={i.id}>
                <strong>#{i.sequence}</strong>
                <span>{new Date(i.due_date).toLocaleDateString('en-IN')}</span>
                <span>{money(i.amount_minor)}</span>
                <span>{money(i.paid_amount_minor)}</span>
                <div className="payer-installment-action">
                  <span className="status-pill">{i.status}</span>
                  {payable && (
                    <div className="payer-payment-options">
                      <form action={'/payer/' + encodeURIComponent(token) + '/pay/'} method="post">
                        <input type="hidden" name="installmentId" value={i.id} />
                        <input type="hidden" name="amountMinor" value={remaining} />
                        <input type="hidden" name="idempotencyKey" value={randomUUID()} />
                        <button className="button" type="submit">
                          Pay full {money(remaining)}
                        </button>
                      </form>

                      {data.paymentPolicy?.mode === 'flexible' &&
                        data.paymentPolicy?.allowCustomAmount && (
                          <form
                            className="payer-flex-form"
                            action={'/payer/' + encodeURIComponent(token) + '/pay/'}
                            method="post"
                          >
                            <input type="hidden" name="installmentId" value={i.id} />
                            <input type="hidden" name="idempotencyKey" value={randomUUID()} />
                            <label>
                              Custom amount (INR)
                              <input
                                name="amount"
                                type="number"
                                step="0.01"
                                min={
                                  data.paymentPolicy.minAmountMinor
                                    ? Number(data.paymentPolicy.minAmountMinor) / 100
                                    : 0.01
                                }
                                max={remaining / 100}
                                required
                              />
                            </label>
                            <button className="button outline" type="submit">
                              Pay custom amount
                            </button>
                          </form>
                        )}

                      {data.paymentPolicy?.mode === 'flexible' &&
                        data.paymentPolicy?.allowComponentSelection &&
                        data.components?.some((component: any) => component.remainingMinor > 0) && (
                          <form
                            className="payer-flex-form payer-component-form"
                            action={'/payer/' + encodeURIComponent(token) + '/pay/'}
                            method="post"
                          >
                            <input type="hidden" name="installmentId" value={i.id} />
                            <input type="hidden" name="idempotencyKey" value={randomUUID()} />
                            <fieldset>
                              <legend>Choose fee heads</legend>
                              <p className="small">
                                Enter amounts against one or more fee heads. The combined amount
                                cannot exceed {money(remaining)} for this installment.
                              </p>
                              <div className="payer-component-grid">
                                {data.components
                                  .filter((component: any) => component.remainingMinor > 0)
                                  .map((component: any) => (
                                    <label key={component.code}>
                                      {component.label}{' '}
                                      <span className="small">
                                        ({money(component.remainingMinor)} remaining)
                                      </span>
                                      <input
                                        name={'component_' + component.code}
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        max={Number(component.remainingMinor) / 100}
                                        placeholder="0.00"
                                      />
                                    </label>
                                  ))}
                              </div>
                            </fieldset>
                            <button className="button outline" type="submit">
                              Pay selected fee heads
                            </button>
                          </form>
                        )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="payer-card">
        <div className="admin-toolbar">
          <div>
            <p className="eyebrow">Automatic collections</p>
            <h2>UPI AutoPay / eNACH mandate</h2>
          </div>
          {data.mandates?.[0] && <span className="status-pill">{data.mandates[0].status}</span>}
        </div>
        {data.mandates?.some((m: any) => m.status === 'active') ? (
          <p>
            Automatic collection is active through{' '}
            <strong>
              {data.mandates.find((m: any) => m.status === 'active')?.rail === 'upi_autopay'
                ? 'UPI AutoPay'
                : 'eNACH'}
            </strong>
            . Due installments can be submitted automatically to the configured provider. Final
            payment status is recorded only after verified provider confirmation.
          </p>
        ) : data.autopayProviderConnected ? (
          <>
            <p>
              Authorize the full fee schedule once with the approved provider. Bank credentials, UPI
              PINs and OTPs stay on the provider-hosted authorization page.
            </p>
            <div className="admin-toolbar">
              <form action={'/payer/' + encodeURIComponent(token) + '/autopay/'} method="post">
                <input type="hidden" name="rail" value="upi_autopay" />
                <input type="hidden" name="idempotencyKey" value={randomUUID()} />
                <button className="button" type="submit">
                  Set up UPI AutoPay
                </button>
              </form>
              <form action={'/payer/' + encodeURIComponent(token) + '/autopay/'} method="post">
                <input type="hidden" name="rail" value="enach" />
                <input type="hidden" name="idempotencyKey" value={randomUUID()} />
                <button className="button outline" type="submit">
                  Set up eNACH
                </button>
              </form>
            </div>
          </>
        ) : (
          <p>
            Recurring payment setup is disabled until the institute connects and verifies an
            approved mandate provider.
          </p>
        )}
        {!!data.mandateSetups?.length && (
          <div className="payer-receipts">
            {data.mandateSetups.slice(0, 5).map((setup: any) => (
              <article key={setup.id}>
                <div>
                  <strong>{setup.rail === 'upi_autopay' ? 'UPI AutoPay' : 'eNACH'}</strong>
                  <p>Started {new Date(setup.created_at).toLocaleString('en-IN')}</p>
                </div>
                <span className="status-pill">{setup.status}</span>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="payer-card">
        <p className="eyebrow">Receipts</p>
        <h2>Payment history</h2>
        {!data.payments.length ? (
          <p>No confirmed payments are recorded for this schedule yet.</p>
        ) : (
          <div className="payer-receipts">
            {data.payments.map((p: any) => (
              <article key={p.id}>
                <div>
                  <strong>{money(p.amount_minor)}</strong>
                  <p>
                    Recorded {new Date(p.recorded_at).toLocaleString('en-IN')} · {p.status}
                  </p>
                </div>
                {p.receipt_number && (
                  <div>
                    <span className="small">Receipt</span>
                    <strong>{p.receipt_number}</strong>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      {!!data.refunds.length && (
        <section className="payer-card">
          <p className="eyebrow">Adjustments</p>
          <h2>Refund records</h2>
          <div className="payer-receipts">
            {data.refunds.map((r: any) => (
              <article key={r.id}>
                <div>
                  <strong>{money(r.amount_minor)}</strong>
                  <p>{r.reason}</p>
                </div>
                <span>{new Date(r.created_at).toLocaleString('en-IN')}</span>
              </article>
            ))}
          </div>
        </section>
      )}

      {!!data.checkoutSessions?.length && (
        <section className="payer-card">
          <p className="eyebrow">Payment attempts</p>
          <h2>Hosted checkout history</h2>
          <div className="payer-receipts">
            {data.checkoutSessions.map((session: any) => (
              <article key={session.id}>
                <div>
                  <strong>{money(session.amount_minor)}</strong>
                  <p>
                    Created {new Date(session.created_at).toLocaleString('en-IN')} · installment{' '}
                    {data.installments.find((i: any) => i.id === session.installment_id)
                      ?.sequence || '—'}
                  </p>
                </div>
                <span className="status-pill">{session.status}</span>
              </article>
            ))}
          </div>
        </section>
      )}

      {data.paymentPolicy?.componentSelectionBlockedReason && (
        <aside className="payer-security-note">
          <strong>Fee-head selection unavailable</strong>
          <p>{data.paymentPolicy.componentSelectionBlockedReason}</p>
        </aside>
      )}

      <aside className="payer-security-note">
        <strong>Security note</strong>
        <p>
          {data.providerConnected
            ? 'Payment actions redirect to the approved hosted provider. This portal never asks for card numbers, bank credentials, UPI PINs or OTPs.'
            : 'This page never asks for card, bank, UPI PIN or OTP credentials. Payment actions remain disabled until the platform owner connects and verifies an approved payment provider.'}
        </p>
      </aside>
    </main>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Payment status',
  description: 'Review the latest status reported for a hosted payment session.',
  robots: { index: false, follow: false, noarchive: true },
};

const money = (minor: number | string, currency = 'INR') =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(
    Number(minor || 0) / 100,
  );

async function load(token: string) {
  if (!/^[A-Za-z0-9_-]{30,100}$/.test(token)) return null;
  const api = process.env.API_INTERNAL_URL || 'http://127.0.0.1:4000';
  const response = await fetch(api + '/v1/payment-return/' + encodeURIComponent(token), {
    cache: 'no-store',
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) return null;
  return response.json();
}

export default async function PaymentReturn({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const data = await load(token);
  if (!data) notFound();

  const completed = data.status === 'completed';
  const failed = ['failed', 'cancelled', 'expired'].includes(data.status);
  return (
    <main id="main" className="payer-portal">
      <header className="payer-portal-header">
        <div className="brand brand-wordmark">
          <span className="brand-mark" aria-hidden="true">
            ◆
          </span>
          <strong>{process.env.NEXT_PUBLIC_BRAND_NAME || 'YourCompany'}</strong>
        </div>
        <span className="status-pill">{data.status}</span>
      </header>

      <section className="payer-hero">
        <p className="eyebrow">Hosted payment status</p>
        <h1>
          {completed
            ? 'Payment confirmed'
            : failed
              ? 'Payment was not completed'
              : 'Payment confirmation is still pending'}
        </h1>
        <p className="lead">
          {completed
            ? 'The verified provider callback has been applied to the fee ledger.'
            : failed
              ? 'No successful collection is being represented for this checkout session.'
              : 'Do not retry blindly. The platform will update only after an authoritative provider result is received.'}
        </p>
      </section>

      <section className="payer-card">
        <div className="dashboard-stats">
          <div className="dashboard-stat">
            <span>Amount</span>
            <strong>{money(data.amountMinor, data.currency)}</strong>
          </div>
          <div className="dashboard-stat">
            <span>Status</span>
            <strong>{data.status}</strong>
          </div>
          <div className="dashboard-stat">
            <span>Receipt</span>
            <strong>{data.receiptNumber || 'Pending'}</strong>
          </div>
        </div>
        <p className="small">
          This page contains no card number, bank credential, UPI PIN or OTP data. Those credentials
          remain with the selected hosted payment provider.
        </p>
        <Link className="button outline" href="/">
          Return to website
        </Link>
      </section>
    </main>
  );
}

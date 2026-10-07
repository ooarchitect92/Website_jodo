import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Recurring payment setup',
  robots: { index: false, follow: false, noarchive: true },
};

type Props = { params: Promise<{ token: string }> };

async function load(token: string) {
  if (!/^[A-Za-z0-9_-]{30,100}$/.test(token)) return null;
  const base = process.env.API_INTERNAL_URL || 'http://127.0.0.1:4000';
  const r = await fetch(base + '/v1/mandate-return/' + encodeURIComponent(token), {
    cache: 'no-store',
    signal: AbortSignal.timeout(5000),
  });
  if (!r.ok) return null;
  return r.json();
}

export default async function MandateReturnPage({ params }: Props) {
  const { token } = await params;
  const data = await load(token);
  if (!data) notFound();

  const message =
    data.status === 'active'
      ? 'Automatic fee collection is active.'
      : data.status === 'failed'
        ? 'The recurring payment setup did not complete. No automatic debit is authorized.'
        : 'The provider is still processing the recurring payment setup.';

  return (
    <main id="main" className="payer-portal">
      <section className="payer-card">
        <p className="eyebrow">Recurring payment setup</p>
        <h1>{message}</h1>
        <p>
          Fee account <strong>{data.account_reference}</strong> ·{' '}
          {data.rail === 'upi_autopay' ? 'UPI AutoPay' : 'eNACH'}
        </p>
        <span className="status-pill">{data.status}</span>
        <p className="small">
          Final mandate activation is accepted only from a verified provider callback. Returning to
          this page does not by itself mark a mandate successful.
        </p>
      </section>
    </main>
  );
}

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CollectionChooser } from './client';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Fee collection',
  description: 'Review an approved fee collection request.',
  robots: { index: false, follow: false, noarchive: true },
};

type Props = { params: Promise<{ slug: string }> };
const money = (minor: number | string) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(
    Number(minor || 0) / 100,
  );

async function load(slug: string) {
  if (!/^collect-[a-f0-9]{32}$/.test(slug)) return null;
  const base = process.env.API_INTERNAL_URL || 'http://127.0.0.1:4000';
  const r = await fetch(base + '/v1/collections/' + encodeURIComponent(slug), {
    cache: 'no-store',
    signal: AbortSignal.timeout(5000),
  });
  if (!r.ok) return null;
  return r.json();
}

export default async function CollectionPage({ params }: Props) {
  const { slug } = await params;
  const data = await load(slug);
  if (!data) notFound();

  return (
    <main id="main" className="payer-portal">
      <header className="payer-portal-header">
        <div className="brand brand-wordmark">
          <span className="brand-mark" aria-hidden="true">◆</span>
          <strong>{process.env.NEXT_PUBLIC_BRAND_NAME || 'YourCompany'}</strong>
        </div>
        <span className="status-pill">Protected collection request</span>
      </header>

      <section className="payer-hero">
        <p className="eyebrow">Fee collection</p>
        <h1>{data.page.title}</h1>
        {data.page.description && <p className="lead">{data.page.description}</p>}
      </section>

      <section className="payer-card">
        <h2>Choose what you want to pay</h2>
        <div className="fee-schedule-grid">
          {data.installments.map((item: any) => (
            <article className="fee-schedule-card" key={item.id}>
              <div className="admin-toolbar">
                <div>
                  <p className="eyebrow">Installment #{item.sequence}</p>
                  <h3>{new Date(item.due_date).toLocaleDateString('en-IN')}</h3>
                </div>
                <span className="status-pill">{item.status}</span>
              </div>
              <p>
                Outstanding <strong>{money(item.outstanding_minor)}</strong> of{' '}
                {money(item.amount_minor)}
              </p>
              {!!item.components?.length && (
                <ul>
                  {item.components.map((component: any) => (
                    <li key={component.code}>
                      {component.name}: {money(component.amountMinor)}
                    </li>
                  ))}
                </ul>
              )}
            </article>
          ))}
        </div>
      </section>

      <section className="payer-card">
        <h2>Prepare payment</h2>
        <CollectionChooser data={data} />
      </section>

      <aside className="payer-security-note">
        <strong>Payment provider status</strong>
        <p>
          {data.paymentProviderMode === 'disabled'
            ? 'No hosted payment provider is connected. You can review or prepare an amount, but no money will be taken.'
            : 'Signed provider callbacks are ready, but hosted checkout still requires provider-specific activation.'}
        </p>
      </aside>
    </main>
  );
}

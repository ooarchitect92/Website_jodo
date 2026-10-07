'use client';
import { FormEvent, useState } from 'react';

type Installment = {
  id: string;
  sequence: number;
  due_date: string;
  amount_minor: number | string;
  paid_amount_minor: number | string;
  outstanding_minor: number | string;
  status: string;
  components: { code: string; name: string; amountMinor: number | string }[];
};
type PageData = {
  page: {
    slug: string;
    title: string;
    description: string;
    currency: string;
    modes: { full: boolean; partial: boolean; custom: boolean };
    minimumMinor?: number | string | null;
    maximumMinor?: number | string | null;
  };
  installments: Installment[];
  paymentProviderMode: string;
  note: string;
};

const money = (minor: number | string) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(
    Number(minor || 0) / 100,
  );

export function CollectionChooser({ data }: { data: PageData }) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const f = new FormData(e.currentTarget);
      const mode = String(f.get('mode') || 'full');
      const amountRupees = Number(f.get('amount') || 0);
      const payload = {
        installmentId: String(f.get('installmentId') || ''),
        mode,
        ...(mode === 'full' ? {} : { amountMinor: Math.round(amountRupees * 100) }),
        idempotencyKey: crypto.randomUUID(),
      };
      const r = await fetch('/api/v1/collections/' + data.page.slug + '/intents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.message || 'Unable to prepare this collection');
      setMessage(
        result.checkoutAvailable
          ? 'Checkout is ready.'
          : result.message ||
              'Your amount has been prepared, but payment checkout is not enabled yet.',
      );
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="collection-form" onSubmit={submit}>
      <label className="field">
        Installment
        <select name="installmentId" required defaultValue="">
          <option value="" disabled>
            Choose an unpaid installment
          </option>
          {data.installments
            .filter((item) => Number(item.outstanding_minor) > 0)
            .map((item) => (
              <option value={item.id} key={item.id}>
                #{item.sequence} · {new Date(item.due_date).toLocaleDateString('en-IN')} ·{' '}
                {money(item.outstanding_minor)} outstanding
              </option>
            ))}
        </select>
      </label>

      <fieldset>
        <legend>Payment amount</legend>
        <div className="collection-modes">
          {data.page.modes.full && (
            <label>
              <input type="radio" name="mode" value="full" defaultChecked /> Full outstanding
            </label>
          )}
          {data.page.modes.partial && (
            <label>
              <input type="radio" name="mode" value="partial" /> Partial amount
            </label>
          )}
          {data.page.modes.custom && (
            <label>
              <input type="radio" name="mode" value="custom" /> Custom amount
            </label>
          )}
        </div>
      </fieldset>

      {(data.page.modes.partial || data.page.modes.custom) && (
        <label className="field">
          Amount (INR) — used for partial/custom selections
          <input
            name="amount"
            inputMode="decimal"
            min={data.page.minimumMinor ? Number(data.page.minimumMinor) / 100 : 1}
            max={data.page.maximumMinor ? Number(data.page.maximumMinor) / 100 : undefined}
            placeholder="Enter amount"
          />
        </label>
      )}

      <button className="button primary" disabled={busy}>
        {busy ? 'Preparing…' : 'Continue securely'}
      </button>
      {message && (
        <p className="admin-feedback" role="status">
          {message}
        </p>
      )}
      <p className="small">
        This page never asks for your card number, bank password, UPI PIN or OTP. A verified hosted
        provider must be connected before money can be collected.
      </p>
    </form>
  );
}

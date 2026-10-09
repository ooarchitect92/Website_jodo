'use client';
import { FormEvent, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/client';

type Settings = { title: string; notice: string; success: string; revision: number };
export function TenantEnquiryForm({ config }: { config: Settings }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState('');
  const key = useRef('');
  const previous = useRef('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError('');
    const form = event.currentTarget;
    const data = new FormData(form);
    const payload = {
      hostname: location.hostname.toLowerCase(),
      revision: config.revision,
      name: String(data.get('name') || ''),
      email: String(data.get('email') || ''),
      phone: String(data.get('phone') || ''),
      message: String(data.get('message') || ''),
      noticeAccepted: data.get('notice') === 'on',
      website: String(data.get('website') || ''),
    };
    const serialized = JSON.stringify(payload);
    if (previous.current && previous.current !== serialized) {
      setError('A previous attempt may exist. Restore the same details before retrying.');
      return;
    }
    previous.current = serialized;
    if (!key.current) key.current = crypto.randomUUID();
    setBusy(true);
    try {
      const result = await api<{ receipt: string }>('/v1/forms/tenant/submissions', {
        method: 'POST',
        headers: { 'Idempotency-Key': key.current },
        body: serialized,
      });
      setReceipt(result.receipt);
      previous.current = '';
      key.current = '';
      form.reset();
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ApiError && e.status === 422) {
        previous.current = '';
        key.current = '';
      }
    } finally {
      setBusy(false);
    }
  }
  if (receipt)
    return (
      <div className="success-card" role="status">
        <h2>Enquiry received</h2>
        <p>{config.success}</p>
        <p>
          Receipt: <strong>{receipt}</strong>
        </p>
        <button className="button outline" onClick={() => setReceipt('')}>
          Submit another enquiry
        </button>
      </div>
    );
  return (
    <form className="lead-form" onSubmit={submit}>
      <h2>{config.title}</h2>
      <label className="field">
        <span>Your name</span>
        <input name="name" autoComplete="name" required minLength={2} maxLength={120} />
      </label>
      <label className="field">
        <span>Email</span>
        <input name="email" type="email" autoComplete="email" required maxLength={200} />
      </label>
      <label className="field">
        <span>Phone number</span>
        <input name="phone" type="tel" autoComplete="tel" required maxLength={20} />
      </label>
      <label className="field">
        <span>Your enquiry</span>
        <textarea name="message" required minLength={5} maxLength={1500} rows={4} />
      </label>
      <div className="honey" aria-hidden="true">
        <input name="website" tabIndex={-1} autoComplete="off" aria-label="Leave blank" />
      </div>
      <label className="checkbox-row">
        <input type="checkbox" name="notice" required />
        <span>{config.notice}</span>
      </label>
      {error && (
        <p role="alert" className="error-card">
          {error}
        </p>
      )}
      <button className="button primary" type="submit" disabled={busy}>
        {busy ? 'Saving…' : 'Send enquiry'}
      </button>
      <p className="small muted">
        This enquiry is saved for this institution. No payment or external notification is
        confirmed.
      </p>
    </form>
  );
}

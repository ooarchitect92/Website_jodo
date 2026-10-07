'use client';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/client';
import { leadSchema } from '@core/contracts';
export function LeadForm({ source = 'form' }: { source?: 'form' | 'chat' }) {
  const [config, setConfig] = useState({
    revision: 'demo-v1',
    title: 'Request a demo',
    notice:
      'I understand this is a demonstration and agree to send these details to the operator of this installation.',
    success: 'Your enquiry was saved to this installation.',
  });
  useEffect(() => {
    api('/v1/public/site')
      .then((r) => setConfig(r.settings.form))
      .catch(() => {});
  }, []);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [fields, setFields] = useState<Record<string, string>>({}),
    [receipt, setReceipt] = useState('');
  const key = useRef('');
  const locked = useRef<Record<string, unknown> | null>(null);
  const errRef = useRef<HTMLDivElement>(null);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setError('');
    setFields({});
    const form = e.currentTarget;
    const data = new FormData(form);
    const raw = {
      name: data.get('name'),
      email: data.get('email'),
      phone: data.get('phone'),
      institute: data.get('institute'),
      role: data.get('role'),
      students: Number(data.get('students')),
      city: data.get('city'),
      interest: data.get('interest'),
      message: data.get('message') || '',
      website: data.get('website') || '',
      noticeAccepted: data.get('notice') === 'on',
      marketingOptIn: false,
      formRevision: config.revision,
      source,
    };
    const validation = leadSchema.safeParse(raw);
    if (!validation.success) {
      setFields(
        Object.fromEntries(validation.error.issues.map((x) => [x.path.join('.'), x.message])),
      );
      setError('Please check the form fields.');
      setTimeout(() => errRef.current?.focus(), 0);
      return;
    }
    if (locked.current && JSON.stringify(locked.current) !== JSON.stringify(validation.data)) {
      setError(
        'A previous attempt is unconfirmed. Restore those details and retry, or use “Start a separate enquiry” below.',
      );
      return;
    }
    if (!key.current) key.current = crypto.randomUUID();
    locked.current = validation.data;
    setBusy(true);
    try {
      const result = await api<{ status: string; receipt: string }>(
        source === 'chat' ? '/v1/chat/leads' : '/v1/forms/demo/submissions',
        {
          method: 'POST',
          headers: { 'Idempotency-Key': key.current },
          body: JSON.stringify(validation.data),
        },
      );
      setReceipt(result.receipt);
      form.reset();
      locked.current = null;
      key.current = '';
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ApiError) {
        setFields(Object.fromEntries(e.fields.map((f) => [f.field, f.message])));
        if (e.status === 422) {
          locked.current = null;
          key.current = '';
        }
      }
      setTimeout(() => errRef.current?.focus(), 0);
    } finally {
      setBusy(false);
    }
  }
  const label = (
    name: string,
    title: string,
    type = 'text',
    extra: Record<string, unknown> = {},
  ) => (
    <label className="field" key={name}>
      <span>
        {title} <span aria-hidden="true">*</span>
      </span>
      <input
        id={`lead-${name}`}
        name={name}
        type={type}
        aria-label={title}
        required
        aria-invalid={!!fields[name]}
        aria-describedby={fields[name] ? name + '-error' : undefined}
        {...extra}
      />
      {fields[name] && (
        <span id={name + '-error'} className="field-error">
          {fields[name]}
        </span>
      )}
    </label>
  );
  if (receipt)
    return (
      <div className="success-card" role="status">
        <span className="success-icon">✓</span>
        <h2>Enquiry received.</h2>
        <p>{config.success}</p>
        <p>
          Receipt <strong>{receipt}</strong>
        </p>
        <p className="small">
          Staff review is the next step. This is not confirmation of an email, booking, payment or a
          message to Jodo.
        </p>
        <button className="button outline" onClick={() => setReceipt('')}>
          Submit another enquiry
        </button>
      </div>
    );
  return (
    <form className="lead-form" onSubmit={submit} noValidate>
      <div className="form-grid">
        {label('name', 'Your name', 'text', { autoComplete: 'name', maxLength: 100 })}
        {label('institute', 'Institute name', 'text', {
          autoComplete: 'organization',
          maxLength: 180,
        })}
        {label('email', 'Work email', 'email', { autoComplete: 'email', maxLength: 200 })}
        {label('phone', 'Mobile number', 'tel', { autoComplete: 'tel', maxLength: 20 })}
        <label className="field">
          <span>Your role *</span>
          <select name="role" defaultValue="Owner">
            {['Owner', 'Principal', 'Finance', 'Administrator', 'Other'].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        {label('students', 'Number of students', 'number', {
          min: 1,
          max: 10000000,
          defaultValue: 500,
        })}
        {label('city', 'City', 'text', {\n          autoComplete: 'address-level2',\n          maxLength: 100,\n          defaultValue: '',\n        })}
        <label className="field">
          <span>Interested in</span>
          <select name="interest" defaultValue="Not sure">
            {['Not sure', 'Flex', 'Cred', 'Pay'].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        <span>
          Anything else? <small>(optional)</small>
        </span>
        <textarea
          name="message"
          rows={3}
          maxLength={1500}
          placeholder="Please avoid personal financial details."
        />
      </label>
      <div className="honey" aria-hidden="true">
        <label>
          Leave this blank
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <label className="checkbox-row">
        <input type="checkbox" name="notice" required />
        <span>
          {config.notice} <a href="/privacy-policy/">Read the demo privacy notice.</a>
        </span>
      </label>
      {fields.noticeAccepted && (
        <p className="field-error">Please acknowledge the form’s purpose.</p>
      )}
      {error && (
        <div className="error-card" role="alert" tabIndex={-1} ref={errRef}>
          {error}
        </div>
      )}
      <button className="button primary large" type="submit" disabled={busy}>
        {busy ? 'Saving your enquiry…' : config.title}
      </button>
      {locked.current && !busy && (
        <button
          type="button"
          className="text-button"
          onClick={() => {
            if (
              confirm('The earlier attempt may already exist. Start a genuinely separate enquiry?')
            ) {
              locked.current = null;
              key.current = '';
              setError('');
            }
          }}
        >
          Start a separate enquiry
        </button>
      )}
      <p className="small muted">
        No advertising consent is required. This form does not contact the real Jodo team.
      </p>
    </form>
  );
}

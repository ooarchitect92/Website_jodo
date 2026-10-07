'use client';
import { useState } from 'react';
import { api } from '@/lib/client';
export function PrivacyRequest() {
  const [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <form
      className="wrap narrow section"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const f = new FormData(e.currentTarget);
        try {
          const r = await api<{ message: string }>('/v1/privacy/requests', {
            method: 'POST',
            body: JSON.stringify({ email: f.get('email'), kind: f.get('kind') }),
          });
          setMessage(r.message);
        } catch (e) {
          setMessage((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>Ask the operator to review a privacy request.</h2>
      <label className="field">
        Email for verification
        <input name="email" type="email" required autoComplete="email" />
      </label>
      <label className="field">
        Request type
        <select name="kind">
          <option value="access">Access</option>
          <option value="correction">Correction</option>
          <option value="deletion">Deletion</option>
        </select>
      </label>
      <button className="button primary" disabled={busy}>
        Submit review request
      </button>
      {message && <p role="status">{message}</p>}
    </form>
  );
}

'use client';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { api } from '@/lib/client';
import { sanitizeCampaign } from '@core/contracts';
type Choice = { analytics: boolean; advertising: boolean; chosen: boolean; policyVersion: string };
const denied: Choice = {
  analytics: false,
  advertising: false,
  chosen: false,
  policyVersion: '2026-10-v1',
};
const Context = createContext({
  choice: denied,
  save: async (_a: boolean, _b: boolean) => {},
  error: '',
});
export function ConsentProvider({ children }: { children: React.ReactNode }) {
  const [choice, setChoice] = useState(denied),
    [error, setError] = useState(''),
    [ready, setReady] = useState(false);
  const pathname = usePathname();
  const pageKey = useRef('');
  async function sync() {
    try {
      setChoice(await api<Choice>('/v1/consent'));
    } catch {
      setChoice(denied);
    } finally {
      setReady(true);
    }
  }
  useEffect(() => {
    void sync();
    const syncVisible = () => {
      if (document.visibilityState === 'visible') void sync();
    };
    const channel =
      typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('jodo-consent') : null;
    channel?.addEventListener('message', syncVisible);
    window.addEventListener('pageshow', syncVisible);
    window.addEventListener('focus', syncVisible);
    document.addEventListener('visibilitychange', syncVisible);
    return () => {
      channel?.close();
      window.removeEventListener('pageshow', syncVisible);
      window.removeEventListener('focus', syncVisible);
      document.removeEventListener('visibilitychange', syncVisible);
    };
  }, []);
  async function save(analytics: boolean, advertising: boolean) {
    setError('');
    try {
      const c = await api<Choice>('/v1/consent/choices', {
        method: 'POST',
        body: JSON.stringify({ analytics, advertising, policyVersion: '2026-10-v1' }),
      });
      setChoice(c);
      pageKey.current = '';
      if (typeof BroadcastChannel !== 'undefined') {
        const channel = new BroadcastChannel('jodo-consent');
        channel.postMessage('change');
        channel.close();
      }
    } catch (e) {
      setChoice(denied);
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    if (
      !choice.analytics ||
      !ready ||
      document.visibilityState !== 'visible' ||
      (document as Document & { prerendering?: boolean }).prerendering
    )
      return;
    if (pageKey.current === pathname) return;
    pageKey.current = pathname;
    void api('/v1/events', {
      method: 'POST',
      body: JSON.stringify({
        id: crypto.randomUUID(),
        name: 'page_view',
        route: pathname,
        occurredAt: new Date().toISOString(),
      }),
    }).catch(() => {});
    const fields = sanitizeCampaign(Object.fromEntries(new URLSearchParams(location.search)));
    if (Object.keys(fields).length)
      void api('/v1/attribution/touches', {
        method: 'POST',
        body: JSON.stringify({ route: pathname, fields }),
      }).catch(() => {});
  }, [pathname, choice, ready]);
  useEffect(() => {
    if (!choice.analytics) return;
    const click = (event: MouseEvent) => {
      const element = (event.target as Element)?.closest?.('[data-action-id]');
      const actionId = element?.getAttribute('data-action-id');
      if (actionId && /^[a-z0-9_-]{1,80}$/.test(actionId))
        void api('/v1/events', {
          method: 'POST',
          body: JSON.stringify({
            id: crypto.randomUUID(),
            name: 'cta_click',
            route: pathname,
            actionId,
            occurredAt: new Date().toISOString(),
          }),
        }).catch(() => {});
    };
    document.addEventListener('click', click);
    return () => document.removeEventListener('click', click);
  }, [choice.analytics, pathname]);
  return (
    <Context.Provider value={{ choice, save, error }}>
      {children}
      {ready && !choice.chosen && pathname !== '/cookie-preferences/' && (
        <aside className="consent-banner" aria-label="Privacy choices">
          <div>
            <strong>Your privacy, your choice.</strong>
            <p>
              Essential features work without optional analytics. Advertising connections are
              disabled in this demo.
            </p>
            {error && <p role="alert">{error}</p>}
          </div>
          <div className="consent-actions">
            <button onClick={() => save(false, false)} className="button outline">
              Reject optional
            </button>
            <button onClick={() => save(true, false)} className="button primary">
              Allow analytics
            </button>
            <a href="/cookie-preferences/">Manage</a>
          </div>
        </aside>
      )}
    </Context.Provider>
  );
}
export function CookiePreferences() {
  const { choice, save, error } = useContext(Context);
  const [analytics, setAnalytics] = useState(choice.analytics);
  useEffect(() => setAnalytics(choice.analytics), [choice.analytics]);
  return (
    <section className="wrap narrow section">
      <p className="eyebrow">Privacy preferences</p>
      <h1>Your choice stays yours.</h1>
      <p>
        Essential sessions support the owner console, submitted forms and support chat. No optional
        behavioural events are queued before consent.
      </p>
      <label className="check-card">
        <input
          type="checkbox"
          checked={analytics}
          onChange={(e) => setAnalytics(e.target.checked)}
        />
        <span>
          <strong>First-party analytics</strong>
          <br />
          Allow a limited set of route and interaction events. Form values, account information and
          calculator inputs are excluded.
        </span>
      </label>
      <div className="check-card">
        <strong>Advertising: disabled</strong>
        <p>No Google Ads or Meta integrations are activated.</p>
      </div>
      <button className="button primary" onClick={() => save(analytics, false)}>
        Save preferences
      </button>
      {choice.chosen && (
        <p role="status">
          Saved server preference: analytics {choice.analytics ? 'allowed' : 'off'}.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

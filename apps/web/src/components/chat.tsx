'use client';
import { useRef, useState } from 'react';
import { api } from '@/lib/client';
import { LeadForm } from './form';
export function Chat() {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [messages, setMessages] = useState<string[]>([]),
    [capture, setCapture] = useState(false);
  const box = useRef<HTMLDialogElement>(null);
  async function launch() {
    setOpen(true);
    box.current?.showModal();
    setBusy(true);
    try {
      await api('/v1/chat/start', { method: 'POST', body: '{}' });
      setMessages([
        'Hello. I’m a guided product assistant. Choose a topic below. I cannot access payment accounts or provide credit decisions.',
      ]);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function topic(topic: string) {
    if (topic === 'Demo') {
      setCapture(true);
      return;
    }
    setBusy(true);
    try {
      const r = await api<{ answer: string }>('/v1/chat/messages', {
        method: 'POST',
        body: JSON.stringify({ clientId: crypto.randomUUID(), topic }),
      });
      setMessages((m) => [...m, topic, r.answer]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button className="chat-launcher" onClick={launch} aria-label="Open guided product assistant">
        ☏ <span>Let’s talk</span>
      </button>
      <dialog className="chat-dialog" ref={box} onClose={() => setOpen(false)}>
        <div className="chat-top">
          <div>
            <strong>Jodo product guide</strong>
            <small>Guided demo assistant · not a live agent</small>
          </div>
          <button aria-label="Close assistant" onClick={() => box.current?.close()}>
            ✕
          </button>
        </div>
        <div className="chat-body">
          {messages.map((m, i) => (
            <p className={i % 2 === 1 ? 'message user' : 'message'} key={i}>
              {m}
            </p>
          ))}
          {busy && <p role="status">Working…</p>}
          {error && (
            <p className="error-card" role="alert">
              {error} <a href="/contact-us/">Use the contact form instead.</a>
            </p>
          )}
          {!capture ? (
            <>
              <div className="topic-buttons">
                {['Flex', 'Cred', 'Pay', 'Demo', 'Official support'].map((t) => (
                  <button
                    disabled={busy || !!error}
                    className="button outline"
                    key={t}
                    onClick={() => topic(t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <button
                className="text-button"
                disabled={!!error}
                onClick={async () => {
                  try {
                    const r = await api<{ message: string }>('/v1/chat/handoff', {
                      method: 'POST',
                      body: '{}',
                    });
                    setMessages((m) => [...m, r.message]);
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Request staff review
              </button>
            </>
          ) : (
            <>
              <button className="text-button" onClick={() => setCapture(false)}>
                ← Back to topics
              </button>
              <LeadForm source="chat" />
            </>
          )}
        </div>
      </dialog>
    </>
  );
}

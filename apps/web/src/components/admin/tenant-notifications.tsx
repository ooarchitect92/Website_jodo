'use client';
import { useEffect, useState } from 'react';
import { DataTable, useAdminApi } from './context';

type Notification = {
  id: string;
  title: string;
  enquiryId: string;
  createdAt: string;
  read: boolean;
};

export function TenantNotifications({ openEnquiries }: { openEnquiries: () => void }) {
  const { request, session } = useAdminApi();
  const [items, setItems] = useState<Notification[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  async function refresh() {
    try {
      setItems(await request<Notification[]>('admin/tenant/notifications'));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    setItems([]);
    void refresh();
  }, [session.tenant.id]);

  async function markRead(id: string) {
    setBusy(id);
    try {
      await request('admin/tenant/notifications/' + id + '/read', 'POST', {});
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  const unreadCount = items.filter((item) => !item.read).length;
  return (
    <section className="admin-panel">
      <div className="admin-toolbar">
        <div>
          <h2>Institution notifications</h2>
          <p>
            {unreadCount} unread in the latest {items.length} notifications. These are in-app
            alerts, not sent emails, SMS or WhatsApp messages.
          </p>
        </div>
        <button className="button outline" onClick={refresh}>
          Refresh
        </button>
      </div>
      {error && (
        <p className="error-card" role="alert">
          {error}
        </p>
      )}
      <DataTable
        rows={items.map((item) => ({
          ...item,
          received: new Date(item.createdAt).toLocaleString('en-IN'),
          status: item.read ? 'Read' : 'Unread',
        }))}
        columns={[
          ['title', 'Notification'],
          ['received', 'Received'],
          ['status', 'Status'],
        ]}
        actions={(row) => (
          <div className="admin-toolbar">
            {!row.read && (
              <button
                onClick={() => markRead(row.id)}
                disabled={Boolean(busy) || session.tenant.readOnly}
              >
                Mark read
              </button>
            )}
            <button onClick={openEnquiries}>Open enquiries</button>
          </div>
        )}
      />
      <p className="small muted">
        Notifications appear after the durable background worker processes accepted enquiries. Each
        staff member has independent read status.
      </p>
    </section>
  );
}

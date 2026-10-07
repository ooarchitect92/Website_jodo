'use client';
import { createContext, useContext } from 'react';
import { api } from '@/lib/client';
export type Session = {
  user: { id: string; email: string; role: string };
  tenant: { id: string; name: string; role: string; status?: string };
  workspaces: Array<{ id: string; name: string; role: string; status?: string }>;
  csrf: string;
};
export const AdminContext = createContext<Session>({
  user: { id: '', email: '', role: '' },
  tenant: { id: '', name: '', role: '' },
  workspaces: [],
  csrf: '',
});
export function useAdminApi() {
  const session = useContext(AdminContext);
  return {
    session,
    request: async <T = any,>(path: string, method = 'GET', body?: unknown) =>
      api<T>('/v1/' + path, {
        method,
        headers: { 'X-CSRF-Token': session.csrf },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      }),
  };
}
export function DataTable({
  rows,
  columns,
  actions,
}: {
  rows: Record<string, any>[];
  columns: [string, string][];
  actions?: (row: Record<string, any>) => React.ReactNode;
}) {
  if (!rows.length)
    return (
      <div className="empty-state">
        <h3>Nothing here yet.</h3>
        <p>New records will appear when the corresponding workflow is used.</p>
      </div>
    );
  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr>
            {columns.map(([k, t]) => (
              <th key={k}>{t}</th>
            ))}
            {actions && <th>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, n) => (
            <tr key={r.id || r.key || n}>
              {columns.map(([k]) => (
                <td key={k}>
                  {typeof r[k] === 'object' ? JSON.stringify(r[k]) : String(r[k] ?? '—')}
                </td>
              ))}
              {actions && <td>{actions(r)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

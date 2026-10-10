/**
 * Sidebar visibility is a presentation safeguard, not a substitute for
 * server-side tenant authorization. Keep one consistent active-role policy.
 */
export const allowedAdminAreas: Record<string, readonly string[]> = {
  owner: [
    'overview',
    'content',
    'leads',
    'enquiries',
    'notifications',
    'collections',
    'fees',
    'fee-plans',
    'academic',
    'tenant',
    'tasks',
    'media',
    'campaigns',
    'workflows',
    'conversations',
    'settings',
    'outbox',
    'audit',
    'privacy-requests',
    'users',
    'integrations',
  ],
  editor: ['overview', 'content', 'media', 'collections'],
  sales: ['overview', 'leads', 'enquiries', 'notifications', 'tasks'],
  analyst: ['overview'],
};

export function canViewAdminArea(tenantRole: string, area: string): boolean {
  return (allowedAdminAreas[tenantRole] ?? []).includes(area);
}

export function safeAdminArea(tenantRole: string, requestedArea: string): string {
  return canViewAdminArea(tenantRole, requestedArea) ? requestedArea : 'overview';
}

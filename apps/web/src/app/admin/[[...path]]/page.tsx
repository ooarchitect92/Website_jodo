import { AdminShell } from '@/components/admin/shell';
export const metadata = {
  title: 'Owner Console | Website Jodo',
  robots: { index: false, follow: false },
};
export default function Admin() {
  return <AdminShell />;
}

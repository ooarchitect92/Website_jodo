import { checkConfig } from '../apps/api/src/config';
import { Db } from '../apps/api/src/db';
import { access } from 'node:fs/promises';
async function main() {
  checkConfig();
  const db = new Db();
  try {
    await db.query('SELECT 1');
    const tables = await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public'");
    const role = (await db.query('SELECT current_user'))[0];
    console.log(
      'Configuration valid. Database reachable. Tables:',
      tables.length,
      'Role:',
      role!.current_user,
    );
    const forbidden = await db.query(
      "SELECT has_table_privilege(current_user,'content','DELETE') AS content_delete,has_table_privilege(current_user,'audit','UPDATE') AS audit_update",
    );
    if (forbidden[0]!.content_delete || forbidden[0]!.audit_update)
      throw Error('Runtime role has excessive content/audit privileges');
    await access('apps/web/public/reference/images/jodo-logo-v2.svg');
    console.log('Reference media present. Automatic blog deletion disabled.');
    console.log(
      'Production acceptance:',
      process.env.SITE_APPROVED === 'true'
        ? 'Owner flag set; inspect full evidence ledger'
        : 'BLOCKED — approval required',
    );
  } finally {
    await db.onModuleDestroy();
  }
}
main().catch((e) => {
  console.error('Doctor:', e.message);
  process.exitCode = 1;
});

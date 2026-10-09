import { Pool } from 'pg';
import { seedPages, defaultNavigation, formDefinition } from '../packages/core/src/site';
async function main() {
  if (process.env.DEPLOYMENT_MODE !== 'demo' && process.env.DEPLOYMENT_MODE !== 'test')
    throw Error('Demo seeding is prohibited outside demo/test');
  const p = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL,
  });
  const c = await p.connect();
  try {
    await c.query('BEGIN');
    await c.query('INSERT INTO form_revisions(id,body) VALUES($1,$2) ON CONFLICT(id) DO NOTHING', [
      formDefinition.revision,
      formDefinition,
    ]);
    for (const s of seedPages) {
      const added = await c.query(
        `INSERT INTO content(slug,kind,draft,state,tenant_id)
         VALUES($1,$2,$3,$4,(SELECT id FROM tenants WHERE slug='default'))
         ON CONFLICT(slug) DO NOTHING RETURNING id`,
        [s.slug, s.kind, s.body, 'published'],
      );
      if (added.rows[0]) {
        const id = added.rows[0].id;
        const rev = await c.query(
          'INSERT INTO revisions(content_id,body) VALUES($1,$2) RETURNING id',
          [id, s.body],
        );
        await c.query('UPDATE content SET published_revision=$2 WHERE id=$1', [id, rev.rows[0].id]);
      }
    }
    for (const [key, value] of Object.entries({
      navigation: defaultNavigation,
      form: formDefinition,
      brand: { name: 'Jodo', primary: '#2c67d3' },
    }))
      await c.query('INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO NOTHING', [
        key,
        JSON.stringify(value),
      ]);
    await c.query('COMMIT');
    console.log(
      'Demo source content inserted without overwriting existing records:',
      seedPages.length,
    );
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
    await p.end();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});

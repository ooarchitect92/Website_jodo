import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const denied = ['.env', '.env.local', '.env.production'];
for (const f of denied) {
  try {
    const git = await import('node:child_process');
    const tracked = git
      .execFileSync('git', ['ls-files', '--error-unmatch', f], { stdio: 'pipe' })
      .toString()
      .trim();
    if (tracked) throw Error('A private environment file is tracked');
  } catch (e) {
    if (e.message === 'A private environment file is tracked') throw e;
  }
}
const data = JSON.parse(await readFile('packages/core/src/seed-content.json', 'utf8'));
let images = 0;
const missing = [];
for (const p of data)
  for (const b of p.body.blocks)
    for (const item of [b, ...b.items]) {
      if (item.image?.startsWith('/reference/')) {
        try {
          await stat(join('apps/web/public', item.image));
          images++;
        } catch {
          missing.push(item.image);
        }
      }
    }
for (const p of data)
  if (p.body.cover) {
    try {
      await stat(join('apps/web/public', p.body.cover));
    } catch {
      missing.push(p.body.cover);
    }
  }
if (missing.length) throw Error('Missing source media: ' + [...new Set(missing)].join(', '));
console.log('Verified reference media usages:', images, 'Public content records:', data.length);

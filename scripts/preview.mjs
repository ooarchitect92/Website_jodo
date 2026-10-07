import { spawn } from 'node:child_process';
console.log(
  'READ-ONLY REFERENCE PREVIEW. No database is used for public content. Forms and administration cannot report success without the real API.',
);
const child = spawn(
  process.execPath,
  [
    'node_modules/next/dist/bin/next',
    'dev',
    'apps/web',
    '--webpack',
    '-p',
    process.env.PORT || '3000',
  ],
  {
    stdio: 'inherit',
    env: { ...process.env, JODO_READONLY_PREVIEW: 'true', DEPLOYMENT_MODE: 'demo' },
  },
);
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => (process.exitCode = code || 0));

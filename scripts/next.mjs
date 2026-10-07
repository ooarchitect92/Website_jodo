import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
// Load environment into the child process without inheriting --env-file through
// execArgv: Next workers intentionally reject that flag in NODE_OPTIONS.
if (existsSync('.env')) process.loadEnvFile('.env');
const child = spawn(
  process.execPath,
  ['node_modules/next/dist/bin/next', ...process.argv.slice(2)],
  {
    env: process.env,
    stdio: 'inherit',
  },
);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});

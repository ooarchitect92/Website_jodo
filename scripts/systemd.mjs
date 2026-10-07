import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = process.cwd();
if (/[\n\r]/.test(root)) throw Error('Invalid working directory');
const output = resolve('infra/native/generated');
await mkdir(output, { recursive: true });
for (const service of ['api', 'worker', 'web']) {
  const command =
    service === 'web'
      ? `${process.execPath} --env-file=${root}/.env ${root}/node_modules/next/dist/bin/next start ${root}/apps/web -p 3000`
      : `${process.execPath} --env-file=${root}/.env ${root}/dist/apps/${service}/src/main.js`;
  await writeFile(
    resolve(output, `website-jodo-${service}.service`),
    `[Unit]\nDescription=Website Jodo ${service}\nAfter=network.target\n\n[Service]\nType=simple\nWorkingDirectory=${root}\nExecStart=${command}\nRestart=on-failure\nRestartSec=5\nNoNewPrivileges=true\nPrivateTmp=true\nUMask=0077\n\n[Install]\nWantedBy=default.target\n`,
  );
}
console.log(
  'Generated user service units. Review paths, then copy to ~/.config/systemd/user/ and enable with systemctl --user. No services were installed automatically.',
);

import { test, expect } from '@playwright/test';
import { Pool } from 'pg';
import { authenticator } from 'otplib';
import AxeBuilder from '@axe-core/playwright';

test('owner creates, autosaves, reviews, publishes, trashes and restores content', async ({
  page,
}, info) => {
  test.skip(
    info.project.name !== 'desktop-chromium',
    'One isolated privileged end-to-end workflow; public mobile coverage is separate.',
  );
  test.setTimeout(90000);
  expect(process.env.DEPLOYMENT_MODE).toBe('test');
  const pool = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
  try {
    await pool.query('UPDATE users SET last_totp_step=0 WHERE email=$1', [process.env.OWNER_EMAIL]);
  } finally {
    await pool.end();
  }
  await page.goto('/admin/');
  await page.getByLabel('Staff email').fill(process.env.OWNER_EMAIL!);
  await page.getByLabel('Password', { exact: true }).fill(process.env.OWNER_PASSWORD!);
  await page
    .getByLabel('Authenticator code')
    .fill(authenticator.generate(process.env.OWNER_TOTP_SECRET!));
  await page.getByRole('button', { name: 'Sign in securely' }).click();
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  const a = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(a.violations.map((v) => v.id)).toEqual([]);
  await page.screenshot({ path: 'test-results/owner-overview.png', fullPage: true });
  await page.getByRole('button', { name: 'Content & publishing', exact: true }).click();
  await page.getByRole('button', { name: 'Create content', exact: true }).click();
  const route = '/owner-qa-' + Date.now() + '/';
  await page.getByLabel('Title', { exact: true }).fill('Owner acceptance test');
  await page.getByLabel('Route', { exact: true }).fill(route);
  await page.getByRole('button', { name: 'Create draft', exact: true }).click();
  await expect(page.getByLabel('Page title', { exact: true })).toHaveValue('Owner acceptance test');
  await page.getByLabel('Page title', { exact: true }).fill('Owner draft saved and published');
  await expect(page.locator('.save-state')).toContainText('Saved draft', { timeout: 10000 });
  await page.getByRole('button', { name: 'Submit for review', exact: true }).click();
  await expect(page.locator('.admin-toolbar .status-pill')).toContainText('in_review');
  await page.getByRole('button', { name: 'Approve draft', exact: true }).click();
  await expect(page.locator('.admin-toolbar .status-pill')).toContainText('approved');
  await page.getByRole('button', { name: 'Publish approved draft', exact: true }).click();
  await expect(page.locator('.admin-toolbar .status-pill')).toContainText('published');
  const publicPage = await page.context().newPage();
  const response = await publicPage.goto(route);
  expect(response?.status()).toBe(200);
  await expect(
    publicPage.getByRole('heading', { name: 'Owner acceptance test', exact: true }),
  ).toBeVisible();
  await publicPage.close();
  page.on('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Move to no-expiry trash', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Restore to draft', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Restore to draft', exact: true }).click();
  await expect(page.locator('.admin-toolbar .status-pill')).toContainText('draft');
  await page.screenshot({ path: 'test-results/owner-content-editor.png', fullPage: true });
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign in securely', exact: true })).toBeVisible();
});

test('no optional event network requests before consent and no third-party trackers', async ({
  page,
}) => {
  const calls: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST') calls.push(r.url());
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Reject optional', exact: true })).toBeVisible();
  await page.waitForTimeout(400);
  expect(calls.filter((u) => u.includes('/v1/events') || u.includes('/v1/attribution'))).toEqual(
    [],
  );
  await page.getByRole('button', { name: 'Reject optional', exact: true }).click();
  await page
    .getByRole('link', { name: 'Products', exact: true })
    .first()
    .click()
    .catch(() => {});
  expect(calls.filter((u) => /google-analytics|facebook\.com|doubleclick/.test(u))).toEqual([]);
});

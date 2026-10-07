import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const routes = [
  '/',
  '/products/',
  '/about-us/',
  '/contact-us/',
  '/blog/',
  '/case-studies/',
  '/tools/hidden-cost-calculator/',
  '/login/',
  '/privacy-policy/',
];
for (const route of routes)
  test('public route, media and accessibility ' + route, async ({ page }, info) => {
    const r = await page.goto(route);
    expect(r?.status()).toBe(200);
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('h1')).toBeVisible();
    await page.waitForTimeout(300);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 2,
    );
    expect(overflow).toBe(false);
    const broken = await page
      .locator('img')
      .evaluateAll((imgs) =>
        imgs
          .filter(
            (i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth === 0,
          )
          .map((i) => i.getAttribute('src')),
      );
    expect(broken).toEqual([]);
    const a = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(
      a.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.map((n) => n.target),
      })),
    ).toEqual([]);
    await page.screenshot({
      path:
        'test-results/' + info.project.name + '-' + (route.replaceAll('/', '_') || 'home') + '.png',
      fullPage: true,
    });
  });
test('rejecting optional tracking preserves the form journey', async ({ page }) => {
  await page.goto('/contact-us/');
  const reject = page.getByRole('button', { name: 'Reject optional' });
  if (await reject.isVisible()) await reject.click();
  await page.getByLabel('Your name').fill('Synthetic Browser Visitor');
  await page.getByLabel('Institute name').fill('Synthetic Browser Institute');
  await page.getByLabel('Work email').fill('browser@example.invalid');
  await page.getByLabel('Mobile number').fill('+919999999999');
  await page.getByLabel('City', { exact: true }).fill('Test City');
  await page.locator('input[name="notice"]').check();
  await page.getByRole('button', { name: 'Request a demo', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Enquiry received.' })).toBeVisible();
  await expect(page.getByText(/REQ-[A-F0-9]+/)).toBeVisible();
});
test('API outage never displays false form success', async ({ page }) => {
  await page.goto('/contact-us/');
  await page.route('**/v1/forms/demo/submissions', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Synthetic outage; no receipt' }),
    }),
  );
  await page.getByLabel('Your name').fill('Synthetic Failure Visitor');
  await page.getByLabel('Institute name').fill('Failure Institute');
  await page.getByLabel('Work email').fill('failure@example.invalid');
  await page.getByLabel('Mobile number').fill('+919999999999');
  await page.getByLabel('City', { exact: true }).fill('Test City');
  await page.locator('input[name="notice"]').check();
  await page.getByRole('button', { name: 'Request a demo', exact: true }).click();
  await expect(page.locator('.error-card[role="alert"]')).toContainText('no receipt');
  await expect(page.getByRole('heading', { name: 'Enquiry received.' })).toHaveCount(0);
});
test('calculator changes locally without sending input values', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST') requests.push(r.postData() || '');
  });
  await page.goto('/tools/hidden-cost-calculator/');
  await page.getByLabel('Number of students').fill('4321');
  await expect(page.locator('.calculator-result h2')).not.toContainText('Check');
  expect(requests.join('')).not.toContain('4321');
});
test('unknown route has a true 404', async ({ page }) => {
  const r = await page.goto('/definitely-not-a-real-route/');
  expect(r?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Let’s get you back on track.' })).toBeVisible();
});
test('customer portals do not capture credentials before provider configuration', async ({
  page,
}) => {
  await page.goto('/login/');
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Continue' })).toHaveCount(4);
  await expect(page.locator('.portal-grid a[href^="/contact-us"]')).toHaveCount(3);
  await expect(page.locator('.portal-grid a[href^="/admin"]')).toHaveCount(1);
  await expect(page.locator('a[href*="jodo.in"]')).toHaveCount(0);
});
test('owner login page has MFA and no default credentials', async ({ page }) => {
  await page.goto('/admin/');
  await expect(page.getByLabel('Authenticator code')).toBeVisible();
  await expect(page.getByLabel('Password')).toBeEmpty();
  const a = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(a.violations.map((v) => v.id)).toEqual([]);
});

import { expect, test } from '@playwright/test';

test('manifest is valid and installable', async ({ request }) => {
  const res = await request.get('/manifest.webmanifest');
  expect(res.ok()).toBe(true);
  const m = await res.json();
  expect(m.name).toBe('FileShare');
  expect(m.short_name).toBe('FileShare');
  expect(m.display).toBe('standalone');
  expect(m.start_url).toBeTruthy();
  const sizes = m.icons.map((i: { sizes: string }) => i.sizes);
  expect(sizes).toContain('192x192');
  expect(sizes).toContain('512x512');
  expect(m.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true);
  for (const icon of m.icons) expect((await request.get(`/${icon.src}`)).ok()).toBe(true);
});

test('app shell opens offline after the first visit', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'FileShare' })).toBeVisible();
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return reg.active?.state;
  });
  // Make sure the precache finished before going offline.
  await page.waitForFunction(async () =>
    (await caches.keys()).some((k) => k.startsWith('fileshare-shell-')),
  );
  await page.reload();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'FileShare' })).toBeVisible();
  await page.goto('/#/settings'); // lazy-loaded chunk must also come from the cache
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(page.getByText(/No internet connection/)).toBeVisible();
  await context.setOffline(false);
});

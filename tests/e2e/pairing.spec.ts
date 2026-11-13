import { expect, test } from '@playwright/test';
import { openDevice, type Device } from './helpers';

let a: Device;
let b: Device;

test.beforeEach(async ({ browser }) => {
  a = await openDevice(browser, 'Test iPad');
  b = await openDevice(browser, 'Test Phone');
});

test.afterEach(async () => {
  await a?.context.close();
  await b?.context.close();
});

async function textCode(page: Device['page']) {
  await page.getByRole('button', { name: /Use a text code/ }).click();
  return page.getByLabel('Pairing code as text').inputValue();
}

async function enter(page: Device['page'], code: string) {
  const open = page.getByRole('button', { name: 'Enter code manually' });
  const field = page.getByLabel('Pairing code', { exact: true });
  await expect(open.or(field)).toBeVisible();
  if (await open.isVisible()) await open.click();
  await field.fill(code);
  await page.getByRole('button', { name: 'Continue' }).click();
}

test('connects even when the reply is scanned 45 seconds later', async () => {
  test.setTimeout(240_000);
  await a.page.goto('./#/pair/show');
  const offer = await textCode(a.page);
  await b.page.goto('./#/pair/scan');
  await enter(b.page, offer);
  const answer = await textCode(b.page);
  await b.page.waitForTimeout(45_000);
  await a.page.getByRole('button', { name: 'Scan Reply' }).click();
  await enter(a.page, answer);
  await expect(a.page.getByRole('button', { name: 'Codes Match' })).toBeVisible({
    timeout: 40_000,
  });
  await expect(b.page.getByRole('button', { name: 'Codes Match' })).toBeVisible();
});

test('rejects a reused pairing code', async () => {
  await a.page.goto('./#/pair/show');
  const offer = await textCode(a.page);
  await b.page.goto('./#/pair/scan');
  await enter(b.page, offer);
  await expect(
    b.page
      .getByLabel('Pairing code as text')
      .or(b.page.getByRole('button', { name: /Use a text code/ })),
  ).toBeVisible();
  await b.page.getByRole('button', { name: 'Scan a Different Code' }).click();
  await enter(b.page, offer);
  await expect(
    b.page.getByText('This code was already used. Create a new code on the other device.'),
  ).toBeVisible();
});

test('explains invalid and misdirected codes', async () => {
  await b.page.goto('./#/pair/scan');
  await enter(b.page, 'hello world');
  await expect(b.page.getByText('This isn’t a FileShare pairing code.')).toBeVisible();

  await enter(b.page, 'FS1.AAAAAAAAAAAAAAAA');
  await expect(b.page.getByText('This code is damaged or incomplete.')).toBeVisible();

  // A device scanning its own code.
  await a.page.goto('./#/pair/show');
  const own = await textCode(a.page);
  await a.page.getByRole('button', { name: 'Scan Reply' }).click();
  await enter(a.page, own);
  await expect(a.page.getByText(/That’s this device’s own pairing code/)).toBeVisible();
});

test('mismatched verification closes the connection on both devices', async () => {
  await a.page.goto('./#/pair/show');
  const offer = await textCode(a.page);
  await b.page.goto('./#/pair/scan');
  await enter(b.page, offer);
  const answer = await textCode(b.page);
  await a.page.getByRole('button', { name: 'Scan Reply' }).click();
  await enter(a.page, answer);
  await a.page.getByRole('button', { name: 'Codes Don’t Match' }).click();
  await expect(a.page.getByText('Couldn’t connect')).toBeVisible();
  await expect(b.page.getByText('Couldn’t connect')).toBeVisible();
  await expect(b.page.getByText(/didn’t confirm the verification code/)).toBeVisible();
});

import { expect, test } from '@playwright/test';
import { downloadedBytes, makeFile, openDevice, sha256, type Device } from './helpers';

/**
 * Quick connect goes through real public Nostr relays, so these tests need
 * internet. Skip with FILESHARE_SKIP_RELAY=1.
 */
test.skip(!!process.env.FILESHARE_SKIP_RELAY, 'Relay tests disabled');

let ipad: Device;
let phone: Device;

test.beforeEach(async ({ browser }) => {
  ipad = await openDevice(browser, 'Test iPad', { quickConnect: true });
  phone = await openDevice(browser, 'Test Phone', { quickConnect: true });
});

test.afterEach(async () => {
  await ipad?.context.close();
  await phone?.context.close();
});

/** First pairing with a single scan: the reply travels back through the relay. */
async function pairWithOneScan() {
  await ipad.page.goto('./#/pair/show');
  await expect(ipad.page.getByText('It connects automatically after scanning.')).toBeVisible();
  await ipad.page.getByRole('button', { name: /Use a text code/ }).click();
  const offer = await ipad.page.getByLabel('Pairing code as text').inputValue();

  await phone.page.goto('./#/pair/scan');
  await phone.page.getByRole('button', { name: 'Enter code manually' }).click();
  await phone.page.getByLabel('Pairing code', { exact: true }).fill(offer);
  await phone.page.getByRole('button', { name: 'Continue' }).click();

  // The iPad never scans anything: both reach the verification step on their own.
  const codeA = ipad.page.getByLabel(/^Verification code/);
  const codeB = phone.page.getByLabel(/^Verification code/);
  await expect(codeA).toBeVisible({ timeout: 30_000 });
  await expect(codeB).toBeVisible();
  expect(await codeA.getAttribute('aria-label')).toBe(await codeB.getAttribute('aria-label'));
  await ipad.page.getByRole('button', { name: 'Codes Match' }).click();
  await phone.page.getByRole('button', { name: 'Codes Match' }).click();
  await expect(ipad.page.getByText('Connected to Test Phone')).toBeVisible();
  await expect(phone.page.getByText('Connected to Test iPad')).toBeVisible();
}

test('first pairing needs only one scan', async () => {
  await pairWithOneScan();
});

test('paired device reconnects with a tap and receives a file', async () => {
  test.setTimeout(240_000);
  await pairWithOneScan();

  // Quick connect is set up on both sides after the verified pairing.
  await ipad.page.goto('./#/devices');
  await ipad.page
    .getByRole('button', { name: /Test Phone/ })
    .last()
    .click();
  await expect(
    ipad.page.getByRole('dialog').getByText('Connects with a tap, no QR code.'),
  ).toBeVisible();
  await ipad.page.keyboard.press('Escape');

  // End the connection, as if the apps had been closed.
  await ipad.page.getByRole('button', { name: 'Disconnect Test Phone' }).click();
  await expect(phone.page.getByText('Test iPad disconnected')).toBeVisible();

  // The phone lists the iPad under Send; one tap connects and selects it.
  await phone.page.goto('./#/send');
  const row = phone.page.getByRole('radio', { name: /Test iPad/ });
  await expect(row).toBeVisible();
  await expect(phone.page.getByText('Available · Tap to connect')).toBeVisible({ timeout: 60_000 });
  await row.click();
  await expect(
    phone.page.getByRole('radio', { name: /Test iPad.*Connected/, checked: true }),
  ).toBeVisible({
    timeout: 45_000,
  });

  const file = makeFile('after-reconnect.bin', 500_000);
  await phone.page.locator('input[type="file"]').setInputFiles(file);
  await phone.page.getByRole('button', { name: /^Send 1 File to Test iPad/ }).click();
  await ipad.page.getByRole('dialog').getByRole('button', { name: 'Accept' }).click();
  await expect(ipad.page.getByText('Received 1 file from Test Phone')).toBeVisible({
    timeout: 60_000,
  });

  await ipad.page.goto('./#/receive');
  const [download] = await Promise.all([
    ipad.page.waitForEvent('download'),
    ipad.page.getByRole('button', { name: 'Save after-reconnect.bin', exact: true }).click(),
  ]);
  expect(sha256(await downloadedBytes(download))).toBe(sha256(file.buffer));
});

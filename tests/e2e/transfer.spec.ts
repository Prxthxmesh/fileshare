import { expect, test } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  chooseFilePaths,
  chooseFiles,
  downloadedBytes,
  makeFile,
  makeLargeFile,
  openDevice,
  pair,
  sha256,
  sha256OfPath,
  type Device,
} from './helpers';

const TMP = join(tmpdir(), 'fileshare-e2e');

let receiver: Device;
let sender: Device;

test.beforeEach(async ({ browser }) => {
  receiver = await openDevice(browser, 'Test iPad');
  sender = await openDevice(browser, 'Test Phone');
  await pair(receiver, sender);
});

test.afterEach(async () => {
  await receiver?.context.close();
  await sender?.context.close();
});

test('multiple files arrive byte-for-byte identical, with SHA-256 verification', async () => {
  const files = [
    makeFile('photo.jpg', 3 * 1024 * 1024 + 17, 'image/jpeg'),
    makeFile('empty.txt', 0, 'text/plain'),
    makeFile('写真 – résumé 📷.heic', 200_000, 'image/heic'),
    makeFile('archive.weird-ext', 65536 * 2, ''),
    makeFile('photo.jpg', 1234, 'image/jpeg'), // duplicate name
  ];
  await chooseFiles(sender.page, files);
  await expect(sender.page.getByText('5 files ·')).toBeVisible();
  await sender.page.getByRole('button', { name: /^Send 5 Files to Test iPad/ }).click();

  const dialog = receiver.page.getByRole('dialog', {
    name: /Test Phone wants to send you 5 files/,
  });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('photo (1).jpg')).toBeVisible();
  await dialog.getByRole('button', { name: 'Accept' }).click();

  await expect(receiver.page.getByText('Received 5 files from Test Phone')).toBeVisible({
    timeout: 60_000,
  });
  await expect(sender.page.getByText('Sent 5 files to Test iPad')).toBeVisible();

  await receiver.page.goto('./#/receive');
  const expected = new Map([
    ['photo.jpg', files[0]],
    ['empty.txt', files[1]],
    ['写真 – résumé 📷.heic', files[2]],
    ['archive.weird-ext', files[3]],
    ['photo (1).jpg', files[4]],
  ]);
  for (const [name, file] of expected) {
    const [download] = await Promise.all([
      receiver.page.waitForEvent('download'),
      receiver.page.getByRole('button', { name: `Save ${name}`, exact: true }).click(),
    ]);
    expect(download.suggestedFilename()).toBe(name);
    const bytes = await downloadedBytes(download);
    expect(bytes.length).toBe(file.buffer.length);
    expect(sha256(bytes)).toBe(sha256(file.buffer));
  }

  // History records metadata, including the verified checksum.
  await sender.page.goto('./#/activity');
  await sender.page
    .getByRole('link', { name: /5 files/ })
    .first()
    .click();
  await expect(sender.page.getByText('Completed').first()).toBeVisible();
  await expect(sender.page.getByText(`SHA-256 ${sha256(files[0].buffer)}`)).toBeVisible();
});

test('receiver can decline a transfer', async () => {
  await chooseFiles(sender.page, [makeFile('secret.pdf', 1000, 'application/pdf')]);
  await sender.page.getByRole('button', { name: /^Send 1 File/ }).click();
  const dialog = receiver.page.getByRole('dialog', { name: /wants to send you 1 file/ });
  await dialog.getByRole('button', { name: 'Decline' }).click();
  await expect(sender.page.getByText('Test iPad declined the transfer.').first()).toBeVisible();
  await expect(sender.page.getByText('Declined').first()).toBeVisible();
});

test('sender can cancel a transfer in progress', async () => {
  const big = await makeLargeFile(TMP, 'cancel-me.bin', 300 * 1000 * 1000);
  await chooseFilePaths(sender.page, [big.path]);
  await sender.page.getByRole('button', { name: /^Send 1 File/ }).click();
  await receiver.page.getByRole('dialog').getByRole('button', { name: 'Accept' }).click();
  // Wait until bytes are flowing, then cancel.
  await expect(sender.page.getByText(/MB of 300 MB/).first()).toBeVisible({ timeout: 30_000 });
  await sender.page.getByRole('button', { name: 'Cancel transfer' }).first().click();
  await sender.page
    .getByRole('dialog', { name: 'Cancel this transfer?' })
    .getByRole('button', { name: 'Cancel Transfer', exact: true })
    .click();
  await expect(sender.page.getByText('Cancelled').first()).toBeVisible();
  await expect(receiver.page.getByText('Transfer cancelled')).toBeVisible();
  await receiver.page.goto('./#/activity');
  await expect(receiver.page.getByText('Cancelled').first()).toBeVisible();
});

test('text sharing delivers the exact text and the receiver can copy it', async () => {
  const text = 'Meeting notes\nhttps://example.com/agenda?x=1\n  indented code();\n✓ unicode';
  await sender.page.goto('./#/send?mode=text');
  await sender.page.getByLabel('Text to send').fill(text);
  await sender.page.getByRole('button', { name: 'Send Text to Test iPad' }).click();
  await expect(sender.page.getByText('Text sent to Test iPad')).toBeVisible();
  const dialog = receiver.page.getByRole('dialog', { name: 'Text from Test Phone' });
  await expect(dialog).toBeVisible();
  expect(await dialog.locator('pre').textContent()).toBe(text);
});

// Large-file check. Size is configurable: FILESHARE_E2E_LARGE_MB=1000 npx playwright test -g "large file"
test('large file transfers with bounded memory and verified integrity', async () => {
  test.setTimeout(15 * 60_000);
  const mb = Number(process.env.FILESHARE_E2E_LARGE_MB ?? 200);
  const big = await makeLargeFile(TMP, `large-${mb}MB.bin`, mb * 1000 * 1000);
  await chooseFilePaths(sender.page, [big.path]);
  const started = Date.now();
  await sender.page.getByRole('button', { name: /^Send 1 File/ }).click();
  await receiver.page.getByRole('dialog').getByRole('button', { name: 'Accept' }).click();
  await expect(receiver.page.getByText('Received 1 file from Test Phone')).toBeVisible({
    timeout: 14 * 60_000,
  });
  const seconds = (Date.now() - started) / 1000;
  console.log(
    `[large file] ${mb} MB in ${seconds.toFixed(1)} s ≈ ${(mb / seconds).toFixed(1)} MB/s (same machine, loopback)`,
  );

  // Receiver JS heap stays far below the file size (data is written to OPFS, not held in memory).
  const heap = await receiver.page.evaluate(
    () =>
      (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ??
      0,
  );
  console.log(`[large file] receiver JS heap after transfer: ${(heap / 1e6).toFixed(1)} MB`);
  if (heap) expect(heap).toBeLessThan(mb * 1e6 * 0.5);

  await receiver.page.goto('./#/receive');
  const [download] = await Promise.all([
    receiver.page.waitForEvent('download'),
    receiver.page.getByRole('button', { name: `Save large-${mb}MB.bin`, exact: true }).click(),
  ]);
  expect(await sha256OfPath(await download.path())).toBe(big.sha256);
});

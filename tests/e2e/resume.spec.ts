import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  chooseFilePaths,
  makeLargeFile,
  openDevice,
  pair,
  sha256OfPath,
  type Device,
} from './helpers';

const TMP = join(tmpdir(), 'fileshare-e2e');
const SIZE = 150 * 1000 * 1000;

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

async function startTransfer(path: string) {
  await chooseFilePaths(sender.page, [path]);
  await sender.page.getByRole('button', { name: /^Send 1 File/ }).click();
  await receiver.page.getByRole('dialog').getByRole('button', { name: 'Accept' }).click();
  // Let a meaningful amount of data through first.
  await expect(sender.page.getByText(/(\d{2,3}(\.\d)?) MB of 150 MB/).first()).toBeVisible({
    timeout: 60_000,
  });
}

async function resumeFromSender() {
  await sender.page.goto('/#/activity');
  await sender.page.getByRole('button', { name: 'Resume' }).click();
  const dialog = receiver.page.getByRole('dialog', { name: 'Resume transfer from Test Phone?' });
  await expect(dialog).toBeVisible();
  // It must continue from where it stopped, not from zero.
  await expect(dialog.getByText(/MB of 150 MB already received/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Resume' }).click();
  await expect(receiver.page.getByText('Received 1 file from Test Phone')).toBeVisible({
    timeout: 120_000,
  });
}

async function saveAndHash(page: Page, name: string) {
  await page.goto('/#/receive');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: `Save ${name}`, exact: true }).click(),
  ]);
  return sha256OfPath(await download.path());
}

test('disconnect mid-transfer, re-pair, and resume from confirmed progress', async () => {
  const file = await makeLargeFile(TMP, 'resume-disconnect.bin', SIZE);
  await startTransfer(file.path);

  await receiver.page.goto('/#/devices');
  await receiver.page.getByRole('button', { name: 'Disconnect Test Phone' }).click();
  await receiver.page.getByRole('dialog').getByRole('button', { name: 'Disconnect' }).click();
  await expect(sender.page.getByText('Transfer interrupted').first()).toBeVisible();

  // Same devices again: recognised by their pinned certificate fingerprints.
  await pair(receiver, sender, true);
  await resumeFromSender();
  expect(await saveAndHash(receiver.page, 'resume-disconnect.bin')).toBe(file.sha256);
});

test('receiver reloads mid-transfer; partial file survives on disk and the transfer resumes', async () => {
  const file = await makeLargeFile(TMP, 'resume-reload.bin', SIZE);
  await startTransfer(file.path);

  await receiver.page.reload();
  await expect(sender.page.getByText('Transfer interrupted').first()).toBeVisible({
    timeout: 30_000,
  });

  // After the reload the receiver lists the transfer as interrupted.
  await receiver.page.goto('/#/activity');
  await expect(receiver.page.getByText('Interrupted').first()).toBeVisible();

  await pair(receiver, sender, true);
  await resumeFromSender();
  expect(await saveAndHash(receiver.page, 'resume-reload.bin')).toBe(file.sha256);
});

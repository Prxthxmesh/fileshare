import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { chooseFiles, makeFile, openDevice, type Device } from './helpers';

/**
 * Captures every screen for design review: phone (390×844) and iPad
 * (1024×1366 portrait, 1366×1024 landscape), light and dark. Run with
 *   FILESHARE_SCREENSHOTS=1 npx playwright test screens
 * Output: test-results/screens/*.png
 */
test.skip(
  !process.env.FILESHARE_SCREENSHOTS,
  'Set FILESHARE_SCREENSHOTS=1 to capture design screenshots',
);

const OUT = join('test-results', 'screens');
const SIZES = {
  phone: { width: 390, height: 844 },
  ipad: { width: 1024, height: 1366 },
  'ipad-land': { width: 1366, height: 1024 },
};

async function shoot(page: Page, name: string) {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(OUT, `${name}-${scheme}.png`), fullPage: false });
  }
}

let receiver: Device;
let sender: Device;

test('capture screens', async ({ browser }) => {
  test.setTimeout(600_000);
  await mkdir(OUT, { recursive: true });
  receiver = await openDevice(browser, 'Prathamesh’s iPad');
  sender = await openDevice(browser, 'Realme GT 6T');

  for (const [size, viewport] of Object.entries(SIZES)) {
    await receiver.page.setViewportSize(viewport);
    await receiver.page.goto('./#/');
    await shoot(receiver.page, `${size}-01-home-empty`);
    await receiver.page.goto('./#/send');
    await shoot(receiver.page, `${size}-02-send-empty`);
    await receiver.page.goto('./#/receive');
    await shoot(receiver.page, `${size}-03-receive`);
    await receiver.page.goto('./#/pair/show');
    await expect(receiver.page.getByRole('img', { name: /Pairing code/ })).toBeVisible();
    await shoot(receiver.page, `${size}-04-pair-show`);
    await receiver.page.goto('./#/activity');
    await shoot(receiver.page, `${size}-05-activity-empty`);
    await receiver.page.goto('./#/devices');
    await shoot(receiver.page, `${size}-06-devices-empty`);
    await receiver.page.goto('./#/settings');
    await shoot(receiver.page, `${size}-07-settings`);
  }

  // Verification step (signature screen)
  await receiver.page.setViewportSize(SIZES.phone);
  await receiver.page.goto('./#/pair/show');
  await receiver.page.getByRole('button', { name: /Use a text code/ }).click();
  await shoot(receiver.page, 'phone-04b-pair-textcode');
  const offer = await receiver.page.getByLabel('Pairing code as text').inputValue();
  await sender.page.goto('./#/pair/scan');
  await sender.page.getByRole('button', { name: 'Enter code manually' }).click();
  await sender.page.setViewportSize(SIZES.phone);
  await shoot(sender.page, 'phone-04c-pair-scan');
  await sender.page.getByLabel('Pairing code', { exact: true }).fill(offer);
  await sender.page.getByRole('button', { name: 'Continue' }).click();
  await sender.page.getByRole('button', { name: /Use a text code/ }).waitFor();
  await shoot(sender.page, 'phone-04d-pair-reply');
  await sender.page.getByRole('button', { name: /Use a text code/ }).click();
  const answer = await sender.page.getByLabel('Pairing code as text').inputValue();
  await receiver.page.getByRole('button', { name: 'Scan Reply' }).click();
  await receiver.page.getByRole('button', { name: 'Enter code manually' }).click();
  await receiver.page.getByLabel('Pairing code', { exact: true }).fill(answer);
  await receiver.page.getByRole('button', { name: 'Continue' }).click();
  await expect(receiver.page.getByRole('button', { name: 'Codes Match' })).toBeVisible();
  await shoot(receiver.page, 'phone-04e-verify');
  await receiver.page.setViewportSize(SIZES.ipad);
  await shoot(receiver.page, 'ipad-04e-verify');
  await receiver.page.getByRole('button', { name: 'Codes Match' }).click();
  await sender.page.getByRole('button', { name: 'Codes Match' }).click();
  await expect(receiver.page.getByText(/^Connected to Realme/)).toBeVisible();
  await receiver.page.setViewportSize(SIZES.phone);
  await shoot(receiver.page, 'phone-04f-connected');

  // Send with files selected
  await chooseFiles(sender.page, [
    makeFile('IMG_4021.HEIC', 3_200_000, 'image/heic'),
    makeFile('Quarterly report – final.pdf', 1_250_000, 'application/pdf'),
    makeFile('Holiday clip.mov', 18_000_000, 'video/quicktime'),
  ]);
  await shoot(sender.page, 'phone-02b-send-files');
  await sender.page.setViewportSize(SIZES.ipad);
  await shoot(sender.page, 'ipad-02b-send-files');
  await sender.page.setViewportSize(SIZES.phone);
  await sender.page.getByRole('button', { name: /^Send 3 Files/ }).click();
  const dialog = receiver.page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await shoot(receiver.page, 'phone-08-approval');
  await receiver.page.setViewportSize(SIZES.ipad);
  await shoot(receiver.page, 'ipad-08-approval');
  await dialog.getByRole('button', { name: 'Accept' }).click();
  await expect(receiver.page.getByText(/Received 3 files/)).toBeVisible({ timeout: 60_000 });
  await receiver.page.setViewportSize(SIZES.phone);
  await receiver.page.goto('./#/');
  await shoot(receiver.page, 'phone-01b-home-connected');
  await receiver.page.setViewportSize(SIZES.ipad);
  await shoot(receiver.page, 'ipad-01b-home-connected');
  await receiver.page.setViewportSize(SIZES.phone);
  await receiver.page.goto('./#/receive');
  await shoot(receiver.page, 'phone-03b-receive-files');
  await sender.page.goto('./#/activity');
  await shoot(sender.page, 'phone-05b-activity');
  await sender.page
    .getByRole('link', { name: /3 files/ })
    .first()
    .click();
  await shoot(sender.page, 'phone-09-details');
  await receiver.page.goto('./#/devices');
  await shoot(receiver.page, 'phone-06b-devices');

  // In-flight transfer card
  await chooseFiles(sender.page, [makeFile('Big archive.zip', 45_000_000, 'application/zip')]);
  await sender.page.getByRole('button', { name: /^Send 1 File/ }).click();
  await receiver.page.getByRole('dialog').getByRole('button', { name: 'Accept' }).click();
  await sender.page.goto('./#/activity');
  await sender.page.getByRole('button', { name: 'Pause transfer' }).click();
  await shoot(sender.page, 'phone-05c-activity-paused');
  await sender.page.getByRole('button', { name: 'Resume transfer' }).click();

  // Text
  await sender.page.goto('./#/send?mode=text');
  await shoot(sender.page, 'phone-10-text');
  await sender.page.getByLabel('Text to send').fill('https://example.com/agenda');
  await sender.page.getByRole('button', { name: /Send Text/ }).click();
  await expect(receiver.page.getByRole('dialog', { name: /Text from/ })).toBeVisible({
    timeout: 60_000,
  });
  await shoot(receiver.page, 'phone-11-text-received');

  await receiver.page.goto('./#/settings/diagnostics');
  await shoot(receiver.page, 'phone-12-diagnostics');

  await receiver.context.close();
  await sender.context.close();
});

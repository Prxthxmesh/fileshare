import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  expect,
  type Browser,
  type BrowserContext,
  type Download,
  type Page,
} from '@playwright/test';

export interface Device {
  context: BrowserContext;
  page: Page;
}

export async function openDevice(browser: Browser, name: string): Promise<Device> {
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log(`[${name}] pageerror:`, e.message));
  await page.goto('/#/settings');
  const field = page.getByLabel('Device name');
  await field.fill(name);
  await field.blur();
  await expect(page.getByText('Device name saved')).toBeVisible();
  return { context, page };
}

async function readTextCode(page: Page): Promise<string> {
  await page.getByRole('button', { name: /Use a text code/ }).click();
  const code = await page.getByLabel('Pairing code as text').inputValue();
  expect(code).toMatch(/^FS1/);
  return code;
}

async function enterCode(page: Page, code: string) {
  await page.getByRole('button', { name: 'Enter code manually' }).click();
  await page.getByLabel('Pairing code', { exact: true }).fill(code);
  await page.getByRole('button', { name: 'Continue' }).click();
}

/**
 * Full pairing through the UI: receiver shows code → sender enters it and
 * shows a reply → receiver enters the reply → both confirm matching codes.
 */
export async function pair(receiver: Device, sender: Device, expectRecognised = false) {
  await receiver.page.goto('/#/pair/show');
  const offer = await readTextCode(receiver.page);

  await sender.page.goto('/#/pair/scan');
  await enterCode(sender.page, offer);
  await expect(
    sender.page
      .getByText('Reply code for the other device', { exact: false })
      .or(sender.page.getByLabel(/Reply code/)),
  ).toBeVisible();
  const answer = await readTextCode(sender.page);

  await receiver.page.getByRole('button', { name: 'Scan Reply' }).click();
  await enterCode(receiver.page, answer);

  if (expectRecognised) {
    // Both devices verified each other before and present the same DTLS
    // certificate fingerprints, so no code comparison is needed.
    await expect(receiver.page.getByText(/^Connected to Test /)).toBeVisible();
    await expect(sender.page.getByText(/^Connected to Test /)).toBeVisible();
    return;
  }

  const codeA = receiver.page.getByLabel(/^Verification code/);
  const codeB = sender.page.getByLabel(/^Verification code/);
  await expect(codeA).toBeVisible();
  await expect(codeB).toBeVisible();
  const a = await codeA.getAttribute('aria-label');
  const b = await codeB.getAttribute('aria-label');
  expect(a).toMatch(/^Verification code( \d){6}$/);
  expect(a).toBe(b);

  await receiver.page.getByRole('button', { name: 'Codes Match' }).click();
  await sender.page.getByRole('button', { name: 'Codes Match' }).click();
  await expect(receiver.page.getByText(/^Connected to Test /)).toBeVisible();
  await expect(sender.page.getByText(/^Connected to Test /)).toBeVisible();
}

export interface TestFile {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

export function makeFile(
  name: string,
  size: number,
  mimeType = 'application/octet-stream',
): TestFile {
  return { name, mimeType, buffer: size ? randomBytes(size) : Buffer.alloc(0) };
}

export function sha256(buf: Buffer) {
  return createHash('sha256').update(buf).digest('hex');
}

export async function chooseFiles(page: Page, files: TestFile[]) {
  await page.goto('/#/send');
  await page.locator('input[type="file"]').setInputFiles(files);
}

export async function downloadedBytes(download: Download): Promise<Buffer> {
  const path = await download.path();
  return readFile(path);
}

/** Writes a large random file to disk in 8 MiB blocks (never held in memory) and returns its path and SHA-256. */
export async function makeLargeFile(
  dir: string,
  name: string,
  size: number,
): Promise<{ path: string; sha256: string }> {
  const { mkdir, open } = await import('node:fs/promises');
  const { join } = await import('node:path');
  await mkdir(dir, { recursive: true });
  const path = join(dir, name);
  const fh = await open(path, 'w');
  const hash = createHash('sha256');
  const block = 8 * 1024 * 1024;
  try {
    for (let written = 0; written < size; written += block) {
      const chunk = randomBytes(Math.min(block, size - written));
      hash.update(chunk);
      await fh.write(chunk);
    }
  } finally {
    await fh.close();
  }
  return { path, sha256: hash.digest('hex') };
}

export async function sha256OfPath(path: string): Promise<string> {
  const { createReadStream } = await import('node:fs');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path, { highWaterMark: 8 * 1024 * 1024 }))
    hash.update(chunk as Buffer);
  return hash.digest('hex');
}

export async function chooseFilePaths(page: Page, paths: string[]) {
  await page.goto('/#/send');
  await page.locator('input[type="file"]').setInputFiles(paths);
}

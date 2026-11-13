// Rasterizes public/icons/*.svg into the PNG sizes the manifest and iOS need,
// using the Playwright Chromium already installed for tests.
// Usage: npm run icons
import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const jobs = [
  ['public/icons/icon.svg', 'public/icons/icon-192.png', 192],
  ['public/icons/icon.svg', 'public/icons/icon-512.png', 512],
  ['public/icons/icon-maskable.svg', 'public/icons/icon-maskable-512.png', 512],
  // iOS applies its own rounded mask: use the full-bleed variant.
  ['public/icons/icon-maskable.svg', 'public/icons/apple-touch-icon.png', 180],
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [src, out, size] of jobs) {
  const svg = await readFile(src, 'utf8');
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`,
  );
  await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  console.log('wrote', out);
}
await browser.close();

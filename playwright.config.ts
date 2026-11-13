import { defineConfig, devices } from '@playwright/test';

// Set FILESHARE_BASE_URL to test a deployed copy instead of the local build, e.g.
//   $env:FILESHARE_BASE_URL='https://prxthxmesh.github.io/fileshare/'; npx playwright test transfer
const remote = process.env.FILESHARE_BASE_URL;

/**
 * End-to-end tests run the production build. Each test opens two isolated
 * browser contexts — two "devices" with separate storage and identities —
 * that pair through the real UI and transfer over a real WebRTC DataChannel
 * on this machine's loopback/LAN interfaces.
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: remote ?? 'http://localhost:4173',
    acceptDownloads: true,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
        },
      },
    },
  ],
  webServer: remote
    ? undefined
    : {
        command: 'npx vite preview --port 4173 --strictPort',
        url: 'http://localhost:4173',
        reuseExistingServer: true,
        timeout: 60_000,
      },
});

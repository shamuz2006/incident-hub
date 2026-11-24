import { defineConfig } from '@playwright/test'
import { chromiumLaunchOptions } from 'deepspace/testing'

/**
 * Runs specs against the deployed app instead of a local dev server:
 *   npx playwright test -c tests/playwright.prod.config.ts war-room.spec.ts
 * Uses the same @deepspace.test accounts; data created lands in teams only
 * those accounts can see.
 */
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: process.env.PROD_URL ?? 'https://incident-hub.app.space',
    headless: true,
    launchOptions: chromiumLaunchOptions(),
  },
})

import { chromium, FullConfig } from '@playwright/test';

const BASE_URL = 'https://localhost:5173';
const EMAIL = process.env.TESTING_EMAIL?.toString();
const PASSWORD = process.env.TESTING_PASSWORD?.toString();
const STATE_FILE = 'tests/.auth/state.json';

async function globalSetup(_config: FullConfig) {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.goto(BASE_URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('button', { name: 'Sign out' }).waitFor({ timeout: 20000 });

  // Save localStorage + cookies so all tests reuse this session
  await page.context().storageState({ path: STATE_FILE });
  await browser.close();
}

export default globalSetup;

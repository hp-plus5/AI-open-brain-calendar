import { Page } from '@playwright/test';

const BASE_URL = 'https://localhost:5173';
const EMAIL = process.env.TESTING_EMAIL?.toString();
const PASSWORD = process.env.TESTING_PASSWORD?.toString();

/**
 * Navigate to the app and ensure we are logged in.
 * Uses storageState if the session is still valid.
 * Falls back to a fresh sign-in if the session has expired.
 */
export async function goToCalendar(page: Page) {
  await page.goto(BASE_URL);

  // Check if we ended up on the login page (session expired or not loaded)
  const signInBtn = page.getByRole('button', { name: 'Sign in' });
  const signOutBtn = page.getByRole('button', { name: 'Sign out' });

  // Wait up to 8 s for either button to appear
  await Promise.race([
    signOutBtn.waitFor({ timeout: 8000 }).catch(() => {}),
    signInBtn.waitFor({ timeout: 8000 }).catch(() => {}),
  ]);

  if (await signInBtn.isVisible()) {
    // Session not restored – sign in fresh
    await page.getByLabel('Email').fill(EMAIL);
    await page.getByLabel('Password').fill(PASSWORD);
    await signInBtn.click();
    await signOutBtn.waitFor({ timeout: 20000 });
  } else {
    await signOutBtn.waitFor({ timeout: 10000 });
  }
}

/**
 * Navigate to a specific month/year using the prev/next buttons.
 */
export async function navigateToMonth(page: Page, targetYear: number, targetMonthName: string) {
  const heading = page.locator('.fc-toolbar-title');
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const targetMonthIdx = monthNames.indexOf(targetMonthName);

  for (let i = 0; i < 200; i++) {
    const text = await heading.textContent() ?? '';
    if (text.includes(targetMonthName) && text.includes(String(targetYear))) return;

    const currentMonthIdx = monthNames.findIndex(m => text.includes(m));
    const currentYearMatch = text.match(/\d{4}/);
    const currentYear = currentYearMatch ? parseInt(currentYearMatch[0]) : targetYear;

    const currentTotal = currentYear * 12 + currentMonthIdx;
    const targetTotal = targetYear * 12 + targetMonthIdx;

    if (targetTotal > currentTotal) {
      await page.locator('.fc-next-button').click();
    } else {
      await page.locator('.fc-prev-button').click();
    }
  }
}

// Alias for backward compat
export async function signIn(page: Page) {
  await goToCalendar(page);
}

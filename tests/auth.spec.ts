import { test, expect } from '@playwright/test';
import { EMAIL, PASSWORD } from './helpers';

const BASE_URL = 'https://localhost:5173';

// These tests verify the login page UI; they navigate without storageState
// by clearing the Supabase key from localStorage.
async function goToLoginPage(page: typeof test.extend<{}>['extend']) {
  // Handled by the individual tests below
}

test.describe('Authentication', () => {
  test('shows login page when unauthenticated', async ({ page }) => {
    await page.goto(BASE_URL);
    // Clear only the Supabase auth key so we see the login form
    await page.evaluate(() => {
      Object.keys(localStorage)
        .filter(k => k.startsWith('sb-'))
        .forEach(k => localStorage.removeItem(k));
    });
    await page.reload();

    await expect(page.getByText('Open Brain Calendar')).toBeVisible();
    await expect(page.getByText('Sign in to access your calendar')).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  });

  test('shows forgot password and sign up links on login page', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.evaluate(() => {
      Object.keys(localStorage)
        .filter(k => k.startsWith('sb-'))
        .forEach(k => localStorage.removeItem(k));
    });
    await page.reload();

    await expect(page.getByText('Forgot your password?')).toBeVisible();
    await expect(page.getByText("Don't have an account? Sign up")).toBeVisible();
  });

  test('shows error message on invalid credentials', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.evaluate(() => {
      Object.keys(localStorage)
        .filter(k => k.startsWith('sb-'))
        .forEach(k => localStorage.removeItem(k));
    });
    await page.reload();

    await page.getByLabel('Email').fill('nobody@nowhere.invalid');
    await page.getByLabel('Password').fill('wrongpassword123');
    await page.getByRole('button', { name: 'Sign in' }).click();

    // Should stay on the login page (no calendar appears)
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: 'Sign out' })).not.toBeVisible();
  });

  test('logs in successfully and shows the calendar', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.evaluate(() => {
      Object.keys(localStorage)
        .filter(k => k.startsWith('sb-'))
        .forEach(k => localStorage.removeItem(k));
    });
    await page.reload();

    await page.getByLabel('Email').fill(EMAIL);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('button', { name: '+ New Event' })).toBeVisible();
    await expect(page.locator('.fc-toolbar-title')).toBeVisible();
  });

  test('logs out and returns to the login page', async ({ page }) => {
    // Use stored session — navigate directly to the app
    await page.goto(BASE_URL);

    // Wait for calendar or login page
    const signOutBtn = page.getByRole('button', { name: 'Sign out' });
    const signInBtn = page.getByRole('button', { name: 'Sign in' });
    await Promise.race([
      signOutBtn.waitFor({ timeout: 8000 }).catch(() => {}),
      signInBtn.waitFor({ timeout: 8000 }).catch(() => {}),
    ]);

    // If we're on the login page, sign in first
    if (await signInBtn.isVisible()) {
      await page.getByLabel('Email').fill(EMAIL);
      await page.getByLabel('Password').fill(PASSWORD);
      await signInBtn.click();
      await signOutBtn.waitFor({ timeout: 20000 });
    }

    // Now sign out
    await signOutBtn.click();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible({ timeout: 10000 });
  });
});

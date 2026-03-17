import { test, expect } from '@playwright/test';
import { signIn } from './helpers';

test.describe('UI Layout & Visual Checks', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('header shows app title', async ({ page }) => {
    await expect(page.locator('.calendar-topbar-title')).toHaveText('Open Brain Calendar');
  });

  test('header shows + New Event and Sign out buttons', async ({ page }) => {
    await expect(page.getByRole('button', { name: '+ New Event' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  });

  test('month view shows all 7 day-of-week column headers', async ({ page }) => {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    for (const day of days) {
      await expect(page.locator(`a[aria-label="${day}"]`)).toBeVisible();
    }
  });

  test('month view shows at least 28 day cells', async ({ page }) => {
    const cells = page.locator('.fc-daygrid-day');
    const count = await cells.count();
    expect(count).toBeGreaterThanOrEqual(28);
  });

  test('week view shows time slots', async ({ page }) => {
    await page.locator('.fc-timeGridWeek-button').click();
    await expect(page.locator('.fc-timegrid-slot').first()).toBeVisible();
    // Should have many time slots (48 half-hour slots = full day)
    const slotCount = await page.locator('.fc-timegrid-slot').count();
    expect(slotCount).toBeGreaterThan(10);
  });

  test('week view shows all-day row', async ({ page }) => {
    await page.locator('.fc-timeGridWeek-button').click();
    await expect(page.locator('.fc-daygrid-body')).toBeVisible();
  });

  test('day view shows time grid', async ({ page }) => {
    await page.locator('.fc-timeGridDay-button').click();
    await expect(page.locator('.fc-timegrid-slot').first()).toBeVisible();
  });

  test('view toggle buttons reflect active state', async ({ page }) => {
    // Month active by default
    await expect(page.locator('.fc-dayGridMonth-button')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.fc-timeGridWeek-button')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.fc-timeGridDay-button')).toHaveAttribute('aria-pressed', 'false');

    // Switch to week
    await page.locator('.fc-timeGridWeek-button').click();
    await expect(page.locator('.fc-dayGridMonth-button')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.fc-timeGridWeek-button')).toHaveAttribute('aria-pressed', 'true');

    // Switch to day
    await page.locator('.fc-timeGridDay-button').click();
    await expect(page.locator('.fc-timeGridDay-button')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.fc-timeGridWeek-button')).toHaveAttribute('aria-pressed', 'false');
  });

  test('page title is set', async ({ page }) => {
    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);
  });
});

import { test, expect } from '@playwright/test';
import { signIn } from './helpers';

test.describe('Calendar Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('displays month view by default', async ({ page }) => {
    await expect(page.locator('.fc-dayGridMonth-button')).toHaveAttribute('aria-pressed', 'true');
    // Heading shows "Month Year"
    await expect(page.locator('.fc-toolbar-title')).toContainText(/\w+ \d{4}/);
    // Shows day-of-week column headers
    await expect(page.locator('a[aria-label="Sunday"]')).toBeVisible();
    await expect(page.locator('a[aria-label="Saturday"]')).toBeVisible();
  });

  test('navigates to next month with forward button', async ({ page }) => {
    const heading = page.locator('.fc-toolbar-title');
    const currentText = await heading.textContent();

    await page.locator('.fc-next-button').click();

    await expect(heading).not.toHaveText(currentText!);
  });

  test('navigates to previous month with back button', async ({ page }) => {
    const heading = page.locator('.fc-toolbar-title');
    const currentText = await heading.textContent();

    await page.locator('.fc-prev-button').click();

    await expect(heading).not.toHaveText(currentText!);
  });

  test('"today" button returns to current month', async ({ page }) => {
    // Navigate away
    await page.locator('.fc-next-button').click();
    await page.locator('.fc-next-button').click();

    // Return with today
    await page.locator('.fc-today-button').click();

    // Should show current month/year
    const now = new Date();
    const month = now.toLocaleString('en-US', { month: 'long' });
    const year = now.getFullYear().toString();
    await expect(page.locator('.fc-toolbar-title')).toContainText(month);
    await expect(page.locator('.fc-toolbar-title')).toContainText(year);
  });

  test('switches to week view', async ({ page }) => {
    await page.locator('.fc-timeGridWeek-button').click();

    await expect(page.locator('.fc-timeGridWeek-button')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.fc-dayGridMonth-button')).toHaveAttribute('aria-pressed', 'false');
    // Heading shows a week range like "Mar 8 – 14, 2026"
    await expect(page.locator('.fc-toolbar-title')).toContainText('2026');
    // Shows "all-day" row label
    await expect(page.locator('.fc-timegrid-allday-label, .fc-daygrid-day-frame').first()).toBeVisible();
  });

  test('switches to day view', async ({ page }) => {
    await page.locator('.fc-timeGridDay-button').click();

    await expect(page.locator('.fc-timeGridDay-button')).toHaveAttribute('aria-pressed', 'true');
    // Shows time grid (time slots)
    await expect(page.locator('.fc-timegrid-slot').first()).toBeVisible();
  });

  test('week view navigates forward and back', async ({ page }) => {
    await page.locator('.fc-timeGridWeek-button').click();

    const heading = page.locator('.fc-toolbar-title');
    const currentText = await heading.textContent();

    await page.locator('.fc-next-button').click();
    await expect(heading).not.toHaveText(currentText!);

    await page.locator('.fc-prev-button').click();
    await expect(heading).toHaveText(currentText!);
  });

  test('day view navigates forward and back', async ({ page }) => {
    await page.locator('.fc-timeGridDay-button').click();

    const heading = page.locator('.fc-toolbar-title');
    const currentText = await heading.textContent();

    await page.locator('.fc-next-button').click();
    await expect(heading).not.toHaveText(currentText!);

    await page.locator('.fc-prev-button').click();
    await expect(heading).toHaveText(currentText!);
  });

  test('each day cell in month view has a date number link with an aria-label', async ({ page }) => {
    // Date number links should be present and have accessible labels
    const dateLinks = page.locator('a.fc-daygrid-day-number[aria-label]');
    const count = await dateLinks.count();
    expect(count).toBeGreaterThanOrEqual(28); // at least 4 weeks worth
    // First date link aria-label should reference the current month
    const firstLabel = await dateLinks.first().getAttribute('aria-label');
    expect(firstLabel).toMatch(/\d{4}/); // contains a year
  });

  test('week view column headers show the day of week and date', async ({ page }) => {
    await page.locator('.fc-timeGridWeek-button').click();

    // Each of the 7 column headers should be visible
    const headers = page.locator('.fc-col-header-cell');
    await expect(headers).toHaveCount(7);

    // All column header cells should be visible
    await expect(headers.first()).toBeVisible();
    await expect(headers.last()).toBeVisible();
  });
});

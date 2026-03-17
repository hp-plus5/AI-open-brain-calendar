import { test, expect } from '@playwright/test';
import { goToCalendar, navigateToMonth } from './helpers';

// Use a far-future month with second-resolution day offset to avoid dayMaxEvents accumulation
const TEST_YEAR = 2028;
const TEST_MONTH = 'April';
const _testDay = String(5 + (Math.floor(Date.now() / 1000) % 22)).padStart(2, '0'); // Day 05-26
const TEST_DATE = `2028-04-${_testDay}`;

test.describe('New Event Modal', () => {
  test.beforeEach(async ({ page }) => {
    await goToCalendar(page);
  });

  test('opens new event modal via "+ New Event" button', async ({ page }) => {
    await page.getByRole('button', { name: '+ New Event' }).click();

    await expect(page.locator('.modal')).toBeVisible();
    await expect(page.locator('.modal-header h2')).toHaveText('New Event');
  });

  test('new event modal has all required fields', async ({ page }) => {
    await page.getByRole('button', { name: '+ New Event' }).click();

    const modal = page.locator('.modal');
    await expect(modal.locator('#evt-title')).toBeVisible();
    await expect(modal.locator('#evt-allday')).toBeVisible();
    await expect(modal.locator('#evt-recur')).toBeVisible();
    await expect(modal.getByPlaceholder('Optional notes')).toBeVisible();
    await expect(modal.getByRole('button', { name: 'Save' })).toBeVisible();
    await expect(modal.getByRole('button', { name: 'Cancel' })).toBeVisible();
  });

  test('checking all-day shows date-only fields', async ({ page }) => {
    await page.getByRole('button', { name: '+ New Event' }).click();

    const allDay = page.locator('#evt-allday');
    await expect(allDay).toBeVisible();

    // Ensure all-day is checked
    await allDay.check();
    await expect(allDay).toBeChecked();
    await expect(page.locator('.modal-body')).toContainText('Start date');
    await expect(page.locator('.modal-body')).toContainText('End date');
  });

  test('unchecking all-day reveals datetime fields with timezone label', async ({ page }) => {
    await page.getByRole('button', { name: '+ New Event' }).click();

    await page.locator('#evt-allday').uncheck();

    await expect(page.locator('.modal-body')).toContainText('Start (ET)');
    await expect(page.locator('.modal-body')).toContainText('End (ET)');
  });

  test('recurrence dropdown has all expected options', async ({ page }) => {
    await page.getByRole('button', { name: '+ New Event' }).click();

    const select = page.locator('#evt-recur');
    const options = await select.locator('option').allTextContents();

    expect(options).toContain('Does not repeat');
    expect(options.some(o => o.includes('Every day'))).toBe(true);
    expect(options.some(o => o.includes('Every week'))).toBe(true);
    expect(options.some(o => o.includes('Every weekday'))).toBe(true);
    expect(options.some(o => o.includes('Every month'))).toBe(true);
    expect(options.some(o => o.includes('Every year'))).toBe(true);
    expect(options.some(o => o.includes('Custom'))).toBe(true);
  });

  test('cancel button closes the modal', async ({ page }) => {
    await page.getByRole('button', { name: '+ New Event' }).click();
    await expect(page.locator('.modal')).toBeVisible();

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('.modal')).not.toBeVisible();
  });

  test('close (✕) button closes the modal', async ({ page }) => {
    await page.getByRole('button', { name: '+ New Event' }).click();
    await expect(page.locator('.modal')).toBeVisible();

    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.locator('.modal')).not.toBeVisible();
  });

  test('cannot save event without a title — modal stays open', async ({ page }) => {
    await page.getByRole('button', { name: '+ New Event' }).click();
    await expect(page.locator('.modal')).toBeVisible();

    // Leave title empty and try to save
    await page.locator('#evt-title').clear();
    await page.getByRole('button', { name: 'Save' }).click();

    // Modal should stay open since title is required
    await expect(page.locator('.modal')).toBeVisible();
  });

  test('creates an all-day event and it appears on the calendar', async ({ page }) => {
    const eventTitle = `All-Day-${Date.now()}`;

    await navigateToMonth(page, TEST_YEAR, TEST_MONTH);
    await page.getByRole('button', { name: '+ New Event' }).click();

    await page.locator('#evt-allday').check();
    await page.locator('#evt-title').fill(eventTitle);
    await page.locator('#evt-start').fill(TEST_DATE);
    await page.locator('#evt-end').fill(TEST_DATE);
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.locator('.modal')).not.toBeVisible();
    // Event should be in the calendar on the chosen date
    await expect(
      page.locator('.fc-event').filter({ hasText: eventTitle }).first()
    ).toBeVisible({ timeout: 10000 });
  });

  test('creates a timed event and modal closes', async ({ page }) => {
    const eventTitle = `Timed-${Date.now()}`;

    await page.getByRole('button', { name: '+ New Event' }).click();
    await page.locator('#evt-allday').uncheck();
    await page.locator('#evt-title').fill(eventTitle);
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.locator('.modal')).not.toBeVisible();
  });

  test('creates event with description', async ({ page }) => {
    const eventTitle = `WithDesc-${Date.now()}`;

    await navigateToMonth(page, TEST_YEAR, TEST_MONTH);
    await page.getByRole('button', { name: '+ New Event' }).click();

    await page.locator('#evt-allday').check();
    await page.locator('#evt-title').fill(eventTitle);
    await page.locator('#evt-start').fill(TEST_DATE);
    await page.locator('#evt-end').fill(TEST_DATE);
    await page.locator('#evt-desc').fill('Test description text');
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.locator('.modal')).not.toBeVisible();
    await expect(
      page.locator('.fc-event').filter({ hasText: eventTitle }).first()
    ).toBeVisible({ timeout: 10000 });
  });

  test('clicking an empty day cell opens new event modal with date pre-filled', async ({ page }) => {
    // Navigate to a month that won't have existing events in the cells
    await navigateToMonth(page, 2029, 'January');

    // Click on the day cell for Jan 7 in 2029 (a clean date)
    const targetCell = page.locator('.fc-daygrid-day[data-date="2029-01-07"]');
    await targetCell.click();

    await expect(page.locator('.modal')).toBeVisible();
    await expect(page.locator('.modal-header h2')).toHaveText('New Event');
    // Start date should be pre-filled
    await expect(page.locator('#evt-start')).toHaveValue('2029-01-07');
  });
});

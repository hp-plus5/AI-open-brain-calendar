import { test, expect } from '@playwright/test';
import { goToCalendar, navigateToMonth } from './helpers';

// Each test uses a unique far-future month with a second-resolution day offset to
// minimise event accumulation from prior runs causing dayMaxEvents overflow.
const MONTHS = ['May', 'June', 'July', 'August', 'September', 'October'];
let monthIdx = 0;
function nextTestMonth() {
  const m = MONTHS[monthIdx % MONTHS.length];
  const monthNum = String(MONTHS.indexOf(m) + 5).padStart(2, '0');
  // Day 05-26: changes every second so successive runs use different days
  const day = String(5 + (Math.floor(Date.now() / 1000) % 22)).padStart(2, '0');
  monthIdx++;
  return { year: 2028, month: m, date: `2028-${monthNum}-${day}` };
}

test.describe('Event Management', () => {
  test.beforeEach(async ({ page }) => {
    await goToCalendar(page);
  });

  test('clicking an existing event opens the event edit modal', async ({ page }) => {
    const { year, month, date } = nextTestMonth();
    const eventTitle = `ClickTest-${Date.now()}`;

    await navigateToMonth(page, year, month);
    await page.getByRole('button', { name: '+ New Event' }).click();
    await page.locator('#evt-allday').check();
    await page.locator('#evt-title').fill(eventTitle);
    await page.locator('#evt-start').fill(date);
    await page.locator('#evt-end').fill(date);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('.modal')).not.toBeVisible();

    await expect(
      page.locator('.fc-event').filter({ hasText: eventTitle }).first()
    ).toBeVisible({ timeout: 10000 });

    // Click the event — should open edit modal
    await page.locator('.fc-event').filter({ hasText: eventTitle }).first().click();
    await expect(page.locator('.modal')).toBeVisible();
    await expect(page.locator('.modal-header h2')).toHaveText('Edit Event');
    // Event title should be pre-filled
    await expect(page.locator('#evt-title')).toHaveValue(eventTitle);
    await page.getByRole('button', { name: 'Cancel' }).click();
  });

  test('can edit an existing event title', async ({ page }) => {
    const { year, month, date } = nextTestMonth();
    const originalTitle = `EditMe-${Date.now()}`;
    const updatedTitle = `Edited-${Date.now() + 1}`;

    await navigateToMonth(page, year, month);
    await page.getByRole('button', { name: '+ New Event' }).click();
    await page.locator('#evt-allday').check();
    await page.locator('#evt-title').fill(originalTitle);
    await page.locator('#evt-start').fill(date);
    await page.locator('#evt-end').fill(date);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('.modal')).not.toBeVisible();
    await expect(
      page.locator('.fc-event').filter({ hasText: originalTitle }).first()
    ).toBeVisible({ timeout: 10000 });

    // Open and edit
    await page.locator('.fc-event').filter({ hasText: originalTitle }).first().click();
    await expect(page.locator('.modal')).toBeVisible();
    await expect(page.locator('.modal-header h2')).toHaveText('Edit Event');
    await page.locator('#evt-title').clear();
    await page.locator('#evt-title').fill(updatedTitle);
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.locator('.modal')).not.toBeVisible();
    await expect(
      page.locator('.fc-event').filter({ hasText: updatedTitle }).first()
    ).toBeVisible({ timeout: 10000 });
    await expect(
      page.locator('.fc-event').filter({ hasText: originalTitle })
    ).toHaveCount(0);
  });

  test('event modal shows a delete button for existing events', async ({ page }) => {
    const { year, month, date } = nextTestMonth();
    const eventTitle = `HasDelete-${Date.now()}`;

    await navigateToMonth(page, year, month);
    await page.getByRole('button', { name: '+ New Event' }).click();
    await page.locator('#evt-allday').check();
    await page.locator('#evt-title').fill(eventTitle);
    await page.locator('#evt-start').fill(date);
    await page.locator('#evt-end').fill(date);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(
      page.locator('.fc-event').filter({ hasText: eventTitle }).first()
    ).toBeVisible({ timeout: 10000 });

    await page.locator('.fc-event').filter({ hasText: eventTitle }).first().click();
    await expect(page.locator('.modal')).toBeVisible();
    // Delete button should be visible for existing events
    await expect(page.locator('.btn-danger')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
  });

  test('can delete an existing event', async ({ page }) => {
    const { year, month, date } = nextTestMonth();
    const eventTitle = `DeleteMe-${Date.now()}`;

    await navigateToMonth(page, year, month);
    await page.getByRole('button', { name: '+ New Event' }).click();
    await page.locator('#evt-allday').check();
    await page.locator('#evt-title').fill(eventTitle);
    await page.locator('#evt-start').fill(date);
    await page.locator('#evt-end').fill(date);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(
      page.locator('.fc-event').filter({ hasText: eventTitle }).first()
    ).toBeVisible({ timeout: 10000 });

    // Open and delete
    await page.locator('.fc-event').filter({ hasText: eventTitle }).first().click();
    await expect(page.locator('.modal')).toBeVisible();

    page.on('dialog', dialog => dialog.accept());
    await page.locator('.btn-danger').click();

    // Event disappears
    await expect(page.locator('.modal')).not.toBeVisible({ timeout: 10000 });
    await expect(
      page.locator('.fc-event').filter({ hasText: eventTitle })
    ).toHaveCount(0, { timeout: 10000 });
  });

  test('recurring event appears on multiple weeks after creation', async ({ page }) => {
    const { year, month, date } = nextTestMonth();
    const eventTitle = `Recurring-${Date.now()}`;

    await navigateToMonth(page, year, month);
    await page.getByRole('button', { name: '+ New Event' }).click();
    await page.locator('#evt-allday').check();
    await page.locator('#evt-title').fill(eventTitle);
    await page.locator('#evt-start').fill(date);
    await page.locator('#evt-end').fill(date);
    // Select "Every week on <day>"
    await page.locator('#evt-recur').selectOption({ index: 2 });
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('.modal')).not.toBeVisible();

    // Should appear in current month
    await expect(
      page.locator('.fc-event').filter({ hasText: eventTitle }).first()
    ).toBeVisible({ timeout: 10000 });

    // Should also appear in the next month
    await page.locator('.fc-next-button').click();
    await expect(
      page.locator('.fc-event').filter({ hasText: eventTitle }).first()
    ).toBeVisible({ timeout: 5000 });
  });

  test('event description is saved on creation and visible when reopened', async ({ page }) => {
    const { year, month, date } = nextTestMonth();
    const eventTitle = `WithDesc-${Date.now()}`;
    const description = 'Persistent description text';

    await navigateToMonth(page, year, month);
    await page.getByRole('button', { name: '+ New Event' }).click();
    await page.locator('#evt-allday').check();
    await page.locator('#evt-title').fill(eventTitle);
    await page.locator('#evt-start').fill(date);
    await page.locator('#evt-end').fill(date);
    // Fill description during initial creation
    await page.locator('#evt-desc').fill(description);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(
      page.locator('.fc-event').filter({ hasText: eventTitle }).first()
    ).toBeVisible({ timeout: 10000 });

    // Reopen the event and verify description is pre-filled
    await page.locator('.fc-event').filter({ hasText: eventTitle }).first().click();
    await expect(page.locator('.modal')).toBeVisible();
    await expect(page.locator('.modal-header h2')).toHaveText('Edit Event');
    await expect(page.locator('#evt-desc')).toHaveValue(description);
    await page.getByRole('button', { name: 'Cancel' }).click();
  });
});

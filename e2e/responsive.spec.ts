import { test, expect } from '@playwright/test';

test.describe('Epoch Dashboard Responsive Design Tests', () => {
  test('should render properly on desktop viewports', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');

    // Check main elements
    await expect(page.locator('header')).toBeVisible();
    await expect(page.getByText('SWITCH MONITOR')).toBeVisible();
    await expect(page.getByText('SEALED INHERITANCE VAULT')).toBeVisible();
  });

  test('should render properly on mobile viewports', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');

    // Check header logo and vault are still visible and stacked
    await expect(page.locator('header').getByText('EPOCH')).toBeVisible();
    await expect(page.getByText('SWITCH MONITOR')).toBeVisible();
    await expect(page.getByText('SEALED INHERITANCE VAULT')).toBeVisible();
  });
});

import { test, expect } from '@playwright/test';

test.describe('Epoch Demo Mode Smoke Tests', () => {
  test('should load the dashboard successfully with metadata', async ({ page }) => {
    // Open the home page
    await page.goto('/');

    // Check title
    await expect(page).toHaveTitle(/Epoch/);

    // Check header logo
    const headerLogo = page.locator('header').getByText('EPOCH');
    await expect(headerLogo).toBeVisible();

    // Check TEE Status Badge
    const statusBadge = page.getByText('INTEL TDX HARNESS OK');
    await expect(statusBadge).toBeVisible();
  });
});

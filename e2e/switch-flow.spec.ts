import { test, expect } from '@playwright/test';

test.describe('Epoch Dead-Man\'s Switch Lifecycle Flow', () => {
  test('should go through the full heartbeat and trigger sequence', async ({ page }) => {
    // 1. Load dashboard and reset database to clean state
    await page.goto('/');
    
    const resetButton = page.getByRole('button', { name: 'RESET SWITCH & SEED DATA' });
    await expect(resetButton).toBeVisible();
    await resetButton.click();

    // Verify initial state is active
    const statusPill = page.locator('div').filter({ hasText: /^(active|armed)$/i }).first();
    await expect(statusPill).toBeVisible();

    // Verify empty state is visible initially
    await expect(page.getByText('Vault is empty')).toBeVisible();

    // Test: Download example file
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'DOWNLOAD EXAMPLE FILE' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('epoch_example_secret.txt');

    // Test: Upload immediate example
    await page.getByRole('button', { name: 'UPLOAD IMMEDIATE EXAMPLE' }).click();
    await expect(page.getByText('epoch_example_secret.txt')).toBeVisible();
    await expect(page.getByText('Vault is empty')).not.toBeVisible();

    // Test: Manual file upload via input
    await page.locator('#file-upload-input').setInputFiles({
      name: 'user_uploaded_file.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('hello world')
    });
    await expect(page.getByText('user_uploaded_file.txt')).toBeVisible();

    // 2. Heartbeat submission
    // Get the debug OTP value shown on the TimeWarpPanel debug panel
    // We can open the heartbeat modal and click autofill
    const heartbeatButton = page.getByRole('button', { name: 'SEND HEARTBEAT (OTP)' });
    await expect(heartbeatButton).toBeVisible();
    await heartbeatButton.click();

    // Verify modal opened
    await expect(page.getByText('SUBMIT HEARTBEAT CODE')).toBeVisible();

    // Click autofill in modal
    const autofillButton = page.getByRole('button', { name: 'AUTOFILL' });
    await expect(autofillButton).toBeVisible();

    // Wait for the simulated OTP to be loaded (not 000000) inside the modal
    const modal = page.locator('div.fixed');
    const otpValue = modal.locator('span.tracking-widest');
    await expect(otpValue).not.toHaveText('000000');
    const otpText = (await otpValue.textContent())?.trim() || '';
    console.log(`E2E Debug: Read OTP value: "${otpText}"`);

    // Directly fill the input inside the modal
    const input = modal.locator('input[placeholder="000000"]');
    await expect(input).toBeVisible();
    await input.fill(otpText);
    console.log(`E2E Debug: Filled input with: "${otpText}"`);

    // Click submit
    const submitButton = page.getByRole('button', { name: 'VERIFY HEARTBEAT' });
    await expect(submitButton).toBeVisible();
    await submitButton.click();

    // Log modal error message if any
    const errorLocator = page.locator('form div.text-red-500');
    if (await errorLocator.isVisible()) {
      const errorMsg = await errorLocator.textContent();
      console.log(`E2E Debug: Heartbeat verification failed with error: "${errorMsg}"`);
    }

    // Modal should close and status remain active
    await expect(page.getByText('SUBMIT HEARTBEAT CODE')).not.toBeVisible();
    await expect(statusPill).toBeVisible();

    // 3. Time Warp Expiration
    // Drag slider or set the range input value to 15 days
    const timeSlider = page.locator('#time-warp-slider');
    await timeSlider.fill('15');

    // Click force trigger evaluation to run check-trigger route
    const forceTriggerButton = page.getByRole('button', { name: 'FORCE TRIGGER EVALUATION' });
    await expect(forceTriggerButton).toBeVisible();
    await forceTriggerButton.click();
    
    // Check status pill updates to expired
    const expiredPill = page.locator('div').filter({ hasText: /^expired$/ }).first();
    await expect(expiredPill).toBeVisible();

    // 4. Trigger Atomic Cascade
    const triggerButton = page.getByRole('button', { name: 'TRIGGER ATOMIC CASCADE' });
    await expect(triggerButton).toBeVisible();
    await triggerButton.click();

    // Verify status updates to fired
    const firedPill = page.locator('div').filter({ hasText: /^fired$/ }).first();
    await expect(firedPill).toBeVisible();

    // Verify VC receipt is displayed
    await expect(page.getByText('ENCLAVE VC RECEIPT')).toBeVisible();

    // Test: Download decrypted files
    const decryptedDownloadPromise1 = page.waitForEvent('download');
    await page.locator('a[title="Download Decrypted File"]').first().click();
    const decryptedDownload1 = await decryptedDownloadPromise1;
    expect(decryptedDownload1.suggestedFilename()).toBe('epoch_example_secret.txt');

    const decryptedDownloadPromise2 = page.waitForEvent('download');
    await page.locator('a[title="Download Decrypted File"]').nth(1).click();
    const decryptedDownload2 = await decryptedDownloadPromise2;
    expect(decryptedDownload2.suggestedFilename()).toBe('user_uploaded_file.txt');
  });
});

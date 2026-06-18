
import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';

async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function recordWalkthrough() {
  console.log('Starting Epoch UI Walkthrough Recorder via Playwright...');
  const outputDir = path.resolve(process.cwd(), 'docs/assets/screenshots');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });

  // Step 1: Open app
  console.log('Loading dashboard...');
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  await page.screenshot({ path: path.join(outputDir, '01_dashboard_loaded.png') });

  // Step 2: Reset switch to seeded active state
  console.log('Resetting database...');
  await page.click('text=RESET SWITCH & SEED DATA');
  await delay(1000);
  await page.screenshot({ path: path.join(outputDir, '02_database_seeded.png') });

  // Step 3: Click Heartbeat OTP modal
  console.log('Opening heartbeat modal...');
  await page.click('text=SEND HEARTBEAT (OTP)');
  await delay(1000);
  await page.screenshot({ path: path.join(outputDir, '03_heartbeat_modal.png') });

  // Step 4: Autofill OTP and verify
  console.log('Autofilling code and verifying heartbeat...');
  await page.click('text=AUTOFILL');
  await delay(500);
  await page.screenshot({ path: path.join(outputDir, '04_heartbeat_autofilled.png') });
  await page.click('text=VERIFY HEARTBEAT');
  await delay(1500);
  await page.screenshot({ path: path.join(outputDir, '05_heartbeat_verified.png') });

  // Step 5: Simulate Expiration
  console.log('Warping time to +15 Days...');
  await page.fill('#time-warp-slider', '15');
  await delay(1000);
  await page.click('text=FORCE TRIGGER EVALUATION');
  await delay(1000);
  await page.screenshot({ path: path.join(outputDir, '06_switch_expired.png') });

  // Step 6: Trigger atomic cascade
  console.log('Triggering digital legacy cascade...');
  await page.click('text=TRIGGER ATOMIC CASCADE');
  await delay(2000);
  await page.screenshot({ path: path.join(outputDir, '07_cascade_success.png') });

  // Step 7: Toggle failure step and show rollback
  console.log('Simulating cascade failure step 1...');
  await page.click('text=RESET SWITCH & SEED DATA');
  await delay(1000);
  await page.selectOption('select', '1'); // Select Step 1: Egress Notification Fail
  await page.fill('#time-warp-slider', '15');
  await delay(500);
  await page.click('text=FORCE TRIGGER EVALUATION');
  await delay(500);
  await page.click('text=TRIGGER ATOMIC CASCADE');
  await delay(2000);
  await page.screenshot({ path: path.join(outputDir, '08_cascade_rollback.png') });

  console.log('UI walkthrough screens recorded successfully to docs/assets/screenshots/');
  await browser.close();
}

recordWalkthrough().catch(console.error);

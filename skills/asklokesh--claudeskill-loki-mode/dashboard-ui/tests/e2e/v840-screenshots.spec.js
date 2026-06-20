// @ts-check
// v7.84.0 enterprise dashboard overhaul - screenshot pass across all views in
// light + dark. Captures into artifacts/dashboard-preview/screens/ for review.
// Run with the dashboard served at 127.0.0.1:57374 (seeded .loki fixture).
import { test } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '../../../artifacts/dashboard-preview/screens');

// All nav sections (data-section ids preserved through the IA restructure).
const SECTIONS = [
  'overview', 'fleet', 'insights', 'prd-checklist', 'app-runner', 'council',
  'quality', 'cost', 'trust', 'checkpoint', 'context', 'notifications',
  'migration', 'analytics', 'escalations', 'wiki',
];

const THEMES = ['light', 'dark'];

test.describe('v7.84.0 dashboard screenshots', () => {
  test.setTimeout(120000);

  for (const theme of THEMES) {
    test(`all views - ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto('/', { waitUntil: 'networkidle' });

      await page.evaluate((t) => {
        try { localStorage.setItem('loki-theme', t); } catch (e) {}
        try { localStorage.setItem('loki-active-section', 'overview'); } catch (e) {}
      }, theme);
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForTimeout(1000);

      await page.screenshot({
        path: path.join(OUT, `${theme}-00-overview-full.png`),
        fullPage: true,
      });

      for (let i = 0; i < SECTIONS.length; i++) {
        const sec = SECTIONS[i];
        const nav = page.locator(`.nav-link[data-section="${sec}"]`).first();
        if (await nav.count() === 0) continue;
        await nav.click().catch(() => {});
        await page.waitForTimeout(2500);
        const n = String(i + 1).padStart(2, '0');
        await page.screenshot({
          path: path.join(OUT, `${theme}-${n}-${sec}.png`),
          fullPage: false,
        });
      }
    });
  }
});

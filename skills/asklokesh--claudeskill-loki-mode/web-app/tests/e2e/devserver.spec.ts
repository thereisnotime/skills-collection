import { test, expect } from '@playwright/test';

// ============================================================================
// Dev Server E2E Tests
// ============================================================================

test.describe('Dev Server / Preview Panel', () => {
  let sessionId: string;

  test.beforeAll(async ({ request }) => {
    const res = await request.get('/api/sessions/history');
    const sessions = await res.json();
    if (sessions.length > 0) {
      sessionId = sessions[0].id;
    }
  });

  test.beforeEach(async ({ page }) => {
    // Dismiss the OnboardingOverlay so it does not block clicks
    await page.addInitScript(() => localStorage.setItem('pl_onboarding_complete', '1'));
  });

  test('Preview tab shows project type info when no server running', async ({ page }) => {
    test.skip(!sessionId, 'No sessions available');
    await page.goto(`/project/${sessionId}`);
    // Switch to Preview tab
    const previewTab = page.getByRole('tab', { name: 'Preview' });
    await expect(previewTab).toBeVisible({ timeout: 10000 });
    await previewTab.click();
    // The preview panel should render -- either an iframe or a "Start" button
    // depending on project type. At minimum the tab content should appear.
    await page.waitForTimeout(2000); // Wait for preview-info API call
    const content = page.locator('[role="tabpanel"]').first();
    await expect(content).toBeVisible({ timeout: 5000 });
  });

  test('Dev server status endpoint returns correct format', async ({ request }) => {
    test.skip(!sessionId, 'No sessions available');
    const res = await request.get(`/api/sessions/${sessionId}/devserver/status`);
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('running');
    expect(data).toHaveProperty('status');
    expect(data).toHaveProperty('port');
    expect(data).toHaveProperty('command');
    expect(typeof data.running).toBe('boolean');
  });

  test('Custom command input appears in preview panel', async ({ page }) => {
    test.skip(!sessionId, 'No sessions available');
    await page.goto(`/project/${sessionId}`);
    const previewTab = page.getByRole('tab', { name: 'Preview' });
    await expect(previewTab).toBeVisible({ timeout: 10000 });
    await previewTab.click();
    await page.waitForTimeout(2000);
    // Look for custom command input -- present when dev server is not running
    // and preview-info shows dev controls
    const customInput = page.locator('input[placeholder*="npm run dev"]');
    // This may or may not be visible depending on project type
    // If dev controls are shown, the custom input should exist
    const devControls = page.locator('text=custom command');
    if (await devControls.isVisible()) {
      await expect(customInput).toBeVisible();
    }
  });

  test('Preview-info endpoint returns project type data', async ({ request }) => {
    test.skip(!sessionId, 'No sessions available');
    const res = await request.get(`/api/sessions/${sessionId}/preview-info`);
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('type');
    expect(data).toHaveProperty('description');
    expect(typeof data.type).toBe('string');
  });

  test('Preview iframe renders when preview URL is available', async ({ page }) => {
    test.skip(!sessionId, 'No sessions available');
    await page.goto(`/project/${sessionId}`);
    const previewTab = page.getByRole('tab', { name: 'Preview' });
    await expect(previewTab).toBeVisible({ timeout: 10000 });
    await previewTab.click();
    await page.waitForTimeout(2000);
    // If the project has a preview URL (static or dev server), an iframe should render
    const iframe = page.locator('iframe[title="Project Preview"]');
    if (await iframe.isVisible()) {
      const src = await iframe.getAttribute('src');
      expect(src).toBeTruthy();
    }
  });
});

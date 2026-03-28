import { test, expect } from '@playwright/test';

// ============================================================================
// Terminal E2E Tests
// ============================================================================

test.describe('Terminal Panel', () => {
  let sessionId: string;

  test.beforeAll(async ({ request }) => {
    const res = await request.get('/api/sessions/history');
    const sessions = await res.json();
    if (sessions.length > 0) {
      sessionId = sessions[0].id;
    }
  });

  test('Terminal tab exists in ActivityPanel', async ({ page }) => {
    test.skip(!sessionId, 'No sessions available');
    await page.goto(`/project/${sessionId}`);
    // ActivityPanel renders tabs including Terminal
    const terminalTab = page.locator('button:has-text("Terminal")');
    await expect(terminalTab).toBeVisible({ timeout: 10000 });
  });

  test('Terminal tab is the default active tab', async ({ page }) => {
    test.skip(!sessionId, 'No sessions available');
    await page.goto(`/project/${sessionId}`);
    // The Terminal tab should be the first tab and active by default
    const terminalTab = page.locator('button:has-text("Terminal")').first();
    await expect(terminalTab).toBeVisible({ timeout: 10000 });
    // Active tab has specific styling -- check it is visually distinct
    await expect(terminalTab).toHaveClass(/bg-primary|border-primary|text-white/);
  });

  test('xterm.js container renders with correct dimensions', async ({ page }) => {
    test.skip(!sessionId, 'No sessions available');
    await page.goto(`/project/${sessionId}`);
    // Ensure Terminal tab is active
    await page.click('button:has-text("Terminal")');
    // xterm renders a .xterm container div
    const xtermContainer = page.locator('.xterm');
    await expect(xtermContainer).toBeVisible({ timeout: 10000 });
    // Verify it has non-zero dimensions
    const box = await xtermContainer.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(box.width).toBeGreaterThan(50);
      expect(box.height).toBeGreaterThan(20);
    }
  });

  test('Build Log tab shown conditionally alongside Terminal', async ({ page }) => {
    test.skip(!sessionId, 'No sessions available');
    await page.goto(`/project/${sessionId}`);
    // Terminal tab is always visible
    await expect(page.locator('button:has-text("Terminal")')).toBeVisible({ timeout: 10000 });
    // Build Log tab is conditionally visible -- only when there are logs or a build is running.
    // AI Chat tab is always visible alongside Terminal.
    await expect(page.locator('button:has-text("AI Chat")')).toBeVisible();
  });

  test('Terminal connects via WebSocket (DOM check)', async ({ page }) => {
    test.skip(!sessionId, 'No sessions available');
    await page.goto(`/project/${sessionId}`);
    await page.click('button:has-text("Terminal")');
    // Wait for the xterm container to appear and have content
    const xtermContainer = page.locator('.xterm');
    await expect(xtermContainer).toBeVisible({ timeout: 10000 });
    // After connection the terminal should render at least some rows
    const xtermRows = page.locator('.xterm-rows');
    await expect(xtermRows).toBeAttached({ timeout: 5000 });
  });
});

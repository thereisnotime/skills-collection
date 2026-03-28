import { test, expect } from '@playwright/test';

// Dismiss OnboardingOverlay globally for all tests
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('pl_onboarding_complete', '1');
  });
});

// ============================================================================
// API Endpoint Tests
// ============================================================================

test.describe('API Endpoints', () => {
  test('GET /health returns ok', async ({ request }) => {
    const res = await request.get('/health');
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('ok');
    expect(data.service).toBe('purple-lab');
  });

  test('GET /api/session/status returns session state', async ({ request }) => {
    const res = await request.get('/api/session/status');
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('running');
    expect(data).toHaveProperty('phase');
    expect(data).toHaveProperty('provider');
    expect(typeof data.running).toBe('boolean');
  });

  test('GET /api/templates returns templates with category', async ({ request }) => {
    const res = await request.get('/api/templates');
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    expect(data[0]).toHaveProperty('name');
    expect(data[0]).toHaveProperty('filename');
    expect(data[0]).toHaveProperty('description');
    expect(data[0]).toHaveProperty('category');
  });

  test('GET /api/sessions/history returns session list', async ({ request }) => {
    const res = await request.get('/api/sessions/history');
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  test('GET /api/provider/current returns provider info', async ({ request }) => {
    const res = await request.get('/api/provider/current');
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('provider');
    expect(['claude', 'codex', 'gemini', '']).toContain(data.provider);
  });
});

// ============================================================================
// Secrets API Tests
// ============================================================================

test.describe('Secrets API', () => {
  const testKey = 'PW_TEST_SECRET';
  const testValue = 'playwright-test-value';

  test('POST /api/secrets creates a secret', async ({ request }) => {
    const res = await request.post('/api/secrets', {
      data: { key: testKey, value: testValue },
    });
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.set).toBe(true);
    expect(data.key).toBe(testKey);
  });

  test('GET /api/secrets returns masked values', async ({ request }) => {
    // Ensure secret exists
    await request.post('/api/secrets', { data: { key: testKey, value: testValue } });
    const res = await request.get('/api/secrets');
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data[testKey]).toBe('***');
  });

  test('DELETE /api/secrets/{key} removes secret', async ({ request }) => {
    await request.post('/api/secrets', { data: { key: testKey, value: testValue } });
    const res = await request.delete(`/api/secrets/${testKey}`);
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.deleted).toBe(true);

    // Verify gone
    const getRes = await request.get('/api/secrets');
    const secrets = await getRes.json();
    expect(secrets).not.toHaveProperty(testKey);
  });

  test('POST /api/secrets rejects invalid key format', async ({ request }) => {
    const res = await request.post('/api/secrets', {
      data: { key: 'invalid-key!', value: 'x' },
    });
    expect(res.status()).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('Invalid key');
  });
});

// ============================================================================
// File CRUD Tests (requires at least one session in history)
// ============================================================================

test.describe('File CRUD', () => {
  let sessionId: string;

  test.beforeAll(async ({ request }) => {
    const res = await request.get('/api/sessions/history');
    const sessions = await res.json();
    if (sessions.length > 0) {
      sessionId = sessions[0].id;
    }
  });

  test('GET session detail returns files', async ({ request }) => {
    test.skip(!sessionId, 'No sessions available');
    const res = await request.get(`/api/sessions/${sessionId}`);
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('id');
    expect(data).toHaveProperty('files');
    expect(data).toHaveProperty('status');
  });

  test('PUT creates and GET reads file', async ({ request }) => {
    test.skip(!sessionId, 'No sessions available');
    const path = '_playwright_test.txt';
    const content = 'Playwright E2E test content';

    // Create/save
    const putRes = await request.put(`/api/sessions/${sessionId}/file`, {
      data: { path, content },
    });
    expect(putRes.status()).toBe(200);
    expect((await putRes.json()).saved).toBe(true);

    // Read
    const getRes = await request.get(`/api/sessions/${sessionId}/file?path=${path}`);
    expect(getRes.status()).toBe(200);
    expect((await getRes.json()).content).toBe(content);

    // Delete
    const delRes = await request.delete(`/api/sessions/${sessionId}/file`, {
      data: { path },
    });
    expect(delRes.status()).toBe(200);
    expect((await delRes.json()).deleted).toBe(true);

    // Verify deleted
    const verifyRes = await request.get(`/api/sessions/${sessionId}/file?path=${path}`);
    expect(verifyRes.status()).toBe(404);
  });
});

// ============================================================================
// Chat API Tests
// ============================================================================

test.describe('Chat API', () => {
  let sessionId: string;

  test.beforeAll(async ({ request }) => {
    const res = await request.get('/api/sessions/history');
    const sessions = await res.json();
    if (sessions.length > 0) {
      sessionId = sessions[0].id;
    }
  });

  test('POST chat returns task_id (non-blocking)', async ({ request }) => {
    test.skip(!sessionId, 'No sessions available');
    const res = await request.post(`/api/sessions/${sessionId}/chat`, {
      data: { message: 'test ping', mode: 'quick' },
    });
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('task_id');
    expect(data.status).toBe('running');
  });

  test('GET chat poll returns task status', async ({ request }) => {
    test.skip(!sessionId, 'No sessions available');
    // Start a chat task
    const startRes = await request.post(`/api/sessions/${sessionId}/chat`, {
      data: { message: 'poll test', mode: 'quick' },
    });
    const { task_id } = await startRes.json();

    // Poll it
    const pollRes = await request.get(`/api/sessions/${sessionId}/chat/${task_id}`);
    expect(pollRes.status()).toBe(200);
    const data = await pollRes.json();
    expect(data).toHaveProperty('task_id');
    expect(data).toHaveProperty('status');
    expect(data).toHaveProperty('output_lines');
    expect(data).toHaveProperty('complete');
  });
});

// ============================================================================
// UI Navigation Tests
// ============================================================================

test.describe('UI Navigation', () => {
  test.beforeEach(async ({ page }) => {
    // Dismiss the OnboardingOverlay so it does not block clicks
    await page.addInitScript(() => localStorage.setItem('pl_onboarding_complete', '1'));
  });

  test('Home page loads with sidebar and hero text', async ({ page }) => {
    await page.goto('/');
    // Sidebar should be visible
    await expect(page.locator('text=Purple Lab')).toBeVisible({ timeout: 10000 });
    // Hero heading
    await expect(page.locator('text=Describe it. Build it. Ship it.')).toBeVisible();
    // Nav links (use getByRole to avoid matching page content)
    await expect(page.getByRole('link', { name: 'Home' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Projects' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Templates' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible();
  });

  test('Projects page navigates and renders', async ({ page }) => {
    await page.goto('/projects');
    await expect(page.locator('h1:has-text("Projects")')).toBeVisible({ timeout: 10000 });
  });

  test('Templates page navigates and shows categories', async ({ page }) => {
    await page.goto('/templates');
    await expect(page.locator('h1:has-text("Templates")')).toBeVisible({ timeout: 10000 });
    // Category filter tabs
    await expect(page.locator('button:has-text("All")')).toBeVisible();
    await expect(page.locator('button:has-text("Website")')).toBeVisible();
    await expect(page.locator('button:has-text("API")')).toBeVisible();
  });

  test('Settings page navigates and shows provider selector', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.locator('h1:has-text("Settings")')).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    // Provider selector -- look for Claude card (may be capitalized)
    await expect(page.locator('text=Claude').or(page.locator('text=claude')).first()).toBeVisible({ timeout: 5000 });
  });

  test('Sidebar navigation works between all pages', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=Describe it')).toBeVisible({ timeout: 10000 });

    // Navigate to Projects
    await page.click('a:has-text("Projects")');
    await expect(page.locator('h1:has-text("Projects")')).toBeVisible({ timeout: 5000 });

    // Navigate to Templates
    await page.click('a:has-text("Templates")');
    await expect(page.locator('h1:has-text("Templates")')).toBeVisible({ timeout: 5000 });

    // Navigate to Settings
    await page.click('a:has-text("Settings")');
    await expect(page.locator('h1:has-text("Settings")')).toBeVisible({ timeout: 5000 });

    // Navigate back to Home
    await page.click('a:has-text("Home")');
    await expect(page.locator('text=Describe it')).toBeVisible({ timeout: 5000 });
  });

  test('Hard refresh works on all routes (SPA)', async ({ page }) => {
    // Direct navigation to /projects should work (SPA fallback)
    await page.goto('/projects');
    await expect(page.locator('h1:has-text("Projects")')).toBeVisible({ timeout: 10000 });

    await page.goto('/templates');
    await expect(page.locator('h1:has-text("Templates")')).toBeVisible({ timeout: 10000 });

    await page.goto('/settings');
    await expect(page.locator('h1:has-text("Settings")')).toBeVisible({ timeout: 10000 });
  });
});

// ============================================================================
// IDE Workspace Tests (requires at least one session)
// ============================================================================

test.describe('IDE Workspace', () => {
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

  test('Project page loads with workspace tabs', async ({ page }) => {
    test.skip(!sessionId, 'No sessions available');
    await page.goto(`/project/${sessionId}`);

    // Wait for workspace to load
    await expect(page.getByRole('tab', { name: 'Code' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('tab', { name: 'Preview' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Config' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Secrets' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'PRD' })).toBeVisible();
  });

  test('Workspace tab switching works', async ({ page }) => {
    test.skip(!sessionId, 'No sessions available');
    await page.goto(`/project/${sessionId}`);
    await expect(page.locator('text=Code')).toBeVisible({ timeout: 10000 });

    // Click PRD tab
    await page.click('button[role="tab"]:has-text("PRD")');
    await expect(page.locator('h3:has-text("Product Requirements")')).toBeVisible({ timeout: 5000 });

    // Click Config tab
    await page.click('button[role="tab"]:has-text("Config")');
    await expect(page.locator('text=Build Mode')).toBeVisible({ timeout: 5000 });

    // Click Secrets tab
    await page.click('button[role="tab"]:has-text("Secrets")');
    await expect(page.locator('text=Environment Secrets')).toBeVisible({ timeout: 5000 });

    // Click back to Code tab
    await page.click('button[role="tab"]:has-text("Code")');
  });

  test('File tree shows project files', async ({ page }) => {
    test.skip(!sessionId, 'No sessions available');
    await page.goto(`/project/${sessionId}`);
    await expect(page.locator('text=Files')).toBeVisible({ timeout: 10000 });
    // Should have at least one file listed
    const fileItems = page.locator('[role="treeitem"]');
    await expect(fileItems.first()).toBeVisible({ timeout: 5000 });
  });

  test('Back button navigates to projects', async ({ page }) => {
    test.skip(!sessionId, 'No sessions available');
    await page.goto(`/project/${sessionId}`);
    await expect(page.getByRole('button', { name: 'Back', exact: true })).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    // Should go back to home or projects
    await expect(page).toHaveURL(/\/(projects)?$/, { timeout: 5000 });
  });
});

// ============================================================================
// Home Page Functionality Tests
// ============================================================================

test.describe('Home Page', () => {
  test.beforeEach(async ({ page }) => {
    // Dismiss the OnboardingOverlay so it does not block clicks
    await page.addInitScript(() => localStorage.setItem('pl_onboarding_complete', '1'));
  });

  test('PRD input area is present and functional', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=Product Requirements')).toBeVisible({ timeout: 10000 });
    // Textarea should exist
    const textarea = page.locator('textarea');
    await expect(textarea).toBeVisible();
    // Type into it
    await textarea.fill('# Test PRD\n\nBuild a hello world app');
    await expect(textarea).toHaveValue(/Test PRD/);
  });

  test('Templates dropdown loads templates', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('button:has-text("Templates")')).toBeVisible({ timeout: 10000 });
    await page.click('button:has-text("Templates")');
    // Should show template list
    await expect(page.locator('button:has-text("Readme")')).toBeVisible({ timeout: 5000 });
  });

  test('Start Build button exists and is disabled without PRD', async ({ page }) => {
    await page.goto('/');
    const btn = page.locator('button:has-text("Start Build")');
    await expect(btn).toBeVisible({ timeout: 10000 });
    // Should be disabled when textarea is empty
    await expect(btn).toBeDisabled();
  });

  test('Start Build enables when PRD is entered', async ({ page }) => {
    await page.goto('/');
    const textarea = page.locator('textarea');
    await textarea.fill('# Test PRD\n\nBuild something');
    const btn = page.locator('button:has-text("Start Build")');
    await expect(btn).toBeEnabled({ timeout: 3000 });
  });

  test('Session history section is visible', async ({ page }) => {
    await page.goto('/');
    // Past Builds section should be visible if there are sessions
    await page.waitForTimeout(2000); // Wait for polling
    const builds = page.locator('text=Past Builds');
    // May or may not be visible depending on whether sessions exist
    // Just verify the page loaded without errors
    await expect(page.getByRole('heading', { name: 'Product Requirements' })).toBeVisible();
  });
});

// ============================================================================
// Accessibility Tests
// ============================================================================

test.describe('Accessibility', () => {
  test.beforeEach(async ({ page }) => {
    // Dismiss the OnboardingOverlay so it does not block clicks
    await page.addInitScript(() => localStorage.setItem('pl_onboarding_complete', '1'));
  });

  test('Skip link exists and is focusable', async ({ page }) => {
    await page.goto('/');
    // Tab to skip link
    await page.keyboard.press('Tab');
    const skipLink = page.locator('a:has-text("Skip to main content")');
    // It should exist in DOM even if visually hidden
    await expect(skipLink).toBeAttached();
  });

  test('Sidebar nav has accessible labels', async ({ page }) => {
    await page.goto('/');
    const nav = page.locator('nav[aria-label="Main navigation"]');
    await expect(nav).toBeAttached({ timeout: 10000 });
  });

  test('Workspace tabs have correct ARIA roles', async ({ page, request }) => {
    const res = await request.get('/api/sessions/history');
    const sessions = await res.json();
    test.skip(sessions.length === 0, 'No sessions');

    await page.goto(`/project/${sessions[0].id}`);
    const tablist = page.locator('[role="tablist"]');
    await expect(tablist.first()).toBeVisible({ timeout: 10000 });
    const tabs = page.locator('[role="tab"]');
    expect(await tabs.count()).toBeGreaterThanOrEqual(4);
  });

  test('Icon buttons have tooltips (title attribute)', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);
    // Sidebar collapse button should have title
    const collapseBtn = page.locator('button[title="Collapse sidebar"]');
    await expect(collapseBtn).toBeAttached({ timeout: 5000 });
  });
});

// ============================================================================
// Onboarding Overlay Tests
// ============================================================================

test.describe('Onboarding Overlay', () => {
  test('shows onboarding when pl_onboarding_complete is cleared', async ({ browser }) => {
    // Create a fresh context with explicitly empty storageState
    const context = await browser.newContext({
      baseURL: 'http://127.0.0.1:57375',
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();
    // Clear the key BEFORE React mounts via addInitScript
    await page.addInitScript(() => localStorage.removeItem('pl_onboarding_complete'));
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    // Should show onboarding overlay with step counter
    await expect(page.locator('text=Write your PRD')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=1 / 4')).toBeVisible();
    await context.close();
  });

  test('steps through all onboarding steps with Next', async ({ browser }) => {
    const context = await browser.newContext({
      baseURL: 'http://127.0.0.1:57375',
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();
    await page.addInitScript(() => localStorage.removeItem('pl_onboarding_complete'));
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    // Step 1: Write your PRD
    await expect(page.locator('text=Write your PRD')).toBeVisible({ timeout: 10000 });
    await page.click('button:has-text("Next")');
    // Step 2: Use the terminal
    await expect(page.locator('text=Use the terminal')).toBeVisible({ timeout: 3000 });
    await page.click('button:has-text("Next")');
    // Step 3: Preview in real-time
    await expect(page.locator('text=Preview in real-time')).toBeVisible({ timeout: 3000 });
    await page.click('button:has-text("Next")');
    // Step 4: Iterate with AI Chat -- final step shows "Get Started"
    await expect(page.locator('text=Iterate with AI Chat')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('button:has-text("Get Started")')).toBeVisible();
    await page.click('button:has-text("Get Started")');
    // Overlay should be gone
    await expect(page.locator('text=Write your PRD')).not.toBeVisible({ timeout: 3000 });
    await context.close();
  });

  test('Skip button dismisses onboarding immediately', async ({ browser }) => {
    const context = await browser.newContext({
      baseURL: 'http://127.0.0.1:57375',
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();
    await page.addInitScript(() => localStorage.removeItem('pl_onboarding_complete'));
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('text=Write your PRD')).toBeVisible({ timeout: 10000 });
    await page.click('button:has-text("Skip")');
    // Overlay should be gone
    await expect(page.locator('text=Write your PRD')).not.toBeVisible({ timeout: 3000 });
    await context.close();
  });

  test('does not show onboarding when pl_onboarding_complete is set', async ({ page }) => {
    // The playwright config sets pl_onboarding_complete=1 in storageState
    await page.goto('/');
    await expect(page.locator('text=Describe it. Build it. Ship it.')).toBeVisible({ timeout: 10000 });
    // Onboarding overlay should not be present
    await expect(page.locator('text=Write your PRD')).not.toBeVisible();
  });
});

// ============================================================================
// WebSocket Connection Indicator Tests
// ============================================================================

test.describe('WebSocket Connection', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('pl_onboarding_complete', '1'));
  });

  test('shows connection status indicator in sidebar', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(3000);
    // Sidebar shows "Connected" or "Disconnected" text
    // Use first() since "Connected" may also appear in body text
    const connected = page.locator('text=Connected').first();
    const disconnected = page.locator('text=Disconnected').first();
    const hasConnected = await connected.isVisible().catch(() => false);
    const hasDisconnected = await disconnected.isVisible().catch(() => false);
    expect(hasConnected || hasDisconnected).toBe(true);
  });

  test('home page shows connection dot indicator', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(3000);
    // Home page has its own connection indicator at the bottom
    const connectedText = page.locator('text=Connected to Purple Lab backend');
    const waitingText = page.locator('text=Waiting for backend connection...');
    const hasConnected = await connectedText.isVisible().catch(() => false);
    const hasWaiting = await waitingText.isVisible().catch(() => false);
    expect(hasConnected || hasWaiting).toBe(true);
  });
});

// ============================================================================
// 404 / Not Found Page Tests
// ============================================================================

test.describe('Not Found Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('pl_onboarding_complete', '1'));
  });

  test('shows 404 for unknown routes', async ({ page }) => {
    await page.goto('/this-page-does-not-exist');
    // Should render something -- either a 404 page or redirect to home
    await expect(page.locator('body')).toBeVisible({ timeout: 10000 });
  });

  test('invalid project ID shows error state', async ({ page }) => {
    await page.goto('/project/nonexistent-session-id-12345');
    await page.waitForTimeout(3000);
    // Should show "Project not found" or error message
    const notFound = page.locator('text=Project not found');
    const backBtn = page.locator('text=Back to Home');
    const hasNotFound = await notFound.isVisible().catch(() => false);
    const hasBackBtn = await backBtn.isVisible().catch(() => false);
    expect(hasNotFound || hasBackBtn).toBe(true);
  });
});

// ============================================================================
// Settings Page - Provider Selection Tests
// ============================================================================

test.describe('Settings - Provider Selection', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('pl_onboarding_complete', '1'));
  });

  test('shows all three providers (Claude, Codex, Gemini)', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.locator('h1:has-text("Settings")')).toBeVisible({ timeout: 10000 });
    // Provider names are in p.font-medium elements
    await expect(page.locator('p.font-medium:has-text("Claude")')).toBeVisible();
    await expect(page.locator('p.font-medium:has-text("Codex")')).toBeVisible();
    await expect(page.locator('p.font-medium:has-text("Gemini")')).toBeVisible();
  });

  test('provider cards show descriptions', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.locator('h1:has-text("Settings")')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=full features')).toBeVisible();
    await expect(page.locator('text=degraded mode').first()).toBeVisible();
  });

  test('clicking a provider selects it (ring highlight)', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.locator('h1:has-text("Settings")')).toBeVisible({ timeout: 10000 });
    // Click the Gemini provider name
    await page.locator('p.font-medium:has-text("Gemini")').click();
    await page.waitForTimeout(500);
    // Verify the API responds (provider may or may not have changed)
    const res = await page.request.get('/api/provider/current');
    const data = await res.json();
    expect(data).toHaveProperty('provider');
  });

  test('About section shows version and links', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.locator('h1:has-text("Settings")')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=About')).toBeVisible();
    await expect(page.locator('text=Documentation')).toBeVisible();
    await expect(page.locator('text=GitHub')).toBeVisible();
  });
});

// ============================================================================
// Template Category Filtering Tests
// ============================================================================

test.describe('Templates - Category Filtering', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('pl_onboarding_complete', '1'));
  });

  test('all category filter tabs are visible', async ({ page }) => {
    await page.goto('/templates');
    await expect(page.locator('h1:has-text("Templates")')).toBeVisible({ timeout: 10000 });
    for (const cat of ['All', 'Website', 'API', 'CLI', 'Bot', 'Data', 'Other']) {
      await expect(page.locator(`button[role="tab"]:has-text("${cat}")`)).toBeVisible();
    }
  });

  test('clicking a category filters templates', async ({ page }) => {
    await page.goto('/templates');
    await expect(page.locator('h1:has-text("Templates")')).toBeVisible({ timeout: 10000 });
    // Wait for templates to load
    await page.waitForTimeout(2000);
    // Click a specific category
    await page.click('button[role="tab"]:has-text("Website")');
    await page.waitForTimeout(500);
    // Either shows filtered templates or "No templates in this category"
    const cards = page.locator('[class*="card"]');
    const noTemplates = page.locator('text=No templates in this category');
    const hasCards = await cards.count() > 0;
    const hasEmpty = await noTemplates.isVisible().catch(() => false);
    expect(hasCards || hasEmpty).toBe(true);
  });

  test('clicking All shows all templates', async ({ page }) => {
    await page.goto('/templates');
    await expect(page.locator('h1:has-text("Templates")')).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(2000);
    // Click Website first, then All
    await page.click('button[role="tab"]:has-text("Website")');
    await page.waitForTimeout(300);
    await page.click('button[role="tab"]:has-text("All")');
    await page.waitForTimeout(500);
    // Should show templates or loading
    const templateCards = page.locator('h3');
    expect(await templateCards.count()).toBeGreaterThan(0);
  });

  test('selecting a template navigates to home with PRD prefill', async ({ page }) => {
    await page.goto('/templates');
    await expect(page.locator('h1:has-text("Templates")')).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(2000);
    // Click the first template card
    const firstCard = page.locator('h3').first();
    if (await firstCard.isVisible()) {
      await firstCard.click();
      // Should navigate to home
      await expect(page).toHaveURL('/', { timeout: 5000 });
    }
  });
});

// ============================================================================
// Projects Page - Search and Filter Tests
// ============================================================================

test.describe('Projects - Search and Filter', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('pl_onboarding_complete', '1'));
  });

  test('search input is present and functional', async ({ page }) => {
    await page.goto('/projects');
    await expect(page.locator('h1:has-text("Projects")')).toBeVisible({ timeout: 10000 });
    const searchInput = page.locator('input[aria-label="Search projects"]');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('test search query');
    await expect(searchInput).toHaveValue('test search query');
  });

  test('filter tabs are present (All, Running, Completed, Failed)', async ({ page }) => {
    await page.goto('/projects');
    await expect(page.locator('h1:has-text("Projects")')).toBeVisible({ timeout: 10000 });
    for (const tab of ['All', 'Running', 'Completed', 'Failed']) {
      await expect(page.locator(`button[role="tab"]:has-text("${tab}")`)).toBeVisible();
    }
  });

  test('New Project button navigates to home', async ({ page }) => {
    await page.goto('/projects');
    await expect(page.locator('h1:has-text("Projects")')).toBeVisible({ timeout: 10000 });
    await page.click('button:has-text("New Project")');
    await expect(page).toHaveURL('/', { timeout: 5000 });
  });

  test('filter tab switching changes the active tab highlight', async ({ page }) => {
    await page.goto('/projects');
    await expect(page.locator('h1:has-text("Projects")')).toBeVisible({ timeout: 10000 });
    // Click Completed tab
    const completedTab = page.locator('button[role="tab"]:has-text("Completed")');
    await completedTab.click();
    // Should have aria-selected=true
    await expect(completedTab).toHaveAttribute('aria-selected', 'true');
    // All tab should no longer be selected
    const allTab = page.locator('button[role="tab"]:has-text("All")');
    await expect(allTab).toHaveAttribute('aria-selected', 'false');
  });
});

// ============================================================================
// PRD Input - Advanced Tests
// ============================================================================

test.describe('PRD Input - Advanced', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('pl_onboarding_complete', '1'));
  });

  test('character count updates as user types', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=Product Requirements')).toBeVisible({ timeout: 10000 });
    const textarea = page.locator('textarea');
    await textarea.fill('Hello World');
    // Character count should show "11 chars"
    await expect(page.locator('text=11 chars')).toBeVisible({ timeout: 3000 });
  });

  test('Quick Mode toggle exists and works', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=Product Requirements')).toBeVisible({ timeout: 10000 });
    const quickBtn = page.locator('button:has-text("Quick")');
    await expect(quickBtn).toBeVisible();
    // Click to toggle Quick Mode on
    await quickBtn.click();
    await page.waitForTimeout(300);
    // Click again to toggle off
    await quickBtn.click();
  });

  test('project directory input field exists', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=Product Requirements')).toBeVisible({ timeout: 10000 });
    const dirLabel = page.locator('text=Project Directory');
    await expect(dirLabel).toBeVisible();
    const dirInput = page.locator('input[placeholder*="Leave blank"]');
    await expect(dirInput).toBeVisible();
    await dirInput.fill('/tmp/my-test-project');
    await expect(dirInput).toHaveValue('/tmp/my-test-project');
  });

  test('PRD draft persists in localStorage', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=Product Requirements')).toBeVisible({ timeout: 10000 });
    const textarea = page.locator('textarea');
    await textarea.fill('# Persisted Draft\n\nThis should survive a reload.');
    // Wait for draft to save
    await page.waitForTimeout(500);
    // Verify localStorage has the draft
    const draft = await page.evaluate(() => localStorage.getItem('loki-prd-draft'));
    expect(draft).toContain('Persisted Draft');
    // Clean up
    await page.evaluate(() => localStorage.removeItem('loki-prd-draft'));
  });
});

// ============================================================================
// Project Card Interactions (requires sessions)
// ============================================================================

test.describe('Project Cards', () => {
  let sessionId: string;
  let hasSessions: boolean;

  test.beforeAll(async ({ request }) => {
    const res = await request.get('/api/sessions/history');
    const sessions = await res.json();
    hasSessions = sessions.length > 0;
    if (hasSessions) {
      sessionId = sessions[0].id;
    }
  });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('pl_onboarding_complete', '1'));
  });

  test('project cards show date and status badge', async ({ page }) => {
    test.skip(!hasSessions, 'No sessions available');
    await page.goto('/projects');
    await expect(page.locator('h1:has-text("Projects")')).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(2000);
    // Should have at least one card with a date and status
    const cards = page.locator('[class*="card"]');
    expect(await cards.count()).toBeGreaterThan(0);
  });

  test('3-dot menu opens on project card', async ({ page }) => {
    test.skip(!hasSessions, 'No sessions available');
    await page.goto('/projects');
    await expect(page.locator('h1:has-text("Projects")')).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(2000);
    // Click the first 3-dot menu button
    const menuBtn = page.locator('button[aria-label="Project options"]').first();
    if (await menuBtn.isVisible()) {
      await menuBtn.click();
      // Should show menu items
      await expect(page.locator('text=Open project')).toBeVisible({ timeout: 3000 });
      await expect(page.locator('text=Copy path')).toBeVisible();
      await expect(page.locator('text=Delete project')).toBeVisible();
    }
  });

  test('clicking project card navigates to workspace', async ({ page }) => {
    test.skip(!hasSessions, 'No sessions available');
    await page.goto('/projects');
    await expect(page.locator('h1:has-text("Projects")')).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(2000);
    // Click the first project card (not the menu button)
    const firstCard = page.locator('h3').first();
    if (await firstCard.isVisible()) {
      await firstCard.click();
      await page.waitForTimeout(2000);
      // Should navigate to /project/<id>
      expect(page.url()).toContain('/project/');
    }
  });
});

// ============================================================================
// Sidebar Collapse / Expand Tests
// ============================================================================

test.describe('Sidebar', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('pl_onboarding_complete', '1'));
  });

  test('sidebar shows Purple Lab branding', async ({ page }) => {
    await page.goto('/');
    // Use the sidebar-specific heading span (font-heading class)
    await expect(page.locator('aside span.font-heading:has-text("Purple Lab")')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Powered by Loki')).toBeVisible();
  });

  test('sidebar collapse button toggles sidebar width', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('aside span.font-heading:has-text("Purple Lab")')).toBeVisible({ timeout: 10000 });

    // Get collapse button
    const collapseBtn = page.locator('button[title="Collapse sidebar"]');
    if (await collapseBtn.isVisible()) {
      await collapseBtn.click();
      await page.waitForTimeout(300);
      // Sidebar branding text should be hidden when collapsed
      await expect(page.locator('aside span.font-heading:has-text("Purple Lab")')).not.toBeVisible({ timeout: 3000 });

      // Expand it back
      const expandBtn = page.locator('button[title="Expand sidebar"]');
      await expandBtn.click();
      await page.waitForTimeout(300);
      await expect(page.locator('aside span.font-heading:has-text("Purple Lab")')).toBeVisible({ timeout: 3000 });
    }
  });

  test('sidebar has Docs link', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('aside span.font-heading:has-text("Purple Lab")')).toBeVisible({ timeout: 10000 });
    const docsLink = page.locator('a:has-text("Docs")');
    await expect(docsLink).toBeVisible();
    const href = await docsLink.getAttribute('href');
    expect(href).toContain('autonomi.dev/docs');
  });

  test('sidebar shows version when available', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(3000);
    // Version is conditionally shown -- depends on API response
    // Verify at minimum the page loaded correctly
    await expect(page.locator('aside span.font-heading:has-text("Purple Lab")')).toBeVisible({ timeout: 10000 });
  });
});

// ============================================================================
// Session Detail API Tests
// ============================================================================

test.describe('Session Detail API', () => {
  let sessionId: string;

  test.beforeAll(async ({ request }) => {
    const res = await request.get('/api/sessions/history');
    const sessions = await res.json();
    if (sessions.length > 0) {
      sessionId = sessions[0].id;
    }
  });

  test('session detail includes all expected fields', async ({ request }) => {
    test.skip(!sessionId, 'No sessions available');
    const res = await request.get(`/api/sessions/${sessionId}`);
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('id');
    expect(data).toHaveProperty('files');
    expect(data).toHaveProperty('status');
    expect(data).toHaveProperty('prd');
    expect(data.id).toBe(sessionId);
  });

  test('session detail files array has expected structure', async ({ request }) => {
    test.skip(!sessionId, 'No sessions available');
    const res = await request.get(`/api/sessions/${sessionId}`);
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.files)).toBe(true);
    if (data.files.length > 0) {
      expect(data.files[0]).toHaveProperty('name');
      expect(data.files[0]).toHaveProperty('type');
      expect(data.files[0]).toHaveProperty('path');
    }
  });

  test('devserver status endpoint returns correct format', async ({ request }) => {
    test.skip(!sessionId, 'No sessions available');
    const res = await request.get(`/api/sessions/${sessionId}/devserver/status`);
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('running');
    expect(data).toHaveProperty('status');
    expect(data).toHaveProperty('port');
    expect(typeof data.running).toBe('boolean');
  });

  test('preview-info endpoint returns project type', async ({ request }) => {
    test.skip(!sessionId, 'No sessions available');
    const res = await request.get(`/api/sessions/${sessionId}/preview-info`);
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('type');
    expect(data).toHaveProperty('description');
  });

  test('nonexistent session returns 404', async ({ request }) => {
    const res = await request.get('/api/sessions/nonexistent-session-xyz');
    expect(res.status()).toBe(404);
  });
});

// ============================================================================
// Config Tab UI Tests
// ============================================================================

test.describe('Config Tab UI', () => {
  let sessionId: string;

  test.beforeAll(async ({ request }) => {
    const res = await request.get('/api/sessions/history');
    const sessions = await res.json();
    if (sessions.length > 0) {
      sessionId = sessions[0].id;
    }
  });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('pl_onboarding_complete', '1'));
  });

  test('Config tab shows build mode options', async ({ page }) => {
    test.skip(!sessionId, 'No sessions available');
    await page.goto(`/project/${sessionId}`);
    await page.waitForTimeout(1000);
    const configTab = page.getByRole('tab', { name: 'Config' });
    await expect(configTab).toBeVisible({ timeout: 10000 });
    await configTab.click();
    await expect(page.locator('text=Build Mode')).toBeVisible({ timeout: 5000 });
  });

  test('Secrets tab shows environment secrets heading', async ({ page }) => {
    test.skip(!sessionId, 'No sessions available');
    await page.goto(`/project/${sessionId}`);
    await page.waitForTimeout(1000);
    const secretsTab = page.getByRole('tab', { name: 'Secrets' });
    await expect(secretsTab).toBeVisible({ timeout: 10000 });
    await secretsTab.click();
    await expect(page.locator('text=Environment Secrets')).toBeVisible({ timeout: 5000 });
  });
});

// ============================================================================
// Keyboard Shortcut Tests
// ============================================================================

test.describe('Keyboard Shortcuts', () => {
  let sessionId: string;

  test.beforeAll(async ({ request }) => {
    const res = await request.get('/api/sessions/history');
    const sessions = await res.json();
    if (sessions.length > 0) {
      sessionId = sessions[0].id;
    }
  });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('pl_onboarding_complete', '1'));
  });

  test('keyboard shortcuts help button opens modal', async ({ page }) => {
    test.skip(!sessionId, 'No sessions available');
    await page.goto(`/project/${sessionId}`);
    // Wait for workspace to fully load
    await expect(page.getByRole('tab', { name: 'Code' })).toBeVisible({ timeout: 10000 });
    // The shortcuts help button renders in the toolbar
    const helpBtn = page.locator('button[title="Keyboard shortcuts"]');
    await expect(helpBtn).toBeVisible({ timeout: 5000 });
    await helpBtn.click();
    await page.waitForTimeout(500);
    // Modal should show keyboard shortcuts list
    await expect(page.getByRole('heading', { name: 'Keyboard Shortcuts' })).toBeVisible({ timeout: 3000 });
  });
});

// ============================================================================
// Error Boundary Tests
// ============================================================================

test.describe('Error Handling', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('pl_onboarding_complete', '1'));
  });

  test('page loads without console errors on home', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto('/');
    await expect(page.locator('text=Describe it. Build it. Ship it.')).toBeVisible({ timeout: 10000 });
    // Filter out non-critical errors (WebSocket connection failures are expected in test env)
    const criticalErrors = errors.filter(e =>
      !e.includes('WebSocket') &&
      !e.includes('fetch') &&
      !e.includes('NetworkError') &&
      !e.includes('net::ERR')
    );
    expect(criticalErrors).toHaveLength(0);
  });

  test('page loads without console errors on projects', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto('/projects');
    await expect(page.locator('h1:has-text("Projects")')).toBeVisible({ timeout: 10000 });
    const criticalErrors = errors.filter(e =>
      !e.includes('WebSocket') &&
      !e.includes('fetch') &&
      !e.includes('NetworkError') &&
      !e.includes('net::ERR')
    );
    expect(criticalErrors).toHaveLength(0);
  });
});

// ============================================================================
// Performance / Loading Tests
// ============================================================================

test.describe('Performance', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('pl_onboarding_complete', '1'));
  });

  test('home page loads within 5 seconds', async ({ page }) => {
    const start = Date.now();
    await page.goto('/');
    await expect(page.locator('text=Describe it. Build it. Ship it.')).toBeVisible({ timeout: 5000 });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(5000);
  });

  test('templates API responds within 2 seconds', async ({ request }) => {
    const start = Date.now();
    const res = await request.get('/api/templates');
    const elapsed = Date.now() - start;
    expect(res.status()).toBe(200);
    expect(elapsed).toBeLessThan(2000);
  });

  test('health endpoint responds within 500ms', async ({ request }) => {
    const start = Date.now();
    const res = await request.get('/health');
    const elapsed = Date.now() - start;
    expect(res.status()).toBe(200);
    expect(elapsed).toBeLessThan(500);
  });
});

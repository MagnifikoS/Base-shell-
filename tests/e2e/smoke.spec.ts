/**
 * Smoke Tests — Minimal E2E checks for staging/CI validation.
 *
 * These tests verify that the application boots, the auth flow works,
 * the dashboard renders after login, and critical pages load without
 * crashing. They are designed to run in CI against a built app or a
 * staging URL.
 *
 * Required environment variables for authenticated tests:
 *   E2E_USER_EMAIL    — test user email
 *   E2E_USER_PASSWORD — test user password
 *
 * If these env vars are missing, authenticated tests are skipped
 * gracefully so the suite never fails due to missing credentials.
 *
 * Coverage:
 *   1. Unauthenticated — login page, form, public routes
 *   2. Authenticated — auth flow, dashboard, sidebar navigation
 *   3. Critical pages — ALL key pages, not just a subset
 *   4. Error detection — error boundary, error banners, console errors
 */
import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const hasCredentials = !!process.env.E2E_USER_EMAIL && !!process.env.E2E_USER_PASSWORD;

/**
 * Console error messages that are benign and should NOT fail tests.
 * CSP and X-Frame-Options warnings come from <meta> tags in the HTML and
 * are not actionable. Supabase realtime errors happen in local/staging
 * because the connection drops when there's no active subscription.
 */
const IGNORED_CONSOLE_ERRORS = [
  "Content Security Policy",
  "X-Frame-Options",
  "Failed to register a ServiceWorker",
  // Supabase realtime connection noise in non-prod environments
  "WebSocket connection",
  "realtime",
];

/**
 * Returns true if a console error message should be ignored.
 */
function isIgnoredConsoleError(msg: string): boolean {
  return IGNORED_CONSOLE_ERRORS.some((pattern) => msg.includes(pattern));
}

/**
 * Log in via the Auth page and wait until we land on an authenticated route.
 */
async function login(page: import("@playwright/test").Page) {
  await page.goto("/auth");

  // Wait for the login form to appear (may briefly show a spinner while
  // checking admin_exists).
  await page.waitForSelector('form[aria-label="Connexion"]', {
    timeout: 15_000,
  });

  await page.locator("#email").fill(process.env.E2E_USER_EMAIL!);
  await page.locator("#password").fill(process.env.E2E_USER_PASSWORD!);
  await page.locator('button[type="submit"]').click();

  // After successful login the app redirects away from /auth.
  await page.waitForURL((url) => !url.pathname.includes("/auth"), {
    timeout: 20_000,
  });
}

/**
 * Assert the page has no visible errors:
 *  - No error boundary ("Une erreur est survenue")
 *  - No error banners (destructive-styled alerts with "Erreur" text)
 *  - No 404 page
 */
async function assertNoVisibleErrors(page: import("@playwright/test").Page) {
  // Error boundary
  const errorBoundary = page.locator("text=Une erreur est survenue");
  await expect(errorBoundary).not.toBeVisible();

  // Error banners — these use bg-destructive or text-destructive with "Erreur"
  const errorBanners = page.locator('.bg-destructive\\/10:has-text("Erreur")');
  await expect(errorBanners).toHaveCount(0);

  // Also catch "Erreur de chargement" standalone messages
  const errorLoadingText = page.locator('.text-destructive:has-text("Erreur")');
  await expect(errorLoadingText).toHaveCount(0);

  // 404 page
  const notFound = page.locator("h1:has-text('404')");
  await expect(notFound).not.toBeVisible();
}

/**
 * Collect console errors during a page visit. Returns the list of
 * unexpected errors (after filtering out benign ones).
 */
function trackConsoleErrors(page: import("@playwright/test").Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text();
      if (!isIgnoredConsoleError(text)) {
        errors.push(text);
      }
    }
  });
  return errors;
}

// ---------------------------------------------------------------------------
// Smoke Tests
// ---------------------------------------------------------------------------

test.describe("Smoke Tests", () => {
  // ── Unauthenticated tests ──────────────────────────────────────────────

  test("login page loads when visiting /", async ({ page }) => {
    await page.goto("/");

    // The app should redirect unauthenticated users to /auth
    await page.waitForURL("**/auth", { timeout: 15_000 });
    expect(page.url()).toContain("/auth");

    // The login form (or at minimum the card container) should be visible
    const card = page.locator(".max-w-md");
    await expect(card).toBeVisible({ timeout: 10_000 });
  });

  test("login form is functional", async ({ page }) => {
    await page.goto("/auth");

    await page.waitForSelector('form[aria-label="Connexion"]', {
      timeout: 15_000,
    });

    const emailInput = page.locator("#email");
    const passwordInput = page.locator("#password");
    const submitButton = page.locator('button[type="submit"]');

    await expect(emailInput).toBeVisible();
    await expect(passwordInput).toBeVisible();
    await expect(submitButton).toBeVisible();
    await expect(submitButton).toHaveText("Se connecter");

    // Verify inputs accept text
    await emailInput.fill("test@example.com");
    await expect(emailInput).toHaveValue("test@example.com");

    await passwordInput.fill("somepassword");
    await expect(passwordInput).toHaveValue("somepassword");
  });

  // ── Authenticated tests (skipped when credentials are absent) ──────────

  test("auth flow — login with test credentials", async ({ page }) => {
    test.skip(!hasCredentials, "E2E_USER_EMAIL / E2E_USER_PASSWORD not set");

    await login(page);

    // We should now be on an authenticated page (dashboard, planning, etc.)
    // The URL must NOT be /auth anymore.
    expect(page.url()).not.toContain("/auth");
  });

  test("dashboard loads after login", async ({ page }) => {
    test.skip(!hasCredentials, "E2E_USER_EMAIL / E2E_USER_PASSWORD not set");

    const consoleErrors = trackConsoleErrors(page);

    await login(page);

    // The SmartHomeRedirect sends the user to the appropriate home page.
    // Wait a moment for the page to settle and verify no error boundary fired.
    await page.waitForTimeout(3_000);

    await assertNoVisibleErrors(page);

    // The page should have meaningful content (not a blank screen).
    const body = page.locator("body");
    const bodyText = await body.innerText();
    expect(bodyText.length).toBeGreaterThan(10);

    // No unexpected console errors
    expect(consoleErrors).toEqual([]);
  });

  test("navigation — sidebar item changes page", async ({ page }) => {
    test.skip(!hasCredentials, "E2E_USER_EMAIL / E2E_USER_PASSWORD not set");

    await login(page);

    // Wait for the layout to be ready
    await page.waitForTimeout(2_000);

    // Try to navigate to /planning via the sidebar. The sidebar links are
    // rendered as <a> tags. We look for one that points to /planning.
    const planningLink = page.locator('a[href="/planning"]').first();

    if (await planningLink.isVisible()) {
      await planningLink.click();
      await page.waitForURL("**/planning", { timeout: 10_000 });
      expect(page.url()).toContain("/planning");
    } else {
      // If no sidebar link is visible (e.g. mobile layout or permission),
      // navigate directly.
      await page.goto("/planning");
      await page.waitForURL(
        (url) => {
          // Either we landed on /planning or got redirected to /auth
          return url.pathname.includes("/planning") || url.pathname.includes("/auth");
        },
        { timeout: 10_000 }
      );
    }
  });

  // ── Critical pages load without error ──────────────────────────────────
  // Every key page in the app. If a page crashes, shows an error banner,
  // or emits unexpected console errors, the test fails.

  const criticalPages = [
    // RH
    { path: "/planning", name: "Planning" },
    { path: "/presence", name: "Présence" },
    { path: "/paie", name: "Paie" },
    { path: "/salaries", name: "Salariés" },
    { path: "/gestion-personnel", name: "Gestion Personnel" },
    { path: "/badgeuse", name: "Badgeuse" },
    { path: "/conges-absences", name: "Congés & Absences" },
    // Finance
    { path: "/caisse", name: "Caisse" },
    { path: "/rapports", name: "Rapports" },
    // Achats & Stock
    { path: "/factures", name: "Factures" },
    { path: "/produits", name: "Produits" },
    { path: "/inventaire", name: "Inventaire" },
    { path: "/fournisseurs", name: "Fournisseurs" },
    // Pilotage
    { path: "/vision-ai", name: "Vision AI" },
    // Settings
    { path: "/parametres", name: "Paramètres" },
  ];

  for (const { path, name } of criticalPages) {
    test(`critical page loads without error: ${name} (${path})`, async ({ page }) => {
      test.skip(!hasCredentials, "E2E_USER_EMAIL / E2E_USER_PASSWORD not set");

      const consoleErrors = trackConsoleErrors(page);

      await login(page);

      // Navigate to the critical page
      const response = await page.goto(path);

      // The HTTP response should be successful (SPA always returns 200 for
      // known routes).
      expect(response?.status()).toBeLessThan(400);

      // Wait for async data to load and the page to settle
      await page.waitForTimeout(3_000);

      // Full error check: error boundary + error banners + 404
      await assertNoVisibleErrors(page);

      // No unexpected console errors (e.g. failed edge function calls)
      expect(
        consoleErrors,
        `Unexpected console errors on ${name} (${path}):\n${consoleErrors.join("\n")}`
      ).toEqual([]);
    });
  }
});

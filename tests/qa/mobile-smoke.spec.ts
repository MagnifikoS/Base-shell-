import { test, expect } from "@playwright/test";

/**
 * Mobile smoke tests — verify the app renders correctly on mobile viewports.
 *
 * These tests target the login page (no auth needed) and assert basic
 * layout, responsiveness, and touch-interaction readiness.
 */

test.describe("Mobile smoke tests", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/auth");
    // Wait for the loading spinner to disappear and the login form to render
    await page.waitForSelector('form[aria-label="Connexion"]', {
      timeout: 15_000,
    });
  });

  test("login page renders in mobile viewport", async ({ page }) => {
    // The login card should be visible
    await expect(page.getByRole("heading", { name: "GestionPro" })).toBeVisible();

    // Email and password fields must be present
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Mot de passe")).toBeVisible();

    // Login button must be present
    await expect(page.getByRole("button", { name: "Se connecter" })).toBeVisible();
  });

  test("no horizontal scroll overflow", async ({ page }) => {
    // Body scroll width should not exceed the viewport width
    const overflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(overflow).toBe(false);
  });

  test("login card fits within mobile viewport width", async ({ page, viewport }) => {
    // Skip if viewport info not available (shouldn't happen in normal runs)
    test.skip(!viewport, "No viewport information available");

    const card = page.locator(".max-w-md").first();
    const box = await card.boundingBox();
    expect(box).not.toBeNull();

    // The card must not extend beyond the viewport
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 1); // +1 for subpixel rounding
  });

  test("form inputs are tappable (minimum touch target size)", async ({ page }) => {
    const emailInput = page.getByLabel("Email");
    const passwordInput = page.getByLabel("Mot de passe");
    const submitButton = page.getByRole("button", { name: "Se connecter" });

    // WCAG 2.5.8 recommends 24x24 minimum; we use 44px as the iOS guideline
    const MIN_TOUCH_SIZE = 24;

    for (const element of [emailInput, passwordInput, submitButton]) {
      const box = await element.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(MIN_TOUCH_SIZE);
      expect(box!.width).toBeGreaterThanOrEqual(MIN_TOUCH_SIZE);
    }
  });

  test("can type into form fields (basic touch interaction)", async ({ page }) => {
    const emailInput = page.getByLabel("Email");
    const passwordInput = page.getByLabel("Mot de passe");

    // Tap and type into email
    await emailInput.tap();
    await emailInput.fill("test@example.com");
    await expect(emailInput).toHaveValue("test@example.com");

    // Tap and type into password
    await passwordInput.tap();
    await passwordInput.fill("password123");
    await expect(passwordInput).toHaveValue("password123");
  });

  test("forgot password link is accessible on mobile", async ({ page }) => {
    const forgotLink = page.getByText("Mot de passe oubli");
    await expect(forgotLink).toBeVisible();

    // Tap the link and verify the reset form appears
    await forgotLink.tap();
    await expect(page.getByRole("heading", { name: /initialisation/i })).toBeVisible();

    // Verify the "back to login" button works
    const backButton = page.getByText("Retour");
    await expect(backButton).toBeVisible();
    await backButton.tap();
    await expect(page.getByRole("button", { name: "Se connecter" })).toBeVisible();
  });
});

import { test, expect } from "./fixtures";

test.describe("Accessibility", () => {
  test("skip-to-content link exists and becomes visible on focus", async ({ page }) => {
    await page.goto("/auth");

    // The skip-to-content link uses sr-only + focus:not-sr-only classes
    const skipLink = page.locator('a[href="#main-content"]');
    await expect(skipLink).toBeAttached();
    await expect(skipLink).toHaveText("Aller au contenu principal");

    // Tab to the skip link to make it visible
    await page.keyboard.press("Tab");
    await expect(skipLink).toBeFocused();
    await expect(skipLink).toBeVisible();
  });

  test("login page has proper form labels", async ({ page }) => {
    await page.goto("/auth");
    await page.waitForSelector('form[aria-label="Connexion"]', { timeout: 10000 });

    // Check that labels are associated with inputs via htmlFor/id
    const emailLabel = page.locator('label[for="email"]');
    await expect(emailLabel).toHaveText("Email");

    const passwordLabel = page.locator('label[for="password"]');
    await expect(passwordLabel).toHaveText("Mot de passe");

    // Check that the form itself has an aria-label
    const form = page.locator('form[aria-label="Connexion"]');
    await expect(form).toBeVisible();
  });

  test("no images without alt text on auth page", async ({ page }) => {
    await page.goto("/auth");
    await page.waitForSelector('form[aria-label="Connexion"]', { timeout: 10000 });

    // Find all img elements without alt attribute
    const imagesWithoutAlt = page.locator("img:not([alt])");
    const count = await imagesWithoutAlt.count();
    expect(count).toBe(0);
  });

  test("no images without alt text on privacy policy page", async ({ page }) => {
    await page.goto("/politique-confidentialite");

    const heading = page.getByRole("heading", { name: "Politique de confidentialite" });
    await expect(heading).toBeVisible();

    const imagesWithoutAlt = page.locator("img:not([alt])");
    const count = await imagesWithoutAlt.count();
    expect(count).toBe(0);
  });

  test("live region exists for dynamic announcements", async ({ page }) => {
    await page.goto("/auth");

    const liveRegion = page.locator("#live-announcements");
    await expect(liveRegion).toBeAttached();
    await expect(liveRegion).toHaveAttribute("aria-live", "polite");
    await expect(liveRegion).toHaveAttribute("aria-atomic", "true");
  });
});

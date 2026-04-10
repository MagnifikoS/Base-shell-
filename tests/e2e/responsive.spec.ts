import { test, expect } from "./fixtures";

test.describe("Responsive - Desktop viewport", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test("auth page renders properly on desktop", async ({ page }) => {
    await page.goto("/auth");
    await page.waitForSelector('form[aria-label="Connexion"]', { timeout: 10000 });

    const card = page.locator(".max-w-md");
    await expect(card).toBeVisible();

    const title = page.getByText("GestionPro");
    await expect(title).toBeVisible();
  });

  test("404 page renders properly on desktop", async ({ page }) => {
    await page.goto("/nonexistent-route");

    const heading = page.locator("h1");
    await expect(heading).toHaveText("404");
    await expect(heading).toBeVisible();
  });
});

test.describe("Responsive - Mobile viewport", () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test("auth page renders properly on mobile (375px)", async ({ page }) => {
    await page.goto("/auth");
    await page.waitForSelector('form[aria-label="Connexion"]', { timeout: 10000 });

    const card = page.locator(".max-w-md");
    await expect(card).toBeVisible();

    const title = page.getByText("GestionPro");
    await expect(title).toBeVisible();

    // Verify the form inputs are visible and usable on mobile
    const emailInput = page.locator("#email");
    const passwordInput = page.locator("#password");
    await expect(emailInput).toBeVisible();
    await expect(passwordInput).toBeVisible();
  });

  test("404 page renders properly on mobile (375px)", async ({ page }) => {
    await page.goto("/nonexistent-route");

    const heading = page.locator("h1");
    await expect(heading).toHaveText("404");
    await expect(heading).toBeVisible();

    const message = page.getByText("Page non trouvée");
    await expect(message).toBeVisible();
  });

  test("privacy policy page is readable on mobile", async ({ page }) => {
    await page.goto("/politique-confidentialite");

    const heading = page.getByRole("heading", { name: "Politique de confidentialite" });
    await expect(heading).toBeVisible();

    // Ensure content sections are visible
    const section1 = page.getByText("1. Responsable du traitement");
    await expect(section1).toBeVisible();
  });
});

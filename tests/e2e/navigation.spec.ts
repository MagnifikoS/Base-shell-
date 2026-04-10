import { test, expect } from "./fixtures";

test.describe("Navigation", () => {
  test('404 page renders for unknown route with "Page non trouvee"', async ({ page }) => {
    await page.goto("/this-route-does-not-exist");

    const heading = page.locator("h1");
    await expect(heading).toHaveText("404");

    const message = page.getByText("Page non trouvée");
    await expect(message).toBeVisible();

    const homeLink = page.getByText("Retour à l'accueil");
    await expect(homeLink).toBeVisible();
    await expect(homeLink).toHaveAttribute("href", "/");
  });

  test("/auth is accessible as a public route", async ({ page }) => {
    const response = await page.goto("/auth");
    expect(response?.status()).toBeLessThan(400);

    // Should show the login form or at least the GestionPro title
    // (may show loading spinner first while checking admin_exists)
    const card = page.locator(".max-w-md");
    await expect(card).toBeVisible({ timeout: 10000 });
  });

  test("/politique-confidentialite is accessible as a public route", async ({ page }) => {
    const response = await page.goto("/politique-confidentialite");
    expect(response?.status()).toBeLessThan(400);

    const heading = page.getByRole("heading", { name: "Politique de confidentialite" });
    await expect(heading).toBeVisible();
  });

  test("protected route /planning redirects to /auth when not logged in", async ({ page }) => {
    await page.goto("/planning");
    await page.waitForURL("**/auth", { timeout: 10000 });
    expect(page.url()).toContain("/auth");
  });

  test("protected route /salaries redirects to /auth when not logged in", async ({ page }) => {
    await page.goto("/salaries");
    await page.waitForURL("**/auth", { timeout: 10000 });
    expect(page.url()).toContain("/auth");
  });

  test("protected route /admin redirects to /auth when not logged in", async ({ page }) => {
    await page.goto("/admin");
    await page.waitForURL("**/auth", { timeout: 10000 });
    expect(page.url()).toContain("/auth");
  });
});

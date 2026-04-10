import { test, expect } from "./fixtures";

test.describe("Public pages", () => {
  test("/politique-confidentialite renders privacy policy content", async ({ page }) => {
    await page.goto("/politique-confidentialite");

    // Page heading
    const heading = page.getByRole("heading", { name: "Politique de confidentialite" });
    await expect(heading).toBeVisible();

    // Check key sections are rendered
    await expect(page.getByText("1. Responsable du traitement")).toBeVisible();
    await expect(page.getByText("2. Donnees personnelles collectees")).toBeVisible();
    await expect(page.getByText("3. Bases legales du traitement")).toBeVisible();
    await expect(page.getByText("4. Durees de conservation")).toBeVisible();
    await expect(page.getByText("5. Mesures de securite")).toBeVisible();
    await expect(page.getByText("6. Sous-traitants et transferts hors UE")).toBeVisible();
    await expect(page.getByText("7. Vos droits")).toBeVisible();
    await expect(page.getByText("8. Cookies et stockage local")).toBeVisible();
    await expect(page.getByText("9. Contact")).toBeVisible();

    // Check the RGPD reference in the footer
    await expect(page.getByText(/Reglement General sur la Protection des Donnees/)).toBeVisible();

    // Check the back button exists
    const backButton = page.locator('a[href="/auth"] button[aria-label="Retour"]');
    await expect(backButton).toBeVisible();
  });

  test("/auth renders login form with all expected elements", async ({ page }) => {
    await page.goto("/auth");
    await page.waitForSelector('form[aria-label="Connexion"]', { timeout: 10000 });

    // App title
    await expect(page.getByText("GestionPro")).toBeVisible();

    // Description
    await expect(page.getByText("Connectez-vous à votre compte")).toBeVisible();

    // Form elements
    await expect(page.locator("#email")).toBeVisible();
    await expect(page.locator("#password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Se connecter" })).toBeVisible();

    // Forgot password link
    await expect(page.getByText("Mot de passe oublié ?")).toBeVisible();

    // Privacy policy link
    await expect(page.getByText("Politique de confidentialite")).toBeVisible();
  });

  test("/bootstrap renders the first-launch setup form", async ({ page }) => {
    await page.goto("/bootstrap");

    // Bootstrap page either shows the setup form or redirects to /auth
    // (depending on whether admin_exists returns true)
    // We wait for either the form or a redirect to /auth
    await Promise.race([
      page.waitForSelector('form[aria-label="Création du compte administrateur"]', {
        timeout: 10000,
      }),
      page.waitForURL("**/auth", { timeout: 10000 }),
    ]);

    const currentUrl = page.url();
    if (currentUrl.includes("/bootstrap")) {
      // The bootstrap form is showing
      await expect(page.getByText("Premier lancement")).toBeVisible();
      await expect(page.locator("#org-name")).toBeVisible();
      await expect(page.locator("#full-name")).toBeVisible();
      await expect(page.locator("#email")).toBeVisible();
      await expect(page.locator("#password")).toBeVisible();
      await expect(page.getByRole("button", { name: /Créer l'administrateur/ })).toBeVisible();
    } else {
      // Admin already exists, redirected to /auth
      expect(currentUrl).toContain("/auth");
    }
  });
});

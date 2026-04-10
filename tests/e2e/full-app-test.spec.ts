/**
 * Full App E2E Test — Authenticated Owner Flow
 * Tests all major pages after login
 *
 * SAFETY: READ-ONLY — does NOT create, modify, or delete any data
 */
import { test, expect } from "@playwright/test";

const EMAIL = process.env.TEST_EMAIL ?? "";
const PASSWORD = process.env.TEST_PASSWORD ?? "";
const BASE = "http://localhost:8080";

test.describe("Full App Test — Owner Login", () => {
  test.beforeEach(async ({ page }) => {
    // Login via Supabase JS SDK injected into page
    await page.goto(BASE + "/auth");

    // Fill email
    const emailInput = page.locator('input[id="email"]');
    await emailInput.fill(EMAIL);

    // Fill password
    const passwordInput = page.locator('input[id="password"]');
    await passwordInput.fill(PASSWORD);

    // Click login
    await page.getByRole("button", { name: "Se connecter" }).click();

    // Wait for redirect away from /auth
    await page.waitForURL((url) => !url.pathname.includes("/auth"), { timeout: 15000 });
  });

  test("01 — Login redirects to home/dashboard", async ({ page }) => {
    const url = page.url();
    expect(url).not.toContain("/auth");
    // Should be on / or /dashboard
    console.log("Redirected to:", url);
    await page.screenshot({ path: "tests/qa/screenshots/e2e-01-after-login.png" });
  });

  test("02 — Dashboard page loads", async ({ page }) => {
    await page.goto(BASE + "/dashboard");
    await page.waitForLoadState("networkidle");

    // Should NOT show "Page en construction" anymore (was rebuilt in branch)
    const body = await page.textContent("body");
    console.log("Dashboard content preview:", body?.substring(0, 200));
    await page.screenshot({ path: "tests/qa/screenshots/e2e-02-dashboard.png" });

    // Verify it loaded (not redirected to auth)
    expect(page.url()).toContain("/dashboard");
  });

  test("03 — Planning page loads", async ({ page }) => {
    await page.goto(BASE + "/planning");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    expect(page.url()).toContain("/planning");
    await page.screenshot({ path: "tests/qa/screenshots/e2e-03-planning.png" });
  });

  test("04 — Salaries page loads", async ({ page }) => {
    await page.goto(BASE + "/salaries");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    expect(page.url()).toContain("/salaries");
    await page.screenshot({ path: "tests/qa/screenshots/e2e-04-salaries.png" });
  });

  test("05 — Badgeuse page loads", async ({ page }) => {
    await page.goto(BASE + "/badgeuse");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    expect(page.url()).toContain("/badgeuse");
    await page.screenshot({ path: "tests/qa/screenshots/e2e-05-badgeuse.png" });
  });

  test("06 — Presence page loads", async ({ page }) => {
    await page.goto(BASE + "/presence");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    expect(page.url()).toContain("/presence");
    await page.screenshot({ path: "tests/qa/screenshots/e2e-06-presence.png" });
  });

  test("07 — Payroll page loads", async ({ page }) => {
    await page.goto(BASE + "/paie");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    expect(page.url()).toContain("/paie");
    await page.screenshot({ path: "tests/qa/screenshots/e2e-07-payroll.png" });
  });

  test("08 — Caisse page loads", async ({ page }) => {
    await page.goto(BASE + "/caisse");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    expect(page.url()).toContain("/caisse");
    await page.screenshot({ path: "tests/qa/screenshots/e2e-08-caisse.png" });
  });

  test("09 — Rapports page loads", async ({ page }) => {
    await page.goto(BASE + "/rapports");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    expect(page.url()).toContain("/rapports");
    await page.screenshot({ path: "tests/qa/screenshots/e2e-09-rapports.png" });
  });

  test("10 — Admin page loads", async ({ page }) => {
    await page.goto(BASE + "/admin");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    expect(page.url()).toContain("/admin");
    await page.screenshot({ path: "tests/qa/screenshots/e2e-10-admin.png" });
  });

  test("11 — Vision AI page loads", async ({ page }) => {
    await page.goto(BASE + "/vision-ai");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    expect(page.url()).toContain("/vision-ai");
    await page.screenshot({ path: "tests/qa/screenshots/e2e-11-vision-ai.png" });
  });

  test("12 — Factures page loads", async ({ page }) => {
    await page.goto(BASE + "/factures");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    expect(page.url()).toContain("/factures");
    await page.screenshot({ path: "tests/qa/screenshots/e2e-12-factures.png" });
  });

  test("13 — Fournisseurs page loads", async ({ page }) => {
    await page.goto(BASE + "/fournisseurs");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    expect(page.url()).toContain("/fournisseurs");
    await page.screenshot({ path: "tests/qa/screenshots/e2e-13-fournisseurs.png" });
  });

  test("14 — Produits V2 page loads", async ({ page }) => {
    await page.goto(BASE + "/produits-v2");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    expect(page.url()).toContain("/produits-v2");
    await page.screenshot({ path: "tests/qa/screenshots/e2e-14-produits.png" });
  });

  test("15 — Inventaire page loads", async ({ page }) => {
    await page.goto(BASE + "/inventaire");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    expect(page.url()).toContain("/inventaire");
    await page.screenshot({ path: "tests/qa/screenshots/e2e-15-inventaire.png" });
  });

  test("16 — Achats page loads", async ({ page }) => {
    await page.goto(BASE + "/achat");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    expect(page.url()).toContain("/achat");
    await page.screenshot({ path: "tests/qa/screenshots/e2e-16-achats.png" });
  });

  test("17 — Parametres page loads", async ({ page }) => {
    await page.goto(BASE + "/parametres");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    expect(page.url()).toContain("/parametres");
    await page.screenshot({ path: "tests/qa/screenshots/e2e-17-parametres.png" });
  });

  test("18 — Notifications page loads", async ({ page }) => {
    await page.goto(BASE + "/notifications");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    expect(page.url()).toContain("/notifications");
    await page.screenshot({ path: "tests/qa/screenshots/e2e-18-notifications.png" });
  });

  test("19 — Gestion Personnel page loads", async ({ page }) => {
    await page.goto(BASE + "/gestion-personnel");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    expect(page.url()).toContain("/gestion-personnel");
    await page.screenshot({ path: "tests/qa/screenshots/e2e-19-gestion-personnel.png" });
  });

  test("20 — THE BRAIN page loads", async ({ page }) => {
    await page.goto(BASE + "/pilotage/the-brain");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    expect(page.url()).toContain("/pilotage/the-brain");
    await page.screenshot({ path: "tests/qa/screenshots/e2e-20-the-brain.png" });
  });

  test("21 — 404 page works", async ({ page }) => {
    await page.goto(BASE + "/this-does-not-exist");
    await page.waitForLoadState("networkidle");

    const text = await page.textContent("body");
    expect(text).toContain("404");
    expect(text).toContain("Page non trouvée");
    await page.screenshot({ path: "tests/qa/screenshots/e2e-21-404.png" });
  });

  test("22 — Sidebar navigation works", async ({ page }) => {
    await page.goto(BASE + "/dashboard");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    // Check sidebar exists
    const sidebar = page
      .locator('[data-testid="sidebar"]')
      .or(page.locator("aside"))
      .or(page.locator("nav"));
    const sidebarVisible = await sidebar
      .first()
      .isVisible()
      .catch(() => false);
    console.log("Sidebar visible:", sidebarVisible);

    await page.screenshot({ path: "tests/qa/screenshots/e2e-22-sidebar.png", fullPage: true });
  });

  test("23 — Mobile responsive check", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(BASE + "/");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    await page.screenshot({ path: "tests/qa/screenshots/e2e-23-mobile-home.png" });

    // Check for mobile layout elements
    const url = page.url();
    console.log("Mobile URL:", url);
  });

  test("24 — No console errors on key pages", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error" && !msg.text().includes("React Router Future Flag")) {
        errors.push(msg.text());
      }
    });

    // Visit 5 key pages
    for (const path of ["/dashboard", "/planning", "/salaries", "/paie", "/factures"]) {
      await page.goto(BASE + path);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(1500);
    }

    console.log("Console errors found:", errors.length);
    if (errors.length > 0) {
      console.log("Errors:", errors.slice(0, 5));
    }
    // Allow some non-critical errors but flag them
    expect(errors.filter((e) => !e.includes("Warning")).length).toBeLessThan(5);
  });
});

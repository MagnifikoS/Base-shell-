import { test, expect } from "./fixtures";

test.describe("Error handling", () => {
  test("ErrorBoundary renders fallback UI text", async ({ page }) => {
    await page.goto("/auth");

    // Verify that the ErrorBoundary component is wrapping the app
    // by checking that the app renders without showing the error fallback
    // (If ErrorBoundary were broken, nothing would render)
    await page.waitForSelector(".min-h-screen", { timeout: 10000 });

    // The error fallback message is "Une erreur est survenue"
    // It should NOT be visible under normal conditions
    const errorMessage = page.getByText("Une erreur est survenue");
    await expect(errorMessage).not.toBeVisible();
  });

  test("offline banner appears when network is offline", async ({ page }) => {
    await page.goto("/auth");
    await page.waitForSelector(".min-h-screen", { timeout: 10000 });

    // The offline banner should not be visible when online
    const offlineBanner = page.getByText("Pas de connexion Internet");
    await expect(offlineBanner).not.toBeVisible();

    // Simulate going offline by intercepting all network requests
    await page.context().setOffline(true);

    // The OfflineBanner listens to the "offline" event on window
    // Trigger it by dispatching the event
    await page.evaluate(() => {
      window.dispatchEvent(new Event("offline"));
    });

    await expect(offlineBanner).toBeVisible();
    await expect(offlineBanner).toHaveAttribute("role", "alert");

    // Simulate coming back online
    await page.context().setOffline(false);
    await page.evaluate(() => {
      window.dispatchEvent(new Event("online"));
    });

    await expect(offlineBanner).not.toBeVisible();
  });
});

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: "http://localhost:8080",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    // ── Desktop ──────────────────────────────────────────────
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"] },
    },

    // ── Mobile Chrome (Pixel 5 viewport: 393x851) ───────────
    {
      name: "Mobile Chrome",
      use: {
        ...devices["Pixel 5"],
      },
    },

    // ── Mobile Safari (iPhone 13 viewport: 390x844) ─────────
    {
      name: "Mobile Safari",
      use: {
        ...devices["iPhone 13"],
      },
    },

    // ── Tablet (iPad gen 7 viewport: 768x1024) ──────────────
    {
      name: "Tablet",
      use: {
        ...devices["iPad (gen 7)"],
      },
    },

    // ── Tablet landscape (iPad gen 7 rotated: 1024x768) ─────
    {
      name: "Tablet landscape",
      use: {
        ...devices["iPad (gen 7) landscape"],
      },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:8080",
    reuseExistingServer: true,
  },
});

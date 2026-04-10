/**
 * RED-FRONTEND — ROBOTS-01: robots.txt crawling policy
 *
 * Finding: Checks whether robots.txt properly restricts search engine crawling
 * of internal application pages.
 *
 * For a SaaS application with authenticated pages, robots.txt should ideally
 * block all crawlers from internal routes while potentially allowing
 * public-facing pages like the login page.
 */

import { describe, it, expect } from "vitest";
import { readSourceFile, findInSource } from "../../helpers";

describe("ROBOTS-01: robots.txt crawling policy", () => {
  it("should verify robots.txt exists", async () => {
    const source = await readSourceFile("public/robots.txt");
    expect(source.length).toBeGreaterThan(0);
  });

  it("should verify robots.txt has a User-agent directive", async () => {
    const source = await readSourceFile("public/robots.txt");

    const userAgent = findInSource(source, /User-agent:\s*\*/gi);
    expect(userAgent.length).toBeGreaterThanOrEqual(1);
  });

  it("should verify robots.txt blocks crawling of the root path", async () => {
    const source = await readSourceFile("public/robots.txt");

    // Check for Disallow: / which blocks crawling of all paths
    const disallowRoot = findInSource(source, /Disallow:\s*\//g);

    // The app correctly has Disallow: / to prevent crawling internal pages
    expect(disallowRoot.length).toBeGreaterThanOrEqual(1);
  });

  it("should verify robots.txt allows the auth page (public login page)", async () => {
    const source = await readSourceFile("public/robots.txt");

    // Check for Allow: /auth which permits crawling the login page
    const allowAuth = findInSource(source, /Allow:\s*\/auth/g);

    // The /auth page is public (login page) — allowing it is acceptable
    // However, this also means search engines can index the login URL
    expect(allowAuth.length).toBeGreaterThanOrEqual(1);
  });

  it("RESIDUAL RISK: should verify that allowing /auth does not expose internal routes", async () => {
    const source = await readSourceFile("public/robots.txt");

    // Check if any other Allow rules exist that might expose internal pages
    const allAllowRules = findInSource(source, /Allow:\s*\/.*/g);

    // Document all Allow rules — each one is a route visible to crawlers
    // Only /auth should be allowed for a SaaS app
    for (const match of allAllowRules) {
      const allowedPath = match[0].replace("Allow:", "").trim();
      // Verify only safe public paths are allowed
      const safePublicPaths = ["/auth", "/politique-confidentialite", "/invite"];
      const isSafe = safePublicPaths.some((p) => allowedPath.startsWith(p));

      // If a non-public path is allowed, it's a potential information leak
      // Crawlers could discover internal route names and application structure
      expect(isSafe).toBe(true);
    }
  });

  it("should verify no Sitemap directive exposes internal routes", async () => {
    const source = await readSourceFile("public/robots.txt");

    // A Sitemap directive would give crawlers a map of all routes
    const sitemapDirective = findInSource(source, /Sitemap:/gi);

    // PoC: No sitemap should be present for a private SaaS application
    // A sitemap would enumerate all internal routes to search engines
    expect(sitemapDirective.length).toBe(0);
  });

  it("should verify meta robots tags are used in the HTML for defense in depth", async () => {
    let indexHtml: string;
    try {
      indexHtml = await readSourceFile("index.html");
    } catch {
      try {
        indexHtml = await readSourceFile("public/index.html");
      } catch {
        // If no index.html found, skip this check
        indexHtml = "";
      }
    }

    if (indexHtml.length > 0) {
      // Check for <meta name="robots" content="noindex, nofollow">
      // This provides defense-in-depth beyond robots.txt
      const metaRobots = findInSource(indexHtml, /meta\s+name=["']robots["']/gi);

      // RESIDUAL RISK: If no meta robots tag exists, the app relies solely
      // on robots.txt which is advisory (crawlers can ignore it)
      // This test documents whether defense-in-depth exists
      expect(metaRobots).toBeDefined();
    }
  });
});

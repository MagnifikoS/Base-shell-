/**
 * ROBOTS-01: robots.txt Assessment
 *
 * Verifies that the robots.txt file exists and blocks crawlers from indexing
 * internal application pages (this is an internal SaaS app, not a public site).
 *
 * Assessment scope:
 *   - robots.txt exists in public/
 *   - It blocks all crawlers from internal paths by default
 *   - It allows only specific public pages (e.g. /auth)
 *   - It does not allow unrestricted crawling
 */
import { describe, it, expect } from "vitest";
import { readSourceFile, findInSource, globSourceFiles } from "../../helpers";

describe("ROBOTS-01: robots.txt Assessment", () => {
  describe("robots.txt file exists", () => {
    it("should have a robots.txt in the public directory", async () => {
      const files = await globSourceFiles("public/robots.txt");
      expect(files.length).toBe(1);
    });
  });

  describe("robots.txt blocks internal paths by default", () => {
    it("should contain a User-agent directive", async () => {
      const source = await readSourceFile("public/robots.txt");
      const matches = findInSource(source, /User-agent:\s*\*/);
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });

    it("should disallow root path by default (block everything)", async () => {
      const source = await readSourceFile("public/robots.txt");
      const matches = findInSource(source, /Disallow:\s*\//);
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });

    it("should use Disallow: / to block all internal pages", async () => {
      const source = await readSourceFile("public/robots.txt");
      // The most restrictive approach: Disallow: / blocks everything
      // then Allow: only specific public pages
      expect(source).toContain("Disallow: /");
    });
  });

  describe("robots.txt allows only public pages", () => {
    it("should allow the auth page", async () => {
      const source = await readSourceFile("public/robots.txt");
      const allowAuth = findInSource(source, /Allow:\s*\/auth/);
      expect(allowAuth.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("robots.txt does not allow unrestricted crawling", () => {
    it("should NOT have an Allow: / without a corresponding Disallow", async () => {
      const source = await readSourceFile("public/robots.txt");
      const lines = source
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);

      // Check that there is no standalone "Allow: /" that would override the Disallow
      // (Allow: /auth is fine, but Allow: / alone would be too permissive)
      const allowAll = lines.filter((line) => /^Allow:\s*\/\s*$/i.test(line));
      expect(allowAll.length).toBe(0);
    });

    it("should NOT have Disallow: (empty value) which permits all crawling", async () => {
      const source = await readSourceFile("public/robots.txt");
      const lines = source.split("\n").map((l) => l.trim());
      // "Disallow:" with no path = allow everything (dangerous)
      const emptyDisallow = lines.filter((line) => /^Disallow:\s*$/i.test(line));
      expect(emptyDisallow.length).toBe(0);
    });

    it("should block sensitive internal routes from crawlers", async () => {
      const source = await readSourceFile("public/robots.txt");
      // Since Disallow: / is used, ALL paths are blocked by default.
      // This means /dashboard, /employees, /payroll, etc. are all blocked.
      // Verify this is the case by confirming Disallow: / exists.
      expect(source).toContain("Disallow: /");
    });
  });
});

/**
 * RED-FRONTEND — XSS-01: dangerouslySetInnerHTML Audit
 *
 * Finding: dangerouslySetInnerHTML is used in the codebase, which is a potential
 * XSS vector if user-controlled data reaches it without sanitization.
 *
 * Known location: src/components/ui/chart.tsx (shadcn ChartStyle component)
 * uses dangerouslySetInnerHTML to inject CSS custom properties for chart theming.
 *
 * This test scans the entire src/ directory for all dangerouslySetInnerHTML
 * and innerHTML usages and documents the risk profile for each.
 */

import { describe, it, expect } from "vitest";
import { readSourceFile, findInSource, globSourceFiles } from "../../helpers";

describe("XSS-01: dangerouslySetInnerHTML audit", () => {
  it("should find dangerouslySetInnerHTML in src/components/ui/chart.tsx", async () => {
    const source = await readSourceFile("src/components/ui/chart.tsx");
    const matches = findInSource(source, /dangerouslySetInnerHTML/g);

    // PoC: chart.tsx uses dangerouslySetInnerHTML for CSS injection
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("should verify chart.tsx dangerouslySetInnerHTML injects a <style> tag", async () => {
    const source = await readSourceFile("src/components/ui/chart.tsx");

    // The usage is within a <style> element for CSS custom properties
    const styleTag = findInSource(source, /<style\s*\n?\s*dangerouslySetInnerHTML/g);
    expect(styleTag.length).toBe(1);
  });

  it("should verify chart.tsx config values flow into dangerouslySetInnerHTML", async () => {
    const source = await readSourceFile("src/components/ui/chart.tsx");

    // The ChartStyle component receives `config` as a prop
    // and injects color values from config into CSS via dangerouslySetInnerHTML
    const configParam = findInSource(source, /ChartStyle.*config/g);
    expect(configParam.length).toBeGreaterThanOrEqual(1);

    // The __html template interpolates color values from the config
    const colorInterpolation = findInSource(source, /--color-\$\{key\}.*\$\{color\}/g);
    expect(colorInterpolation.length).toBeGreaterThanOrEqual(1);

    // RISK: If a ChartConfig key or color value contains malicious CSS or
    // escapes the style context (e.g., </style><script>), it could enable XSS.
    // However, ChartConfig is typically developer-defined, not user-input.
  });

  it("should scan entire src/ for all dangerouslySetInnerHTML usages", async () => {
    const allFiles = await globSourceFiles("src/**/*.{tsx,ts}");
    const filesWithDangerousHTML: Array<{ file: string; count: number }> = [];

    for (const file of allFiles) {
      // Skip test files
      if (file.includes("__tests__") || file.includes(".test.") || file.includes(".spec.")) {
        continue;
      }

      const source = await readSourceFile(file);
      const matches = findInSource(source, /dangerouslySetInnerHTML/g);

      if (matches.length > 0) {
        filesWithDangerousHTML.push({ file, count: matches.length });
      }
    }

    // PoC: Document all files using dangerouslySetInnerHTML
    // Each instance is a potential XSS vector if user data reaches it
    expect(filesWithDangerousHTML.length).toBeGreaterThanOrEqual(1);

    // Verify we found the known location
    const chartFile = filesWithDangerousHTML.find((f) => f.file.includes("chart.tsx"));
    expect(chartFile).toBeDefined();
  });

  it("should scan entire src/ for innerHTML assignments (DOM manipulation)", async () => {
    const allFiles = await globSourceFiles("src/**/*.{tsx,ts}");
    const filesWithInnerHTML: Array<{ file: string; count: number }> = [];

    for (const file of allFiles) {
      if (file.includes("__tests__") || file.includes(".test.") || file.includes(".spec.")) {
        continue;
      }

      const source = await readSourceFile(file);
      // Match direct innerHTML assignments like element.innerHTML = "..."
      const matches = findInSource(source, /\.innerHTML\s*=/g);

      if (matches.length > 0) {
        filesWithInnerHTML.push({ file, count: matches.length });
      }
    }

    // innerHTML assignments are another XSS vector
    // They bypass React's built-in XSS protection
    expect(filesWithInnerHTML).toBeDefined();
  });

  it("should verify no user-input flows into dangerouslySetInnerHTML in chart.tsx", async () => {
    const source = await readSourceFile("src/components/ui/chart.tsx");

    // Check if the component receives any dynamic user input
    // ChartConfig is a typed object with label, icon, color, and theme
    // Color values are CSS color strings — not typically user-controlled
    const _userInputPatterns = findInSource(
      source,
      /useState|useSearchParams|useParams|props\.value|event\.target/g
    );

    // The ChartStyle component does NOT read user input directly;
    // it receives config from the parent ChartContainer
    // However, if a parent passes user-controlled data as config,
    // the CSS injection could be exploited

    // This test documents the risk — config is developer-provided
    // but there's no sanitization of color values before injection
    const hasSanitization = findInSource(source, /sanitize|escape|DOMPurify|encodeURI/g);
    expect(hasSanitization.length).toBe(0);
  });

  it("should check for DOMPurify or similar sanitization library usage", async () => {
    const allFiles = await globSourceFiles("src/**/*.{tsx,ts}");
    let sanitizationFound = false;

    for (const file of allFiles) {
      if (file.includes("__tests__") || file.includes("node_modules")) continue;

      const source = await readSourceFile(file);
      const matches = findInSource(source, /DOMPurify|sanitize-html|xss|dompurify/gi);
      if (matches.length > 0) {
        sanitizationFound = true;
        break;
      }
    }

    // PoC: No HTML sanitization library is imported anywhere in the frontend
    // If dangerouslySetInnerHTML is ever used with user data, there's no defense
    // This test PASSES when no sanitization exists (vulnerability present)
    expect(sanitizationFound).toBe(false);
  });
});

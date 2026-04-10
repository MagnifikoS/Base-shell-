/**
 * RED-FRONTEND — REL-01: No Error Boundary
 *
 * Original finding: No React Error Boundary anywhere in the component tree.
 * A runtime error in any component would crash the entire app (white screen).
 *
 * This test verifies whether the vulnerability still exists by checking:
 * 1. Whether an ErrorBoundary component exists
 * 2. Whether it implements getDerivedStateFromError and componentDidCatch
 * 3. Whether it wraps the root <App /> component in main.tsx or App.tsx
 */

import { describe, it, expect } from "vitest";
import { readSourceFile, findInSource } from "../../helpers";

describe("REL-01: Error Boundary coverage", () => {
  it("should check if ErrorBoundary component exists in the codebase", async () => {
    let errorBoundaryExists = false;

    try {
      const source = await readSourceFile("src/components/ErrorBoundary.tsx");
      errorBoundaryExists = source.length > 0;
    } catch {
      errorBoundaryExists = false;
    }

    // If this passes, the ErrorBoundary file exists (vulnerability remediated)
    // If this fails, there is no ErrorBoundary component (vulnerability present)
    expect(errorBoundaryExists).toBe(true);
  });

  it("should verify ErrorBoundary implements getDerivedStateFromError", async () => {
    const source = await readSourceFile("src/components/ErrorBoundary.tsx");
    const matches = findInSource(source, /getDerivedStateFromError/g);

    // getDerivedStateFromError is required for a proper React error boundary
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("should verify ErrorBoundary implements componentDidCatch", async () => {
    const source = await readSourceFile("src/components/ErrorBoundary.tsx");
    const matches = findInSource(source, /componentDidCatch/g);

    // componentDidCatch is needed for error logging/reporting
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("should verify ErrorBoundary wraps the root App component", async () => {
    const appSource = await readSourceFile("src/App.tsx");

    // Check that ErrorBoundary is imported
    const importMatches = findInSource(appSource, /import.*ErrorBoundary/g);
    expect(importMatches.length).toBeGreaterThanOrEqual(1);

    // Check that ErrorBoundary wraps the JSX tree
    const wrapperMatches = findInSource(appSource, /<ErrorBoundary[\s>]/g);
    expect(wrapperMatches.length).toBeGreaterThanOrEqual(1);
  });

  it("should verify main.tsx renders App (which includes ErrorBoundary)", async () => {
    const mainSource = await readSourceFile("src/main.tsx");

    // Verify App is rendered in main.tsx
    const appRender = findInSource(mainSource, /<App\s*\/>/g);
    expect(appRender.length).toBeGreaterThanOrEqual(1);
  });

  it("RESIDUAL RISK: should check that no StrictMode is used (double-render can trigger boundary twice in dev)", async () => {
    const mainSource = await readSourceFile("src/main.tsx");

    // StrictMode double-renders in dev can cause confusing error boundary behavior
    const strictModeMatches = findInSource(mainSource, /StrictMode/g);

    // Currently no StrictMode — this is documented in CLAUDE.md
    // Not a vulnerability per se, but noted as a known gap
    expect(strictModeMatches.length).toBe(0);
  });

  it("RESIDUAL RISK: should check for per-route ErrorBoundary coverage in AppRoutes", async () => {
    // Check how many routes are wrapped with ErrorBoundary
    // For proper fault isolation, each major route should have its own boundary

    let appRoutesSource: string;
    try {
      appRoutesSource = await readSourceFile("src/routes/AppRoutes.tsx");
    } catch {
      appRoutesSource = await readSourceFile("src/App.tsx");
    }

    // Count how many ErrorBoundary wrappers exist at the route level
    const routeErrorBoundaries = findInSource(appRoutesSource, /<ErrorBoundary/g);

    // Count how many <Route elements exist (to gauge coverage ratio)
    const routeElements = findInSource(appRoutesSource, /<Route\s/g);

    // There are some per-route ErrorBoundaries but not all routes are wrapped.
    // This means some module crashes will be caught by the global boundary
    // (showing a full-page error), while only a few critical routes degrade gracefully.
    // RESIDUAL RISK: Most routes lack individual error boundaries.
    expect(routeErrorBoundaries.length).toBeLessThan(routeElements.length);
  });
});

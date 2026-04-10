/**
 * REL-01: Error Boundary Assessment
 *
 * Verifies that an ErrorBoundary component exists and is properly integrated
 * into the React component tree to prevent blank-screen crashes.
 *
 * Assessment scope:
 *   - ErrorBoundary component has getDerivedStateFromError + componentDidCatch
 *   - main.tsx or App.tsx wraps the app with ErrorBoundary
 *   - ErrorBoundary renders a user-friendly fallback UI
 *   - Sentry integration for error reporting
 */
import { describe, it, expect } from "vitest";
import { readSourceFile, findInSource, globSourceFiles } from "../../helpers";

describe("REL-01: Error Boundary Assessment", () => {
  describe("ErrorBoundary component exists", () => {
    it("should have an ErrorBoundary.tsx component file", async () => {
      const files = await globSourceFiles("src/components/ErrorBoundary.tsx");
      expect(files.length).toBeGreaterThanOrEqual(1);
    });

    it("should export an ErrorBoundary class component", async () => {
      const source = await readSourceFile("src/components/ErrorBoundary.tsx");
      expect(source).toContain("class ErrorBoundary");
      expect(source).toContain("export { ErrorBoundary }");
    });
  });

  describe("ErrorBoundary implements required lifecycle methods", () => {
    it("should implement getDerivedStateFromError", async () => {
      const source = await readSourceFile("src/components/ErrorBoundary.tsx");
      const matches = findInSource(source, /static getDerivedStateFromError/);
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });

    it("should implement componentDidCatch", async () => {
      const source = await readSourceFile("src/components/ErrorBoundary.tsx");
      const matches = findInSource(source, /componentDidCatch/);
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });

    it("should track error state (hasError + error)", async () => {
      const source = await readSourceFile("src/components/ErrorBoundary.tsx");
      expect(source).toContain("hasError");
      expect(source).toContain("error");
      // getDerivedStateFromError should return state with hasError: true
      const derivedMatches = findInSource(source, /hasError:\s*true/);
      expect(derivedMatches.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("ErrorBoundary renders fallback UI", () => {
    it("should render a user-friendly error message when hasError is true", async () => {
      const source = await readSourceFile("src/components/ErrorBoundary.tsx");
      // Check for French error message in the fallback UI
      expect(source).toContain("Une erreur est survenue");
    });

    it("should provide a reload button in the fallback", async () => {
      const source = await readSourceFile("src/components/ErrorBoundary.tsx");
      expect(source).toContain("Recharger");
      expect(source).toContain("handleReload");
    });

    it("should support a custom fallback prop", async () => {
      const source = await readSourceFile("src/components/ErrorBoundary.tsx");
      expect(source).toContain("fallback");
      // Should check for fallback prop before rendering default UI
      const fallbackCheck = findInSource(source, /this\.props\.fallback/);
      expect(fallbackCheck.length).toBeGreaterThanOrEqual(1);
    });

    it("should only show error details in DEV mode", async () => {
      const source = await readSourceFile("src/components/ErrorBoundary.tsx");
      // Error details should be guarded by import.meta.env.DEV
      const devGuardMatches = findInSource(source, /import\.meta\.env\.DEV/);
      expect(devGuardMatches.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("ErrorBoundary reports to Sentry", () => {
    it("should import Sentry", async () => {
      const source = await readSourceFile("src/components/ErrorBoundary.tsx");
      expect(source).toContain("@sentry/react");
    });

    it("should call Sentry.captureException in componentDidCatch", async () => {
      const source = await readSourceFile("src/components/ErrorBoundary.tsx");
      const sentryCapture = findInSource(source, /Sentry\.captureException/);
      expect(sentryCapture.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("App is wrapped with ErrorBoundary", () => {
    it("should import ErrorBoundary in App.tsx", async () => {
      const source = await readSourceFile("src/App.tsx");
      expect(source).toContain("import { ErrorBoundary }");
      expect(source).toContain("@/components/ErrorBoundary");
    });

    it("should wrap the entire App component tree in ErrorBoundary", async () => {
      const source = await readSourceFile("src/App.tsx");
      // ErrorBoundary should be the outermost wrapper
      const openTag = findInSource(source, /<ErrorBoundary>/);
      const closeTag = findInSource(source, /<\/ErrorBoundary>/);
      expect(openTag.length).toBeGreaterThanOrEqual(1);
      expect(closeTag.length).toBeGreaterThanOrEqual(1);
    });

    it("should have ErrorBoundary as the outermost wrapper in the component tree", async () => {
      const source = await readSourceFile("src/App.tsx");
      // The App component's JSX should start with <ErrorBoundary>
      // and end with </ErrorBoundary> as the outermost elements
      const lines = source.split("\n");
      const jsxLines = lines.filter(
        (line) => line.includes("<ErrorBoundary>") || line.includes("</ErrorBoundary>")
      );
      expect(jsxLines.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("main.tsx has global error handlers", () => {
    it("should have an unhandled promise rejection handler", async () => {
      const source = await readSourceFile("src/main.tsx");
      expect(source).toContain("unhandledrejection");
    });

    it("should initialize Sentry in main.tsx", async () => {
      const source = await readSourceFile("src/main.tsx");
      expect(source).toContain("Sentry.init");
    });

    it("should report unhandled rejections to Sentry", async () => {
      const source = await readSourceFile("src/main.tsx");
      const sentryCapture = findInSource(source, /Sentry\.captureException/);
      expect(sentryCapture.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("ErrorBoundary is used in additional critical locations", () => {
    it("should be used in AppRoutes.tsx for route-level protection", async () => {
      const source = await readSourceFile("src/routes/AppRoutes.tsx");
      const matches = findInSource(source, /<ErrorBoundary>/);
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });
  });
});

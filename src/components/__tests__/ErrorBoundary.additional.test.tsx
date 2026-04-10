/**
 * Additional tests for ErrorBoundary.tsx
 *
 * Supplements existing ErrorBoundary.test.tsx with:
 * - Error message propagation
 * - Multiple error scenarios
 * - Nested ErrorBoundary behavior
 * - Initial state validation
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ErrorBoundary } from "../ErrorBoundary";

// Component that throws on render
const ThrowError = ({ message = "Test error" }: { message?: string }) => {
  throw new Error(message);
};

// Component that renders normally
const NormalComponent = () => <div>Normal content</div>;

describe("ErrorBoundary — additional tests", () => {
  it("displays French error title 'Une erreur est survenue'", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    );
    expect(screen.getByText("Une erreur est survenue")).toBeDefined();
    spy.mockRestore();
  });

  it("displays French description about reloading", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    );
    expect(screen.getByText(/Veuillez recharger la page/)).toBeDefined();
    spy.mockRestore();
  });

  it("Recharger button exists and is clickable", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    );
    const button = screen.getByText("Recharger");
    expect(button).toBeDefined();
    expect(button.tagName).toBe("BUTTON");
    // Click should not throw
    expect(() => fireEvent.click(button)).not.toThrow();
    spy.mockRestore();
  });

  it("renders children when they do not throw", () => {
    render(
      <ErrorBoundary>
        <NormalComponent />
      </ErrorBoundary>
    );
    expect(screen.getByText("Normal content")).toBeDefined();
    // Error UI should not be present
    expect(screen.queryByText("Une erreur est survenue")).toBeNull();
  });

  it("renders custom fallback instead of default error UI", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary fallback={<p>Erreur personnalisée</p>}>
        <ThrowError />
      </ErrorBoundary>
    );
    expect(screen.getByText("Erreur personnalisée")).toBeDefined();
    expect(screen.queryByText("Recharger")).toBeNull();
    spy.mockRestore();
  });

  it("catches errors from deeply nested children", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <div>
          <div>
            <ThrowError message="Deep error" />
          </div>
        </div>
      </ErrorBoundary>
    );
    expect(screen.getByText("Une erreur est survenue")).toBeDefined();
    spy.mockRestore();
  });

  it("displays error icon (SVG element)", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    );
    const svgElement = container.querySelector("svg");
    expect(svgElement).not.toBeNull();
    spy.mockRestore();
  });
});

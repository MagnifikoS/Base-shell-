import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ErrorBoundary } from "../ErrorBoundary";

// Component that throws on render
const ThrowError = ({ message = "Test error" }: { message?: string }) => {
  throw new Error(message);
};

describe("ErrorBoundary", () => {
  it("renders children when no error occurs", () => {
    render(
      <ErrorBoundary>
        <div>Hello World</div>
      </ErrorBoundary>
    );
    expect(screen.getByText("Hello World")).toBeDefined();
  });

  it("catches errors and shows the default fallback UI", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    );
    expect(screen.getByText("Une erreur est survenue")).toBeDefined();
    expect(screen.getByText(/L'application a rencontr/)).toBeDefined();
    spy.mockRestore();
  });

  it("shows the Recharger button", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    );
    const reloadButton = screen.getByText("Recharger");
    expect(reloadButton).toBeDefined();
    expect(reloadButton.tagName).toBe("BUTTON");
    spy.mockRestore();
  });

  it("renders a custom fallback when provided", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary fallback={<div>Custom fallback</div>}>
        <ThrowError />
      </ErrorBoundary>
    );
    expect(screen.getByText("Custom fallback")).toBeDefined();
    // Default UI should NOT be present
    expect(screen.queryByText("Une erreur est survenue")).toBeNull();
    spy.mockRestore();
  });

  it("renders multiple children without error", () => {
    render(
      <ErrorBoundary>
        <div>Child 1</div>
        <div>Child 2</div>
      </ErrorBoundary>
    );
    expect(screen.getByText("Child 1")).toBeDefined();
    expect(screen.getByText("Child 2")).toBeDefined();
  });
});

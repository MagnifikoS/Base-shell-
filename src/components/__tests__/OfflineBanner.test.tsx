import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { OfflineBanner } from "../OfflineBanner";

describe("OfflineBanner", () => {
  let originalOnLine: boolean;

  beforeEach(() => {
    originalOnLine = navigator.onLine;
  });

  afterEach(() => {
    // Restore navigator.onLine
    Object.defineProperty(navigator, "onLine", {
      value: originalOnLine,
      writable: true,
      configurable: true,
    });
  });

  it("renders nothing when online", () => {
    Object.defineProperty(navigator, "onLine", {
      value: true,
      writable: true,
      configurable: true,
    });
    const { container } = render(<OfflineBanner />);
    expect(container.innerHTML).toBe("");
  });

  it("shows the offline banner when navigator.onLine is false", () => {
    Object.defineProperty(navigator, "onLine", {
      value: false,
      writable: true,
      configurable: true,
    });
    render(<OfflineBanner />);
    expect(screen.getByText("Pas de connexion Internet")).toBeDefined();
    expect(screen.getByRole("alert")).toBeDefined();
  });

  it("shows the banner when the offline event fires", () => {
    Object.defineProperty(navigator, "onLine", {
      value: true,
      writable: true,
      configurable: true,
    });
    render(<OfflineBanner />);
    // Initially nothing rendered
    expect(screen.queryByText("Pas de connexion Internet")).toBeNull();

    // Simulate going offline
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByText("Pas de connexion Internet")).toBeDefined();
  });

  it("hides the banner when the online event fires after being offline", () => {
    Object.defineProperty(navigator, "onLine", {
      value: false,
      writable: true,
      configurable: true,
    });
    render(<OfflineBanner />);
    expect(screen.getByText("Pas de connexion Internet")).toBeDefined();

    // Simulate coming back online
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.queryByText("Pas de connexion Internet")).toBeNull();
  });
});

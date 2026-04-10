/**
 * Tests for ProtectedRoute — auth-only route guard
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { ProtectedRoute } from "../ProtectedRoute";

// ═══════════════════════════════════════════════════════════════════════════
// Mock AuthContext
// ═══════════════════════════════════════════════════════════════════════════

const mockUseAuth = vi.fn();

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => mockUseAuth(),
}));

// ═══════════════════════════════════════════════════════════════════════════
// Helper: render with router
// ═══════════════════════════════════════════════════════════════════════════

function renderWithRouter(ui: React.ReactElement, initialPath = "/protected") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/protected" element={ui} />
        <Route path="/auth" element={<div>Auth Page</div>} />
      </Routes>
    </MemoryRouter>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 1: Loading state
// ═══════════════════════════════════════════════════════════════════════════

describe("ProtectedRoute — loading state", () => {
  it("shows loading spinner when auth is loading", () => {
    mockUseAuth.mockReturnValue({ user: null, loading: true });

    const { container } = renderWithRouter(
      <ProtectedRoute>
        <div>Protected Content</div>
      </ProtectedRoute>
    );

    // Should show spinner, not content
    expect(screen.queryByText("Protected Content")).toBeNull();
    // Check for the spinner div (animate-spin class)
    const spinner = container.querySelector(".animate-spin");
    expect(spinner).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 2: Unauthenticated → redirect
// ═══════════════════════════════════════════════════════════════════════════

describe("ProtectedRoute — unauthenticated", () => {
  it("redirects to /auth when user is null and not loading", () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false });

    renderWithRouter(
      <ProtectedRoute>
        <div>Protected Content</div>
      </ProtectedRoute>
    );

    // Should show the auth page, not the protected content
    expect(screen.queryByText("Protected Content")).toBeNull();
    expect(screen.getByText("Auth Page")).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 3: Authenticated → render children
// ═══════════════════════════════════════════════════════════════════════════

describe("ProtectedRoute — authenticated", () => {
  it("renders children when user is authenticated", () => {
    mockUseAuth.mockReturnValue({
      user: { id: "test-user", email: "test@test.com" },
      loading: false,
    });

    renderWithRouter(
      <ProtectedRoute>
        <div>Protected Content</div>
      </ProtectedRoute>
    );

    expect(screen.getByText("Protected Content")).toBeDefined();
  });

  it("renders complex children", () => {
    mockUseAuth.mockReturnValue({
      user: { id: "test-user", email: "test@test.com" },
      loading: false,
    });

    renderWithRouter(
      <ProtectedRoute>
        <div>
          <h1>Dashboard</h1>
          <p>Welcome back</p>
        </div>
      </ProtectedRoute>
    );

    expect(screen.getByText("Dashboard")).toBeDefined();
    expect(screen.getByText("Welcome back")).toBeDefined();
  });

  it("does not show loading spinner when authenticated", () => {
    mockUseAuth.mockReturnValue({
      user: { id: "test-user", email: "test@test.com" },
      loading: false,
    });

    const { container } = renderWithRouter(
      <ProtectedRoute>
        <div>Protected Content</div>
      </ProtectedRoute>
    );

    const spinner = container.querySelector(".animate-spin");
    expect(spinner).toBeNull();
  });

  it("does not redirect when authenticated", () => {
    mockUseAuth.mockReturnValue({
      user: { id: "test-user", email: "test@test.com" },
      loading: false,
    });

    renderWithRouter(
      <ProtectedRoute>
        <div>Protected Content</div>
      </ProtectedRoute>
    );

    expect(screen.queryByText("Auth Page")).toBeNull();
  });
});

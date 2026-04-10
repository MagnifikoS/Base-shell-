/**
 * Tests for UserSessionTag — displays user initials, click handler
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { UserSessionTag } from "../UserSessionTag";
import type { User } from "@supabase/supabase-js";

// ═══════════════════════════════════════════════════════════════════════════
// Helper: create mock user
// ═══════════════════════════════════════════════════════════════════════════

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "test-user-id",
    email: "jean.dupont@example.com",
    aud: "authenticated",
    role: "authenticated",
    app_metadata: {},
    user_metadata: {},
    identities: [],
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    ...overrides,
  } as User;
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 1: Initials display
// ═══════════════════════════════════════════════════════════════════════════

describe("UserSessionTag — initials from full_name", () => {
  it("displays initials from full_name (two words)", () => {
    const user = makeUser({
      user_metadata: { full_name: "Jean Dupont" },
    });
    render(<UserSessionTag user={user} />);
    expect(screen.getByText("JD")).toBeDefined();
  });

  it("displays initials from full_name (three words)", () => {
    const user = makeUser({
      user_metadata: { full_name: "Jean Pierre Dupont" },
    });
    render(<UserSessionTag user={user} />);
    // Uses first two words
    expect(screen.getByText("JP")).toBeDefined();
  });

  it("displays first two chars for single-word full_name", () => {
    const user = makeUser({
      user_metadata: { full_name: "Administrator" },
    });
    render(<UserSessionTag user={user} />);
    expect(screen.getByText("AD")).toBeDefined();
  });

  it("displays uppercase initials", () => {
    const user = makeUser({
      user_metadata: { full_name: "marie curie" },
    });
    render(<UserSessionTag user={user} />);
    expect(screen.getByText("MC")).toBeDefined();
  });
});

describe("UserSessionTag — initials from email", () => {
  it("displays first two chars of email prefix when no full_name", () => {
    const user = makeUser({
      email: "bob.martin@example.com",
      user_metadata: {},
    });
    render(<UserSessionTag user={user} />);
    expect(screen.getByText("BO")).toBeDefined();
  });

  it("displays uppercase email initials", () => {
    const user = makeUser({
      email: "alice@example.com",
      user_metadata: {},
    });
    render(<UserSessionTag user={user} />);
    expect(screen.getByText("AL")).toBeDefined();
  });

  it("handles single-char email prefix", () => {
    const user = makeUser({
      email: "x@example.com",
      user_metadata: {},
    });
    render(<UserSessionTag user={user} />);
    expect(screen.getByText("X")).toBeDefined();
  });
});

describe("UserSessionTag — fallback", () => {
  it("displays ?? when user is null", () => {
    render(<UserSessionTag user={null} />);
    expect(screen.getByText("??")).toBeDefined();
  });

  it("displays ?? when no email and no full_name", () => {
    const user = makeUser({
      email: undefined,
      user_metadata: {},
    });
    render(<UserSessionTag user={user} />);
    expect(screen.getByText("??")).toBeDefined();
  });

  it("displays email initials when full_name is empty string", () => {
    const user = makeUser({
      email: "test@example.com",
      user_metadata: { full_name: "" },
    });
    render(<UserSessionTag user={user} />);
    expect(screen.getByText("TE")).toBeDefined();
  });

  it("displays email initials when full_name is whitespace", () => {
    const user = makeUser({
      email: "test@example.com",
      user_metadata: { full_name: "   " },
    });
    render(<UserSessionTag user={user} />);
    expect(screen.getByText("TE")).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 2: Click handler
// ═══════════════════════════════════════════════════════════════════════════

describe("UserSessionTag — click handler", () => {
  it("calls onClick when button is clicked", () => {
    const handleClick = vi.fn();
    const user = makeUser({ user_metadata: { full_name: "Test User" } });
    render(<UserSessionTag user={user} onClick={handleClick} />);

    const button = screen.getByRole("button");
    fireEvent.click(button);

    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it("does not crash when onClick is undefined", () => {
    const user = makeUser({ user_metadata: { full_name: "Test User" } });
    render(<UserSessionTag user={user} />);

    const button = screen.getByRole("button");
    expect(() => fireEvent.click(button)).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 3: Accessibility
// ═══════════════════════════════════════════════════════════════════════════

describe("UserSessionTag — accessibility", () => {
  it("has button role", () => {
    const user = makeUser({ user_metadata: { full_name: "Test" } });
    render(<UserSessionTag user={user} />);
    expect(screen.getByRole("button")).toBeDefined();
  });

  it("has 'Deconnexion' aria-label", () => {
    const user = makeUser({ user_metadata: { full_name: "Test" } });
    render(<UserSessionTag user={user} />);
    expect(screen.getByLabelText("Déconnexion")).toBeDefined();
  });

  it("has 'Deconnexion' title", () => {
    const user = makeUser({ user_metadata: { full_name: "Test" } });
    render(<UserSessionTag user={user} />);
    const button = screen.getByRole("button");
    expect(button.getAttribute("title")).toBe("Déconnexion");
  });
});

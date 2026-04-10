/**
 * Tests for Bootstrap page — form rendering, validation
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Bootstrap from "../Bootstrap";

// ═══════════════════════════════════════════════════════════════════════════
// Mock dependencies
// ═══════════════════════════════════════════════════════════════════════════

const mockNavigate = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const mockRpc = vi.fn();
const mockInvoke = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
  },
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
  // Default: no admin exists, so show bootstrap form
  mockRpc.mockResolvedValue({ data: false, error: null });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 1: Loading state
// ═══════════════════════════════════════════════════════════════════════════

describe("Bootstrap — loading state", () => {
  it("shows loading spinner while checking admin", () => {
    mockRpc.mockReturnValue(new Promise(() => {}));

    const { container } = render(
      <MemoryRouter>
        <Bootstrap />
      </MemoryRouter>
    );

    const spinner = container.querySelector(".animate-spin");
    expect(spinner).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 2: Form rendering
// ═══════════════════════════════════════════════════════════════════════════

describe("Bootstrap — form rendering", () => {
  it("renders the title", async () => {
    render(
      <MemoryRouter>
        <Bootstrap />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Premier lancement")).toBeDefined();
    });
  });

  it("renders the description", async () => {
    render(
      <MemoryRouter>
        <Bootstrap />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(
        screen.getByText("Créez votre organisation et votre compte administrateur")
      ).toBeDefined();
    });
  });

  it("renders organization name field", async () => {
    render(
      <MemoryRouter>
        <Bootstrap />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Nom de l'organisation")).toBeDefined();
    });
  });

  it("renders full name field", async () => {
    render(
      <MemoryRouter>
        <Bootstrap />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Votre nom complet")).toBeDefined();
    });
  });

  it("renders email field", async () => {
    render(
      <MemoryRouter>
        <Bootstrap />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Email")).toBeDefined();
    });
  });

  it("renders password field", async () => {
    render(
      <MemoryRouter>
        <Bootstrap />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Mot de passe")).toBeDefined();
    });
  });

  it("renders the submit button", async () => {
    render(
      <MemoryRouter>
        <Bootstrap />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Créer l'administrateur")).toBeDefined();
    });
  });

  it("shows password strength indicator when password is typed", async () => {
    render(
      <MemoryRouter>
        <Bootstrap />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Mot de passe")).toBeDefined();
    });

    // Type a partial password to trigger the strength indicator
    fireEvent.change(screen.getByLabelText("Mot de passe"), { target: { value: "a" } });

    await waitFor(() => {
      expect(screen.getByText(/Au moins 8 caractères/)).toBeDefined();
    });
  });

  it("has correct form aria-label", async () => {
    render(
      <MemoryRouter>
        <Bootstrap />
      </MemoryRouter>
    );

    await waitFor(() => {
      const form = screen.getByRole("form", { name: "Création du compte administrateur" });
      expect(form).toBeDefined();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 3: Validation
// ═══════════════════════════════════════════════════════════════════════════

describe("Bootstrap — validation", () => {
  it("shows error for empty organization name on submit", async () => {
    render(
      <MemoryRouter>
        <Bootstrap />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Créer l'administrateur")).toBeDefined();
    });

    // Fill partial form (leave org name empty)
    fireEvent.change(screen.getByLabelText("Votre nom complet"), { target: { value: "Jean" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "test@test.com" } });
    fireEvent.change(screen.getByLabelText("Mot de passe"), { target: { value: "Secure1!pass" } });

    // Submit via form event to bypass HTML5 validation
    const form = screen.getByRole("form", { name: "Création du compte administrateur" });
    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getByText(/requis/)).toBeDefined();
    });
  });

  it("shows error for invalid email on submit", async () => {
    render(
      <MemoryRouter>
        <Bootstrap />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Créer l'administrateur")).toBeDefined();
    });

    fireEvent.change(screen.getByLabelText("Nom de l'organisation"), {
      target: { value: "Mon Resto" },
    });
    fireEvent.change(screen.getByLabelText("Votre nom complet"), { target: { value: "Jean" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "not-email" } });
    fireEvent.change(screen.getByLabelText("Mot de passe"), { target: { value: "Secure1!pass" } });

    const form = screen.getByRole("form", { name: "Création du compte administrateur" });
    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getByText(/invalide/)).toBeDefined();
    });
  });

  it("shows error for short password on submit", async () => {
    render(
      <MemoryRouter>
        <Bootstrap />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Créer l'administrateur")).toBeDefined();
    });

    fireEvent.change(screen.getByLabelText("Nom de l'organisation"), {
      target: { value: "Mon Resto" },
    });
    fireEvent.change(screen.getByLabelText("Votre nom complet"), { target: { value: "Jean" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "test@test.com" } });
    fireEvent.change(screen.getByLabelText("Mot de passe"), { target: { value: "short" } });

    const form = screen.getByRole("form", { name: "Création du compte administrateur" });
    fireEvent.submit(form);

    await waitFor(() => {
      // The validation error and the strength indicator both mention the 8 character requirement
      const matches = screen.getAllByText(/8 caractères/);
      expect(matches.length).toBeGreaterThanOrEqual(1);
      // At least one should be the destructive-colored validation error
      const errorElement = matches.find((el) => el.classList.contains("text-destructive"));
      expect(errorElement).toBeDefined();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 4: Redirect when admin exists
// ═══════════════════════════════════════════════════════════════════════════

describe("Bootstrap — redirect", () => {
  it("redirects to /auth when admin already exists", async () => {
    mockRpc.mockResolvedValue({ data: true, error: null });

    render(
      <MemoryRouter>
        <Bootstrap />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/auth", { replace: true });
    });
  });
});

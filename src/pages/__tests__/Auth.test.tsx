/**
 * Tests for Auth page — login form rendering, validation, forgot password
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Auth from "../Auth";

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
const mockSignIn = vi.fn();
const mockResetPassword = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    auth: {
      signInWithPassword: (...args: unknown[]) => mockSignIn(...args),
      resetPasswordForEmail: (...args: unknown[]) => mockResetPassword(...args),
    },
  },
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
  // Default: admin exists, so show login form
  mockRpc.mockResolvedValue({ data: true, error: null });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 1: Loading state
// ═══════════════════════════════════════════════════════════════════════════

describe("Auth — loading state", () => {
  it("shows loading spinner while checking admin", () => {
    // Never resolve the RPC
    mockRpc.mockReturnValue(new Promise(() => {}));

    const { container } = render(
      <MemoryRouter>
        <Auth />
      </MemoryRouter>
    );

    const spinner = container.querySelector(".animate-spin");
    expect(spinner).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 2: Login form rendering
// ═══════════════════════════════════════════════════════════════════════════

describe("Auth — login form", () => {
  it("renders the GestionPro title", async () => {
    render(
      <MemoryRouter>
        <Auth />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("GestionPro")).toBeDefined();
    });
  });

  it("renders email and password fields", async () => {
    render(
      <MemoryRouter>
        <Auth />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Email")).toBeDefined();
      expect(screen.getByLabelText("Mot de passe")).toBeDefined();
    });
  });

  it("renders the login button", async () => {
    render(
      <MemoryRouter>
        <Auth />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Se connecter")).toBeDefined();
    });
  });

  it("renders forgot password link", async () => {
    render(
      <MemoryRouter>
        <Auth />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Mot de passe oublié ?")).toBeDefined();
    });
  });

  it("renders privacy policy link", async () => {
    render(
      <MemoryRouter>
        <Auth />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Politique de confidentialite")).toBeDefined();
    });
  });

  it("renders the login form with Connexion aria-label", async () => {
    render(
      <MemoryRouter>
        <Auth />
      </MemoryRouter>
    );

    await waitFor(() => {
      const form = screen.getByRole("form", { name: "Connexion" });
      expect(form).toBeDefined();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 3: Validation errors
// ═══════════════════════════════════════════════════════════════════════════

describe("Auth — form validation", () => {
  it("shows error for invalid email on submit", async () => {
    render(
      <MemoryRouter>
        <Auth />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Se connecter")).toBeDefined();
    });

    // Type invalid email
    const emailInput = screen.getByLabelText("Email");
    fireEvent.change(emailInput, { target: { value: "not-an-email" } });

    const passwordInput = screen.getByLabelText("Mot de passe");
    fireEvent.change(passwordInput, { target: { value: "password123" } });

    // Submit via form submit event to bypass HTML5 validation
    const form = screen.getByRole("form", { name: "Connexion" });
    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getByText(/invalide/)).toBeDefined();
    });
  });

  it("shows error for empty password on submit", async () => {
    render(
      <MemoryRouter>
        <Auth />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Se connecter")).toBeDefined();
    });

    const emailInput = screen.getByLabelText("Email");
    fireEvent.change(emailInput, { target: { value: "test@example.com" } });

    // Leave password empty and submit via form event
    const form = screen.getByRole("form", { name: "Connexion" });
    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getByText(/requis/)).toBeDefined();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 4: Forgot password flow
// ═══════════════════════════════════════════════════════════════════════════

describe("Auth — forgot password", () => {
  it("switches to forgot password view on link click", async () => {
    render(
      <MemoryRouter>
        <Auth />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Mot de passe oublié ?")).toBeDefined();
    });

    fireEvent.click(screen.getByText("Mot de passe oublié ?"));

    expect(screen.getByText("Réinitialisation du mot de passe")).toBeDefined();
    expect(screen.getByText("Envoyer le lien de réinitialisation")).toBeDefined();
  });

  it("has back to login button in forgot password view", async () => {
    render(
      <MemoryRouter>
        <Auth />
      </MemoryRouter>
    );

    await waitFor(() => {
      fireEvent.click(screen.getByText("Mot de passe oublié ?"));
    });

    expect(screen.getByText("Retour à la connexion")).toBeDefined();
  });

  it("returns to login form on back click", async () => {
    render(
      <MemoryRouter>
        <Auth />
      </MemoryRouter>
    );

    await waitFor(() => {
      fireEvent.click(screen.getByText("Mot de passe oublié ?"));
    });

    fireEvent.click(screen.getByText("Retour à la connexion"));

    expect(screen.getByText("Se connecter")).toBeDefined();
  });

  it("shows reset form with correct aria-label", async () => {
    render(
      <MemoryRouter>
        <Auth />
      </MemoryRouter>
    );

    await waitFor(() => {
      fireEvent.click(screen.getByText("Mot de passe oublié ?"));
    });

    const form = screen.getByRole("form", { name: "Réinitialisation du mot de passe" });
    expect(form).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 5: Redirect to bootstrap
// ═══════════════════════════════════════════════════════════════════════════

describe("Auth — redirect to bootstrap", () => {
  it("redirects to /bootstrap when no admin exists", async () => {
    mockRpc.mockResolvedValue({ data: false, error: null });

    render(
      <MemoryRouter>
        <Auth />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/bootstrap", { replace: true });
    });
  });
});

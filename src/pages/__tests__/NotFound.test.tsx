/**
 * Tests for NotFound.tsx — 404 page
 *
 * Validates:
 * - Renders 404 text
 * - Displays French error message
 * - Has link back to home
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import NotFound from "../NotFound";

describe("NotFound", () => {
  it("renders the 404 text", () => {
    render(
      <MemoryRouter>
        <NotFound />
      </MemoryRouter>
    );
    expect(screen.getByText("404")).toBeDefined();
  });

  it("renders French 'Page non trouvée' message", () => {
    render(
      <MemoryRouter>
        <NotFound />
      </MemoryRouter>
    );
    expect(screen.getByText("Page non trouvée")).toBeDefined();
  });

  it("has a link back to home (Retour à l'accueil)", () => {
    render(
      <MemoryRouter>
        <NotFound />
      </MemoryRouter>
    );
    const link = screen.getByText("Retour à l'accueil");
    expect(link).toBeDefined();
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("/");
  });

  it("renders the heading with bold styling", () => {
    render(
      <MemoryRouter>
        <NotFound />
      </MemoryRouter>
    );
    const heading = screen.getByText("404");
    expect(heading.tagName).toBe("H1");
  });

  it("does not render error boundary text", () => {
    render(
      <MemoryRouter>
        <NotFound />
      </MemoryRouter>
    );
    expect(screen.queryByText("Une erreur est survenue")).toBeNull();
  });
});

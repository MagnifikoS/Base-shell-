/**
 * Tests for PinPad — digit entry, backspace, submit, max length, keyboard
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PinPad } from "../PinPad";

// ═══════════════════════════════════════════════════════════════════════════
// Setup
// ═══════════════════════════════════════════════════════════════════════════

const defaultProps = {
  onSubmit: vi.fn(),
  onCancel: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 1: Rendering
// ═══════════════════════════════════════════════════════════════════════════

describe("PinPad — rendering", () => {
  it("renders the default title for enter mode", () => {
    render(<PinPad {...defaultProps} />);
    expect(screen.getByText("Entrez votre code PIN")).toBeDefined();
  });

  it("renders the create title in create mode", () => {
    render(<PinPad {...defaultProps} mode="create" />);
    expect(screen.getByText("Créez votre code PIN")).toBeDefined();
  });

  it("renders the confirm title in confirm mode", () => {
    render(<PinPad {...defaultProps} mode="confirm" />);
    expect(screen.getByText("Confirmez votre code PIN")).toBeDefined();
  });

  it("renders custom title when provided", () => {
    render(<PinPad {...defaultProps} title="Custom Title" />);
    expect(screen.getByText("Custom Title")).toBeDefined();
  });

  it("renders all digit buttons (0-9)", () => {
    render(<PinPad {...defaultProps} />);
    for (let i = 0; i <= 9; i++) {
      const btn = screen.getByLabelText(`Chiffre ${i}`);
      expect(btn).toBeDefined();
    }
  });

  it("renders the delete button", () => {
    render(<PinPad {...defaultProps} />);
    const delBtn = screen.getByLabelText("Supprimer le dernier chiffre");
    expect(delBtn).toBeDefined();
  });

  it("renders the close button", () => {
    render(<PinPad {...defaultProps} />);
    const closeBtn = screen.getByLabelText("Fermer");
    expect(closeBtn).toBeDefined();
  });

  it("renders 4 pin indicator dots", () => {
    const { container } = render(<PinPad {...defaultProps} />);
    const dots = container.querySelectorAll(".rounded-full.border-2");
    expect(dots.length).toBe(4);
  });

  it("shows helper text in create mode", () => {
    render(<PinPad {...defaultProps} mode="create" />);
    expect(screen.getByText("Ce code sera requis pour badger")).toBeDefined();
  });

  it("does not show helper text in enter mode", () => {
    render(<PinPad {...defaultProps} mode="enter" />);
    expect(screen.queryByText("Ce code sera requis pour badger")).toBeNull();
  });

  it("renders keypad with group role", () => {
    render(<PinPad {...defaultProps} />);
    const keypadGroup = screen.getByRole("group", { name: "Clavier PIN" });
    expect(keypadGroup).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 2: Digit entry
// ═══════════════════════════════════════════════════════════════════════════

describe("PinPad — digit entry", () => {
  it("fills pin dots on digit press", () => {
    const { container } = render(<PinPad {...defaultProps} />);

    // Press digit 1
    fireEvent.click(screen.getByLabelText("Chiffre 1"));

    // One dot should be filled (bg-primary)
    const filledDots = container.querySelectorAll(".bg-primary");
    expect(filledDots.length).toBe(1);
  });

  it("fills multiple dots on sequential presses", () => {
    const { container } = render(<PinPad {...defaultProps} />);

    fireEvent.click(screen.getByLabelText("Chiffre 1"));
    fireEvent.click(screen.getByLabelText("Chiffre 2"));
    fireEvent.click(screen.getByLabelText("Chiffre 3"));

    const filledDots = container.querySelectorAll(".bg-primary");
    expect(filledDots.length).toBe(3);
  });

  it("auto-submits on 4th digit", () => {
    render(<PinPad {...defaultProps} />);

    fireEvent.click(screen.getByLabelText("Chiffre 1"));
    fireEvent.click(screen.getByLabelText("Chiffre 2"));
    fireEvent.click(screen.getByLabelText("Chiffre 3"));

    expect(defaultProps.onSubmit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText("Chiffre 4"));

    expect(defaultProps.onSubmit).toHaveBeenCalledWith("1234");
  });

  it("does not allow more than 4 digits", () => {
    const { container } = render(<PinPad {...defaultProps} />);

    for (let i = 0; i < 6; i++) {
      fireEvent.click(screen.getByLabelText("Chiffre 0"));
    }

    // Only 4 dots should be filled
    const filledDots = container.querySelectorAll(".bg-primary");
    expect(filledDots.length).toBeLessThanOrEqual(4);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 3: Backspace / delete
// ═══════════════════════════════════════════════════════════════════════════

describe("PinPad — delete", () => {
  it("removes last digit on delete", () => {
    const { container } = render(<PinPad {...defaultProps} />);

    fireEvent.click(screen.getByLabelText("Chiffre 1"));
    fireEvent.click(screen.getByLabelText("Chiffre 2"));

    let filledDots = container.querySelectorAll(".bg-primary");
    expect(filledDots.length).toBe(2);

    fireEvent.click(screen.getByLabelText("Supprimer le dernier chiffre"));

    filledDots = container.querySelectorAll(".bg-primary");
    expect(filledDots.length).toBe(1);
  });

  it("does nothing when deleting from empty pin", () => {
    const { container } = render(<PinPad {...defaultProps} />);

    fireEvent.click(screen.getByLabelText("Supprimer le dernier chiffre"));

    const filledDots = container.querySelectorAll(".bg-primary");
    expect(filledDots.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 4: Cancel
// ═══════════════════════════════════════════════════════════════════════════

describe("PinPad — cancel", () => {
  it("calls onCancel when close button is clicked", () => {
    render(<PinPad {...defaultProps} />);

    fireEvent.click(screen.getByLabelText("Fermer"));

    expect(defaultProps.onCancel).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 5: Loading state
// ═══════════════════════════════════════════════════════════════════════════

describe("PinPad — loading state", () => {
  it("disables all buttons when isLoading", () => {
    render(<PinPad {...defaultProps} isLoading={true} />);

    // Digit buttons should have opacity class
    const digitBtn = screen.getByLabelText("Chiffre 1");
    expect(digitBtn.className).toContain("opacity-50");
  });

  it("does not accept digit input when loading", () => {
    const { container } = render(<PinPad {...defaultProps} isLoading={true} />);

    fireEvent.click(screen.getByLabelText("Chiffre 1"));

    const filledDots = container.querySelectorAll(".bg-primary");
    expect(filledDots.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 6: Error display
// ═══════════════════════════════════════════════════════════════════════════

describe("PinPad — error display", () => {
  it("displays error message when error prop is set", () => {
    render(<PinPad {...defaultProps} error="Code PIN incorrect" />);
    expect(screen.getByText("Code PIN incorrect")).toBeDefined();
  });

  it("does not display error when error is null", () => {
    render(<PinPad {...defaultProps} error={null} />);
    expect(screen.queryByText("Code PIN incorrect")).toBeNull();
  });

  it("clears pin on error", () => {
    const { container, rerender } = render(<PinPad {...defaultProps} error={null} />);

    // Enter some digits
    fireEvent.click(screen.getByLabelText("Chiffre 1"));
    fireEvent.click(screen.getByLabelText("Chiffre 2"));

    // Now trigger error
    rerender(<PinPad {...defaultProps} error="Wrong PIN" />);

    // Pin should be cleared
    const filledDots = container.querySelectorAll(".bg-primary");
    expect(filledDots.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 7: Keyboard input
// ═══════════════════════════════════════════════════════════════════════════

describe("PinPad — keyboard input", () => {
  it("accepts keyboard digit input", () => {
    const { container } = render(<PinPad {...defaultProps} />);

    fireEvent.keyDown(window, { key: "5" });

    const filledDots = container.querySelectorAll(".bg-primary");
    expect(filledDots.length).toBe(1);
  });

  it("handles Backspace key as delete", () => {
    const { container } = render(<PinPad {...defaultProps} />);

    fireEvent.keyDown(window, { key: "1" });
    fireEvent.keyDown(window, { key: "2" });

    let filledDots = container.querySelectorAll(".bg-primary");
    expect(filledDots.length).toBe(2);

    fireEvent.keyDown(window, { key: "Backspace" });

    filledDots = container.querySelectorAll(".bg-primary");
    expect(filledDots.length).toBe(1);
  });

  it("auto-submits on 4th keyboard digit", () => {
    render(<PinPad {...defaultProps} />);

    fireEvent.keyDown(window, { key: "5" });
    fireEvent.keyDown(window, { key: "5" });
    fireEvent.keyDown(window, { key: "5" });
    fireEvent.keyDown(window, { key: "5" });

    expect(defaultProps.onSubmit).toHaveBeenCalledWith("5555");
  });

  it("ignores non-digit keys", () => {
    const { container } = render(<PinPad {...defaultProps} />);

    fireEvent.keyDown(window, { key: "a" });
    fireEvent.keyDown(window, { key: "Enter" });
    fireEvent.keyDown(window, { key: "Shift" });

    const filledDots = container.querySelectorAll(".bg-primary");
    expect(filledDots.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 8: Accessibility
// ═══════════════════════════════════════════════════════════════════════════

describe("PinPad — accessibility", () => {
  it("has status role for pin display", () => {
    render(<PinPad {...defaultProps} />);
    const status = screen.getByRole("status");
    expect(status).toBeDefined();
  });

  it("updates aria-label on pin entry", () => {
    render(<PinPad {...defaultProps} />);

    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-label")).toContain("0 chiffre");

    fireEvent.click(screen.getByLabelText("Chiffre 1"));

    expect(status.getAttribute("aria-label")).toContain("1 chiffre");
  });

  it("each digit button has an aria-label", () => {
    render(<PinPad {...defaultProps} />);

    for (let i = 0; i <= 9; i++) {
      const btn = screen.getByLabelText(`Chiffre ${i}`);
      expect(btn).toBeDefined();
    }
  });
});

/**
 * Tests for DoubleShiftResolutionDialog — V14 double-shift forgotten clock-out resolution
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  DoubleShiftResolutionDialog,
  type DoubleShiftResolutionDialogProps,
} from "../DoubleShiftResolutionDialog";

// Default props factory
function defaultProps(
  overrides?: Partial<DoubleShiftResolutionDialogProps>
): DoubleShiftResolutionDialogProps {
  return {
    open: true,
    openClockInTime: "09:05",
    plannedEndTime: "12:00",
    nextShiftStart: "14:00",
    nextShiftEnd: "18:00",
    onResolveForget: vi.fn(),
    onResolvePlanningChanged: vi.fn(),
    onCancel: vi.fn(),
    isLoading: false,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 1: Basic rendering
// ═══════════════════════════════════════════════════════════════════════════

describe("DoubleShiftResolutionDialog — rendering", () => {
  it("renders dialog content when open", () => {
    render(<DoubleShiftResolutionDialog {...defaultProps()} />);
    expect(screen.getByText("Pointage sans sortie precedente")).toBeDefined();
  });

  it("shows the open clock-in time", () => {
    render(<DoubleShiftResolutionDialog {...defaultProps({ openClockInTime: "09:15" })} />);
    expect(screen.getByText("09:15")).toBeDefined();
  });

  it("shows the planned shift label", () => {
    render(
      <DoubleShiftResolutionDialog
        {...defaultProps({ openClockInTime: "09:05", plannedEndTime: "12:00" })}
      />
    );
    expect(screen.getByText("09:05-12:00")).toBeDefined();
  });

  it("shows the next shift info", () => {
    render(
      <DoubleShiftResolutionDialog
        {...defaultProps({ nextShiftStart: "14:00", nextShiftEnd: "18:00" })}
      />
    );
    expect(screen.getByText("14:00-18:00")).toBeDefined();
  });

  it("hides next shift info when null", () => {
    render(
      <DoubleShiftResolutionDialog
        {...defaultProps({ nextShiftStart: null, nextShiftEnd: null })}
      />
    );
    expect(screen.queryByText("Prochain shift")).toBeNull();
  });

  it("shows both resolution options", () => {
    render(<DoubleShiftResolutionDialog {...defaultProps()} />);
    expect(screen.getByText("J'ai oublie de pointer la sortie")).toBeDefined();
    expect(screen.getByText("Mon planning a ete modifie")).toBeDefined();
  });

  it("shows cancel and confirm buttons", () => {
    render(<DoubleShiftResolutionDialog {...defaultProps()} />);
    expect(screen.getByText("Annuler")).toBeDefined();
    expect(screen.getByText("Confirmer")).toBeDefined();
  });

  it("does not render when closed", () => {
    render(<DoubleShiftResolutionDialog {...defaultProps({ open: false })} />);
    expect(screen.queryByText("Pointage sans sortie precedente")).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 2: Forgot clock-out flow
// ═══════════════════════════════════════════════════════════════════════════

describe("DoubleShiftResolutionDialog — forgot clock-out flow", () => {
  it("calls onResolveForget when default option is confirmed", () => {
    const onResolveForget = vi.fn();
    render(<DoubleShiftResolutionDialog {...defaultProps({ onResolveForget })} />);

    // Default selection is "forgot_clockout", just click Confirm
    fireEvent.click(screen.getByText("Confirmer"));

    expect(onResolveForget).toHaveBeenCalledTimes(1);
  });

  it("shows expected clock_out time in description", () => {
    render(<DoubleShiftResolutionDialog {...defaultProps({ plannedEndTime: "12:00" })} />);
    expect(screen.getByText(/Enregistrer sortie a 12:00/)).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 3: Planning changed flow
// ═══════════════════════════════════════════════════════════════════════════

describe("DoubleShiftResolutionDialog — planning changed flow", () => {
  it("calls onResolvePlanningChanged when second option is selected and confirmed", () => {
    const onResolvePlanningChanged = vi.fn();
    render(<DoubleShiftResolutionDialog {...defaultProps({ onResolvePlanningChanged })} />);

    // Click the "planning changed" option
    fireEvent.click(screen.getByText("Mon planning a ete modifie"));

    // Then click Confirm
    fireEvent.click(screen.getByText("Confirmer"));

    expect(onResolvePlanningChanged).toHaveBeenCalledTimes(1);
  });

  it("shows contact message for planning changed option", () => {
    render(<DoubleShiftResolutionDialog {...defaultProps()} />);
    expect(screen.getByText("Contactez votre responsable pour corriger")).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 4: Cancel flow
// ═══════════════════════════════════════════════════════════════════════════

describe("DoubleShiftResolutionDialog — cancel flow", () => {
  it("calls onCancel when cancel button is clicked", () => {
    const onCancel = vi.fn();
    render(<DoubleShiftResolutionDialog {...defaultProps({ onCancel })} />);

    fireEvent.click(screen.getByText("Annuler"));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 5: Loading state
// ═══════════════════════════════════════════════════════════════════════════

describe("DoubleShiftResolutionDialog — loading state", () => {
  it("shows loading text on confirm button when isLoading", () => {
    render(<DoubleShiftResolutionDialog {...defaultProps({ isLoading: true })} />);
    expect(screen.getByText("Traitement...")).toBeDefined();
  });

  it("disables buttons when isLoading", () => {
    render(<DoubleShiftResolutionDialog {...defaultProps({ isLoading: true })} />);

    const cancelButton = screen.getByLabelText("Annuler la resolution");
    const confirmButton = screen.getByLabelText("Confirmer la resolution");

    expect(cancelButton).toHaveProperty("disabled", true);
    expect(confirmButton).toHaveProperty("disabled", true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 6: Accessibility
// ═══════════════════════════════════════════════════════════════════════════

describe("DoubleShiftResolutionDialog — accessibility", () => {
  it("cancel button has aria-label", () => {
    render(<DoubleShiftResolutionDialog {...defaultProps()} />);
    expect(screen.getByLabelText("Annuler la resolution")).toBeDefined();
  });

  it("confirm button has aria-label", () => {
    render(<DoubleShiftResolutionDialog {...defaultProps()} />);
    expect(screen.getByLabelText("Confirmer la resolution")).toBeDefined();
  });

  it("has screen-reader accessible description", () => {
    render(<DoubleShiftResolutionDialog {...defaultProps()} />);
    expect(
      screen.getByText("Resoudre un oubli de pointage de sortie pour le shift precedent")
    ).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 7: Edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe("DoubleShiftResolutionDialog — edge cases", () => {
  it("handles null plannedEndTime gracefully — no shift label shown", () => {
    render(<DoubleShiftResolutionDialog {...defaultProps({ plannedEndTime: null })} />);
    // When plannedEndTime is null, the planned shift info line is not shown
    expect(screen.queryByText(/Le planning prevoit un shift/)).toBeNull();
    // The clock-in time info should still be displayed
    expect(screen.getByText("09:05")).toBeDefined();
  });

  it("handles null plannedEndTime in forgot option description", () => {
    render(<DoubleShiftResolutionDialog {...defaultProps({ plannedEndTime: null })} />);
    expect(screen.getByText("Enregistrer sortie et entree maintenant")).toBeDefined();
  });
});

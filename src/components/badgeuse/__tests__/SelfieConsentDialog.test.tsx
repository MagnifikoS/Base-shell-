/**
 * Tests for SelfieConsentDialog — consent flow, accept/decline, localStorage
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  SelfieConsentDialog,
  getSelfieConsentStatus,
  setSelfieConsent,
  resetSelfieConsent,
} from "../SelfieConsentDialog";

// ═══════════════════════════════════════════════════════════════════════════
// Setup: Clear localStorage before each test
// ═══════════════════════════════════════════════════════════════════════════

beforeEach(() => {
  localStorage.clear();
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 1: getSelfieConsentStatus
// ═══════════════════════════════════════════════════════════════════════════

describe("getSelfieConsentStatus", () => {
  it("returns 'pending' when no consent stored", () => {
    expect(getSelfieConsentStatus()).toBe("pending");
  });

  it("returns 'accepted' when consent is accepted", () => {
    localStorage.setItem("selfie-consent", "accepted");
    expect(getSelfieConsentStatus()).toBe("accepted");
  });

  it("returns 'refused' when consent is refused", () => {
    localStorage.setItem("selfie-consent", "refused");
    expect(getSelfieConsentStatus()).toBe("refused");
  });

  it("returns 'pending' for unknown values", () => {
    localStorage.setItem("selfie-consent", "something-else");
    expect(getSelfieConsentStatus()).toBe("pending");
  });

  it("returns 'pending' for empty string", () => {
    localStorage.setItem("selfie-consent", "");
    expect(getSelfieConsentStatus()).toBe("pending");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 2: setSelfieConsent
// ═══════════════════════════════════════════════════════════════════════════

describe("setSelfieConsent", () => {
  it("stores 'accepted' when true", () => {
    setSelfieConsent(true);
    expect(localStorage.getItem("selfie-consent")).toBe("accepted");
  });

  it("stores 'refused' when false", () => {
    setSelfieConsent(false);
    expect(localStorage.getItem("selfie-consent")).toBe("refused");
  });

  it("overwrites previous value", () => {
    setSelfieConsent(true);
    expect(getSelfieConsentStatus()).toBe("accepted");

    setSelfieConsent(false);
    expect(getSelfieConsentStatus()).toBe("refused");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 3: resetSelfieConsent
// ═══════════════════════════════════════════════════════════════════════════

describe("resetSelfieConsent", () => {
  it("removes the consent from localStorage", () => {
    setSelfieConsent(true);
    expect(getSelfieConsentStatus()).toBe("accepted");

    resetSelfieConsent();
    expect(getSelfieConsentStatus()).toBe("pending");
  });

  it("does not throw when no consent is stored", () => {
    expect(() => resetSelfieConsent()).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 4: SelfieConsentDialog component rendering
// ═══════════════════════════════════════════════════════════════════════════

describe("SelfieConsentDialog — rendering", () => {
  it("renders dialog content when open", () => {
    render(<SelfieConsentDialog open={true} onAccept={vi.fn()} onRefuse={vi.fn()} />);

    expect(screen.getByText("Selfie de pointage")).toBeDefined();
  });

  it("shows RGPD information", () => {
    render(<SelfieConsentDialog open={true} onAccept={vi.fn()} onRefuse={vi.fn()} />);

    expect(screen.getAllByText(/consentement/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Art. 9.2.a RGPD/)).toBeDefined();
  });

  it("shows accept and refuse buttons", () => {
    render(<SelfieConsentDialog open={true} onAccept={vi.fn()} onRefuse={vi.fn()} />);

    expect(screen.getByText("Accepter")).toBeDefined();
    expect(screen.getByText("Refuser le selfie")).toBeDefined();
  });

  it("shows purpose, storage, and rights information", () => {
    render(<SelfieConsentDialog open={true} onAccept={vi.fn()} onRefuse={vi.fn()} />);

    expect(screen.getByText(/Finalite/)).toBeDefined();
    expect(screen.getByText(/Stockage/)).toBeDefined();
    expect(screen.getByText(/Vos droits/)).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 5: SelfieConsentDialog — accept flow
// ═══════════════════════════════════════════════════════════════════════════

describe("SelfieConsentDialog — accept flow", () => {
  it("calls onAccept and stores consent on accept", () => {
    const onAccept = vi.fn();
    render(<SelfieConsentDialog open={true} onAccept={onAccept} onRefuse={vi.fn()} />);

    fireEvent.click(screen.getByText("Accepter"));

    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(getSelfieConsentStatus()).toBe("accepted");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 6: SelfieConsentDialog — refuse flow
// ═══════════════════════════════════════════════════════════════════════════

describe("SelfieConsentDialog — refuse flow", () => {
  it("calls onRefuse and stores refusal on refuse", () => {
    const onRefuse = vi.fn();
    render(<SelfieConsentDialog open={true} onAccept={vi.fn()} onRefuse={onRefuse} />);

    fireEvent.click(screen.getByText("Refuser le selfie"));

    expect(onRefuse).toHaveBeenCalledTimes(1);
    expect(getSelfieConsentStatus()).toBe("refused");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 7: SelfieConsentDialog — accessibility
// ═══════════════════════════════════════════════════════════════════════════

describe("SelfieConsentDialog — accessibility", () => {
  it("accept button has aria-label", () => {
    render(<SelfieConsentDialog open={true} onAccept={vi.fn()} onRefuse={vi.fn()} />);

    const acceptBtn = screen.getByLabelText("Accepter le consentement selfie");
    expect(acceptBtn).toBeDefined();
  });

  it("refuse button has aria-label", () => {
    render(<SelfieConsentDialog open={true} onAccept={vi.fn()} onRefuse={vi.fn()} />);

    const refuseBtn = screen.getByLabelText("Refuser le consentement selfie");
    expect(refuseBtn).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 8: Full consent workflow integration
// ═══════════════════════════════════════════════════════════════════════════

describe("SelfieConsentDialog — full workflow", () => {
  it("fresh user sees pending status, accepts, then has accepted status", () => {
    expect(getSelfieConsentStatus()).toBe("pending");

    const onAccept = vi.fn();
    render(<SelfieConsentDialog open={true} onAccept={onAccept} onRefuse={vi.fn()} />);

    fireEvent.click(screen.getByText("Accepter"));

    expect(getSelfieConsentStatus()).toBe("accepted");
    expect(onAccept).toHaveBeenCalled();
  });

  it("user can refuse, reset consent, then accept", () => {
    // Step 1: Refuse
    setSelfieConsent(false);
    expect(getSelfieConsentStatus()).toBe("refused");

    // Step 2: Reset
    resetSelfieConsent();
    expect(getSelfieConsentStatus()).toBe("pending");

    // Step 3: Accept
    setSelfieConsent(true);
    expect(getSelfieConsentStatus()).toBe("accepted");
  });
});

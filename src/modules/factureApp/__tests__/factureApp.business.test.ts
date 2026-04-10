/**
 * Business logic tests for Facture App — validates the rules enforced by
 * fn_generate_app_invoice without hitting the DB. Tests the contract.
 *
 * These tests verify the EXPECTED behaviour documented in the RPC:
 * 1. Normal order (recue) → invoice OK
 * 2. Open dispute → invoice BLOCKED
 * 3. Dispute resolved, order recue → invoice UNBLOCKED
 * 4. Missing price snapshot → invoice BLOCKED
 * 5. Duplicate → invoice BLOCKED
 * 6. All lines received_quantity=0 → invoice BLOCKED
 */
import { describe, it, expect } from "vitest";

// ── Pure validation logic extracted from RPC contract ──

type CommandeStatus = "brouillon" | "envoyee" | "ouverte" | "expediee" | "litige" | "recue" | "cloturee";

interface ValidationInput {
  commandeExists: boolean;
  commandeStatus: CommandeStatus;
  hasOpenLitiges: boolean;
  allLinesHavePrice: boolean;
  invoiceAlreadyExists: boolean;
  hasReceivableLines: boolean; // at least one line with received_quantity > 0
}

interface ValidationResult {
  ok: boolean;
  error?: string;
}

/**
 * Mirrors the validation logic of fn_generate_app_invoice.
 * This is a pure function for testing the contract.
 */
function validateInvoiceGeneration(input: ValidationInput): ValidationResult {
  if (!input.commandeExists) {
    return { ok: false, error: "commande_not_found" };
  }
  if (input.commandeStatus !== "recue") {
    return { ok: false, error: "commande_not_receivable" };
  }
  if (input.hasOpenLitiges) {
    return { ok: false, error: "open_litiges" };
  }
  if (!input.allLinesHavePrice) {
    return { ok: false, error: "missing_price_snapshot" };
  }
  if (input.invoiceAlreadyExists) {
    return { ok: false, error: "already_invoiced" };
  }
  if (!input.hasReceivableLines) {
    return { ok: false, error: "no_receivable_lines" };
  }
  return { ok: true };
}

describe("Facture App — Business rules (contract tests)", () => {
  const validInput: ValidationInput = {
    commandeExists: true,
    commandeStatus: "recue",
    hasOpenLitiges: false,
    allLinesHavePrice: true,
    invoiceAlreadyExists: false,
    hasReceivableLines: true,
  };

  // ─── Cas 1 : Commande normale → facture OK ───
  it("allows invoice generation for a received order with no disputes", () => {
    const result = validateInvoiceGeneration(validInput);
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
  });

  // Note: 'cloturee' means invoice already generated — RPC rejects it
  // Only 'recue' is accepted for invoice generation

  // ─── Cas 2 : Litige ouvert → facture BLOQUÉE ───
  it("BLOCKS invoice when there are open disputes", () => {
    const result = validateInvoiceGeneration({ ...validInput, hasOpenLitiges: true });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("open_litiges");
  });

  // ─── Cas 3 : Litige résolu → facture DÉBLOQUÉE ───
  it("UNBLOCKS invoice after dispute resolution (order back to recue)", () => {
    // Dispute was open → now resolved → order is back to recue → no open litiges
    const result = validateInvoiceGeneration({
      ...validInput,
      commandeStatus: "recue",
      hasOpenLitiges: false,
    });
    expect(result.ok).toBe(true);
  });

  // ─── Cas 4 : Prix manquant → facture BLOQUÉE ───
  it("BLOCKS invoice when price snapshot is missing on any line", () => {
    const result = validateInvoiceGeneration({ ...validInput, allLinesHavePrice: false });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("missing_price_snapshot");
  });

  // ─── Cas 5 : Doublon → facture BLOQUÉE ───
  it("BLOCKS duplicate invoice generation", () => {
    const result = validateInvoiceGeneration({ ...validInput, invoiceAlreadyExists: true });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("already_invoiced");
  });

  // ─── Cas 6 : Tout à zéro → facture BLOQUÉE ───
  it("BLOCKS invoice when no lines have received quantity > 0", () => {
    const result = validateInvoiceGeneration({ ...validInput, hasReceivableLines: false });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("no_receivable_lines");
  });

  // ─── Statuts non autorisés ───
  it.each<CommandeStatus>(["brouillon", "envoyee", "ouverte", "expediee", "litige", "cloturee"])(
    "BLOCKS invoice for order in status '%s'",
    (status) => {
      const result = validateInvoiceGeneration({ ...validInput, commandeStatus: status });
      expect(result.ok).toBe(false);
      expect(result.error).toBe("commande_not_receivable");
    }
  );

  // ─── Commande inexistante ───
  it("BLOCKS invoice for non-existent order", () => {
    const result = validateInvoiceGeneration({ ...validInput, commandeExists: false });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("commande_not_found");
  });

  // ─── Priorité des erreurs ───
  it("checks commande existence before status", () => {
    const result = validateInvoiceGeneration({
      ...validInput,
      commandeExists: false,
      commandeStatus: "brouillon",
    });
    expect(result.error).toBe("commande_not_found");
  });

  it("checks status before disputes", () => {
    const result = validateInvoiceGeneration({
      ...validInput,
      commandeStatus: "envoyee",
      hasOpenLitiges: true,
    });
    expect(result.error).toBe("commande_not_receivable");
  });

  it("checks disputes before price", () => {
    const result = validateInvoiceGeneration({
      ...validInput,
      hasOpenLitiges: true,
      allLinesHavePrice: false,
    });
    expect(result.error).toBe("open_litiges");
  });
});

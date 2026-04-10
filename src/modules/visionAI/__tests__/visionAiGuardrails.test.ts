/**
 * Tests for visionAiGuardrails.ts — Vision AI post-extraction guardrails
 *
 * Validates 4 rules:
 *   Rule 1: Free-line keyword detection (offert, gratuit, remise, etc.)
 *   Rule 2: Missing quantity flagging
 *   Rule 3: Coherence check (implied unit price extremes)
 *   Rule 4: Zero amount without free keyword
 *
 * Also tests utility functions: hasRiskFlags, getRiskFlagMessages
 */

import { describe, it, expect, vi } from "vitest";
import type { ExtractedProductLine } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Mock feature flags — default: guardrails ON
// ─────────────────────────────────────────────────────────────────────────────
vi.mock("@/config/featureFlags", () => ({
  VISION_AI_GUARDRAILS_ENABLED: true,
}));

import {
  applyGuardrails,
  hasRiskFlags,
  getRiskFlagMessages,
  type GuardrailedLine,
  type RiskFlagType,
} from "../plugins/visionAiGuardrails";

// ─────────────────────────────────────────────────────────────────────────────
// Helper: build a valid ExtractedProductLine with sensible defaults
// ─────────────────────────────────────────────────────────────────────────────
function makeLine(overrides: Partial<ExtractedProductLine> = {}): ExtractedProductLine {
  return {
    code_produit: null,
    nom_produit_complet: "Test Product",
    info_produit: null,
    quantite_commandee: 5,
    prix_total_ligne: 25.0,
    contenu_facture: "kg",
    ...overrides,
  };
}

/** Extract all risk flag types from a guardrailed line */
function flagTypes(line: GuardrailedLine): RiskFlagType[] {
  return (line._riskFlags || []).map((f) => f.type);
}

// =============================================================================
// TEST SUITE
// =============================================================================

describe("visionAiGuardrails", () => {
  // ─────────────────────────────────────────────────────────────────────────
  // applyGuardrails — general behavior
  // ─────────────────────────────────────────────────────────────────────────

  describe("applyGuardrails — general", () => {
    it("1. passes through when guardrails are disabled", async () => {
      // Dynamically re-mock the flag to false for this single test
      vi.resetModules();
      vi.doMock("@/config/featureFlags", () => ({
        VISION_AI_GUARDRAILS_ENABLED: false,
      }));

      const mod = await import("../plugins/visionAiGuardrails");

      const input = [makeLine({ quantite_commandee: null, prix_total_ligne: 0 })];
      const result = mod.applyGuardrails(input);

      // Should return items as-is, no flags added
      expect(result).toHaveLength(1);
      expect(result[0]._riskFlags).toBeUndefined();
      expect(result[0]._quantitySuspect).toBeUndefined();

      // Restore the original mock for subsequent tests
      vi.resetModules();
      vi.doMock("@/config/featureFlags", () => ({
        VISION_AI_GUARDRAILS_ENABLED: true,
      }));
    });

    it("2. returns empty array for empty input", () => {
      const result = applyGuardrails([]);
      expect(result).toEqual([]);
    });

    it("3. clean line has no flags", () => {
      const result = applyGuardrails([makeLine()]);
      expect(result).toHaveLength(1);
      expect(result[0]._riskFlags).toBeUndefined();
      expect(result[0]._quantitySuspect).toBeUndefined();
    });

    it("25. all items are processed (no items dropped by guardrails)", () => {
      const input = [
        makeLine({ nom_produit_complet: "Tomates" }),
        makeLine({ nom_produit_complet: "Oignons" }),
        makeLine({ nom_produit_complet: "Carottes" }),
        makeLine({ nom_produit_complet: "Pommes de terre" }),
        makeLine({ nom_produit_complet: "Ail" }),
      ];
      const result = applyGuardrails(input);
      expect(result).toHaveLength(5);
      // Verify product names are preserved
      expect(result.map((r) => r.nom_produit_complet)).toEqual([
        "Tomates",
        "Oignons",
        "Carottes",
        "Pommes de terre",
        "Ail",
      ]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Rule 1: Free-line keyword detection
  // ─────────────────────────────────────────────────────────────────────────

  describe("Rule 1 — free-line keyword detection", () => {
    it('4. "offert" in name with amount > 0 flags free_line_ambiguous', () => {
      const result = applyGuardrails([
        makeLine({
          nom_produit_complet: "Dessert offert",
          prix_total_ligne: 12.5,
        }),
      ]);
      expect(flagTypes(result[0])).toContain("free_line_ambiguous");
    });

    it('5. "gratuit" in info_produit flags free_line_ambiguous', () => {
      const result = applyGuardrails([
        makeLine({
          info_produit: "Echantillon gratuit",
          prix_total_ligne: 5.0,
        }),
      ]);
      expect(flagTypes(result[0])).toContain("free_line_ambiguous");
    });

    it('6. "remise" keyword detected', () => {
      const result = applyGuardrails([
        makeLine({
          nom_produit_complet: "Remise commerciale",
          prix_total_ligne: 20.0,
        }),
      ]);
      expect(flagTypes(result[0])).toContain("free_line_ambiguous");
    });

    it("7. free keyword with amount = 0 does NOT flag free_line_ambiguous", () => {
      const result = applyGuardrails([
        makeLine({
          nom_produit_complet: "Dessert offert",
          prix_total_ligne: 0,
        }),
      ]);
      // amount is 0 so Rule 1 should NOT fire (amount > 0 check fails)
      expect(flagTypes(result[0])).not.toContain("free_line_ambiguous");
    });

    it("8. free keyword with null amount does NOT flag free_line_ambiguous", () => {
      const result = applyGuardrails([
        makeLine({
          nom_produit_complet: "Cadeau client",
          prix_total_ligne: null,
        }),
      ]);
      expect(flagTypes(result[0])).not.toContain("free_line_ambiguous");
    });

    it("detects case-insensitive keywords (OFFERT, Gratuit, etc.)", () => {
      const result = applyGuardrails([
        makeLine({
          nom_produit_complet: "OFFERT au client",
          prix_total_ligne: 10.0,
        }),
      ]);
      expect(flagTypes(result[0])).toContain("free_line_ambiguous");
    });

    it('detects all supported keywords: "omaggio", "gratis", "sconto", "cadeau", "promo", "promotion", "reduction"', () => {
      const keywords = ["omaggio", "gratis", "sconto", "cadeau", "promo", "promotion", "réduction"];
      for (const kw of keywords) {
        const result = applyGuardrails([
          makeLine({
            nom_produit_complet: `Article ${kw}`,
            prix_total_ligne: 10.0,
          }),
        ]);
        expect(flagTypes(result[0])).toContain("free_line_ambiguous");
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Rule 2: Missing quantity
  // ─────────────────────────────────────────────────────────────────────────

  describe("Rule 2 — missing quantity", () => {
    it("9. null quantity flags missing_quantity", () => {
      const result = applyGuardrails([makeLine({ quantite_commandee: null })]);
      expect(flagTypes(result[0])).toContain("missing_quantity");
      expect(result[0]._quantitySuspect).toBe(true);
    });

    it("10. undefined quantity flags missing_quantity", () => {
      const line = makeLine();
      // Force undefined (simulating AI returning no qty at all)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (line as unknown as Record<string, unknown>).quantite_commandee = undefined;

      const result = applyGuardrails([line]);
      expect(flagTypes(result[0])).toContain("missing_quantity");
      expect(result[0]._quantitySuspect).toBe(true);
    });

    it("11. quantity = 0 does NOT flag missing_quantity", () => {
      const result = applyGuardrails([makeLine({ quantite_commandee: 0 })]);
      expect(flagTypes(result[0])).not.toContain("missing_quantity");
    });

    it("12. quantity = 5 does NOT flag missing_quantity", () => {
      const result = applyGuardrails([makeLine({ quantite_commandee: 5 })]);
      expect(flagTypes(result[0])).not.toContain("missing_quantity");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Rule 3: Coherence check (implied unit price)
  // ─────────────────────────────────────────────────────────────────────────

  describe("Rule 3 — coherence check (amount vs qty)", () => {
    it("13. normal implied unit price (no flag)", () => {
      // 25 / 5 = 5.00 per unit — perfectly normal
      const result = applyGuardrails([makeLine({ quantite_commandee: 5, prix_total_ligne: 25.0 })]);
      expect(flagTypes(result[0])).not.toContain("quantity_suspect");
    });

    it("14. extreme low unit price (0.005) flags quantity_suspect", () => {
      // 0.05 / 10 = 0.005 per unit — below 0.01 threshold
      const result = applyGuardrails([
        makeLine({ quantite_commandee: 10, prix_total_ligne: 0.05 }),
      ]);
      expect(flagTypes(result[0])).toContain("quantity_suspect");
      expect(result[0]._quantitySuspect).toBe(true);
    });

    it("15. extreme high unit price (15000) flags quantity_suspect", () => {
      // 15000 / 1 = 15000 per unit — above 10,000 threshold
      const result = applyGuardrails([
        makeLine({ quantite_commandee: 1, prix_total_ligne: 15000 }),
      ]);
      expect(flagTypes(result[0])).toContain("quantity_suspect");
      expect(result[0]._quantitySuspect).toBe(true);
    });

    it("16. edge case: amount=10, qty=1 -> 10/unit (no flag)", () => {
      const result = applyGuardrails([makeLine({ quantite_commandee: 1, prix_total_ligne: 10 })]);
      expect(flagTypes(result[0])).not.toContain("quantity_suspect");
    });

    it("17. edge case: amount=0.01, qty=1 -> 0.01/unit (no flag, at threshold)", () => {
      // 0.01 / 1 = 0.01 per unit — exactly at the threshold (< 0.01 is the test)
      const result = applyGuardrails([makeLine({ quantite_commandee: 1, prix_total_ligne: 0.01 })]);
      expect(flagTypes(result[0])).not.toContain("quantity_suspect");
    });

    it("does NOT flag when qty is null (Rule 3 requires both to be present and > 0)", () => {
      const result = applyGuardrails([
        makeLine({ quantite_commandee: null, prix_total_ligne: 100 }),
      ]);
      expect(flagTypes(result[0])).not.toContain("quantity_suspect");
    });

    it("does NOT flag when amount is null", () => {
      const result = applyGuardrails([makeLine({ quantite_commandee: 5, prix_total_ligne: null })]);
      expect(flagTypes(result[0])).not.toContain("quantity_suspect");
    });

    it("does NOT flag when qty is 0 (division by zero guard)", () => {
      const result = applyGuardrails([makeLine({ quantite_commandee: 0, prix_total_ligne: 100 })]);
      expect(flagTypes(result[0])).not.toContain("quantity_suspect");
    });

    it("edge case: amount=10000, qty=1 -> 10000/unit (no flag, at upper threshold)", () => {
      // 10000 / 1 = 10000 per unit — exactly at the threshold (> 10000 is the test)
      const result = applyGuardrails([
        makeLine({ quantite_commandee: 1, prix_total_ligne: 10000 }),
      ]);
      expect(flagTypes(result[0])).not.toContain("quantity_suspect");
    });

    it("flags when just below lower threshold: amount=0.009, qty=1", () => {
      const result = applyGuardrails([
        makeLine({ quantite_commandee: 1, prix_total_ligne: 0.009 }),
      ]);
      expect(flagTypes(result[0])).toContain("quantity_suspect");
    });

    it("flags when just above upper threshold: amount=10001, qty=1", () => {
      const result = applyGuardrails([
        makeLine({ quantite_commandee: 1, prix_total_ligne: 10001 }),
      ]);
      expect(flagTypes(result[0])).toContain("quantity_suspect");
    });

    it("includes a descriptive message with the implied unit price", () => {
      const result = applyGuardrails([
        makeLine({ quantite_commandee: 1, prix_total_ligne: 15000 }),
      ]);
      const messages = getRiskFlagMessages(result[0]);
      expect(messages.some((m) => m.includes("15000.00"))).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Rule 4: Zero amount without free keyword
  // ─────────────────────────────────────────────────────────────────────────

  describe("Rule 4 — zero amount without free keyword", () => {
    it("18. amount=0 without free keyword flags amount_suspect", () => {
      const result = applyGuardrails([
        makeLine({
          nom_produit_complet: "Huile olive",
          prix_total_ligne: 0,
        }),
      ]);
      expect(flagTypes(result[0])).toContain("amount_suspect");
    });

    it('19. amount=0 with "offert" in name does NOT flag amount_suspect', () => {
      const result = applyGuardrails([
        makeLine({
          nom_produit_complet: "Dessert offert",
          prix_total_ligne: 0,
        }),
      ]);
      expect(flagTypes(result[0])).not.toContain("amount_suspect");
    });

    it("amount=0 with free keyword in info_produit does NOT flag amount_suspect", () => {
      const result = applyGuardrails([
        makeLine({
          nom_produit_complet: "Article standard",
          info_produit: "cadeau client",
          prix_total_ligne: 0,
        }),
      ]);
      expect(flagTypes(result[0])).not.toContain("amount_suspect");
    });

    it("amount=null does NOT flag amount_suspect (Rule 4 requires amount === 0)", () => {
      const result = applyGuardrails([makeLine({ prix_total_ligne: null })]);
      expect(flagTypes(result[0])).not.toContain("amount_suspect");
    });

    it("amount > 0 without free keyword does NOT flag amount_suspect", () => {
      const result = applyGuardrails([makeLine({ prix_total_ligne: 10 })]);
      expect(flagTypes(result[0])).not.toContain("amount_suspect");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Multiple flags on same line
  // ─────────────────────────────────────────────────────────────────────────

  describe("Multiple flags", () => {
    it("20. free keyword + missing quantity produces both flags", () => {
      const result = applyGuardrails([
        makeLine({
          nom_produit_complet: "Produit gratuit",
          quantite_commandee: null,
          prix_total_ligne: 15.0,
        }),
      ]);
      const types = flagTypes(result[0]);
      expect(types).toContain("free_line_ambiguous");
      expect(types).toContain("missing_quantity");
      expect(types).toHaveLength(2);
    });

    it("amount_suspect + missing_quantity when amount=0 and qty=null (no free kw)", () => {
      const result = applyGuardrails([
        makeLine({
          nom_produit_complet: "Produit normal",
          quantite_commandee: null,
          prix_total_ligne: 0,
        }),
      ]);
      const types = flagTypes(result[0]);
      expect(types).toContain("amount_suspect");
      expect(types).toContain("missing_quantity");
    });

    it("preserves original line data alongside flags", () => {
      const original = makeLine({
        code_produit: "ABC123",
        nom_produit_complet: "Promo article",
        info_produit: "lot de 3",
        quantite_commandee: null,
        prix_total_ligne: 50.0,
        contenu_facture: "pce",
      });
      const result = applyGuardrails([original]);
      // Original data preserved
      expect(result[0].code_produit).toBe("ABC123");
      expect(result[0].nom_produit_complet).toBe("Promo article");
      expect(result[0].info_produit).toBe("lot de 3");
      expect(result[0].prix_total_ligne).toBe(50.0);
      expect(result[0].contenu_facture).toBe("pce");
      // Flags present
      expect(result[0]._riskFlags).toBeDefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // hasRiskFlags
  // ─────────────────────────────────────────────────────────────────────────

  describe("hasRiskFlags", () => {
    it("21. returns false for clean line (no _riskFlags)", () => {
      const clean: GuardrailedLine = makeLine();
      expect(hasRiskFlags(clean)).toBe(false);
    });

    it("returns false for empty _riskFlags array", () => {
      const clean: GuardrailedLine = { ...makeLine(), _riskFlags: [] };
      expect(hasRiskFlags(clean)).toBe(false);
    });

    it("22. returns true for flagged line", () => {
      const flagged: GuardrailedLine = {
        ...makeLine(),
        _riskFlags: [{ type: "missing_quantity", message: "Quantite manquante" }],
      };
      expect(hasRiskFlags(flagged)).toBe(true);
    });

    it("returns false when _riskFlags is undefined", () => {
      const line: GuardrailedLine = { ...makeLine(), _riskFlags: undefined };
      expect(hasRiskFlags(line)).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getRiskFlagMessages
  // ─────────────────────────────────────────────────────────────────────────

  describe("getRiskFlagMessages", () => {
    it("23. returns empty array for clean line", () => {
      const clean: GuardrailedLine = makeLine();
      expect(getRiskFlagMessages(clean)).toEqual([]);
    });

    it("24. returns messages for flagged line", () => {
      const flagged: GuardrailedLine = {
        ...makeLine(),
        _riskFlags: [
          { type: "missing_quantity", message: "Quantite manquante" },
          { type: "amount_suspect", message: "Montant suspect" },
        ],
      };
      const messages = getRiskFlagMessages(flagged);
      expect(messages).toEqual(["Quantite manquante", "Montant suspect"]);
    });

    it("returns empty array when _riskFlags is undefined", () => {
      const line: GuardrailedLine = { ...makeLine(), _riskFlags: undefined };
      expect(getRiskFlagMessages(line)).toEqual([]);
    });
  });
});

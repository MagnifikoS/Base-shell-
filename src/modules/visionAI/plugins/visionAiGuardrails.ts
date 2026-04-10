/**
 * ═══════════════════════════════════════════════════════════════════════════
 * VISION AI — GUARDRAILS PLUGIN (Rollback-safe)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * PURPOSE: Post-AI micro-sanitization to catch hallucinated quantities,
 * line-slipping, and ambiguous data — WITHOUT any extra AI call.
 *
 * TOGGLE: VISION_AI_GUARDRAILS_ENABLED (default: true)
 * ROLLBACK: Delete this file + remove 1 import in useExtractProducts.ts
 *
 * ARCHITECTURE:
 * - O(1) per line, zero network calls, session-only flags
 * - Does NOT modify DB, does NOT add AI calls
 * - Pure in-memory sanitization on the JSON already received
 */

import type { ExtractedProductLine } from "../types";

// ═══════════════════════════════════════════════════════════════════════════
// TOGGLE — set to false in featureFlags.ts to disable all guardrails (100% passthrough)
// Re-exported from centralized featureFlags.ts (SSOT)
// ═══════════════════════════════════════════════════════════════════════════
import { VISION_AI_GUARDRAILS_ENABLED } from "@/config/featureFlags";
export { VISION_AI_GUARDRAILS_ENABLED };

// ═══════════════════════════════════════════════════════════════════════════
// RISK FLAG TYPES (session-only, never persisted)
// ═══════════════════════════════════════════════════════════════════════════
export type RiskFlagType =
  | "quantity_suspect" // qty doesn't match amount / unit_price coherence
  | "amount_suspect" // amount seems off
  | "free_line_ambiguous" // keywords detected but amount present
  | "missing_quantity" // AI returned null qty
  | "missing_unit_price"; // no way to derive unit price

export interface RiskFlag {
  type: RiskFlagType;
  message: string;
}

export interface GuardrailedLine extends ExtractedProductLine {
  /** Session-only risk flags — never persisted to DB */
  _riskFlags?: RiskFlag[];
  /** True if quantity was marked suspect by guardrails */
  _quantitySuspect?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// KEYWORDS for free/promo line detection
// ═══════════════════════════════════════════════════════════════════════════
const FREE_LINE_KEYWORDS = [
  "offert",
  "gratuit",
  "omaggio",
  "gratis",
  "remise",
  "sconto",
  "cadeau",
  "promo",
  "promotion",
  "réduction",
];

function containsFreeKeyword(text: string): boolean {
  const lower = text.toLowerCase();
  return FREE_LINE_KEYWORDS.some((kw) => lower.includes(kw));
}

// ═══════════════════════════════════════════════════════════════════════════
// CORE: Apply guardrails to a list of extracted lines
// ═══════════════════════════════════════════════════════════════════════════
export function applyGuardrails(items: ExtractedProductLine[]): GuardrailedLine[] {
  if (!VISION_AI_GUARDRAILS_ENABLED) {
    // Passthrough — zero impact
    return items as GuardrailedLine[];
  }

  const result: GuardrailedLine[] = [];

  for (const item of items) {
    const flags: RiskFlag[] = [];
    let quantitySuspect = false;

    const amount = item.prix_total_ligne;
    const qty = item.quantite_commandee;
    const name = item.nom_produit_complet || "";

    // ─────────────────────────────────────────────────────────────────────
    // RULE 1: Free-line keyword + inconsistent amount
    // If name contains free keywords AND amount > 0, flag as ambiguous
    // ─────────────────────────────────────────────────────────────────────
    if (containsFreeKeyword(name) || containsFreeKeyword(item.info_produit || "")) {
      if (amount !== null && amount > 0) {
        flags.push({
          type: "free_line_ambiguous",
          message: "Ligne contenant un mot-clé offert/remise avec un montant positif",
        });
      }
    }

    // ─────────────────────────────────────────────────────────────────────
    // RULE 2: Missing quantity flag
    // AI returned null qty — user should verify
    // ─────────────────────────────────────────────────────────────────────
    if (qty === null || qty === undefined) {
      flags.push({
        type: "missing_quantity",
        message: "Quantité non extraite par l'IA — vérification nécessaire",
      });
      quantitySuspect = true;
    }

    // ─────────────────────────────────────────────────────────────────────
    // RULE 3: Basic coherence check (amount vs qty)
    // If both exist, derive implied unit price. If it's absurdly high/low → flag
    // ─────────────────────────────────────────────────────────────────────
    if (qty !== null && qty > 0 && amount !== null && amount > 0) {
      const impliedUnitPrice = amount / qty;

      // Flag if implied unit price is suspiciously extreme
      // (< 0.01€ or > 10,000€ per unit — obvious extraction errors)
      if (impliedUnitPrice < 0.01 || impliedUnitPrice > 10000) {
        flags.push({
          type: "quantity_suspect",
          message: `Prix unitaire implicite suspect: ${impliedUnitPrice.toFixed(2)} €`,
        });
        quantitySuspect = true;
      }
    }

    // ─────────────────────────────────────────────────────────────────────
    // RULE 4: Amount is 0 but no free keyword → might be extraction error
    // ─────────────────────────────────────────────────────────────────────
    if (
      amount === 0 &&
      !containsFreeKeyword(name) &&
      !containsFreeKeyword(item.info_produit || "")
    ) {
      flags.push({
        type: "amount_suspect",
        message: "Montant à 0 € sans indication de gratuité",
      });
    }

    const guardrailedLine: GuardrailedLine = {
      ...item,
      ...(flags.length > 0 ? { _riskFlags: flags } : {}),
      ...(quantitySuspect ? { _quantitySuspect: true } : {}),
    };

    result.push(guardrailedLine);
  }

  const flaggedCount = result.filter((l) => l._riskFlags && l._riskFlags.length > 0).length;
  if (flaggedCount > 0 && import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log(`[Vision AI Guardrails] ${flaggedCount}/${result.length} lignes flaggées`);
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILITY: Check if a line has any risk flags
// ═══════════════════════════════════════════════════════════════════════════
export function hasRiskFlags(item: GuardrailedLine): boolean {
  return Array.isArray(item._riskFlags) && item._riskFlags.length > 0;
}

export function getRiskFlagMessages(item: GuardrailedLine): string[] {
  return (item._riskFlags || []).map((f) => f.message);
}

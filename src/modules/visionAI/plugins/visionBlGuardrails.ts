/**
 * ═══════════════════════════════════════════════════════════════════════════
 * VISION AI — BL GUARDRAILS PLUGIN (Rollback-safe)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * PURPOSE: Post-AI micro-sanitization for BL (Bon de Livraison) extractions.
 * Catches missing quantities, unreadable products, and low-quality scans
 * WITHOUT any extra AI call.
 *
 * TOGGLE: VISION_AI_GUARDRAILS_ENABLED (default: true)
 * ROLLBACK: Delete this file + remove import from consumer
 *
 * ARCHITECTURE:
 * - O(n) per document, zero network calls, session-only flags
 * - Does NOT modify DB, does NOT add AI calls
 * - Pure in-memory sanitization on the JSON already received
 */

import type { BLExtractionResponse, BLItem, DocumentQuality } from "../types/blTypes";
import { VISION_AI_GUARDRAILS_ENABLED } from "@/config/featureFlags";

// ═══════════════════════════════════════════════════════════════════════════
// FLAG TYPES (session-only, never persisted)
// ═══════════════════════════════════════════════════════════════════════════

export type BLFlagType =
  | "missing_quantity" // qty_delivered === null
  | "unreadable_product" // product_name === "UNREADABLE"
  | "low_quality_photo" // document_quality.score < 0.5
  | "handwritten_ambiguous" // notes mention handwriting + qty null
  | "all_lines_unreadable"; // every line has product_name === "UNREADABLE"

export type BLFlagSeverity = "info" | "warning" | "error" | "blocking";

export interface BLFlag {
  type: BLFlagType;
  severity: BLFlagSeverity;
  message: string;
}

export interface BLItemFlags {
  item_index: number;
  flags: BLFlag[];
}

export interface BLGuardrailResult {
  /** Document-level flags */
  document_flags: BLFlag[];
  /** Per-item flags (only items with flags are included) */
  item_flags: BLItemFlags[];
  /** True if any blocking flag was raised */
  has_blocking: boolean;
  /** True if any error or blocking flag was raised */
  has_errors: boolean;
  /** Total number of flags across document + items */
  total_flag_count: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

const HANDWRITING_KEYWORDS = [
  "manuscrit",
  "handwriting",
  "handwritten",
  "écriture",
  "écrit à la main",
  "stylo",
  "crayon",
];

function mentionsHandwriting(text: string): boolean {
  const lower = text.toLowerCase();
  return HANDWRITING_KEYWORDS.some((kw) => lower.includes(kw));
}

function isUnreadable(item: BLItem): boolean {
  return item.product_name === "UNREADABLE";
}

// ═══════════════════════════════════════════════════════════════════════════
// PER-ITEM RULES
// ═══════════════════════════════════════════════════════════════════════════

function checkItemFlags(item: BLItem): BLFlag[] {
  const flags: BLFlag[] = [];

  // RULE 1: missing_quantity — qty_delivered is null
  if (item.qty_delivered === null) {
    flags.push({
      type: "missing_quantity",
      severity: "warning",
      message: "Quantité livrée non extraite — vérification nécessaire",
    });
  }

  // RULE 2: unreadable_product — product_name is "UNREADABLE"
  if (isUnreadable(item)) {
    flags.push({
      type: "unreadable_product",
      severity: "error",
      message: "Nom du produit illisible — identification manuelle requise",
    });
  }

  // RULE 3: handwritten_ambiguous — notes mention handwriting AND qty is null
  if (item.qty_delivered === null && item.notes && mentionsHandwriting(item.notes)) {
    flags.push({
      type: "handwritten_ambiguous",
      severity: "info",
      message: "Écriture manuscrite détectée avec quantité manquante — vérification recommandée",
    });
  }

  return flags;
}

// ═══════════════════════════════════════════════════════════════════════════
// DOCUMENT-LEVEL RULES
// ═══════════════════════════════════════════════════════════════════════════

function checkDocumentFlags(quality: DocumentQuality, items: BLItem[]): BLFlag[] {
  const flags: BLFlag[] = [];

  // RULE 4: low_quality_photo — document_quality.score < 0.5
  if (quality.score < 0.5) {
    flags.push({
      type: "low_quality_photo",
      severity: "warning",
      message: `Qualité du document faible (${(quality.score * 100).toFixed(0)}%) — les données extraites peuvent être imprécises`,
    });
  }

  // RULE 5: all_lines_unreadable — every line has product_name === "UNREADABLE"
  if (items.length > 0 && items.every(isUnreadable)) {
    flags.push({
      type: "all_lines_unreadable",
      severity: "blocking",
      message: "Aucun produit n'a pu être identifié — le document est inexploitable en l'état",
    });
  }

  return flags;
}

// ═══════════════════════════════════════════════════════════════════════════
// CORE: Apply BL guardrails to a full extraction response
// ═══════════════════════════════════════════════════════════════════════════

export function applyBLGuardrails(response: BLExtractionResponse): BLGuardrailResult {
  // Passthrough when guardrails disabled
  if (!VISION_AI_GUARDRAILS_ENABLED) {
    return {
      document_flags: [],
      item_flags: [],
      has_blocking: false,
      has_errors: false,
      total_flag_count: 0,
    };
  }

  // Document-level checks
  const documentFlags = checkDocumentFlags(response.document_quality, response.bl_items);

  // Per-item checks
  const itemFlags: BLItemFlags[] = [];
  for (let i = 0; i < response.bl_items.length; i++) {
    const flags = checkItemFlags(response.bl_items[i]);
    if (flags.length > 0) {
      itemFlags.push({ item_index: i, flags });
    }
  }

  // Aggregate counts
  const allFlags = [...documentFlags, ...itemFlags.flatMap((entry) => entry.flags)];

  const hasBlocking = allFlags.some((f) => f.severity === "blocking");
  const hasErrors = allFlags.some((f) => f.severity === "error" || f.severity === "blocking");

  if (allFlags.length > 0 && import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log(
      `[Vision AI BL Guardrails] ${allFlags.length} flag(s) — ` +
        `${documentFlags.length} document, ${itemFlags.length} item(s) flaggé(s)` +
        (hasBlocking ? " — BLOQUANT" : "")
    );
  }

  return {
    document_flags: documentFlags,
    item_flags: itemFlags,
    has_blocking: hasBlocking,
    has_errors: hasErrors,
    total_flag_count: allFlags.length,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

/** Check if a guardrail result has any flags at all */
export function hasBLFlags(result: BLGuardrailResult): boolean {
  return result.total_flag_count > 0;
}

/** Get all flag messages (document + items) as a flat list */
export function getBLFlagMessages(result: BLGuardrailResult): string[] {
  const messages: string[] = result.document_flags.map((f) => f.message);
  for (const entry of result.item_flags) {
    for (const flag of entry.flags) {
      messages.push(`Ligne ${entry.item_index + 1}: ${flag.message}`);
    }
  }
  return messages;
}

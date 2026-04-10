/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SMART_MATCH — Scoring Engine (pure functions)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Multi-signal scoring for product candidates.
 * No DB, no React — operates on pre-fetched data.
 */

import type {
  SmartMatchRequest,
  SmartMatchCandidate,
  SmartMatchProductRow,
  SmartMatchAliasRow,
  SmartMatchResponse,
  MatchReason,
} from "../types";
import { normalizeLabel, buildNormalizedKey, textSimilarity } from "./normalize";

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

/** Minimum fuzzy score to include in candidates */
const FUZZY_MIN_THRESHOLD = 0.35;

/** Auto-select threshold (only for exact matches) */
const EXACT_CONFIDENCE = 1.0;

/** Unit compatibility boost */
const UNIT_BOOST = 0.05;

/** Category proximity boost */
const CATEGORY_BOOST = 0.03;

/** Brain rules boost */
const BRAIN_BOOST = 0.08;

/** Max candidates to return */
const MAX_CANDIDATES = 10;

// ═══════════════════════════════════════════════════════════════════════════
// TYPES (internal)
// ═══════════════════════════════════════════════════════════════════════════

interface BrainBoostMap {
  /** product_id → boost value (0–1) */
  [productId: string]: number;
}

export interface ScorerInput {
  request: SmartMatchRequest;
  products: SmartMatchProductRow[];
  aliases: SmartMatchAliasRow[];
  brainBoosts?: BrainBoostMap;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN SCORER
// ═══════════════════════════════════════════════════════════════════════════

export function scoreProducts(input: ScorerInput): SmartMatchResponse {
  const { request, products, aliases, brainBoosts } = input;

  // ─── Step 1: Code strict (code_barres → code_produit) ───
  if (request.code_barres?.trim()) {
    const normalizedBarcode = request.code_barres.trim().toLowerCase();
    const barcodeMatch = products.find(
      (p) => p.code_barres?.toLowerCase().trim() === normalizedBarcode
    );
    if (barcodeMatch) {
      return exactResponse(barcodeMatch, "code_barres");
    }
  }

  if (request.code_produit?.trim()) {
    const normalizedCode = request.code_produit.trim().toLowerCase();
    const codeMatch = products.find(
      (p) => p.code_produit?.toLowerCase().trim() === normalizedCode
    );
    if (codeMatch) {
      return exactResponse(codeMatch, "code_produit");
    }
    // Code present but not found → COMPROMISE: fallback to alias/name/fuzzy
    // but NEVER confidence=1 (human validation always required)
    // Continue to alias/name/fuzzy scoring below
  }

  // ─── Step 2: Alias strict ───
  const normalizedKey = buildNormalizedKey(request.raw_label);
  if (normalizedKey) {
    const aliasMatch = aliases.find((a) => a.normalized_key === normalizedKey);
    if (aliasMatch) {
      const product = products.find((p) => p.id === aliasMatch.global_product_id);
      if (product) {
        return exactResponse(product, "alias");
      }
    }
  }

  // ─── Step 3: Exact name_normalized ───
  const normalizedName = normalizeLabel(request.raw_label);
  const nameExact = products.find(
    (p) => normalizeLabel(p.name_normalized) === normalizedName
  );
  if (nameExact) {
    // If code was present but not found → cannot be confidence=1
    const hasUnmatchedCode = !!request.code_produit?.trim();
    if (hasUnmatchedCode) {
      const candidate = toCandidate(nameExact, 0.85, ["name_exact"]);
      return {
        bestMatch: candidate,
        candidates: [candidate],
        autoSelectRecommended: false,
      };
    }
    return exactResponse(nameExact, "name_exact");
  }

  // ─── Step 4: Fuzzy + scoring ───
  const scored: SmartMatchCandidate[] = [];
  const hasUnmatchedCode = !!request.code_produit?.trim();

  for (const product of products) {
    const reasons: MatchReason[] = [];
    let score = 0;

    // Text similarity (primary signal)
    const sim = textSimilarity(request.raw_label, product.nom_produit);
    if (sim < FUZZY_MIN_THRESHOLD) continue;

    score = sim;
    reasons.push("fuzzy");

    // Unit compatibility boost
    if (
      request.unit_of_sale &&
      product.supplier_billing_unit_id &&
      request.unit_of_sale.toLowerCase().trim() === product.supplier_billing_unit_id
    ) {
      score += UNIT_BOOST;
      reasons.push("unit_boost");
    }

    // Category boost (text libre → weak boost)
    if (
      request.category_suggestion &&
      product.category &&
      normalizeLabel(request.category_suggestion) === normalizeLabel(product.category)
    ) {
      score += CATEGORY_BOOST;
      reasons.push("category_boost");
    }

    // Brain boost
    const brainVal = brainBoosts?.[product.id];
    if (brainVal && brainVal > 0) {
      score += BRAIN_BOOST;
      reasons.push("brain_boost");
    }

    // Cap at 0.99 for fuzzy (never auto-select)
    // If code was present but unmatched → cap lower
    const maxScore = hasUnmatchedCode ? 0.80 : 0.99;
    score = Math.min(score, maxScore);

    scored.push(toCandidate(product, score, reasons));
  }

  // Sort by confidence desc, take top N
  scored.sort((a, b) => b.confidence - a.confidence);
  const candidates = scored.slice(0, MAX_CANDIDATES);

  return {
    bestMatch: candidates.length > 0 ? candidates[0] : null,
    candidates,
    autoSelectRecommended: false, // never auto-select for fuzzy
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function toCandidate(
  product: SmartMatchProductRow,
  confidence: number,
  reasons: MatchReason[]
): SmartMatchCandidate {
  return {
    product_id: product.id,
    nom_produit: product.nom_produit,
    name_normalized: product.name_normalized,
    code_produit: product.code_produit,
    code_barres: product.code_barres,
    category: product.category,
    supplier_billing_unit_id: product.supplier_billing_unit_id,
    conditionnement_resume: product.conditionnement_resume,
    confidence: Math.round(confidence * 1000) / 1000,
    reasons,
  };
}

function exactResponse(
  product: SmartMatchProductRow,
  reason: MatchReason
): SmartMatchResponse {
  const candidate = toCandidate(product, EXACT_CONFIDENCE, [reason]);
  return {
    bestMatch: candidate,
    candidates: [candidate],
    autoSelectRecommended: true,
  };
}

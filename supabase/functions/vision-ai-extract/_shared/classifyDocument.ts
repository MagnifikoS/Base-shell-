/**
 * Document Type Classification — Hybrid heuristic + VLM approach.
 *
 * Strategy:
 * 1. Score French keywords from AI text output (fast, free)
 * 2. If score is decisive (>80% one way) → use heuristic result
 * 3. If ambiguous → fall back to VLM classification prompt
 *
 * Relevé vs Facture disambiguation:
 * - Multiple invoice references = Relevé
 * - Period markers (du XX/XX au XX/XX) = Relevé
 * - Solde / balance markers = Relevé
 */

export type DocType = "facture" | "bl" | "releve" | "unknown";

export interface DocTypeClassification {
  doc_type: DocType;
  confidence: number; // 0.0 - 1.0
  rationale: string;
  signals: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// KEYWORD DICTIONARIES
// ═══════════════════════════════════════════════════════════════════════════

const BL_KEYWORDS: Array<{ pattern: RegExp; weight: number }> = [
  { pattern: /bon\s+de\s+livraison/i, weight: 3 },
  { pattern: /\bbl\b/i, weight: 1.5 },
  { pattern: /bordereau\s+(de\s+)?livraison/i, weight: 3 },
  { pattern: /qt[eé]\s+livr[eé]e/i, weight: 2.5 },
  { pattern: /quantit[eé]\s+livr[eé]e/i, weight: 2.5 },
  { pattern: /\br[eé]ception\b/i, weight: 1 },
  { pattern: /\bcolis\b/i, weight: 1 },
  { pattern: /n[°o]\s+de\s+commande/i, weight: 1.5 },
  { pattern: /bordereau/i, weight: 2 },
  { pattern: /livr[eé]\s+(par|le|du)/i, weight: 1 },
  // Handwritten BLs often say "LIVRAISON N°XX" instead of "Bon de Livraison"
  { pattern: /livraison\s+n[°o]?\s*\d/i, weight: 2.5 },
  // Prep slips are BL variants in French food supply chains
  { pattern: /pr[eé]paration/i, weight: 2.5 },
  // "Préparé" column header is common on prep slips
  { pattern: /\bpr[eé]par[eé]\b/i, weight: 1.5 },
  // "Commande" standalone suggests an order/delivery context
  { pattern: /commande\s+n[°o]?\s*\d/i, weight: 1 },
];

const FACTURE_KEYWORDS: Array<{ pattern: RegExp; weight: number }> = [
  { pattern: /\bfacture\b/i, weight: 2 },
  { pattern: /\btva\b/i, weight: 1.5 },
  { pattern: /\bttc\b/i, weight: 1.5 },
  { pattern: /montant\s+h\.?t\.?/i, weight: 1.5 },
  { pattern: /[eé]ch[eé]ance/i, weight: 1 },
  { pattern: /\brib\b/i, weight: 1 },
  { pattern: /\biban\b/i, weight: 1.5 },
  { pattern: /total\s+ttc/i, weight: 2 },
  { pattern: /net\s+[àa]\s+payer/i, weight: 2 },
  { pattern: /prix\s+unitaire/i, weight: 1 },
];

const RELEVE_KEYWORDS: Array<{ pattern: RegExp; weight: number }> = [
  { pattern: /relev[eé]\s+de\s+compte/i, weight: 4 },
  { pattern: /relev[eé]\s+de\s+factures/i, weight: 4 },
  { pattern: /relev[eé]/i, weight: 2 },
  { pattern: /r[eé]capitulatif/i, weight: 3 },
  { pattern: /[eé]tat\s+de\s+compte/i, weight: 3 },
  { pattern: /solde\s+pr[eé]c[eé]dent/i, weight: 3 },
  { pattern: /solde\s+report[eé]/i, weight: 3 },
  { pattern: /total\s+d[uû]/i, weight: 2 },
  { pattern: /[eé]ch[eé]ancier/i, weight: 2 },
  { pattern: /liste\s+des\s+factures/i, weight: 3 },
  { pattern: /\bbalance\b/i, weight: 1 },
  { pattern: /arr[eê]t[eé]\s+(de\s+)?compte/i, weight: 3 },
  { pattern: /avoir\s+n[°o]/i, weight: 1.5 },
];

// ═══════════════════════════════════════════════════════════════════════════
// HEURISTIC CLASSIFICATION
// ═══════════════════════════════════════════════════════════════════════════

interface HeuristicScores {
  facture: number;
  bl: number;
  releve: number;
  signals: string[];
}

function scoreKeywords(text: string): HeuristicScores {
  const signals: string[] = [];
  let factureScore = 0;
  let blScore = 0;
  let releveScore = 0;

  for (const kw of FACTURE_KEYWORDS) {
    const matches = text.match(new RegExp(kw.pattern, "gi"));
    if (matches) {
      factureScore += kw.weight * matches.length;
      signals.push(`facture: "${matches[0]}" (x${matches.length})`);
    }
  }

  for (const kw of BL_KEYWORDS) {
    const matches = text.match(new RegExp(kw.pattern, "gi"));
    if (matches) {
      blScore += kw.weight * matches.length;
      signals.push(`bl: "${matches[0]}" (x${matches.length})`);
    }
  }

  for (const kw of RELEVE_KEYWORDS) {
    const matches = text.match(new RegExp(kw.pattern, "gi"));
    if (matches) {
      releveScore += kw.weight * matches.length;
      signals.push(`releve: "${matches[0]}" (x${matches.length})`);
    }
  }

  // ── Relevé heuristic bonus: multiple invoice references ──
  // Pattern: "N° XXXX", "FA-XXXX", "Facture N°", etc.
  const invoiceRefPattern = /(?:facture\s+n[°o]|fa[-\s]?\d{3,}|n[°o]\s*\d{4,})/gi;
  const invoiceRefs = text.match(invoiceRefPattern);
  if (invoiceRefs && invoiceRefs.length >= 3) {
    releveScore += invoiceRefs.length * 1.5;
    signals.push(`releve: ${invoiceRefs.length} invoice references found`);
  }

  // Period markers boost relevé
  const periodPattern = /du\s+\d{1,2}[/.-]\d{1,2}[/.-]?\d{0,4}\s+(au|à)\s+\d{1,2}[/.-]\d{1,2}/i;
  if (periodPattern.test(text)) {
    releveScore += 2;
    signals.push("releve: period range detected");
  }

  return { facture: factureScore, bl: blScore, releve: releveScore, signals };
}

/**
 * Classify document type using keyword heuristics.
 * Returns classification with confidence based on score dominance.
 */
export function classifyByHeuristics(text: string): DocTypeClassification {
  if (!text || text.trim().length === 0) {
    return {
      doc_type: "unknown",
      confidence: 0.1,
      rationale: "No text content available for classification",
      signals: [],
    };
  }

  const scores = scoreKeywords(text);
  const total = scores.facture + scores.bl + scores.releve;

  if (total === 0) {
    return {
      doc_type: "unknown",
      confidence: 0.2,
      rationale: "No classification keywords found in document",
      signals: [],
    };
  }

  // Find the winner
  const entries: Array<{ type: DocType; score: number }> = [
    { type: "facture", score: scores.facture },
    { type: "bl", score: scores.bl },
    { type: "releve", score: scores.releve },
  ];
  entries.sort((a, b) => b.score - a.score);

  const winner = entries[0];
  const runnerUp = entries[1];
  const dominance = winner.score / total;

  // Relevé vs Facture disambiguation: if in doubt, prefer relevé (safer per spec)
  if (
    winner.type === "facture" &&
    runnerUp.type === "releve" &&
    dominance < 0.7
  ) {
    return {
      doc_type: "releve",
      confidence: 0.6,
      rationale:
        "Ambiguous between facture and relevé — defaulting to relevé (safer: human will review)",
      signals: scores.signals,
    };
  }

  return {
    doc_type: winner.type,
    confidence: Math.min(0.99, dominance),
    rationale: `Heuristic classification: ${winner.type} scored ${winner.score.toFixed(1)} (${(dominance * 100).toFixed(0)}% of total ${total.toFixed(1)})`,
    signals: scores.signals,
  };
}

/**
 * Build a short classification prompt for VLM fallback.
 * Returns the prompt string to send to the AI provider.
 */
export function buildClassificationPrompt(): string {
  return `Classify this document into exactly ONE of these types:

(a) FACTURE — a single invoice/bill from a supplier with product line items and a total
(b) BON DE LIVRAISON — a delivery note listing products delivered (no prices usually)
(c) RELEVE — a supplier account statement listing MULTIPLE invoices for a period
(d) UNKNOWN — cannot determine the document type

Respond ONLY with a JSON object:
{
  "doc_type": "facture" | "bl" | "releve" | "unknown",
  "confidence": 0.0 to 1.0,
  "rationale": "brief explanation"
}

Key disambiguation rules:
- A document with MULTIPLE invoice references (Facture N° XXX appearing 3+ times) is a RELEVE, not a facture
- A RELEVE often has "solde", "balance", "récapitulatif", or a date period
- A FACTURE has ONE invoice number, product line items with prices, and ONE total
- A BON DE LIVRAISON has product names and quantities but usually NO prices
- If unsure between facture and relevé, choose RELEVE (safer)

NO text outside the JSON.`;
}

/**
 * Parse VLM classification response into DocTypeClassification.
 */
export function parseClassificationResponse(
  content: string,
): DocTypeClassification {
  try {
    let jsonString = content;
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonString = jsonMatch[1].trim();
    }

    const parsed = JSON.parse(jsonString);

    const validTypes: DocType[] = ["facture", "bl", "releve", "unknown"];
    const docType: DocType = validTypes.includes(parsed.doc_type)
      ? parsed.doc_type
      : "unknown";

    const confidence =
      typeof parsed.confidence === "number"
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0.5;

    const rationale =
      typeof parsed.rationale === "string"
        ? parsed.rationale
        : "VLM classification";

    return { doc_type: docType, confidence, rationale, signals: ["vlm_classification"] };
  } catch {
    return {
      doc_type: "unknown",
      confidence: 0.3,
      rationale: "Failed to parse VLM classification response",
      signals: ["vlm_parse_error"],
    };
  }
}

/**
 * Full classification pipeline:
 * 1. Try heuristics on text content
 * 2. If confident enough (>0.8), return
 * 3. Otherwise, return heuristic result with lower confidence (VLM call handled by caller)
 */
export function classifyDocument(textContent: string): {
  classification: DocTypeClassification;
  needsVLM: boolean;
} {
  const heuristic = classifyByHeuristics(textContent);

  if (heuristic.confidence >= 0.8) {
    return { classification: heuristic, needsVLM: false };
  }

  // Heuristic not confident enough — caller should use VLM
  return { classification: heuristic, needsVLM: true };
}

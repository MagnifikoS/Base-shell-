/**
 * Vision AI Bench — Scoring engine (pure functions, no React).
 *
 * Compares a run against a reference run and produces a BenchScore.
 * All scoring is client-side, computed on the fly.
 */

import type { BenchRun, BenchScore, BenchItem } from "../types";

// ─── Text normalisation ─────────────────────────────────────────────────────

/** Normalise a product name for fuzzy matching. */
export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .replace(/[^a-z0-9]/g, " ") // non-alphanum → space
    .replace(/\s+/g, " ")
    .trim();
}

/** Simple word-overlap similarity (Dice coefficient). Returns 0–1. */
function wordSimilarity(a: string, b: string): number {
  const wordsA = new Set(normalizeName(a).split(" ").filter(Boolean));
  const wordsB = new Set(normalizeName(b).split(" ").filter(Boolean));
  if (wordsA.size === 0 && wordsB.size === 0) return 1;
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let overlap = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) overlap++;
  }
  return (2 * overlap) / (wordsA.size + wordsB.size);
}

// ─── Item matching ──────────────────────────────────────────────────────────

interface ItemMatch {
  refIndex: number;
  runIndex: number;
  similarity: number;
}

/**
 * Match items from `runItems` against `refItems` by fuzzy name matching.
 * Uses a greedy best-match approach: highest similarity pairs first.
 */
export function matchItems(
  refItems: BenchItem[],
  runItems: BenchItem[]
): {
  matched: ItemMatch[];
  missedIndices: number[];
  extraIndices: number[];
} {
  const THRESHOLD = 0.4;

  // Build similarity matrix
  const pairs: Array<{ ref: number; run: number; sim: number }> = [];
  for (let r = 0; r < refItems.length; r++) {
    for (let c = 0; c < runItems.length; c++) {
      const sim = wordSimilarity(refItems[r].nom_produit_complet, runItems[c].nom_produit_complet);
      if (sim >= THRESHOLD) {
        pairs.push({ ref: r, run: c, sim });
      }
    }
  }

  // Greedy match: best sim first
  pairs.sort((a, b) => b.sim - a.sim);
  const usedRef = new Set<number>();
  const usedRun = new Set<number>();
  const matched: ItemMatch[] = [];

  for (const p of pairs) {
    if (usedRef.has(p.ref) || usedRun.has(p.run)) continue;
    matched.push({ refIndex: p.ref, runIndex: p.run, similarity: p.sim });
    usedRef.add(p.ref);
    usedRun.add(p.run);
  }

  const missedIndices = refItems.map((_, i) => i).filter((i) => !usedRef.has(i));
  const extraIndices = runItems.map((_, i) => i).filter((i) => !usedRun.has(i));

  return { matched, missedIndices, extraIndices };
}

// ─── Invoice scoring ────────────────────────────────────────────────────────

function scoreInvoice(ref: BenchRun, run: BenchRun): number {
  const refInv = ref.result_invoice;
  const runInv = run.result_invoice;
  if (!refInv || !runInv) return 0;

  let score = 0;
  let fields = 0;

  // supplier_name (fuzzy)
  if (refInv.supplier_name) {
    fields++;
    if (runInv.supplier_name) {
      const sim = wordSimilarity(refInv.supplier_name, runInv.supplier_name);
      score += sim;
    }
  }

  // invoice_number (exact)
  if (refInv.invoice_number) {
    fields++;
    if (
      runInv.invoice_number &&
      normalizeName(refInv.invoice_number) === normalizeName(runInv.invoice_number)
    ) {
      score += 1;
    }
  }

  // invoice_date (exact)
  if (refInv.invoice_date) {
    fields++;
    if (runInv.invoice_date === refInv.invoice_date) {
      score += 1;
    }
  }

  // invoice_total (±0.01€ tolerance)
  if (refInv.invoice_total != null) {
    fields++;
    if (
      runInv.invoice_total != null &&
      Math.abs(runInv.invoice_total - refInv.invoice_total) <= 0.01
    ) {
      score += 1;
    }
  }

  return fields > 0 ? (score / fields) * 100 : 100;
}

// ─── Items scoring ──────────────────────────────────────────────────────────

function scoreItems(
  ref: BenchRun,
  run: BenchRun
): {
  score: number;
  recall: number;
  precision: number;
  missedItems: string[];
  extraItems: string[];
  priceDiffs: Array<{ name: string; expected: number; got: number }>;
} {
  const refItems = ref.result_items || [];
  const runItems = run.result_items || [];

  if (refItems.length === 0 && runItems.length === 0) {
    return {
      score: 100,
      recall: 100,
      precision: 100,
      missedItems: [],
      extraItems: [],
      priceDiffs: [],
    };
  }
  if (refItems.length === 0) {
    return {
      score: 0,
      recall: 100,
      precision: 0,
      missedItems: [],
      extraItems: runItems.map((i) => i.nom_produit_complet),
      priceDiffs: [],
    };
  }

  const { matched, missedIndices, extraIndices } = matchItems(refItems, runItems);

  const missedItems = missedIndices.map((i) => refItems[i].nom_produit_complet);
  const extraItems = extraIndices.map((i) => runItems[i].nom_produit_complet);
  const priceDiffs: Array<{ name: string; expected: number; got: number }> = [];

  // Score each matched pair
  let matchQuality = 0;
  for (const m of matched) {
    const refItem = refItems[m.refIndex];
    const runItem = runItems[m.runIndex];

    // Name component (0–1): already from similarity
    const nameScore = m.similarity;

    // Price component (0–1)
    let priceScore = 1;
    if (refItem.prix_total_ligne != null && runItem.prix_total_ligne != null) {
      if (Math.abs(refItem.prix_total_ligne - runItem.prix_total_ligne) > 0.01) {
        priceScore = 0;
        priceDiffs.push({
          name: refItem.nom_produit_complet,
          expected: refItem.prix_total_ligne,
          got: runItem.prix_total_ligne,
        });
      }
    } else if (refItem.prix_total_ligne != null && runItem.prix_total_ligne == null) {
      priceScore = 0;
    }

    // Quantity component (0–1)
    let qtyScore = 1;
    if (refItem.quantite_commandee != null && runItem.quantite_commandee != null) {
      if (refItem.quantite_commandee !== runItem.quantite_commandee) {
        qtyScore = 0.5;
      }
    }

    matchQuality += nameScore * 0.4 + priceScore * 0.4 + qtyScore * 0.2;
  }

  const recall = refItems.length > 0 ? (matched.length / refItems.length) * 100 : 100;
  const precision = runItems.length > 0 ? (matched.length / runItems.length) * 100 : 100;

  // F1-style overall items score weighted by match quality
  const avgMatchQuality = matched.length > 0 ? (matchQuality / matched.length) * 100 : 0;
  const f1 = recall > 0 && precision > 0 ? (2 * recall * precision) / (recall + precision) : 0;

  // Combine F1 (structural) with match quality (data accuracy)
  const score = f1 * 0.5 + avgMatchQuality * 0.5;

  return { score, recall, precision, missedItems, extraItems, priceDiffs };
}

// ─── Insights scoring ───────────────────────────────────────────────────────

const HIGH_VALUE_LABELS = new Set(["iban", "bic"]);

function scoreInsights(ref: BenchRun, run: BenchRun): number {
  const refInsights = ref.result_insights || [];
  const runInsights = run.result_insights || [];

  if (refInsights.length === 0) return 100;
  if (runInsights.length === 0) return 0;

  const runMap = new Map<string, string>();
  for (const ins of runInsights) {
    runMap.set(normalizeName(ins.label), ins.value);
  }

  let totalWeight = 0;
  let score = 0;
  for (const refIns of refInsights) {
    const key = normalizeName(refIns.label);
    const weight = HIGH_VALUE_LABELS.has(key) ? 2 : 1;
    totalWeight += weight;

    const runValue = runMap.get(key);
    if (runValue != null) {
      const sim = wordSimilarity(refIns.value, runValue);
      score += sim * weight;
    }
  }

  return totalWeight > 0 ? (score / totalWeight) * 100 : 100;
}

// ─── Performance scoring ────────────────────────────────────────────────────

/**
 * Score performance relative to all runs of the same PDF.
 * Lower cost and faster duration = higher score.
 */
function scorePerformance(run: BenchRun, allRuns: BenchRun[]): number {
  const successRuns = allRuns.filter((r) => r.status === "success");
  if (successRuns.length <= 1) return 50; // neutral if single run

  // Cost component (0–100): cheapest gets 100
  let costScore = 50;
  const costs = successRuns.map((r) => r.cost_usd).filter((c): c is number => c != null);
  if (costs.length > 1 && run.cost_usd != null) {
    const minCost = Math.min(...costs);
    const maxCost = Math.max(...costs);
    costScore = maxCost > minCost ? ((maxCost - run.cost_usd) / (maxCost - minCost)) * 100 : 50;
  }

  // Speed component (0–100): fastest gets 100
  let speedScore = 50;
  const durations = successRuns.map((r) => r.duration_ms).filter((d): d is number => d != null);
  if (durations.length > 1 && run.duration_ms != null) {
    const minDur = Math.min(...durations);
    const maxDur = Math.max(...durations);
    speedScore = maxDur > minDur ? ((maxDur - run.duration_ms) / (maxDur - minDur)) * 100 : 50;
  }

  return costScore * 0.6 + speedScore * 0.4;
}

// ─── Main scoring function ──────────────────────────────────────────────────

const WEIGHTS = {
  invoice: 0.25,
  items: 0.5,
  insights: 0.15,
  performance: 0.1,
};

/**
 * Compute the BenchScore for `run` compared against `referenceRun`.
 * `allRuns` is needed for the relative performance scoring.
 */
export function computeScore(
  run: BenchRun,
  referenceRun: BenchRun,
  allRuns: BenchRun[]
): BenchScore {
  const invoice = scoreInvoice(referenceRun, run);
  const {
    score: items,
    recall: itemsRecall,
    precision: itemsPrecision,
    missedItems,
    extraItems,
    priceDiffs,
  } = scoreItems(referenceRun, run);
  const insights = scoreInsights(referenceRun, run);
  const performance = scorePerformance(run, allRuns);

  const overall =
    invoice * WEIGHTS.invoice +
    items * WEIGHTS.items +
    insights * WEIGHTS.insights +
    performance * WEIGHTS.performance;

  return {
    overall: Math.round(overall),
    invoice: Math.round(invoice),
    items: Math.round(items),
    itemsRecall: Math.round(itemsRecall),
    itemsPrecision: Math.round(itemsPrecision),
    insights: Math.round(insights),
    performance: Math.round(performance),
    missedItems,
    extraItems,
    priceDiffs,
  };
}

/** Score label + CSS class based on 0–100 score. */
export function scoreRating(score: number): { label: string; className: string } {
  if (score >= 90)
    return { label: "Excellent", className: "bg-green-600 dark:bg-green-700 text-white" };
  if (score >= 70) return { label: "Bon", className: "bg-blue-600 dark:bg-blue-700 text-white" };
  if (score >= 50)
    return { label: "Moyen", className: "bg-yellow-500 dark:bg-yellow-600 text-white" };
  return { label: "Faible", className: "bg-red-600 dark:bg-red-700 text-white" };
}

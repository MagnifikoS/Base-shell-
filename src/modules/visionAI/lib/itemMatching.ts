/**
 * Vision AI — Item Matching Library
 *
 * Fuzzy matching utilities for comparing extraction results.
 * Adapted from visionAIBench/lib/scoring.ts (no cross-module import).
 */

/** Normalize text for fuzzy matching: lowercase, strip accents, remove non-alphanumeric */
export function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Dice coefficient similarity (0–1) based on bigrams */
export function wordSimilarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (na === nb) return 1;
  if (na.length < 2 || nb.length < 2) return 0;

  const bigrams = (s: string): Set<string> => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) {
      set.add(s.slice(i, i + 2));
    }
    return set;
  };

  const ba = bigrams(na);
  const bb = bigrams(nb);
  let intersection = 0;
  for (const bg of ba) {
    if (bb.has(bg)) intersection++;
  }
  return (2 * intersection) / (ba.size + bb.size);
}

export interface MatchedItem {
  indexA: number;
  indexB: number;
  similarity: number;
}

/** Greedy best-match algorithm for pairing items from two runs */
export function matchItems(
  itemsA: Array<{ nom_produit_complet: string }>,
  itemsB: Array<{ nom_produit_complet: string }>,
  threshold = 0.4
): MatchedItem[] {
  const usedA = new Set<number>();
  const usedB = new Set<number>();
  const pairs: Array<{ a: number; b: number; sim: number }> = [];

  // Compute all pairwise similarities
  for (let a = 0; a < itemsA.length; a++) {
    for (let b = 0; b < itemsB.length; b++) {
      const sim = wordSimilarity(itemsA[a].nom_produit_complet, itemsB[b].nom_produit_complet);
      if (sim >= threshold) {
        pairs.push({ a, b, sim });
      }
    }
  }

  // Sort by similarity descending (greedy best match)
  pairs.sort((x, y) => y.sim - x.sim);

  const matches: MatchedItem[] = [];
  for (const { a, b, sim } of pairs) {
    if (usedA.has(a) || usedB.has(b)) continue;
    usedA.add(a);
    usedB.add(b);
    matches.push({ indexA: a, indexB: b, similarity: sim });
  }

  return matches;
}

export type DiffStatus = "match" | "price_diff" | "missing_in_b" | "extra_in_b";

export interface DiffRow {
  status: DiffStatus;
  nameA: string | null;
  nameB: string | null;
  qtyA: number | null;
  qtyB: number | null;
  priceA: number | null;
  priceB: number | null;
  similarity: number;
}

/** Compare items from two runs and produce a diff table */
export function diffItems(
  itemsA: Array<{
    nom_produit_complet: string;
    quantite_commandee: number | null;
    prix_total_ligne: number | null;
  }>,
  itemsB: Array<{
    nom_produit_complet: string;
    quantite_commandee: number | null;
    prix_total_ligne: number | null;
  }>
): DiffRow[] {
  const matches = matchItems(itemsA, itemsB);
  const matchedA = new Set(matches.map((m) => m.indexA));
  const matchedB = new Set(matches.map((m) => m.indexB));
  const rows: DiffRow[] = [];

  // Matched items
  for (const m of matches) {
    const a = itemsA[m.indexA];
    const b = itemsB[m.indexB];
    const priceDiff =
      a.prix_total_ligne != null &&
      b.prix_total_ligne != null &&
      Math.abs(a.prix_total_ligne - b.prix_total_ligne) > 0.01;
    const qtyDiff =
      a.quantite_commandee != null &&
      b.quantite_commandee != null &&
      a.quantite_commandee !== b.quantite_commandee;

    rows.push({
      status: priceDiff || qtyDiff ? "price_diff" : "match",
      nameA: a.nom_produit_complet,
      nameB: b.nom_produit_complet,
      qtyA: a.quantite_commandee,
      qtyB: b.quantite_commandee,
      priceA: a.prix_total_ligne,
      priceB: b.prix_total_ligne,
      similarity: m.similarity,
    });
  }

  // Items only in A (missing in B)
  for (let i = 0; i < itemsA.length; i++) {
    if (matchedA.has(i)) continue;
    const a = itemsA[i];
    rows.push({
      status: "missing_in_b",
      nameA: a.nom_produit_complet,
      nameB: null,
      qtyA: a.quantite_commandee,
      qtyB: null,
      priceA: a.prix_total_ligne,
      priceB: null,
      similarity: 0,
    });
  }

  // Items only in B (extra in B)
  for (let i = 0; i < itemsB.length; i++) {
    if (matchedB.has(i)) continue;
    const b = itemsB[i];
    rows.push({
      status: "extra_in_b",
      nameA: null,
      nameB: b.nom_produit_complet,
      qtyA: null,
      qtyB: b.quantite_commandee,
      priceA: null,
      priceB: b.prix_total_ligne,
      similarity: 0,
    });
  }

  return rows;
}

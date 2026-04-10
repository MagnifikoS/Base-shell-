/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SMART_MATCH — API (I/O layer — DB queries)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Single entry point for DB access.
 * Queries products_v2 + supplier_product_aliases + brain_rules.
 * Optional AI re-rank via edge function (SMART_MATCH_AI_RERANK flag).
 */

import { supabase } from "@/integrations/supabase/client";
import type {
  SmartMatchRequest,
  SmartMatchResponse,
  SmartMatchProductRow,
  SmartMatchAliasRow,
} from "../types";
import { scoreProducts } from "../engine/scorer";
import { buildNormalizedKey } from "../engine/normalize";
import { SMART_MATCH_AI_RERANK } from "@/config/featureFlags";

// ═══════════════════════════════════════════════════════════════════════════
// MAIN API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Execute SmartMatch: fetch candidates from DB, score, return ranked results.
 * If SMART_MATCH_AI_RERANK is enabled, re-ranks top candidates via LLM.
 */
export async function smartMatch(request: SmartMatchRequest): Promise<SmartMatchResponse> {
  const [products, aliases, brainBoosts] = await Promise.all([
    fetchProducts(request.establishment_id, request.supplier_id),
    fetchAliases(request.establishment_id, request.supplier_id),
    fetchBrainBoosts(request.establishment_id, request.supplier_id, request.raw_label),
  ]);

  const response = scoreProducts({
    request,
    products,
    aliases,
    brainBoosts,
  });

  // AI re-rank (optional, feature-flagged)
  if (SMART_MATCH_AI_RERANK && response.candidates.length > 1 && !response.autoSelectRecommended) {
    try {
      const reranked = await aiRerank(request, response);
      return reranked;
    } catch (err) {
      if (import.meta.env.DEV) console.error("[SmartMatch] AI rerank error, using engine order:", err);
      // Fallback to engine order — never block
    }
  }

  return response;
}

// ═══════════════════════════════════════════════════════════════════════════
// FETCH PRODUCTS
// ═══════════════════════════════════════════════════════════════════════════

async function fetchProducts(
  establishmentId: string,
  supplierId: string
): Promise<SmartMatchProductRow[]> {
  const { data, error } = await supabase
    .from("products_v2")
    .select(
      "id, nom_produit, name_normalized, code_produit, code_barres, category, supplier_billing_unit_id, conditionnement_resume"
    )
    .eq("establishment_id", establishmentId)
    .eq("supplier_id", supplierId)
    .is("archived_at", null)
    .limit(500);

  if (error) {
    if (import.meta.env.DEV) console.error("[SmartMatch] fetchProducts error:", error);
    return [];
  }

  return (data ?? []) as SmartMatchProductRow[];
}

// ═══════════════════════════════════════════════════════════════════════════
// FETCH ALIASES
// ═══════════════════════════════════════════════════════════════════════════

async function fetchAliases(
  establishmentId: string,
  supplierId: string
): Promise<SmartMatchAliasRow[]> {
  const { data, error } = await supabase
    .from("supplier_product_aliases")
    .select("global_product_id, normalized_key, supplier_product_code")
    .eq("establishment_id", establishmentId)
    .eq("supplier_id", supplierId)
    .is("archived_at", null)
    .not("global_product_id", "is", null)
    .limit(1000);

  if (error) {
    if (import.meta.env.DEV) console.error("[SmartMatch] fetchAliases error:", error);
    return [];
  }

  return (data ?? []).map((row) => ({
    global_product_id: row.global_product_id!,
    normalized_key: row.normalized_key,
    supplier_product_code: row.supplier_product_code,
  }));
}

// ═══════════════════════════════════════════════════════════════════════════
// FETCH BRAIN BOOSTS
// ═══════════════════════════════════════════════════════════════════════════

async function fetchBrainBoosts(
  establishmentId: string,
  supplierId: string,
  rawLabel: string
): Promise<Record<string, number>> {
  const key = buildNormalizedKey(rawLabel);
  if (!key) return {};

  // context_key format: supplier_id|category|label_normalized
  // We search for rules matching this supplier + label pattern
  const contextKeyPrefix = `${supplierId}|`;

  const { data, error } = await supabase
    .from("brain_rules")
    .select("value, confirmations_count, corrections_count")
    .eq("establishment_id", establishmentId)
    .eq("subject", "product_matching")
    .eq("enabled", true)
    .like("context_key", `${contextKeyPrefix}%`)
    .limit(50);

  if (error || !data) return {};

  const boosts: Record<string, number> = {};
  for (const rule of data) {
    const val = rule.value as Record<string, unknown> | null;
    const productId = val?.product_id;
    if (typeof productId !== "string") continue;

    const confirmations = rule.confirmations_count ?? 0;
    const corrections = rule.corrections_count ?? 0;

    // Only boost if confirmed and stable
    if (confirmations >= 2 && corrections === 0) {
      boosts[productId] = Math.min(confirmations / 10, 1);
    }
  }

  return boosts;
}

// ═══════════════════════════════════════════════════════════════════════════
// AI RE-RANK (optional, feature-flagged)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Re-rank SmartMatch candidates using the smart-match-rerank edge function.
 * Combines engine score (0.7) + LLM rank score (0.3).
 * Never throws — caller catches and falls back.
 */
async function aiRerank(
  request: SmartMatchRequest,
  response: SmartMatchResponse
): Promise<SmartMatchResponse> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) return response; // No auth → skip silently

  const payload = {
    extracted_label: request.raw_label,
    supplier_name: undefined as string | undefined,
    candidates: response.candidates.map((c) => ({
      id: c.product_id,
      nom_produit: c.nom_produit,
      category: c.category,
      conditionnement_resume: c.conditionnement_resume,
      code_produit: c.code_produit,
    })),
  };

  const res = await supabase.functions.invoke("smart-match-rerank", {
    body: payload,
  });

  if (res.error || !res.data?.ranked_ids) return response;

  const rankedIds: string[] = res.data.ranked_ids;

  // Combine: final_score = 0.7 * engine_score + 0.3 * llm_rank_score
  const candidateMap = new Map(response.candidates.map((c) => [c.product_id, c]));
  const total = rankedIds.length;

  const reranked = rankedIds
    .map((id, llmRank) => {
      const candidate = candidateMap.get(id);
      if (!candidate) return null;
      // LLM rank score: 1.0 for rank 0, decreasing linearly
      const llmScore = total > 1 ? (total - 1 - llmRank) / (total - 1) : 1;
      const finalScore = 0.7 * candidate.confidence + 0.3 * llmScore;
      return { ...candidate, confidence: Math.round(finalScore * 1000) / 1000 };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null)
    .sort((a, b) => b.confidence - a.confidence);

  return {
    bestMatch: reranked.length > 0 ? reranked[0] : null,
    candidates: reranked,
    autoSelectRecommended: false, // Never auto-select after re-rank
  };
}

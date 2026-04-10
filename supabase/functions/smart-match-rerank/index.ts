/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SMART_MATCH — AI Re-rank Edge Function
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Re-ranks SmartMatch candidates using gemini-2.5-flash.
 * NEVER a décideur — only a re-ranker.
 *
 * Input: { extracted_label, supplier, candidates[] }
 * Output: { ranked_ids: string[] } (product IDs in LLM-preferred order)
 *
 * Security: Auth required via getUser().
 * Feature flag: SMART_MATCH_AI_RERANK must be true client-side.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface RerankCandidate {
  id: string;
  nom_produit: string;
  category: string | null;
  conditionnement_resume: string | null;
  code_produit: string | null;
}

interface RerankRequest {
  extracted_label: string;
  supplier_name?: string;
  candidates: RerankCandidate[];
}

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonErr("Missing authorization", 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
    if (authError || !user) {
      return jsonErr("Unauthorized", 401);
    }

    // Parse request
    const body: RerankRequest = await req.json();
    if (!body.extracted_label || !body.candidates?.length) {
      return jsonErr("Missing extracted_label or candidates", 400);
    }

    // Cap candidates to 10
    const candidates = body.candidates.slice(0, 10);

    // Build prompt
    const candidateList = candidates
      .map((c, i) => {
        const parts = [`${i + 1}. "${c.nom_produit}"`];
        if (c.code_produit) parts.push(`code: ${c.code_produit}`);
        if (c.category) parts.push(`cat: ${c.category}`);
        if (c.conditionnement_resume) parts.push(`cond: ${c.conditionnement_resume}`);
        return parts.join(" | ");
      })
      .join("\n");

    const prompt = `Tu es un expert en matching de produits alimentaires pour la restauration.

Étiquette extraite d'une facture fournisseur : "${body.extracted_label}"
${body.supplier_name ? `Fournisseur : ${body.supplier_name}` : ""}

Candidats possibles dans le catalogue :
${candidateList}

Classe ces candidats du plus probable au moins probable pour correspondre à l'étiquette extraite.
Réponds UNIQUEMENT avec les numéros dans l'ordre, séparés par des virgules. Exemple : 3,1,5,2,4
Ne donne aucune explication.`;

    // Call Lovable AI (gemini-2.5-flash)
    const aiResponse = await fetch("https://api.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("LOVABLE_API_KEY") ?? supabaseAnonKey}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "user", content: prompt },
        ],
        max_tokens: 100,
        temperature: 0.1,
      }),
    });

    if (!aiResponse.ok) {
      console.error("[smart-match-rerank] AI error:", aiResponse.status, await aiResponse.text());
      // Fallback: return original order
      return jsonOk({ ranked_ids: candidates.map((c) => c.id), fallback: true });
    }

    const aiResult = await aiResponse.json();
    const rawContent = aiResult.choices?.[0]?.message?.content?.trim() ?? "";

    // Parse "3,1,5,2,4" → indices → product IDs
    const indices = rawContent
      .split(",")
      .map((s: string) => parseInt(s.trim(), 10) - 1) // 1-indexed → 0-indexed
      .filter((i: number) => !isNaN(i) && i >= 0 && i < candidates.length);

    // Deduplicate and fill missing
    const seen = new Set<number>();
    const orderedIds: string[] = [];
    for (const i of indices) {
      if (!seen.has(i)) {
        seen.add(i);
        orderedIds.push(candidates[i].id);
      }
    }
    // Append any candidates not ranked by LLM (fallback)
    for (let i = 0; i < candidates.length; i++) {
      if (!seen.has(i)) {
        orderedIds.push(candidates[i].id);
      }
    }

    return jsonOk({ ranked_ids: orderedIds, fallback: false });
  } catch (err) {
    console.error("[smart-match-rerank] error:", err);
    return jsonErr("Internal error", 500);
  }
});

function jsonOk(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function jsonErr(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

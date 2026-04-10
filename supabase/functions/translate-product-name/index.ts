import { requireAuth, AuthError } from "../_shared/requireAuth.ts";
import { makeCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { createLogger } from "../_shared/logger.ts";

const log = createLogger("translate-product-name");
const CORS = makeCorsHeaders("POST, OPTIONS");

/**
 * Translate product name to French (UI enrichment only)
 * 
 * RULES:
 * - This is a POST-extraction enrichment
 * - Does NOT impact Vision AI extraction performance
 * - Non-blocking: failure returns original name
 * - Translation is informational only, never used as SSOT
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  try {
    // SEC-04: Auth check — require authenticated user
    try {
      await requireAuth(req);
    } catch (e) {
      if (e instanceof AuthError) {
        log.warn("auth_failed", { reason: e.message });
        return new Response(
          JSON.stringify({ error: e.message }),
          { status: e.status, headers: { ...CORS, "Content-Type": "application/json" } }
        );
      }
      throw e;
    }

    // Rate limiting (P0-5) — no admin client available, use in-memory fallback
    const rateLimited = await checkRateLimit(req, null, { max: 30, keyPrefix: "translate-product-name" });
    if (rateLimited) return rateLimited;

    const { product_name } = await req.json();

    log.info("translate_request", { product_name });

    if (!product_name || typeof product_name !== "string") {
      log.warn("validation_failed", { reason: "missing_product_name" });
      return new Response(
        JSON.stringify({ error: "product_name is required" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      // Fail gracefully - return original name
      return new Response(
        JSON.stringify({ 
          detected_lang: "unknown",
          translation: null,
          original: product_name 
        }),
        { headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          {
            role: "system",
            content: `Tu es un détecteur de langue et traducteur de noms de produits alimentaires.

TÂCHE:
1. Détecte la langue du nom de produit fourni
2. Si la langue n'est PAS français, traduis en français
3. Si la langue EST français, ne traduis pas

RÉPONSE JSON STRICTE (aucun texte autour):
{
  "detected_lang": "code ISO 2 lettres (fr, en, es, it, de, etc.)",
  "translation": "traduction française si non-FR, sinon null"
}

RÈGLES:
- Noms propres de marques: garder tels quels
- Termes techniques culinaires internationaux: garder si universels (ex: "Mozzarella")
- Sinon: traduire littéralement le nom du produit`
          },
          {
            role: "user",
            content: product_name
          }
        ],
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      // Fail gracefully
      log.error("AI Gateway error", undefined, { status: response.status });
      return new Response(
        JSON.stringify({ 
          detected_lang: "unknown",
          translation: null,
          original: product_name 
        }),
        { headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      return new Response(
        JSON.stringify({ 
          detected_lang: "unknown",
          translation: null,
          original: product_name 
        }),
        { headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // Parse JSON response from AI
    let parsed;
    try {
      // Clean potential markdown code blocks
      const cleanContent = content.replace(/```json\n?|\n?```/g, "").trim();
      parsed = JSON.parse(cleanContent);
    } catch {
      log.error("Failed to parse AI response", undefined, { content });
      return new Response(
        JSON.stringify({ 
          detected_lang: "unknown",
          translation: null,
          original: product_name 
        }),
        { headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    log.info("completed", { detected_lang: parsed.detected_lang, has_translation: !!parsed.translation });

    return new Response(
      JSON.stringify({
        detected_lang: parsed.detected_lang || "unknown",
        translation: parsed.translation || null,
        original: product_name
      }),
      { headers: { ...CORS, "Content-Type": "application/json" } }
    );

  } catch (error) {
    log.error("Translation error", error);
    return new Response(
      JSON.stringify({ error: "Translation failed" }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});

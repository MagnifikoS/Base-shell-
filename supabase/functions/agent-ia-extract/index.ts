import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ═══════════════════════════════════════════════════════════════════════════
// PROMPT SYSTÈME — SSOT pour l'extraction IA de produits
// Les heuristiques vivent ICI et nulle part ailleurs.
// ═══════════════════════════════════════════════════════════════════════════

const SYSTEM_PROMPT = `Tu es un agent expert en extraction de produits depuis des factures fournisseurs pour un système de gestion de restaurant.

Tu reçois le PDF de la facture directement. Tu le lis visuellement comme un humain. Tu n'as pas besoin qu'on t'explique comment lire un tableau.

TES RÈGLES MÉTIER

NOMS :
Le nom commercial ne contient jamais :
- De dimensions : 10cl, 20cl, 45x30, 26x17x28, 38x38, 45x150m, 120x50x170
- De volumes ou contenances dans le nom
- De références fournisseur : REC, B1, codes numériques, codes alphanumériques
- De poids : 130L, 25kg, 500g
- De quantités entre parenthèses ou séparées par x : (24), x50, 3/1
Ces informations sont utilisées pour construire le conditionnement puis supprimées du nom.
Exemples obligatoires :
"Gobelet carton 10cl" → "Gobelet carton"
"Sac cabas kraft brun REC 26x17x28" → "Sac cabas kraft brun"
"Rouleau aluminium 45x150m" → "Rouleau aluminium"
"Sac poubelle 130L" → "Sac poubelle"
"Serviette 38x38 2F rouge" → "Serviette 2F rouge"
"Sac croissant 101 120x50x170" → "Sac croissant"
"Film étirable boite distributrice 45x30" → "Film étirable boite distributrice"
Exception : les % caractéristiques restent (35% MG, 100% jus, UHT 3,5%).
Exception : si deux tailles du même produit sont sur la même facture, garder le volume pour les distinguer.

CONDITIONNEMENT :
Construire du plus grand contenant au plus petit.
Chaque chiffre supprimé du nom devient la contenance d'un niveau de conditionnement.
La hiérarchie de conditionnement doit être une chaîne strictement descendante. Chaque niveau contient le niveau suivant.
Exemple : Référence "Gobelet carton 20cl", Unité facturée COL (Colis), désignation contient (1x50pcs)
→ niveaux_conditionnement = [{ nom_niveau: "Colis", unite_abbr: "col", contient_quantite: 50, contient_unite_abbr: "pce" }]
Règles absolues :
- Le dernier niveau contient TOUJOURS l'unité finale (pce, kg, L, etc.)
- Si la désignation contient (NxM pcs), c'est N contenants de M pièces
- Ne jamais créer deux niveaux qui finissent tous les deux par la même unité sans les lier entre eux
- Si on ne peut pas reconstruire la hiérarchie avec certitude, retourner un seul niveau avec l'unité finale directement
Déduire le type de contenant par la nature du produit si non explicite :
- Râpé, moulu, poudre, granulé → sach ou paq
- Liquide < 2L → bout ou flac
- Liquide ≥ 2L → bid
  → construire 2 niveaux :
     Niveau 1 : Caisse/Carton → N bid
     Niveau 2 : Bidon → X L
  → unite_finale_abbr = "L"
- Crème, pâte, purée → pot
- Conserve → bte
- Pièce entière solide → pce
Ne jamais utiliser pce par défaut.
Si le produit est vendu à l'unité simple sans packaging → niveaux_conditionnement = null.

PRIX :
prix_unitaire_ht est TOUJOURS le prix de la colonne Prix U. HT de la facture. Ne pas multiplier par la quantité. C'est le prix à l'unité de facturation.
prix_ligne_ht est TOUJOURS quantite_facturee × prix_unitaire_ht.
Ne jamais confondre les deux. Vérifier la cohérence.

TVA :
Toujours vérifier par calcul ligne par ligne.
Facture intracommunautaire → tva_rate = null pour TOUS les produits.
Si TVA explicite sur la facture → tva_source = "explicite_validee".
Si TVA calculée à partir des montants HT/TTC → tva_source = "calculee".
Si TVA déduite par catégorie de produit → tva_source = "suggeree_par_categorie".

UNITÉS :
kg jamais g. L jamais ml ni cl.
Sauf dans contient_unite_abbr d'un niveau de conditionnement (ex: paquet de 750g → contient_quantite = 750, contient_unite_abbr = "g").
unite_finale_abbr = unité de base pour le stock (kg, L, pce...).
unite_facturation_abbr = unité utilisée sur la facture.
unite_interne_suggestion = suggestion d'unité interne pour le restaurant, ou null.

ZONES :
Utiliser uniquement les zones de ZONES_INJECTEES.
Produit laitier frais → zone froide.
UHT → épicerie.

VENTE ET FRACTIONNEMENT :
vente_unite = true si le produit se vend à la pièce au client final (ex: canette, bouteille individuelle).
fractionne = true si le produit peut être vendu en fraction (ex: fromage à la coupe, charcuterie au poids).
En cas de doute → false pour les deux.

CLASSIFICATION :
AUTO = tout rempli avec certitude.
AMBIGU = au moins un champ incertain → mettre les champs incertains à null.

FORMAT DE SORTIE OBLIGATOIRE :
JSON uniquement. Pas de texte avant ou après. Pas de balises markdown.
Utiliser EXACTEMENT les noms de champs suivants, sans exception :

Chaque produit :
{
  "nom": "string — nom nettoyé",
  "reference": "string | null — code article/référence fournisseur",
  "barcode": "string | null — code-barres si visible",
  "fournisseur": "string — nom du fournisseur",
  "categorie": "string | null — parmi CATEGORIES_INJECTEES",
  "niveaux_conditionnement": [
    {
      "nom_niveau": "string — ex: Carton, Bidon, Bouteille",
      "unite_abbr": "string — abréviation du niveau",
      "contient_quantite": "number",
      "contient_unite_abbr": "string — ex: kg, L, pce"
    }
  ] | null,
  "unite_finale_abbr": "string | null — unité de base (kg, L, pce...)",
  "unite_facturation_abbr": "string | null — unité facturée",
  "quantite_facturee": "number | null",
  "prix_unitaire_ht": "number | null — prix unitaire HT du produit tel qu'il apparaît dans la colonne 'Prix U. HT' de la facture. Ne pas multiplier par la quantité. C'est le prix à l'unité de facturation.",
  "prix_ligne_ht": "number | null — montant HT de la ligne = quantite_facturee × prix_unitaire_ht",
  "tva_rate": "number | null",
  "tva_source": "explicite_validee | calculee | suggeree_par_categorie | null",
  "zone_stockage": "string | null — parmi ZONES_INJECTEES",
  "unite_interne_suggestion": "string | null",
  "vente_unite": "boolean",
  "fractionne": "boolean",
  "classification": "AUTO | AMBIGU",
  "manquants": ["string — liste des champs manquants ou incertains"]
}

Structure racine :
{
  "produits": [...],
  "fournisseur_detecte": "string | null",
  "anomalie_total_ttc": "boolean",
  "total_produits": "number",
  "total_auto": "number",
  "total_ambigus": "number"
}

Toute valeur inconnue = null.
niveaux_conditionnement = null si produit simple sans packaging.

DONNÉES DE L'ÉTABLISSEMENT :
Zones : ZONES_INJECTEES
Unités : UNITES_INJECTEES
Catégories : CATEGORIES_INJECTEES
Fournisseurs connus : FOURNISSEURS_INJECTES`;

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

interface WizardOptionsPayload {
  suppliers: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  storageZones: { id: string; name: string }[];
  units: { id: string; name: string; abbreviation: string }[];
}

function buildPrompt(opts: WizardOptionsPayload): string {
  const zones = opts.storageZones.map((z) => z.name).join(", ");
  const units = opts.units.map((u) => `${u.name} (${u.abbreviation})`).join(", ");
  const categories = opts.categories.map((c) => c.name).join(", ");
  const suppliers = opts.suppliers.map((s) => s.name).join(", ");

  return SYSTEM_PROMPT
    .replaceAll("ZONES_INJECTEES", zones)
    .replaceAll("UNITES_INJECTEES", units)
    .replaceAll("CATEGORIES_INJECTEES", categories)
    .replaceAll("FOURNISSEURS_INJECTES", suppliers);
}

function mimeToMediaType(mime: string): string {
  switch (mime) {
    case "application/pdf":
      return "application/pdf";
    case "image/jpeg":
      return "image/jpeg";
    case "image/png":
      return "image/png";
    default:
      return mime;
  }
}

function cleanAndParseJson(raw: string): { parsed: unknown | null; error: string | null } {
  let cleaned = raw.trim();

  // Remove markdown code fences if present
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.slice(3);
  }
  if (cleaned.endsWith("```")) {
    cleaned = cleaned.slice(0, -3);
  }
  cleaned = cleaned.trim();

  // Try direct parse first
  try {
    return { parsed: JSON.parse(cleaned), error: null };
  } catch {
    // Fallback: extract first JSON object from the text
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        const extracted = cleaned.slice(firstBrace, lastBrace + 1);
        return { parsed: JSON.parse(extracted), error: null };
      } catch {
        // fall through
      }
    }
    console.error("PARSE_ERROR — raw response (first 500 chars):", cleaned.slice(0, 500));
    return { parsed: null, error: "PARSE_ERROR" };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER
// ═══════════════════════════════════════════════════════════════════════════

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ── Auth check ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Parse body ──
    const { file_base64, file_type, wizard_options } = await req.json();

    if (!file_base64 || !file_type || !wizard_options) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: file_base64, file_type, wizard_options" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Build prompt ──
    const systemPrompt = buildPrompt(wizard_options as WizardOptionsPayload);

    // ── Call Anthropic ──
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) {
      return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const mediaType = mimeToMediaType(file_type);

    const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 16000,
        temperature: 0,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: [
              {
                type: file_type === "application/pdf" ? "document" : "image",
                source: {
                  type: "base64",
                  media_type: mediaType,
                  data: file_base64,
                },
              },
              {
                type: "text",
                text: "Extrais tous les produits de cette facture. Retourne uniquement le JSON.",
              },
            ],
          },
        ],
      }),
    });

    if (!anthropicResponse.ok) {
      const errText = await anthropicResponse.text();
      console.error("Anthropic API error:", anthropicResponse.status, errText);
      return new Response(
        JSON.stringify({ error: `Anthropic API error: ${anthropicResponse.status}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const anthropicData = await anthropicResponse.json();

    // Log stop reason for debugging truncation issues
    const stopReason = anthropicData?.stop_reason;
    if (stopReason && stopReason !== "end_turn") {
      console.warn("Anthropic stop_reason:", stopReason, "— response may be truncated");
    }

    // ── Extract text from response ──
    const rawText = anthropicData?.content?.[0]?.text ?? "";
    

    if (!rawText) {
      return new Response(
        JSON.stringify({ error: "EMPTY_RESPONSE", raw: "" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Parse JSON ──
    const { parsed, error: parseError } = cleanAndParseJson(rawText);

    if (parseError) {
      return new Response(
        JSON.stringify({ error: "PARSE_ERROR", raw: rawText }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify(parsed), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("agent-ia-extract error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

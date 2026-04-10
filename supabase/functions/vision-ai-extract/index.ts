import { requireAuth, AuthError } from "../_shared/requireAuth.ts";
import { makeCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimitSync } from "../_shared/rateLimit.ts";
import { createLogger } from "../_shared/logger.ts";
import {
  type InvoiceData,
  type ExtractedProductLine,
  type Insight,
  type ExtractionResponse,
  sanitizeInvoice,
  sanitizeExtractedItems,
  sanitizeInsights,
  sanitizeBLHeader,
  sanitizeBLItems,
  sanitizeReleveHeader,
  sanitizeReleveLines,
} from "../_shared/visionSanitize.ts";
import {
  type DocType,
  buildClassificationPrompt,
  parseClassificationResponse,
} from "./_shared/classifyDocument.ts";
import { BL_SYSTEM_PROMPT, BL_USER_INSTRUCTION } from "./_shared/blPrompt.ts";
import { RELEVE_SYSTEM_PROMPT, RELEVE_USER_INSTRUCTION } from "./_shared/relevePrompt.ts";

const log = createLogger("vision-ai-extract");

// ═══════════════════════════════════════════════════════════════════════════
// PROVIDER CONFIGURATION — OpenRouter (primary), OpenAI (fallback), Anthropic (Claude)
// ═══════════════════════════════════════════════════════════════════════════
type AIProvider = "openrouter" | "openai" | "anthropic";

// Standard mode: fast + cheap vision model for everyday invoices
const MODEL_STANDARD = "google/gemini-2.5-flash-lite";
// Precise mode: Mistral's flagship vision model for complex/scanned documents
const MODEL_PRECISE = "mistralai/pixtral-large-2411";
// Claude mode: Anthropic's native vision — excellent document understanding
const MODEL_CLAUDE = "claude-sonnet-4-5-20250929";

function getAIProvider(): AIProvider {
  // Anthropic is the primary provider if key is available
  if (Deno.env.get("ANTHROPIC_API_KEY")) return "anthropic";
  // Fallback chain: openrouter → openai
  if (Deno.env.get("OPENROUTER_API_KEY")) return "openrouter";
  return "openai";
}

// ═══════════════════════════════════════════════════════════════════════════
// PROMPT ENRICHI V1 (FACTURE + PRODUITS + INSIGHTS)
// ═══════════════════════════════════════════════════════════════════════════
const SYSTEM_PROMPT = `Extracteur strict de factures PDF. JSON uniquement. Aucun texte hors JSON.`;

const USER_INSTRUCTION = `Extrais les informations de cette facture. Retourne UNIQUEMENT un JSON valide.

FORMAT DE SORTIE EXACT:
{
  "invoice": {
    "supplier_name": string | null,
    "invoice_number": string | null,
    "invoice_date": string | null,
    "invoice_total": number | null
  },
  "items": [
    {
      "code_produit": string | null,
      "nom_produit_complet": string,
      "info_produit": string | null,
      "quantite_commandee": number | null,
      "prix_total_ligne": number | null,
      "contenu_facture": string | null,
      "has_price_cell": boolean,
      "category_suggestion": {
        "label": string,
        "confidence": number
      }
    }
  ],
  "insights": [
    {
      "label": string,
      "value": string
    }
  ]
}

RÈGLES CATÉGORIE SUGGÉRÉE:
- Pour chaque produit, propose UNE catégorie parmi: "Viande", "Poisson", "Produits laitiers", "Boissons", "Épicerie", "Surgelés", "Fruits & Légumes", "Boulangerie", "Hygiène", "Autre"
- confidence = nombre entre 0 et 1 (ex: 0.9 si très sûr, 0.5 si incertain)
- Si incertain ou produit ambigu: label="Autre" + confidence faible (< 0.5)
- Ne rien inventer. Si le produit n'est pas identifiable, utiliser "Autre".

═══════════════════════════════════════════════════════════════════════════
RÈGLE CRITIQUE: PRODUIT vs FRAIS vs INSTRUCTION (classification)
═══════════════════════════════════════════════════════════════════════════

PRODUIT = un bien physique livrable, achetable, stockable (nourriture, boisson, matériel).
  → Va dans "items"

FRAIS / SERVICE = une ligne de coût NON-PRODUIT: livraison, transport, service, structure, port, etc.
  → Va dans "insights" (label: "Frais de livraison", "Frais de structure", etc.)
  → NE VA JAMAIS dans "items" même si elle apparaît dans le tableau des produits

INSTRUCTION = une phrase administrative, un commentaire, une note fournisseur.
  → Va dans "insights" (label: "Note fournisseur" ou "Instruction")

LIGNES DE FRAIS À EXCLURE DES ITEMS (exhaustif):
- "Frais de livraison" / "FRAIS DE LIVRAISON" (toute variante)
- "Frais de port" / "Port" / "Franco de port"
- "Frais de structure" / "Structure"
- "Frais de service" / "Service"
- "Frais de transport" / "Transport"
- "Frais d'emballage" / "Emballage"
- "Éco-contribution" / "Eco-taxe"
- "Participation publicitaire"
- "Consigne" / "Déconsigne" (sauf si clairement un produit physique)
- Toute ligne contenant le mot "frais" ou "taxe" qui N'EST PAS un produit physique
- Toute ligne avec un code article commençant par "04 999" ou similaire (codes frais)

RÈGLE PRIX ZÉRO + FRAIS:
- Si une ligne a prix_total_ligne = 0 ou 0.00 ET c'est un frais/service → EXCLURE de "items"
- Si une ligne a prix_total_ligne > 0 ET c'est un frais/service → mettre dans "insights" avec le montant (ex: label="Frais de structure", value="1.39 €")
- SEUL un produit physique avec prix = 0.00 peut rester dans items (ex: produit offert)

INSTRUCTIONS À EXCLURE DES ITEMS:
- "Merci de faire le prélèvement..."
- "Règlement prévu le..."
- "Facture mensuelle..."
- "Livraison prévue..."
- "Référence paiement..."
- "En cas de retard..."
- "Conditions de vente..."
- Toute phrase explicative sans produit réel

RÈGLES STRICTES:
- Un frais/service NE DOIT JAMAIS apparaître dans "items"
- Une instruction NE DOIT JAMAIS apparaître dans "items"
- Les frais et instructions DOIVENT être ajoutés dans "insights"
- Si hésitation entre produit et frais/instruction → classer en frais/instruction (jamais faux produit)
- Ne jamais transformer une phrase ou un frais en produit fictif

═══════════════════════════════════════════════════════════════════════════

RÈGLES INVOICE:
- supplier_name: raison sociale COMPLÈTE du fournisseur (forme juridique incluse: SARL, SAS, EURL, etc.). Chercher en priorité la raison sociale dans l'en-tête, le logo, ou les mentions légales. Ex: "SARL JAWAR FRAIS" (pas juste "JAWAR FRAIS"). Si non identifiable → null. Ne jamais inventer.
- invoice_number: référence/numéro de facture visible
- invoice_date: date de la facture (format YYYY-MM-DD si possible)
- invoice_total: montant TTC total
- Si valeur illisible → null

RÈGLES ITEMS (anti-glissement STRICT):
- Chaque ligne produit est TOTALEMENT INDÉPENDANTE
- INTERDIT ABSOLU d'utiliser une valeur d'une autre ligne (code, prix, quantité, unité)
- code_produit: code article visible sur la ligne
- UNIQUEMENT des produits physiques réels (pas d'instructions)

═══════════════════════════════════════════════════════════════════════════
ANTI-DÉCALAGE — STRICT (RÈGLE CRITIQUE NON NÉGOCIABLE):
═══════════════════════════════════════════════════════════════════════════

1. AMOUNT OBLIGATOIRE POUR CRÉER UNE LIGNE PRODUIT:
   - La colonne AMOUNT (montant total ligne) DOIT contenir une valeur numérique visible.
   - Si la cellule AMOUNT est vide, absente, ou illisible → NE PAS RETOURNER CETTE LIGNE dans items.
   - Exception: AMOUNT = 0.00 explicitement affiché sur un VRAI PRODUIT → retourner avec prix_total_ligne: 0 et has_price_cell: true.
   - MAIS: AMOUNT = 0.00 sur une ligne de FRAIS (livraison, structure, etc.) → NE PAS RETOURNER (ce n'est pas un produit).

2. INTERDICTION DE RÉUTILISER UNE VALEUR D'UNE AUTRE LIGNE:
   - Chaque ligne est TOTALEMENT indépendante.
   - INTERDIT de copier/déplacer un AMOUNT depuis la ligne suivante ou précédente.
   - INTERDIT d'inférer ou calculer un prix manquant.

3. LIGNES OFFERTES / REMISES / GRATUITÉS — SUPPRESSION TOTALE:
   - Si la colonne DISCOUNT contient "-99-99" et AMOUNT est vide → NE PAS RETOURNER la ligne.
   - Si une ligne contient les mots "offert", "omaggio", "gratuit", "sconto", "remise", "gratis" et que AMOUNT est vide → NE PAS RETOURNER la ligne.
   - AUCUNE donnée de cette ligne (code, quantité, nom, unité) ne doit être utilisée ou reportée sur une autre ligne.
   - EXEMPLE CONCRET:
     Ligne 5: "MOZZARELLA BUF CAMP 125GR"  qté=3  discount=-99-99  AMOUNT=vide  → ❌ IGNORER TOTALEMENT
     Ligne 6: "BURRATA 125GR"              qté=5  AMOUNT=18.75           → ✅ RETOURNER avec qté=5 (PAS 3)

4. PRICE ≠ AMOUNT:
   - La colonne PRICE (prix unitaire) ne sert JAMAIS à alimenter prix_total_ligne.
   - prix_total_ligne provient UNIQUEMENT de la colonne AMOUNT.
   - Si AMOUNT manque, on SKIP la ligne, point final.

5. has_price_cell:
   - true = la cellule AMOUNT contenait une valeur numérique visible (y compris 0.00)
   - false = impossible car ces lignes ne doivent PAS être retournées
   - Pour les lignes retournées: has_price_cell = true obligatoirement.

═══════════════════════════════════════════════════════════════════════════

GUARDRAILS — Règles anti-hallucination (STRICT):
- Le montant total ligne (AMOUNT) est la RÉFÉRENCE PRINCIPALE.
- Si tu n'es PAS SÛR de la quantité → retourne quantite_commandee: null. NE DEVINE JAMAIS.
- Si tu n'es PAS SÛR du prix unitaire → ne le calcule pas. Laisse le moteur frontend s'en charger.
- INTERDICTION ABSOLUE de recopier une Qté/PU/Montant depuis une ligne précédente ou suivante.
- PRIORITÉ D'EXTRACTION: 1) code article + désignation + montant ligne. 2) Ensuite seulement: prix unitaire et quantité.
- COLONNES AMBIGUËS (Qté vs Colisage): si plusieurs chiffres possibles, choisis celui qui explique le montant (cohérence simple). Sinon retourne quantite_commandee: null.
- FORMAT: quantite_commandee = null est AUTORISÉ et PRÉFÉRÉ à un faux chiffre.

NETTOYAGE NOM PRODUIT (STRICT):
- nom_produit_complet = NOM PROPRE DU PRODUIT UNIQUEMENT
- RETIRER du nom: conditionnement, unité, quantité, pays, catégorie, mentions techniques
- Exemples de nettoyage:
  - "Beurre doux *250 gr" → nom_produit_complet: "Beurre doux"
  - "Brie *1 kg" → nom_produit_complet: "Brie"
  - "Bûche de chèvre long *180 gr" → nom_produit_complet: "Bûche de chèvre"
  - "Citron jaune ES" → nom_produit_complet: "Citron jaune"
  - "Aubergine (cat. 1) FR" → nom_produit_complet: "Aubergine"
  - "JAUNE D OEUF LIQ *1L EC PL" → nom_produit_complet: "Jaune d'œuf liquide"

INFOS PRODUIT (SÉPARATION STRICTE):
- info_produit = toutes les infos RETIRÉES du nom, format texte structuré
- Contenu possible: conditionnement, format, origine, catégorie, mentions
- Exemples:
  - "Beurre doux *250 gr" → info_produit: "Conditionnement: 250 g"
  - "Citron jaune ES" → info_produit: "Origine: ES"
  - "Aubergine (cat. 1) FR" → info_produit: "Catégorie: 1 | Origine: FR"
  - "JAUNE D OEUF LIQ *1L EC PL" → info_produit: "Format: 1 L | Mentions: EC, PL"
- Si aucune info à extraire → info_produit: null

- quantite_commandee: quantité commandée visible sur la ligne (null si non visible)
- prix_total_ligne: montant total de la ligne (null si non visible — voir règle anti-décalage)

═══════════════════════════════════════════════════════════════════════════
CONTENU_FACTURE — UNITÉ DE FACTURATION (RÈGLE ANTI-HALLUCINATION):
═══════════════════════════════════════════════════════════════════════════

contenu_facture = l'unité de facturation VISIBLE dans la colonne UNITÉ de la ligne.

VALEURS AUTORISÉES (enum fermé):
"kg", "g", "piece", "litre", "cl", "ml", "boite", "carton", "bouteille",
"barquette", "sac", "botte", "lot", "palette", "fut", "bidon", "pack", "caisse"

VALEURS INTERDITES — RETOURNER null À LA PLACE:
"u", "un", "uni", "unite", "unité", "unit", "ea", "st", "pce"
Ces abréviations génériques n'apportent aucune information utile → null.

EXEMPLES DE CONVERSION:
- Colonne affiche "KG" ou "Kg" → contenu_facture: "kg"
- Colonne affiche "5 BTE" → contenu_facture: "boite"
- Colonne affiche "1 CT" ou "CARTON" → contenu_facture: "carton"
- Colonne affiche "3 PCES" ou "PIECES" → contenu_facture: "piece"
- Colonne affiche "U" ou "UN" ou "UNITÉ" → contenu_facture: null (PAS "u")
- Colonne affiche "PCE" → contenu_facture: "piece" (PAS "pce")
- Pas de colonne unité visible → contenu_facture: null
- Unité non reconnue → contenu_facture: null (NE JAMAIS INVENTER)

═══════════════════════════════════════════════════════════════════════════

- Valeur non visible sur MÊME ligne → null
- Nom non identifiable → ignorer la ligne

═══════════════════════════════════════════════════════════════════════════
RÈGLES INSIGHTS (extraction document-level):
═══════════════════════════════════════════════════════════════════════════

Extraire TOUTES les informations utiles au niveau DOCUMENT. Labels standardisés:

INFORMATIONS OBLIGATOIRES (si visibles):
- "IBAN": numéro IBAN complet (ex: "FR76 1020 7000 3122 2199 4542 894")
- "BIC": code BIC/SWIFT (ex: "CCBPFRPPMTG")
- "Échéance": date d'échéance de paiement (format YYYY-MM-DD si possible)
- "Moyen de paiement": prélèvement, virement, chèque, etc.
- "Référence BL": numéro de bon de livraison
- "Date de livraison": date de livraison prévue ou effective
- "Contact fournisseur": email ou téléphone du fournisseur

INFORMATIONS OPTIONNELLES:
- "Conditions de paiement": texte des conditions
- "Numéro commande": référence commande client
- "Note fournisseur" ou "Instruction": commentaires, notes, instructions extraits de la facture

NE PAS inclure: tokens bruts, chiffres isolés, mots sans sens.
Chaque insight = { "label": "...", "value": "..." }

═══════════════════════════════════════════════════════════════════════════
FACTURES MULTI-PAGES:
═══════════════════════════════════════════════════════════════════════════

- Extraire les produits de TOUTES les pages, pas seulement la première.
- Les en-têtes de colonnes répétés sur chaque page ne sont PAS des produits → les ignorer.
- Si une ligne produit est coupée entre deux pages, la fusionner en un seul item.
- Le total facture (invoice_total) se trouve généralement sur la dernière page.
- Les informations IBAN/BIC/conditions se trouvent souvent en bas de la dernière page.

═══════════════════════════════════════════════════════════════════════
RELEVÉS ET DOCUMENTS MULTI-FACTURES (CRITIQUE):
═══════════════════════════════════════════════════════════════════════

Certains documents sont des RELEVÉS (statements) contenant PLUSIEURS factures attachées.
Indices qu'un document est un relevé:
- Page 1 = tableau récapitulatif de plusieurs factures avec numéros et montants
- Pages suivantes = factures individuelles avec chacune ses propres lignes produits
- Titre contient "relevé", "récapitulatif", "statement"
- Numéro commençant par "RLV-" ou "REL-"

RÈGLES RELEVÉ (STRICT):
1. EXTRAIRE LES PRODUITS DE TOUTES LES FACTURES du relevé, PAS seulement la première.
2. Parcourir CHAQUE page de la première à la dernière. Chaque facture a ses propres produits.
3. invoice_number: utiliser le numéro du relevé (ex: "RLV-105280-100226").
4. invoice_date: utiliser la date du relevé (page 1, en-tête).
5. invoice_total: utiliser le TOTAL GÉNÉRAL du relevé (somme de toutes les factures).
6. NE PAS s'arrêter après la première facture — continuer sur TOUTES les pages.
7. Le tableau récapitulatif en première page N'EST PAS une source de produits (ce sont des totaux par facture).
8. Les pages de CGV (Conditions Générales de Vente) en fin de document sont à IGNORER pour les produits.

INSIGHTS SPÉCIFIQUES AU RELEVÉ:
- Ajouter un insight label="Type de document" value="Relevé de factures"
- Ajouter un insight pour CHAQUE facture incluse:
  label="Facture incluse" value="F26-035837 — 45.90 € TTC — 2026-01-23" (numéro, montant, date)
- Ajouter les frais de structure/livraison trouvés dans chaque facture comme insights séparés
  Ex: label="Frais de structure (F26-043578)" value="1.39 €"

ATTENTION MULTI-FACTURES — MÊME PRODUIT DANS PLUSIEURS FACTURES:
- Si le MÊME produit apparaît dans DEUX factures différentes du relevé, il faut créer DEUX lignes dans items.
- Chaque ligne est indépendante avec sa propre quantité et son propre montant.
- Ex: "Moule d'Espagne" dans facture F26-035837 (5kg, 22.00€) ET dans facture F26-043578 (3kg, 13.20€) → 2 items séparés.

AUCUN TEXTE HORS JSON. AUCUN CHAMP SUPPLÉMENTAIRE.`;

// ═══════════════════════════════════════════════════════════════════════════
// AI PROVIDER CALL
// ═══════════════════════════════════════════════════════════════════════════
interface AICallParams {
  base64Content: string;
  mimeType: string;
  provider: AIProvider;
  model?: string;
  systemPrompt?: string;
  userInstruction?: string;
}

async function callAI({ base64Content, mimeType, provider, model, systemPrompt, userInstruction }: AICallParams): Promise<Response> {
  const sysPrompt = systemPrompt || SYSTEM_PROMPT;
  const userInstr = userInstruction || USER_INSTRUCTION;

  if (provider === "openrouter") {
    const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
    if (!OPENROUTER_API_KEY) {
      throw new Error("OPENROUTER_API_KEY not configured");
    }

    const selectedModel = model || MODEL_STANDARD;
    const isPixtral = selectedModel.includes("pixtral");
    const isPdfContent = mimeType === "application/pdf";

    // Pixtral PDF: use file-parser plugin with mistral-ocr for PDF → image.
    // Pixtral image: use standard image_url (file-parser only works with PDFs).
    // Gemini: accepts both PDF and images via image_url natively.
    let fileContent: Record<string, unknown>;
    if (isPixtral && isPdfContent) {
      fileContent = {
        type: "file",
        file: {
          filename: "document.pdf",
          file_data: `data:${mimeType};base64,${base64Content}`,
        },
      };
    } else {
      fileContent = {
        type: "image_url",
        image_url: { url: `data:${mimeType};base64,${base64Content}` },
      };
    }

    const messages = [
      { role: "system", content: sysPrompt },
      {
        role: "user",
        content: [
          { type: "text", text: userInstr },
          fileContent,
        ],
      },
    ];

    // Pixtral (precise) needs more tokens for multi-page invoices with many items
    const maxTokens = isPixtral ? 16384 : 8192;

    const body: Record<string, unknown> = {
      model: selectedModel,
      messages,
      max_tokens: maxTokens,
    };

    // Add mistral-ocr plugin for Pixtral with PDFs only (not images)
    if (isPixtral && isPdfContent) {
      body.plugins = [{ id: "file-parser", pdf: { engine: "mistral-ocr" } }];
    }

    return await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://restaurantos.app",
        "X-Title": "Restaurant OS - Vision AI Extract",
      },
      body: JSON.stringify(body),
    });
  }

  if (provider === "openai") {
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY not configured");
    }

    const messages = [
      { role: "system", content: sysPrompt },
      {
        role: "user",
        content: [
          { type: "text", text: userInstr },
          {
            type: "image_url",
            image_url: { url: `data:${mimeType};base64,${base64Content}` },
          },
        ],
      },
    ];

    return await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages,
        max_tokens: 4096,
      }),
    });
  }

  if (provider === "anthropic") {
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY not configured");
    }

    const selectedModel = model || MODEL_CLAUDE;

    // Claude uses "document" blocks for PDFs and "image" blocks for images
    const isPdfContent = mimeType === "application/pdf";
    const fileBlock = isPdfContent
      ? {
          type: "document",
          source: {
            type: "base64",
            media_type: mimeType,
            data: base64Content,
          },
        }
      : {
          type: "image",
          source: {
            type: "base64",
            media_type: mimeType,
            data: base64Content,
          },
        };

    const messages = [
      {
        role: "user",
        content: [
          fileBlock,
          { type: "text", text: userInstr },
        ],
      },
    ];

    return await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: selectedModel,
        system: sysPrompt,
        messages,
        max_tokens: 16384,
      }),
    });
  }

  throw new Error(`Unknown AI provider: ${provider}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// DOCUMENT QUALITY SANITIZATION (used by BL + Relevé)
// ═══════════════════════════════════════════════════════════════════════════
function sanitizeDocumentQuality(raw: unknown): { score: number; issues: string[] } {
  const defaultQuality = { score: 1.0, issues: [] as string[] };
  if (typeof raw !== "object" || raw === null) return defaultQuality;

  const record = raw as Record<string, unknown>;
  const score = typeof record.score === "number" && !isNaN(record.score)
    ? Math.max(0, Math.min(1, record.score))
    : 1.0;
  const issues = Array.isArray(record.issues)
    ? record.issues.filter((i: unknown) => typeof i === "string") as string[]
    : [];

  return { score, issues };
}

// ═══════════════════════════════════════════════════════════════════════════
// SAFE BASE64 ENCODING
// ═══════════════════════════════════════════════════════════════════════════
function arrayBufferToBase64Safe(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 32768;
  let result = "";

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    result += String.fromCharCode(...chunk);
  }

  return btoa(result);
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════════════════
Deno.serve(async (req) => {
  const corsHeaders = makeCorsHeaders("POST, OPTIONS", req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // SEC-05: Rate limiting — 10 requests per minute per IP (AI extraction is expensive)
  const rateLimited = checkRateLimitSync(req, { windowMs: 60_000, max: 10 });
  if (rateLimited) return rateLimited;

  const emptyResponse: ExtractionResponse = {
    success: false,
    invoice: { supplier_name: null, invoice_number: null, invoice_date: null, invoice_total: null },
    items: [],
    insights: [],
  };

  try {
    log.info("Request received");

    // SEC-04: Auth check — require authenticated user
    let authSupabase;
    try {
      const auth = await requireAuth(req);
      authSupabase = auth.supabase;
    } catch (e) {
      if (e instanceof AuthError) {
        log.warn("Auth failed", { status: e.status });
        return new Response(
          JSON.stringify({ ...emptyResponse, error: e.message }),
          { status: e.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      throw e;
    }

    // HARDENING: Server-side file size check (prevents bypass of frontend 6 MB limit)
    const MAX_SERVER_FILE_SIZE = 10 * 1024 * 1024; // 10 MB absolute max
    const contentLength = req.headers.get("Content-Length");
    if (contentLength && parseInt(contentLength, 10) > MAX_SERVER_FILE_SIZE) {
      return new Response(
        JSON.stringify({ ...emptyResponse, error: "Fichier trop volumineux (max 10 Mo)" }),
        { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const formData = await req.formData();

    // SEC-06: RBAC check — establishment_id is REQUIRED for module access verification
    const establishmentId = formData.get("establishment_id") as string | null;
    if (!establishmentId) {
      return new Response(
        JSON.stringify({ ...emptyResponse, error: "establishment_id est requis" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const { data: hasAccess } = await authSupabase.rpc("has_module_access", {
      _module_key: "vision_ai",
      _min_level: "read",
      _establishment_id: establishmentId,
    });
    if (hasAccess === false) {
      return new Response(
        JSON.stringify({ ...emptyResponse, error: "Accès refusé au module Vision AI" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const file = formData.get("file") as File | null;

    if (!file) {
      return new Response(
        JSON.stringify({ ...emptyResponse, error: "Aucun fichier fourni" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Double-check actual file size (Content-Length can be spoofed)
    if (file.size > MAX_SERVER_FILE_SIZE) {
      return new Response(
        JSON.stringify({ ...emptyResponse, error: "Fichier trop volumineux (max 10 Mo)" }),
        { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const isPdf = file.type.includes("pdf") || file.name.toLowerCase().endsWith(".pdf");
    const imageTypes = ["image/jpeg", "image/png", "image/webp", "image/tiff"];
    const imageExtensions = [".jpg", ".jpeg", ".png", ".webp", ".tiff", ".tif"];
    const fileExt = file.name.substring(file.name.lastIndexOf(".")).toLowerCase();
    const isImage = imageTypes.includes(file.type) || imageExtensions.includes(fileExt);

    if (!isPdf && !isImage) {
      return new Response(
        JSON.stringify({ ...emptyResponse, error: "Formats acceptés : PDF, JPG, PNG, WebP, TIFF" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const base64 = arrayBufferToBase64Safe(arrayBuffer);
    const mimeType = isPdf ? "application/pdf" : file.type || "image/jpeg";

    // ═══════════════════════════════════════════════════════════════════════
    // PRECISION MODE TOGGLE: Select model based on user choice
    // Rollback: remove this block and hardcode model below
    // ═══════════════════════════════════════════════════════════════════════
    const precisionMode = formData.get("precision_mode") as string || "standard";

    // Claude mode uses Anthropic provider directly; other modes use configured provider
    // Fallback: if ANTHROPIC_API_KEY is absent, use the configured provider instead
    const isClaude = precisionMode === "claude";
    const hasAnthropic = !!Deno.env.get("ANTHROPIC_API_KEY");
    const provider: AIProvider = (isClaude && hasAnthropic) ? "anthropic" : getAIProvider();
    const modelForPrecision = (isClaude && hasAnthropic)
      ? MODEL_CLAUDE
      : precisionMode === "precise"
        ? MODEL_PRECISE
        : MODEL_STANDARD;

    // ═══════════════════════════════════════════════════════════════════════
    // DOCUMENT MODE: Determines extraction type (facture, bl, releve, auto)
    // Backward compatible: absent or "facture" = existing behavior
    // ═══════════════════════════════════════════════════════════════════════
    const rawDocumentMode = formData.get("document_mode") as string | null;
    const validModes = ["auto", "facture", "bl", "releve"];
    let documentMode = rawDocumentMode?.toLowerCase() || "facture";
    if (!validModes.includes(documentMode)) {
      return new Response(
        JSON.stringify({ ...emptyResponse, error: `Mode invalide: ${rawDocumentMode}. Valeurs acceptées: auto, facture, bl, releve` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Auto-classification: determine document type before extraction
    let classificationInfo: { doc_type: DocType; confidence: number; rationale: string } | null = null;
    if (documentMode === "auto") {
      // First pass: try heuristic classification with a quick VLM call
      // We use the VLM to classify since we can't extract text from base64 directly
      const classPrompt = buildClassificationPrompt();
      const classResponse = await callAI({
        base64Content: base64, mimeType, provider, model: modelForPrecision,
        systemPrompt: "You are a document classifier. JSON only. No text outside JSON.",
        userInstruction: classPrompt,
      });

      if (classResponse.ok) {
        const classData = await classResponse.json();
        const classContent = provider === "anthropic"
          ? (classData.content?.[0]?.text || "")
          : (classData.choices?.[0]?.message?.content || "");
        const classification = parseClassificationResponse(classContent);
        classificationInfo = classification;
        documentMode = classification.doc_type === "unknown" ? "facture" : classification.doc_type;
        log.info("auto_classified", { mode: documentMode, confidence: classification.confidence, rationale: classification.rationale });
      } else {
        // Classification failed — fall back to facture
        log.warn("auto_classification_failed", { fallback: "facture" });
        documentMode = "facture";
      }
    }

    // Select prompts based on document mode
    const promptConfig = documentMode === "bl"
      ? { systemPrompt: BL_SYSTEM_PROMPT, userInstruction: BL_USER_INSTRUCTION }
      : documentMode === "releve"
        ? { systemPrompt: RELEVE_SYSTEM_PROMPT, userInstruction: RELEVE_USER_INSTRUCTION }
        : { systemPrompt: SYSTEM_PROMPT, userInstruction: USER_INSTRUCTION };

    log.info("extract_start", { provider, precision: precisionMode, model: modelForPrecision, mode: documentMode, file_name: file.name, file_size: arrayBuffer.byteLength });

    // HARDENING: Retry with exponential backoff for 429 (rate limit)
    const MAX_RETRIES = 2;
    const RETRY_DELAYS = [1000, 3000]; // 1s, 3s
    let aiResponse: Response | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      aiResponse = await callAI({
        base64Content: base64, mimeType, provider, model: modelForPrecision,
        ...promptConfig,
      });

      if (aiResponse.ok) break;

      // 402 = quota exceeded — never retry, return immediately
      if (aiResponse.status === 402) {
        const errorText = await aiResponse.text();
        log.error("AI quota exceeded", undefined, { error_text: errorText?.slice(0, 500) });
        return new Response(
          JSON.stringify({ ...emptyResponse, error: "Quota IA dépassé. Contactez l'administrateur pour recharger les crédits." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // 429 = rate limit — retry with backoff
      if (aiResponse.status === 429 && attempt < MAX_RETRIES) {
        log.warn("rate_limited_retry", { delay_ms: RETRY_DELAYS[attempt], attempt: attempt + 1, max_retries: MAX_RETRIES });
        await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
        continue;
      }

      // Other errors or final 429 — break and handle below
      break;
    }

    if (!aiResponse!.ok) {
      const errorText = await aiResponse!.text();
      log.error("AI extraction error", undefined, { status: aiResponse!.status, error_text: errorText?.slice(0, 500) });

      if (aiResponse!.status === 429) {
        return new Response(
          JSON.stringify({ ...emptyResponse, error: "Limite de requêtes atteinte. Réessayez dans quelques minutes." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ ...emptyResponse, error: "Erreur extraction IA" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const aiData = await aiResponse!.json();
    // Anthropic Messages API returns { content: [{ type: "text", text: "..." }] }
    // OpenAI-compatible APIs return { choices: [{ message: { content: "..." } }] }
    const content = provider === "anthropic"
      ? (aiData.content?.[0]?.text || "")
      : (aiData.choices?.[0]?.message?.content || "");

    // ═══════════════════════════════════════════════════════════════════════
    // PARSE + SANITIZE based on document mode
    // ═══════════════════════════════════════════════════════════════════════
    try {
      let jsonString = content;

      // Try extracting JSON from markdown code blocks
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonString = jsonMatch[1].trim();
      }

      // If still not valid JSON, try to find the outermost { ... }
      if (!jsonString.startsWith("{")) {
        const firstBrace = jsonString.indexOf("{");
        const lastBrace = jsonString.lastIndexOf("}");
        if (firstBrace !== -1 && lastBrace > firstBrace) {
          jsonString = jsonString.substring(firstBrace, lastBrace + 1);
        }
      }

      // Strip trailing commas before } or ] (common LLM JSON error)
      jsonString = jsonString.replace(/,\s*([\]}])/g, "$1");

      const parsed = JSON.parse(jsonString);

      // ── BL EXTRACTION RESPONSE ──
      if (documentMode === "bl") {
        const bl = sanitizeBLHeader(parsed.bl);
        const blItems = sanitizeBLItems(Array.isArray(parsed.bl_items) ? parsed.bl_items : []);
        const documentQuality = sanitizeDocumentQuality(parsed.document_quality);
        const insights = sanitizeInsights(Array.isArray(parsed.insights) ? parsed.insights : []);
        const warnings = Array.isArray(parsed.warnings) ? parsed.warnings.filter((w: unknown) => typeof w === "string") : [];

        log.info("completed", { mode: "bl", bl_number: bl.bl_number, items_count: blItems.length, quality_score: documentQuality.score });

        return new Response(
          JSON.stringify({
            success: true,
            doc_type: "bl" as const,
            bl,
            bl_items: blItems,
            document_quality: documentQuality,
            insights,
            needs_human_review: true,
            warnings,
            ...(classificationInfo ? { classification: classificationInfo } : {}),
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // ── RELEVÉ EXTRACTION RESPONSE ──
      if (documentMode === "releve") {
        const releve = sanitizeReleveHeader(parsed.releve);
        const releveLines = sanitizeReleveLines(Array.isArray(parsed.releve_lines) ? parsed.releve_lines : []);
        const documentQuality = sanitizeDocumentQuality(parsed.document_quality);
        const insights = sanitizeInsights(Array.isArray(parsed.insights) ? parsed.insights : []);
        const warnings = Array.isArray(parsed.warnings) ? parsed.warnings.filter((w: unknown) => typeof w === "string") : [];

        log.info("completed", { mode: "releve", supplier: releve.supplier_name, lines_count: releveLines.length, period_start: releve.period_start, period_end: releve.period_end });

        return new Response(
          JSON.stringify({
            success: true,
            doc_type: "releve" as const,
            releve,
            releve_lines: releveLines,
            document_quality: documentQuality,
            insights,
            needs_human_review: true,
            warnings,
            ...(classificationInfo ? { classification: classificationInfo } : {}),
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // ── FACTURE EXTRACTION RESPONSE (unchanged) ──
      let invoice: InvoiceData = { supplier_name: null, invoice_number: null, invoice_date: null, invoice_total: null };
      let parsedItems: ExtractedProductLine[] = [];
      let insights: Insight[] = [];

      if (parsed.invoice && typeof parsed.invoice === "object") {
        invoice = sanitizeInvoice(parsed.invoice);
      }

      if (Array.isArray(parsed.items)) {
        parsedItems = sanitizeExtractedItems(parsed.items);
      }

      if (Array.isArray(parsed.insights)) {
        insights = sanitizeInsights(parsed.insights);
      }

      log.info("completed", { mode: "facture", invoice_number: invoice.invoice_number, items_count: parsedItems.length, insights_count: insights.length });

      return new Response(
        JSON.stringify({
          success: true,
          invoice,
          items: parsedItems,
          insights,
          ...(classificationInfo ? { doc_type: "facture", classification: classificationInfo } : {}),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (parseError) {
      log.error("JSON parse error", parseError, { raw_content_preview: content.slice(0, 200) });
      return new Response(
        JSON.stringify({
          ...emptyResponse,
          error: "Erreur d'analyse de la réponse IA. Le format retourné n'était pas du JSON valide. Réessayez ou utilisez le mode précis.",
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch (error) {
    // SEC-20: Log detailed error server-side, return generic message to client
    log.error("Unhandled error", error);
    return new Response(
      JSON.stringify({ ...emptyResponse, error: "Erreur interne du serveur" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

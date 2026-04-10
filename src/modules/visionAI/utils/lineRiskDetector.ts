/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LINE RISK DETECTOR — Détection automatique des lignes à risque
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Détecte les lignes extraites qui nécessitent une attention particulière:
 * - Mots-clés "offert", "gratuit", "omaggio", "sconto", "remise"
 * - Incohérences de prix (prix = 0 mais pas marqué offert)
 * 
 * RÈGLES SSOT:
 * - Cette détection est PUREMENT indicative (badge visuel)
 * - Aucune correction automatique
 * - Aucune modification des données
 */

export interface LineRiskFlag {
  type: "keyword_offer" | "price_zero" | "price_mismatch";
  keyword?: string;
  message: string;
}

export interface LineRiskResult {
  hasRisk: boolean;
  flags: LineRiskFlag[];
  primaryRisk: LineRiskFlag | null;
}

// Keywords indicating free/discounted items (multi-language support)
const OFFER_KEYWORDS = [
  // French
  "offert",
  "gratuit",
  "remise",
  "cadeau",
  "promo",
  "promotion",
  // Italian
  "omaggio",
  "gratuito",
  "sconto",
  "regalo",
  // Spanish
  "gratis",
  "descuento",
  "obsequio",
  // English
  "free",
  "gift",
  "discount",
  "complimentary",
];

/**
 * Detect keywords in product name or info that indicate free/discounted items
 */
function detectOfferKeywords(text: string | null): { found: boolean; keyword: string | null } {
  if (!text) return { found: false, keyword: null };
  
  const normalized = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  
  for (const keyword of OFFER_KEYWORDS) {
    // Match whole word or word boundary
    const regex = new RegExp(`\\b${keyword}\\b`, "i");
    if (regex.test(normalized)) {
      return { found: true, keyword };
    }
  }
  
  return { found: false, keyword: null };
}

/**
 * Analyze a product line for potential risks
 */
export function detectLineRisks(params: {
  nom_produit: string;
  info_produit: string | null;
  prix_total_ligne: number | null;
  price_missing?: boolean;
}): LineRiskResult {
  const { nom_produit, info_produit, prix_total_ligne, price_missing } = params;
  const flags: LineRiskFlag[] = [];
  
  // 1. Check for offer keywords in product name
  const nameKeyword = detectOfferKeywords(nom_produit);
  if (nameKeyword.found) {
    flags.push({
      type: "keyword_offer",
      keyword: nameKeyword.keyword ?? undefined,
      message: `Mot-clé "${nameKeyword.keyword}" détecté dans le nom`,
    });
  }
  
  // 2. Check for offer keywords in product info
  const infoKeyword = detectOfferKeywords(info_produit);
  if (infoKeyword.found && infoKeyword.keyword !== nameKeyword.keyword) {
    flags.push({
      type: "keyword_offer",
      keyword: infoKeyword.keyword ?? undefined,
      message: `Mot-clé "${infoKeyword.keyword}" détecté dans les infos`,
    });
  }
  
  // 3. Check for price = 0 without explicit "offert" flag
  if (prix_total_ligne === 0 && !price_missing) {
    // Price is explicitly 0 — likely a free item
    flags.push({
      type: "price_zero",
      message: "Prix à 0 € — vérifiez si offert",
    });
  }
  
  return {
    hasRisk: flags.length > 0,
    flags,
    primaryRisk: flags[0] ?? null,
  };
}

/**
 * Quick check if a line has any risk (for UI badge)
 */
export function hasLineRisk(params: {
  nom_produit: string;
  info_produit: string | null;
  prix_total_ligne: number | null;
  price_missing?: boolean;
}): boolean {
  return detectLineRisks(params).hasRisk;
}

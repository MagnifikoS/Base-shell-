/**
 * Shared sanitization functions for Vision AI extraction results.
 *
 * Used by both vision-ai-extract and bench-extract edge functions.
 * SSOT for all invoice/items/insights sanitization logic.
 */

// ═══════════════════════════════════════════════════════════════════════════
// INTERFACES
// ═══════════════════════════════════════════════════════════════════════════

export interface InvoiceData {
  supplier_name: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  invoice_total: number | null;
}

export interface CategorySuggestion {
  label: string;
  confidence: number;
}

export interface ExtractedProductLine {
  code_produit: string | null;
  nom_produit_complet: string;
  info_produit: string | null;
  quantite_commandee: number | null;
  prix_total_ligne: number | null;
  /** Unité facturée visible sur la facture (kg, pièce, caisse, etc.) - jamais inventée */
  contenu_facture: string | null;
  category_suggestion?: CategorySuggestion;
  /**
   * 🔒 Flag anti-décalage: true si le prix n'était pas visible sur cette ligne
   * Permet à l'UI de savoir que c'est un produit offert/gratuit, pas une erreur
   */
  price_missing?: boolean;
  /**
   * 🔒 Flag LLM: true si la cellule PRIX/MONTANT était présente sur la ligne
   * false = cellule vide, null = non fourni par l'IA
   */
  has_price_cell?: boolean | null;
}

export interface Insight {
  label: string;
  value: string;
}

export interface ExtractionResponse {
  success: boolean;
  invoice: InvoiceData;
  items: ExtractedProductLine[];
  insights: Insight[];
  error?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// TEXT SANITIZATION HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 🔒 VAI-02: Strip HTML tags from LLM-extracted text to prevent XSS.
 * Removes all HTML/XML tags, decodes common HTML entities, and trims whitespace.
 * Applied to all user-facing string fields before they reach the frontend.
 */
export function stripHtmlTags(input: string): string {
  return input
    .replace(/<[^>]*>/g, "")          // Remove HTML/XML tags
    .replace(/&lt;/gi, "<")           // Decode common HTML entities
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, "/")
    .replace(/&nbsp;/gi, " ")
    .trim();
}

/**
 * Sanitize a string: trim, strip HTML tags, return null if empty.
 */
function sanitizeTextField(val: unknown): string | null {
  if (typeof val === "string" && val.trim() !== "") {
    const cleaned = stripHtmlTags(val);
    return cleaned !== "" ? cleaned : null;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// SANITIZATION FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

export function sanitizeInvoice(raw: unknown): InvoiceData {
  const defaultInvoice: InvoiceData = {
    supplier_name: null,
    invoice_number: null,
    invoice_date: null,
    invoice_total: null,
  };

  if (typeof raw !== "object" || raw === null) return defaultInvoice;

  const record = raw as Record<string, unknown>;

  return {
    supplier_name: sanitizeTextField(record.supplier_name),
    invoice_number: sanitizeTextField(record.invoice_number),
    invoice_date: sanitizeTextField(record.invoice_date),
    invoice_total:
      typeof record.invoice_total === "number" && !isNaN(record.invoice_total)
        ? record.invoice_total
        : null,
  };
}

const VALID_CATEGORIES = [
  "Viande", "Poisson", "Produits laitiers", "Boissons", "Épicerie",
  "Surgelés", "Fruits & Légumes", "Boulangerie", "Hygiène", "Autre"
];

export function sanitizeCategorySuggestion(raw: unknown): CategorySuggestion | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;

  const record = raw as Record<string, unknown>;
  const label = record.label;
  const confidence = record.confidence;

  if (typeof label !== "string" || label.trim() === "") return undefined;

  const normalizedLabel = VALID_CATEGORIES.find(
    cat => cat.toLowerCase() === label.trim().toLowerCase()
  ) || "Autre";

  const normalizedConfidence = typeof confidence === "number" && !isNaN(confidence)
    ? Math.max(0, Math.min(1, confidence))
    : 0.5;

  return {
    label: normalizedLabel,
    confidence: normalizedConfidence,
  };
}

/** 🔒 Anti-hallucination: reject generic/useless unit abbreviations */
const INVALID_UNITS = new Set(["u", "un", "uni", "unite", "unité", "unit", "ea", "st", "pce"]);

/**
 * 🔒 FILTRE ANTI-FRAIS: Détecte les lignes de frais/services qui ne sont PAS des produits.
 * Safety net au cas où le LLM les inclurait dans "items" malgré le prompt.
 *
 * @returns true si la ligne est un frais/service (doit être exclu des items)
 */
function isFeeNotProduct(productName: string, codeArticle: string | null): boolean {
  const nameLower = productName.toLowerCase().trim();

  // Patterns de frais courants sur les factures fournisseurs
  const FEE_PATTERNS = [
    /^frais\s+de\s+livraison/,
    /^frais\s+de\s+port/,
    /^frais\s+de\s+transport/,
    /^frais\s+de\s+structure/,
    /^frais\s+de\s+service/,
    /^frais\s+d['']?emballage/,
    /^frais\s+administratif/,
    /^frais\s+logistique/,
    /^participation\s+publicitaire/,
    /^eco[\s-]?contribution/,
    /^eco[\s-]?taxe/,
    /^franco\s+de\s+port/,
    /^port\s+et\s+emballage/,
    /^supplément\s+transport/,
    /^supplément\s+livraison/,
  ];

  for (const pattern of FEE_PATTERNS) {
    if (pattern.test(nameLower)) return true;
  }

  // Code article starting with "04 999" is typically a fee code (e.g., J'Oceane)
  if (codeArticle && /^04\s*999/.test(codeArticle.trim())) return true;

  return false;
}

export function sanitizeExtractedItems(rawItems: unknown[]): ExtractedProductLine[] {
  const validItems: ExtractedProductLine[] = [];

  for (const item of rawItems) {
    if (typeof item !== "object" || item === null) continue;

    const record = item as Record<string, unknown>;

    const rawNom = record.nom_produit_complet;
    if (typeof rawNom !== "string" || rawNom.trim() === "") {
      console.log("[SANITIZE] Ligne ignorée: nom_produit_complet manquant", record);
      continue;
    }
    const nomProduit = stripHtmlTags(rawNom);

    let quantite: number | null = null;
    if (typeof record.quantite_commandee === "number" && !isNaN(record.quantite_commandee)) {
      quantite = record.quantite_commandee;
    }

    let prix: number | null = null;
    if (typeof record.prix_total_ligne === "number" && !isNaN(record.prix_total_ligne)) {
      prix = record.prix_total_ligne;
    }

    const code: string | null = sanitizeTextField(record.code_produit);

    const infoProduit: string | null = sanitizeTextField(record.info_produit);

    // 🔒 EXTRACTION PURE: contenu_facture - unité facturée visible (JAMAIS inventée)
    let contenuFacture: string | null = null;
    if (typeof record.contenu_facture === "string" && record.contenu_facture.trim() !== "") {
      // Normaliser: minuscules, trim
      const rawUnit = record.contenu_facture.trim().toLowerCase();
      contenuFacture = INVALID_UNITS.has(rawUnit) ? null : rawUnit;
    }

    const categorySuggestion = sanitizeCategorySuggestion(record.category_suggestion);

    // 🔒 ANTI-DÉCALAGE: Flag price_missing si prix est null/undefined (mais PAS si 0)
    // Règle: null/undefined = missing, 0 reste 0 (prix explicitement à zéro)
    const priceMissing = prix === null || prix === undefined;

    // 🔒 has_price_cell: récupérer la valeur LLM, appliquer cohérence
    let hasPriceCell: boolean | null = null;
    if (typeof record.has_price_cell === "boolean") {
      hasPriceCell = record.has_price_cell;
    }
    // Cohérence: si prix === null, has_price_cell ne peut pas être true
    if (prix === null && hasPriceCell === true) {
      hasPriceCell = false;
    }

    const extractedItem: ExtractedProductLine = {
      code_produit: code,
      nom_produit_complet: nomProduit,
      info_produit: infoProduit,
      quantite_commandee: quantite,
      prix_total_ligne: prix,
      contenu_facture: contenuFacture,
      price_missing: priceMissing,
      has_price_cell: hasPriceCell,
    };

    if (categorySuggestion) {
      extractedItem.category_suggestion = categorySuggestion;
    }

    validItems.push(extractedItem);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 🔒 FILTRE ANTI-POLLUTION: Supprimer les lignes offertes/sans montant
  // Règle: si prix_total_ligne est null → la ligne est exclue TOTALEMENT.
  // Seule exception: prix_total_ligne === 0 (produit explicitement "offert" avec 0.00 visible)
  // Ceci empêche toute contamination de données vers les lignes suivantes.
  // ROLLBACK: supprimer ce bloc uniquement.
  // ═══════════════════════════════════════════════════════════════════════
  const cleanedItems = validItems.filter((item) => {
    if (item.prix_total_ligne === null || item.prix_total_ligne === undefined) {
      console.log(
        `[SANITIZE] Ligne supprimée (pas de montant): "${item.nom_produit_complet}" | code=${item.code_produit} | qté=${item.quantite_commandee}`
      );
      return false;
    }
    // 🔒 FILTRE ANTI-FRAIS: Supprimer les frais/services qui auraient échappé au prompt
    // Safety net — les frais doivent être dans insights, pas items
    if (isFeeNotProduct(item.nom_produit_complet, item.code_produit)) {
      console.log(
        `[SANITIZE] Ligne supprimée (frais/service, pas un produit): "${item.nom_produit_complet}" | code=${item.code_produit} | montant=${item.prix_total_ligne}`
      );
      return false;
    }
    return true;
  });

  console.log(
    `[SANITIZE] Items: ${validItems.length} bruts → ${cleanedItems.length} après filtre anti-pollution (${validItems.length - cleanedItems.length} supprimées)`
  );

  return cleanedItems;
}

export function sanitizeInsights(rawInsights: unknown[]): Insight[] {
  const validInsights: Insight[] = [];

  for (const insight of rawInsights) {
    if (typeof insight !== "object" || insight === null) continue;

    const record = insight as Record<string, unknown>;

    const label = record.label;
    const value = record.value;

    const cleanLabel = sanitizeTextField(label);
    const cleanValue = sanitizeTextField(value);

    if (cleanLabel && cleanValue) {
      validInsights.push({
        label: cleanLabel,
        value: cleanValue,
      });
    }
  }

  return validInsights;
}

// ═══════════════════════════════════════════════════════════════════════════
// BL (Bon de Livraison) SANITIZATION
// Different rules: keeps lines without price, keeps null quantities
// ═══════════════════════════════════════════════════════════════════════════

export interface BLHeaderData {
  supplier_name: string | null;
  bl_number: string | null;
  bl_date: string | null;
  order_reference: string | null;
}

export interface BLItemData {
  raw_label: string;
  /** Code article fournisseur extrait du document. null si absent ou illisible. */
  product_code: string | null;
  product_name: string;
  qty_delivered: number | null;
  unit: string | null;
  notes: string | null;
  field_confidence: {
    product_name: number;
    qty_delivered: number;
    unit: number;
  };
  unreadable_fields: Array<{
    field: string;
    reason: string;
  }>;
}

function sanitizeString(val: unknown): string | null {
  if (typeof val === "string" && val.trim() !== "") {
    return stripHtmlTags(val);
  }
  return null;
}

function sanitizeNumber(val: unknown): number | null {
  if (typeof val === "number" && !isNaN(val)) return val;
  if (typeof val === "string") {
    const parsed = parseFloat(val.replace(/[^0-9.-]/g, ""));
    if (!isNaN(parsed)) return parsed;
  }
  return null;
}

function clampConfidence(val: unknown): number {
  if (typeof val === "number" && !isNaN(val)) {
    return Math.max(0, Math.min(1, val));
  }
  return 0.5;
}

export function sanitizeBLHeader(raw: unknown): BLHeaderData {
  const defaultHeader: BLHeaderData = {
    supplier_name: null,
    bl_number: null,
    bl_date: null,
    order_reference: null,
  };

  if (typeof raw !== "object" || raw === null) return defaultHeader;

  const record = raw as Record<string, unknown>;

  return {
    supplier_name: sanitizeString(record.supplier_name),
    bl_number: sanitizeString(record.bl_number),
    bl_date: normalizeDateToISO(record.bl_date) ?? sanitizeString(record.bl_date),
    order_reference: sanitizeString(record.order_reference),
  };
}

export function sanitizeBLItems(rawItems: unknown[]): BLItemData[] {
  const validItems: BLItemData[] = [];

  for (const item of rawItems) {
    if (typeof item !== "object" || item === null) continue;

    const record = item as Record<string, unknown>;

    // raw_label is required
    const rawLabel = sanitizeString(record.raw_label);
    if (!rawLabel) continue;

    // product_code: optional — only if explicitly present and non-empty.
    // NEVER infer or guess. null if absent.
    const productCode: string | null = sanitizeString(record.product_code);

    // product_name defaults to raw_label if missing
    const productName = sanitizeString(record.product_name) || rawLabel;

    // qty_delivered: keep null (BL items may have unreadable quantities)
    const qtyDelivered = sanitizeNumber(record.qty_delivered);

    // unit: normalize lowercase, trim
    let unit: string | null = null;
    if (typeof record.unit === "string" && record.unit.trim() !== "") {
      unit = record.unit.trim().toLowerCase();
    }

    // notes
    const notes = sanitizeString(record.notes);

    // field_confidence: validate and clamp
    const rawConf = (typeof record.field_confidence === "object" && record.field_confidence !== null)
      ? record.field_confidence as Record<string, unknown>
      : {};
    const fieldConfidence = {
      product_name: clampConfidence(rawConf.product_name),
      qty_delivered: clampConfidence(rawConf.qty_delivered),
      unit: clampConfidence(rawConf.unit),
    };

    // unreadable_fields: ensure array of valid entries
    const rawUnreadable = Array.isArray(record.unreadable_fields) ? record.unreadable_fields : [];
    const unreadableFields: Array<{ field: string; reason: string }> = [];
    for (const entry of rawUnreadable) {
      if (typeof entry === "object" && entry !== null) {
        const e = entry as Record<string, unknown>;
        const field = sanitizeString(e.field);
        const reason = sanitizeString(e.reason);
        if (field && reason) {
          unreadableFields.push({ field, reason });
        }
      }
    }

    validItems.push({
      raw_label: rawLabel,
      product_code: productCode,
      product_name: productName,
      qty_delivered: qtyDelivered,
      unit,
      notes,
      field_confidence: fieldConfidence,
      unreadable_fields: unreadableFields,
    });
  }

  console.log(`[SANITIZE-BL] Items: ${rawItems.length} bruts → ${validItems.length} après sanitisation`);
  return validItems;
}

// ═══════════════════════════════════════════════════════════════════════════
// RELEVÉ (Supplier Statement) SANITIZATION
// Different rules: keeps lines with missing amounts, validates dates
// ═══════════════════════════════════════════════════════════════════════════

export interface ReleveHeaderData {
  supplier_name: string | null;
  supplier_account_ref: string | null;
  period_start: string | null;
  period_end: string | null;
  previous_balance: number | null;
  total_invoiced: number | null;
  total_credits: number | null;
  total_payments: number | null;
  balance_due: number | null;
  issue_date: string | null;
}

export type ReleveLineType = "invoice" | "credit_note" | "payment" | "other";

export interface ReleveLineData {
  line_type: ReleveLineType;
  reference: string | null;
  date: string | null;
  description: string | null;
  amount_ht: number | null;
  amount_ttc: number | null;
  amount_tva: number | null;
  due_date: string | null;
  is_credit: boolean;
  field_confidence: {
    reference: number;
    amount_ttc: number;
    date: number;
  };
}

/** Validate a YYYY-MM-DD date is plausible (month 01-12, day 01-31) */
function isPlausibleDate(year: string, month: string, day: string): boolean {
  const m = parseInt(month, 10);
  const d = parseInt(day, 10);
  return m >= 1 && m <= 12 && d >= 1 && d <= 31;
}

/** Attempt to normalize DD/MM/YYYY to YYYY-MM-DD.
 *  Also fixes AI month/day swaps: if month > 12 but day <= 12, swap them. */
function normalizeDateToISO(val: unknown): string | null {
  if (typeof val !== "string" || val.trim() === "") return null;
  const trimmed = val.trim();

  // Already YYYY-MM-DD?
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [year, month, day] = trimmed.split("-");
    // Fix AI month/day swap: if month > 12 but day <= 12, swap them
    const m = parseInt(month, 10);
    const d = parseInt(day, 10);
    if (m > 12 && d <= 12) {
      return `${year}-${day.padStart(2, "0")}-${month.padStart(2, "0")}`;
    }
    return trimmed;
  }

  // DD/MM/YYYY or DD-MM-YYYY
  const match = trimmed.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (match) {
    let day = match[1].padStart(2, "0");
    let month = match[2].padStart(2, "0");
    const year = match[3];
    // If month > 12 but day <= 12, values are likely swapped
    if (parseInt(month, 10) > 12 && parseInt(day, 10) <= 12) {
      [day, month] = [month, day];
    }
    if (isPlausibleDate(year, month, day)) {
      return `${year}-${month}-${day}`;
    }
  }

  // DD/MM/YY (2-digit year) — assume 20xx for years < 50, 19xx otherwise
  const match2 = trimmed.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2})$/);
  if (match2) {
    let day = match2[1].padStart(2, "0");
    let month = match2[2].padStart(2, "0");
    const shortYear = parseInt(match2[3], 10);
    const year = shortYear < 50 ? `20${match2[3]}` : `19${match2[3]}`;
    if (parseInt(month, 10) > 12 && parseInt(day, 10) <= 12) {
      [day, month] = [month, day];
    }
    if (isPlausibleDate(year, month, day)) {
      return `${year}-${month}-${day}`;
    }
  }

  // Return as-is if can't parse
  return trimmed;
}

export function sanitizeReleveHeader(raw: unknown): ReleveHeaderData {
  const defaultHeader: ReleveHeaderData = {
    supplier_name: null,
    supplier_account_ref: null,
    period_start: null,
    period_end: null,
    previous_balance: null,
    total_invoiced: null,
    total_credits: null,
    total_payments: null,
    balance_due: null,
    issue_date: null,
  };

  if (typeof raw !== "object" || raw === null) return defaultHeader;

  const record = raw as Record<string, unknown>;

  return {
    supplier_name: sanitizeString(record.supplier_name),
    supplier_account_ref: sanitizeString(record.supplier_account_ref),
    period_start: normalizeDateToISO(record.period_start),
    period_end: normalizeDateToISO(record.period_end),
    previous_balance: sanitizeNumber(record.previous_balance),
    total_invoiced: sanitizeNumber(record.total_invoiced),
    total_credits: sanitizeNumber(record.total_credits),
    total_payments: sanitizeNumber(record.total_payments),
    balance_due: sanitizeNumber(record.balance_due),
    issue_date: normalizeDateToISO(record.issue_date),
  };
}

export function sanitizeReleveLines(rawLines: unknown[]): ReleveLineData[] {
  const validLines: ReleveLineData[] = [];
  const validLineTypes: ReleveLineType[] = ["invoice", "credit_note", "payment", "other"];

  for (const line of rawLines) {
    if (typeof line !== "object" || line === null) continue;

    const record = line as Record<string, unknown>;

    // line_type: validate or default to "other"
    const rawLineType = typeof record.line_type === "string" ? record.line_type.toLowerCase() : "other";
    const lineType: ReleveLineType = validLineTypes.includes(rawLineType as ReleveLineType)
      ? rawLineType as ReleveLineType
      : "other";

    const reference = sanitizeString(record.reference);
    const date = normalizeDateToISO(record.date);
    const description = sanitizeString(record.description);

    // Amounts: keep null if not provided (Relevé lines may have missing amounts)
    const amountHt = sanitizeNumber(record.amount_ht);
    const amountTtc = sanitizeNumber(record.amount_ttc);
    const amountTva = sanitizeNumber(record.amount_tva);
    const dueDate = normalizeDateToISO(record.due_date);

    // is_credit: boolean (credit notes, payments are credits)
    let isCredit = false;
    if (typeof record.is_credit === "boolean") {
      isCredit = record.is_credit;
    } else if (lineType === "credit_note" || lineType === "payment") {
      isCredit = true;
    }

    // field_confidence
    const rawConf = (typeof record.field_confidence === "object" && record.field_confidence !== null)
      ? record.field_confidence as Record<string, unknown>
      : {};
    const fieldConfidence = {
      reference: clampConfidence(rawConf.reference),
      amount_ttc: clampConfidence(rawConf.amount_ttc),
      date: clampConfidence(rawConf.date),
    };

    // Filter out summary/total rows that are not actual transaction lines.
    // These are aggregation rows like "TOTAL ECHEANCE", "Montant HT Restant", etc.
    const descLower = (description || "").toLowerCase();
    const isSummaryRow = !reference && !date && (
      descLower.includes("total") ||
      descLower.includes("restant") ||
      descLower.includes("solde") ||
      descLower.includes("report") ||
      descLower.includes("sous-total")
    );
    if (isSummaryRow && lineType === "other") {
      continue; // Skip summary rows — they duplicate header-level totals
    }

    validLines.push({
      line_type: lineType,
      reference,
      date,
      description,
      amount_ht: amountHt,
      amount_ttc: amountTtc,
      amount_tva: amountTva,
      due_date: dueDate,
      is_credit: isCredit,
      field_confidence: fieldConfidence,
    });
  }

  console.log(`[SANITIZE-RELEVE] Lines: ${rawLines.length} bruts → ${validLines.length} après sanitisation`);
  return validLines;
}

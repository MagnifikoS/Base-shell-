/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MODULE FACTURES — Service Layer V1.3 (Security Hardened)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Service pour les opérations CRUD sur les factures.
 * Séparé de l'UI pour maintenir l'architecture modulaire.
 *
 * RÈGLES SSOT:
 * - Toute création de facture passe par ce service
 * - Valide que invoice_number, invoice_date ET amount_eur sont présents
 * - supplier_name est optionnel (NON bloquant)
 * - BLOCAGE DOUBLON: vérifie avant insert si la facture existe déjà
 *
 * ⚠️ SÉCURITÉ — POLITIQUE DE SUPPRESSION:
 * - La fonction deleteInvoice() est une opération DESTRUCTIVE
 * - Elle ne doit JAMAIS être appelée sans confirmation utilisateur explicite
 * - Voir docs/data-deletion-policy.md pour les règles complètes
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { supabase } from "@/integrations/supabase/client";
import type { Invoice, MonthNavigation } from "../types";
import { toYearMonthString } from "../types";

/**
 * Error codes for invoice operations
 */
export const INVOICE_ERROR_CODES = {
  DUPLICATE_EXACT: "INVOICE_DUPLICATE_EXACT",
  DUPLICATE_ROBUST: "INVOICE_DUPLICATE_ROBUST",
  DUPLICATE_FUZZY: "INVOICE_DUPLICATE_FUZZY",
  VALIDATION_ERROR: "INVOICE_VALIDATION_ERROR",
} as const;

/**
 * Paramètres pour créer une facture depuis Vision AI
 * RÈGLE: invoice_number, invoice_date ET amount_eur sont OBLIGATOIRES
 * supplier_name est optionnel (NON bloquant)
 */
export interface CreateInvoiceParams {
  establishment_id: string;
  organization_id: string;
  supplier_id: string;
  supplier_name?: string | null; // Optionnel - validé user
  invoice_number: string; // OBLIGATOIRE - validé user
  invoice_date: string; // OBLIGATOIRE - validé user (YYYY-MM-DD)
  amount_eur: number; // OBLIGATOIRE - validé user
  file_path: string;
  file_name: string;
  file_size: number;
  file_type: string;
  created_by: string;
}

/**
 * Check for duplicate invoice BEFORE insert
 * Returns error code if duplicate found
 */
async function checkDuplicateInvoice(params: CreateInvoiceParams): Promise<{
  isDuplicate: boolean;
  errorCode?: string;
  message?: string;
}> {
  // Check 1: Exact match (same supplier + same invoice number)
  if (params.invoice_number?.trim()) {
    const { data: exactMatch } = await supabase
      .from("invoices")
      .select("id, invoice_number")
      .eq("establishment_id", params.establishment_id)
      .eq("supplier_id", params.supplier_id)
      .eq("invoice_date", params.invoice_date)
      .ilike("invoice_number", params.invoice_number.trim())
      .limit(1)
      .maybeSingle();

    if (exactMatch) {
      return {
        isDuplicate: true,
        errorCode: INVOICE_ERROR_CODES.DUPLICATE_EXACT,
        message: `Facture déjà existante avec le même numéro (${params.invoice_number})`,
      };
    }
  }

  // Check 2: Robust match (same supplier + date + amount)
  const { data: robustMatch } = await supabase
    .from("invoices")
    .select("id, invoice_number, invoice_date, amount_eur")
    .eq("establishment_id", params.establishment_id)
    .eq("supplier_id", params.supplier_id)
    .eq("invoice_date", params.invoice_date)
    .eq("amount_eur", params.amount_eur)
    .limit(1)
    .maybeSingle();

  if (robustMatch) {
    return {
      isDuplicate: true,
      errorCode: INVOICE_ERROR_CODES.DUPLICATE_ROBUST,
      message: `Facture déjà existante (même date ${params.invoice_date} et montant ${params.amount_eur}€)`,
    };
  }

  return { isDuplicate: false };
}

/**
 * Créer une facture SSOT après validation user
 *
 * RÈGLE DES 3 CHAMPS BLOQUANTE:
 * - Refuse la création si invoice_number, invoice_date OU amount_eur sont vides/null
 * - AUCUNE EXCEPTION
 * - supplier_name est NON bloquant
 *
 * RÈGLE ANTI-DOUBLON:
 * - Vérifie qu'aucune facture identique n'existe AVANT insert
 * - Bloque si doublon détecté avec code d'erreur spécifique
 */
/**
 * Generate a unique idempotency key for replace operations.
 * Combines old invoice ID + timestamp to ensure uniqueness per attempt,
 * while being stable across retries of the same user action (stored in caller).
 */
function generateIdempotencyKey(oldInvoiceId: string): string {
  return `replace_${oldInvoiceId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function createInvoice(
  params: CreateInvoiceParams,
  options?: { replaceInvoiceId?: string; replaceFilePath?: string; idempotencyKey?: string }
): Promise<{
  success: boolean;
  invoice?: Invoice;
  error?: string;
  errorCode?: string;
}> {
  // Validation stricte SSOT — RÈGLE DES 3 CHAMPS
  if (!params.invoice_number?.trim()) {
    return {
      success: false,
      error: "Référence facture obligatoire",
      errorCode: INVOICE_ERROR_CODES.VALIDATION_ERROR,
    };
  }
  if (!params.invoice_date?.trim()) {
    return {
      success: false,
      error: "Date facture obligatoire",
      errorCode: INVOICE_ERROR_CODES.VALIDATION_ERROR,
    };
  }
  if (params.amount_eur === null || params.amount_eur === undefined || params.amount_eur <= 0) {
    return {
      success: false,
      error: "Montant total facture obligatoire",
      errorCode: INVOICE_ERROR_CODES.VALIDATION_ERROR,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // REMPLACEMENT ATOMIQUE — Single server-side transaction via fn_replace_invoice
  // ═══════════════════════════════════════════════════════════════════════════
  if (options?.replaceInvoiceId) {
    const { data: { user } } = await supabase.auth.getUser();
    const idempotencyKey = options.idempotencyKey || generateIdempotencyKey(options.replaceInvoiceId);

    const { data, error } = await supabase.rpc("fn_replace_invoice", {
      p_old_invoice_id: options.replaceInvoiceId,
      p_idempotency_key: idempotencyKey,
      p_user_id: user?.id ?? null,
      p_establishment_id: params.establishment_id,
      p_organization_id: params.organization_id,
      p_supplier_id: params.supplier_id,
      p_supplier_name: params.supplier_name ?? null,
      p_invoice_number: params.invoice_number.trim(),
      p_invoice_date: params.invoice_date,
      p_amount_eur: params.amount_eur,
      p_file_path: params.file_path,
      p_file_name: params.file_name,
      p_file_size: params.file_size,
      p_file_type: params.file_type,
    });

    if (error) {
      if (import.meta.env.DEV) console.error("[invoiceService] fn_replace_invoice RPC error:", error);
      return { success: false, error: "REPLACE_INVOICE_RPC_FAILED" };
    }

    const result = data as Record<string, unknown> | null;
    if (!result?.ok) {
      return { success: false, error: (result?.error as string) ?? "REPLACE_INVOICE_FAILED" };
    }

    // Best-effort: cleanup OLD PDF (outside transaction — orphan acceptable)
    const oldFilePath = (result?.old_file_path as string) || options.replaceFilePath || "";
    if (oldFilePath) {
      try {
        await supabase.storage.from("invoices").remove([oldFilePath]);
      } catch (e) {
        if (import.meta.env.DEV)
          console.warn("[invoiceService] replace: old PDF cleanup failed (non-blocking)", e);
      }
    }

    // Fetch the newly created invoice to return full object
    const newInvoiceId = result.new_invoice_id as string;
    const { data: newInvoice } = await supabase
      .from("invoices")
      .select("*")
      .eq("id", newInvoiceId)
      .single();

    return { success: true, invoice: newInvoice as Invoice | undefined };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CRÉATION SIMPLE (pas de remplacement) — BLOCAGE DOUBLON
  // ═══════════════════════════════════════════════════════════════════════════
  const duplicateCheck = await checkDuplicateInvoice(params);
  if (duplicateCheck.isDuplicate) {
    if (import.meta.env.DEV)
      console.warn("[invoiceService] Duplicate invoice blocked:", duplicateCheck);
    return {
      success: false,
      error: duplicateCheck.message || "Cette facture existe déjà",
      errorCode: duplicateCheck.errorCode,
    };
  }

  // supplier_name: trimmer si présent, sinon null
  const supplierName = params.supplier_name?.trim() || null;

  const { data, error } = await supabase
    .from("invoices")
    .insert({
      establishment_id: params.establishment_id,
      organization_id: params.organization_id,
      supplier_id: params.supplier_id,
      supplier_name: supplierName,
      invoice_number: params.invoice_number.trim(),
      invoice_date: params.invoice_date,
      amount_eur: params.amount_eur,
      file_path: params.file_path,
      file_name: params.file_name,
      file_size: params.file_size,
      file_type: params.file_type,
      created_by: params.created_by,
      is_paid: false,
    })
    .select()
    .single();

  if (error) {
    if (import.meta.env.DEV) console.error("[invoiceService] createInvoice error:", error);
    if (error.code === "23505") {
      return {
        success: false,
        error: "Cette facture existe déjà (même référence et date)",
        errorCode: INVOICE_ERROR_CODES.DUPLICATE_EXACT,
      };
    }
    return { success: false, error: error.message };
  }

  return { success: true, invoice: data as Invoice };
}

/**
 * Récupérer les factures d'un établissement pour un mois donné
 */
export async function getInvoicesForMonth(
  establishmentId: string,
  nav: MonthNavigation
): Promise<Invoice[]> {
  const yearMonth = toYearMonthString(nav);
  const startDate = `${yearMonth}-01`;
  const endDate = `${yearMonth}-31`; // Simplification, la DB gère les dates invalides

  const { data, error } = await supabase
    .from("invoices")
    .select(
      "id, establishment_id, organization_id, supplier_id, supplier_name, supplier_name_normalized, invoice_number, invoice_date, amount_eur, file_path, file_name, file_size, file_type, is_paid, created_by, created_at, updated_at"
    )
    .eq("establishment_id", establishmentId)
    .gte("invoice_date", startDate)
    .lte("invoice_date", endDate)
    .order("invoice_date", { ascending: false });

  if (error) {
    if (import.meta.env.DEV) console.error("[invoiceService] getInvoicesForMonth error:", error);
    return [];
  }

  return (data || []) as Invoice[];
}

/**
 * Récupérer les factures d'un fournisseur pour un mois donné
 */
export async function getInvoicesForSupplierMonth(
  establishmentId: string,
  supplierId: string,
  nav: MonthNavigation
): Promise<Invoice[]> {
  const yearMonth = toYearMonthString(nav);
  const startDate = `${yearMonth}-01`;
  const endDate = `${yearMonth}-31`;

  const { data, error } = await supabase
    .from("invoices")
    .select(
      "id, establishment_id, organization_id, supplier_id, supplier_name, supplier_name_normalized, invoice_number, invoice_date, amount_eur, file_path, file_name, file_size, file_type, is_paid, created_by, created_at, updated_at"
    )
    .eq("establishment_id", establishmentId)
    .eq("supplier_id", supplierId)
    .gte("invoice_date", startDate)
    .lte("invoice_date", endDate)
    .order("invoice_date", { ascending: false });

  if (error) {
    if (import.meta.env.DEV)
      console.error("[invoiceService] getInvoicesForSupplierMonth error:", error);
    return [];
  }

  return (data || []) as Invoice[];
}

/**
 * Télécharger le fichier d'une facture depuis le storage.
 *
 * Tries the "invoices" bucket first. If the path starts with a known prefix
 * that indicates it may be stored elsewhere (e.g. legacy scans stored in
 * "vision-ia-documents"), falls back to that bucket automatically.
 */
export async function downloadInvoiceFile(filePath: string): Promise<string | null> {
  if (!filePath) {
    if (import.meta.env.DEV)
      console.warn("[invoiceService] downloadInvoiceFile called with empty filePath");
    return null;
  }

  // Determine the correct bucket:
  // - Paths starting with "establishments/" belong to the "invoices" bucket
  // - Other paths (e.g. "{userId}/scans/...") may be legacy scans in "vision-ia-documents"
  const bucket = filePath.startsWith("establishments/") ? "invoices" : "invoices";

  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(filePath, 3600); // URL valide 1h

  if (error) {
    // Fallback: try "vision-ia-documents" bucket for legacy files
    if (bucket === "invoices") {
      const { data: fallbackData, error: fallbackError } = await supabase.storage
        .from("vision-ia-documents")
        .createSignedUrl(filePath, 3600);
      if (!fallbackError && fallbackData?.signedUrl) {
        return fallbackData.signedUrl;
      }
    }
    if (import.meta.env.DEV) console.error("[invoiceService] downloadInvoiceFile error:", error);
    return null;
  }

  return data.signedUrl;
}

/**
 * Obtenir l'URL de prévisualisation d'une facture
 */
export async function getInvoicePreviewUrl(filePath: string): Promise<string | null> {
  return downloadInvoiceFile(filePath);
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ SECURITY: HARD DELETE OPERATION — DONNÉES CRITIQUES
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Supprimer une facture via RPC atomique serveur (fn_delete_invoice).
 * Toutes les suppressions enfants sont dans une transaction unique.
 * Le PDF storage est nettoyé en best-effort APRÈS la transaction DB.
 *
 * Garanties:
 * - Atomicité: tout ou rien (transaction PG)
 * - Idempotence: si déjà supprimée → succès silencieux
 * - Pas d'état partiel: impossible d'avoir des lignes orphelines
 *
 * @see docs/data-deletion-policy.md
 */
export async function deleteInvoice(
  invoiceId: string,
  filePath: string
): Promise<{
  success: boolean;
  error?: string;
}> {
  // Get current user for audit
  const { data: { user } } = await supabase.auth.getUser();

  // Atomic server-side deletion (single transaction)
  const { data, error } = await supabase.rpc("fn_delete_invoice", {
    p_invoice_id: invoiceId,
    p_user_id: user?.id ?? null,
  });

  if (error) {
    if (import.meta.env.DEV)
      console.error("[invoiceService] deleteInvoice RPC error:", error);
    const detail = error.message || error.code || "DELETE_INVOICE_RPC_FAILED";
    return { success: false, error: `Suppression échouée: ${detail}` };
  }

  const result = data as Record<string, unknown> | null;
  if (!result?.ok) {
    return { success: false, error: (result?.error as string) ?? "DELETE_INVOICE_FAILED" };
  }

  // Best-effort storage cleanup (outside transaction — orphan file is acceptable)
  const storagePath = (result?.file_path as string) || filePath;
  if (storagePath) {
    try {
      await supabase.storage.from("invoices").remove([storagePath]);
    } catch (e) {
      if (import.meta.env.DEV)
        console.warn("[invoiceService] deleteInvoice: storage cleanup failed (non-blocking)", e);
    }
  }

  return { success: true };
}

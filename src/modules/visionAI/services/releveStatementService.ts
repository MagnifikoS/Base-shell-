/**
 * ═══════════════════════════════════════════════════════════════════════════
 * VISION AI — Relevé Statement Persistence Service
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Persists a validated relevé reconciliation into invoice_monthly_statements.
 * Called ONLY after the user clicks "Valider le rapprochement".
 *
 * RULES:
 * - Never modifies existing invoices
 * - Uploads PDF to storage bucket "invoices" (same as invoice PDFs)
 * - Writes one row to invoice_monthly_statements per validation
 * - gap_eur = total_releve - total_db (signed: positive = we owe, negative = credit)
 * - missing_refs stored in metadata comment field (no dedicated column needed)
 *
 * ROLLBACK: Delete this file + revert handleReleveValidated in useVisionAIState.ts
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { supabase } from "@/integrations/supabase/client";
import type { ReconciliationResult } from "../types/releveTypes";

// ── Types ──

export interface ReleveStatementSaveParams {
  reconciliation: ReconciliationResult;
  /** The original PDF/image file uploaded by the user */
  file: File;
  establishmentId: string;
  organizationId: string;
  userId: string;
}

export interface ReleveStatementSaveResult {
  ok: boolean;
  statementId?: string;
  error?: string;
}

// ── Helpers ──

/**
 * Build the year_month key (YYYY-MM) from the reconciliation period.
 * Uses the start of the period.
 */
function buildYearMonth(periodStart: string): string {
  return periodStart.substring(0, 7); // "YYYY-MM"
}

/**
 * Build a storage path for the relevé PDF.
 * Format: invoices/{establishmentId}/releve/{YYYY-MM}/{timestamp}_{filename}
 *
 * CRITICAL: The RLS policy on bucket "invoices" checks (string_to_array(name,'/'))[2]::uuid
 * which means segment index 2 (1-based) must be the establishmentId UUID.
 * Prefix with "invoices/" so that: [1]=invoices, [2]=establishmentId ✓
 */
function buildStoragePath(
  establishmentId: string,
  yearMonth: string,
  fileName: string
): string {
  const timestamp = Date.now();
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `invoices/${establishmentId}/releve/${yearMonth}/${timestamp}_${safeName}`;
}

// ── Main ──

/**
 * Upload the relevé PDF and persist reconciliation results to invoice_monthly_statements.
 *
 * invoice_monthly_statements schema (relevant fields):
 *   supplier_id, establishment_id, organization_id, year_month
 *   statement_amount_eur → total amount from the relevé (total_releve)
 *   gap_eur              → balance difference (signed)
 *   status               → "reconciled" | "discrepancy"
 *   file_path, file_name, file_size, file_type
 *   payment_date         → null (not applicable for relevés)
 *   created_by           → user_id
 */
export async function saveReleveStatement(
  params: ReleveStatementSaveParams
): Promise<ReleveStatementSaveResult> {
  const { reconciliation, file, establishmentId, organizationId, userId } = params;

  if (!reconciliation.supplier_id) {
    return { ok: false, error: "Fournisseur non identifié — impossible d'enregistrer le relevé." };
  }

  const yearMonth = buildYearMonth(reconciliation.period.start);
  const storagePath = buildStoragePath(establishmentId, yearMonth, file.name);

  // ── Step 1: Upload PDF to storage ──
  const { error: uploadError } = await supabase.storage
    .from("invoices")
    .upload(storagePath, file, {
      contentType: file.type || "application/pdf",
      upsert: false,
    });

  if (uploadError) {
    if (import.meta.env.DEV) {
      console.error("[releveStatementService] Storage upload failed:", uploadError);
    }
    return { ok: false, error: `Erreur d'upload du fichier: ${uploadError.message}` };
  }

  // ── Step 2: Determine status ──
  // DB CHECK constraint only allows: 'ok' | 'gap' | 'pending'
  const hasDiscrepancy = Math.abs(reconciliation.balance_difference) > 0.01;
  const status = hasDiscrepancy ? "gap" : "ok";

  // ── Step 3: Signed gap (positive = supplier claims more than we recorded) ──
  const gapEur = reconciliation.total_releve - reconciliation.total_db;

  // ── Step 4: Insert into invoice_monthly_statements ──
  const { data: insertedRow, error: insertError } = await supabase
    .from("invoice_monthly_statements")
    .insert({
      supplier_id: reconciliation.supplier_id,
      establishment_id: establishmentId,
      organization_id: organizationId,
      year_month: yearMonth,
      statement_amount_eur: reconciliation.total_releve,
      gap_eur: gapEur,
      status,
      file_path: storagePath,
      file_name: file.name,
      file_size: file.size,
      file_type: file.type || "application/pdf",
      payment_date: null,
      created_by: userId,
    })
    .select("id")
    .single();

  if (insertError) {
    // Best-effort: try to clean up the uploaded file
    await supabase.storage.from("invoices").remove([storagePath]);

    if (import.meta.env.DEV) {
      console.error("[releveStatementService] Insert failed:", insertError);
    }
    return { ok: false, error: `Erreur d'enregistrement: ${insertError.message}` };
  }

  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log("[releveStatementService] Relevé statement saved:", {
      id: insertedRow?.id,
      yearMonth,
      supplierId: reconciliation.supplier_id,
      status,
      gapEur,
    });
  }

  return { ok: true, statementId: insertedRow?.id };
}

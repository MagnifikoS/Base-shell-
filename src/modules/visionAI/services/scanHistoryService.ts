/**
 * Vision AI Scan History — Service Layer
 *
 * CRUD operations for persistent scan documents and extraction runs.
 * All operations go through the Supabase client with RLS.
 *
 * NOTE: vision_ai_scans, vision_ai_scan_runs, bench_runs are custom tables
 * not present in generated types — use (supabase as any) casts throughout.
 */

import { supabase } from "@/integrations/supabase/client";
import type { ScanDocument, ScanRun, ScanDocType } from "../types/scanHistory";
import { SCAN_MODEL_MAP } from "../types/scanHistory";
import type { InvoiceData, ExtractedProductLine, Insight } from "../types";

// Typed alias for non-generated tables
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

// ── Create Scan ──

interface CreateScanParams {
  establishmentId: string;
  file: File;
  storagePath: string;
  doc_type?: ScanDocType;
  bl_number?: string;
  releve_period_start?: string;
  releve_period_end?: string;
}

export async function createScan({
  establishmentId,
  file,
  storagePath,
  doc_type = "facture",
  bl_number,
  releve_period_start,
  releve_period_end,
}: CreateScanParams): Promise<ScanDocument | null> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData?.user?.id;
  if (!userId) return null;

  const insertPayload: Record<string, unknown> = {
    establishment_id: establishmentId,
    owner_id: userId,
    original_filename: file.name,
    file_type: file.type || "application/pdf",
    file_size_bytes: file.size,
    storage_path: storagePath,
    created_by: userId,
    doc_type,
  };

  if (bl_number !== undefined) {
    insertPayload.bl_number = bl_number;
  }
  if (releve_period_start !== undefined) {
    insertPayload.releve_period_start = releve_period_start;
  }
  if (releve_period_end !== undefined) {
    insertPayload.releve_period_end = releve_period_end;
  }

  const { data, error } = await db
    .from("vision_ai_scans")
    .insert(insertPayload)
    .select()
    .single();

  if (error) {
    if (import.meta.env.DEV) console.error("[ScanHistory] createScan error:", error);
    return null;
  }
  return data as ScanDocument;
}

// ── Upload File to Storage ──

export async function uploadScanFile(file: File): Promise<string | null> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData?.user?.id;
  if (!userId) return null;

  const timestamp = Date.now();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `${userId}/scans/${timestamp}_${safeName}`;

  const { error } = await supabase.storage
    .from("vision-ia-documents")
    .upload(storagePath, file, { upsert: false });

  if (error) {
    if (import.meta.env.DEV) console.error("[ScanHistory] upload error:", error);
    return null;
  }
  return storagePath;
}

// ── Record Scan Run ──

interface RecordScanRunParams {
  scanId: string;
  precisionMode: string;
  invoice: InvoiceData;
  items: ExtractedProductLine[];
  insights: Insight[];
  durationMs?: number;
  status?: "success" | "error";
  errorMessage?: string;
  doc_type?: ScanDocType;
  result_bl?: unknown;
  result_bl_items?: unknown;
  result_releve?: unknown;
  result_releve_lines?: unknown;
  result_reconciliation?: unknown;
}

export async function recordScanRun({
  scanId,
  precisionMode,
  invoice,
  items,
  insights,
  durationMs,
  status = "success",
  errorMessage,
  doc_type = "facture",
  result_bl,
  result_bl_items,
  result_releve,
  result_releve_lines,
  result_reconciliation,
}: RecordScanRunParams): Promise<ScanRun | null> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData?.user?.id;

  const modelInfo = SCAN_MODEL_MAP[precisionMode] ?? SCAN_MODEL_MAP.claude;

  const insertPayload: Record<string, unknown> = {
    scan_id: scanId,
    model_id: modelInfo.id,
    model_label: modelInfo.label,
    precision_mode: precisionMode,
    result_invoice: invoice as unknown as Record<string, unknown>,
    result_items: items as unknown as Record<string, unknown>[],
    result_insights: insights as unknown as Record<string, unknown>[],
    items_count: items.length,
    insights_count: insights.length,
    duration_ms: durationMs ?? null,
    status,
    error_message: errorMessage ?? null,
    created_by: userId ?? null,
    doc_type,
  };

  if (result_bl !== undefined) {
    insertPayload.result_bl = result_bl;
  }
  if (result_bl_items !== undefined) {
    insertPayload.result_bl_items = result_bl_items;
  }
  if (result_releve !== undefined) {
    insertPayload.result_releve = result_releve;
  }
  if (result_releve_lines !== undefined) {
    insertPayload.result_releve_lines = result_releve_lines;
  }
  if (result_reconciliation !== undefined) {
    insertPayload.result_reconciliation = result_reconciliation;
  }

  const { data, error } = await db
    .from("vision_ai_scan_runs")
    .insert(insertPayload)
    .select()
    .single();

  if (error) {
    if (import.meta.env.DEV) console.error("[ScanHistory] recordScanRun error:", error);
    return null;
  }

  // Update denormalized fields on parent scan
  if (status === "success" && invoice) {
    await db
      .from("vision_ai_scans")
      .update({
        supplier_name: invoice.supplier_name,
        invoice_number: invoice.invoice_number,
      })
      .eq("id", scanId);
  }

  return data as ScanRun;
}

// ── Fetch Scans ──

export async function fetchScans(
  establishmentId: string,
  docTypeFilter?: ScanDocType
): Promise<ScanDocument[]> {
  let query = db
    .from("vision_ai_scans")
    .select(
      "id, establishment_id, owner_id, original_filename, file_type, file_size_bytes, storage_path, supplier_name, invoice_number, runs_count, last_run_at, created_at, created_by, doc_type, bl_number, releve_period_start, releve_period_end"
    )
    .eq("establishment_id", establishmentId)
    .order("created_at", { ascending: false });

  if (docTypeFilter) {
    query = query.eq("doc_type", docTypeFilter);
  }

  const { data, error } = await query;

  if (error) {
    if (import.meta.env.DEV) console.error("[ScanHistory] fetchScans error:", error);
    return [];
  }
  return (data ?? []) as ScanDocument[];
}

// ── Fetch Scan Runs ──

export async function fetchScanRuns(scanId: string): Promise<ScanRun[]> {
  const { data, error } = await db
    .from("vision_ai_scan_runs")
    .select(
      "id, scan_id, model_id, model_label, precision_mode, result_invoice, result_items, result_insights, items_count, insights_count, duration_ms, status, error_message, created_at, created_by, doc_type, result_bl, result_bl_items, result_releve, result_releve_lines, result_reconciliation"
    )
    .eq("scan_id", scanId)
    .order("created_at", { ascending: false });

  if (error) {
    if (import.meta.env.DEV) console.error("[ScanHistory] fetchScanRuns error:", error);
    return [];
  }
  return (data ?? []) as ScanRun[];
}

// ── Find Existing Scan ──

export async function findExistingScan(scanId: string): Promise<ScanDocument | null> {
  const { data, error } = await db
    .from("vision_ai_scans")
    .select(
      "id, establishment_id, owner_id, original_filename, file_type, file_size_bytes, storage_path, supplier_name, invoice_number, runs_count, last_run_at, created_at, created_by, doc_type, bl_number, releve_period_start, releve_period_end"
    )
    .eq("id", scanId)
    .maybeSingle();

  if (error || !data) return null;
  return data as ScanDocument;
}

// ── Delete Scan ──

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * HARD DELETE OPERATION — vision_ai_scans
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Deletes a scan record and its associated storage file.
 * Must only be called after user confirmation in UI.
 *
 * @see docs/data-deletion-policy.md
 */
export async function deleteScan(scanId: string): Promise<boolean> {
  // Fetch storage_path to clean up storage
  const { data: scan } = await db
    .from("vision_ai_scans")
    .select("storage_path")
    .eq("id", scanId)
    .maybeSingle();

  // SEC-DATA-031: Audit log BEFORE deletion
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any).from("audit_logs").insert({
    action: "hard_delete:vision_ai_scans",
    target_type: "vision_ai_scans",
    target_id: scanId,
    organization_id: "00000000-0000-0000-0000-000000000000", // placeholder — RLS uses auth
    metadata: {
      table: "vision_ai_scans",
      storage_path: (scan as Record<string, unknown> | null)?.storage_path ?? null,
      reason: "User-initiated scan deletion via UI",
    },
  });

  const storagePath = (scan as Record<string, unknown> | null)?.storage_path;
  if (storagePath && typeof storagePath === "string") {
    await supabase.storage.from("vision-ia-documents").remove([storagePath]);
  }

  const { error } = await db.from("vision_ai_scans").delete().eq("id", scanId);

  if (error) {
    if (import.meta.env.DEV) console.error("[ScanHistory] deleteScan error:", error);
    return false;
  }
  return true;
}

// ── Get Signed URL for Scan File ──

export async function getScanFileUrl(storagePath: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from("vision-ia-documents")
    .createSignedUrl(storagePath, 3600); // 1 hour

  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

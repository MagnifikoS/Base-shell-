/**
 * ═══════════════════════════════════════════════════════════════
 * Discrepancy Service — CRUD for inventory_discrepancies
 * ═══════════════════════════════════════════════════════════════
 * READ-ONLY observer pattern: reads stock_events for investigation,
 * writes ONLY to inventory_discrepancies.
 */

import { supabase } from "@/integrations/supabase/client";
import type {
  CreateDiscrepancyParams,
  DiscrepancyStatus,
  DiscrepancyInvestigation,
} from "../types";

/** Create a discrepancy record. Fire-and-forget safe. */
export async function createDiscrepancy(params: CreateDiscrepancyParams) {
  const { error } = await supabase
    .from("inventory_discrepancies" as never)
    .insert({
      establishment_id: params.establishmentId,
      organization_id: params.organizationId,
      product_id: params.productId,
      storage_zone_id: params.storageZoneId,
      withdrawal_quantity: params.withdrawalQuantity,
      estimated_stock_before: params.estimatedStockBefore,
      gap_quantity: params.gapQuantity,
      canonical_unit_id: params.canonicalUnitId,
      withdrawn_by: params.withdrawnBy,
      withdrawal_reason: params.withdrawalReason,
      source_document_id: params.sourceDocumentId,
      source_type: "withdrawal",
      status: "open",
    } as never);

  if (error) {
    console.error("[ecartsInventaire] Failed to create discrepancy:", error.message);
  }
  return { error };
}

/** Update status + resolution note */
export async function updateDiscrepancyStatus(
  id: string,
  status: DiscrepancyStatus,
  resolutionNote?: string | null,
  resolvedBy?: string | null
) {
  const updates: Record<string, unknown> = { status };
  if (resolutionNote !== undefined) updates.resolution_note = resolutionNote;
  if (status === "closed" || status === "analyzed") {
    updates.resolved_by = resolvedBy ?? null;
    updates.resolved_at = new Date().toISOString();
  }

  const { error } = await supabase
    .from("inventory_discrepancies" as never)
    .update(updates as never)
    .eq("id" as never, id as never);

  if (error) {
    console.error("[ecartsInventaire] Failed to update discrepancy:", error.message);
  }
  return { error };
}

/** Fetch investigation data for a discrepancy (read-only from existing tables) */
export async function fetchInvestigation(
  establishmentId: string,
  productId: string,
  beforeDate: string
): Promise<DiscrepancyInvestigation> {
  const result: DiscrepancyInvestigation = {
    lastReceipt: null,
    lastWithdrawal: null,
    lastInventory: null,
    isRecurrent: false,
    totalDiscrepancies: 0,
  };

  const now = new Date();

  // 1. Last RECEIPT event for this product
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: receipts } = await (supabase as any)
    .from("stock_events")
    .select("created_at, delta_quantity_canonical")
    .eq("establishment_id", establishmentId)
    .eq("product_id", productId)
    .eq("event_type", "RECEIPT")
    .lt("created_at", beforeDate)
    .order("created_at", { ascending: false })
    .limit(1);

  if (receipts && receipts.length > 0) {
    const r = receipts[0];
    const d = new Date(r.created_at);
    result.lastReceipt = {
      date: r.created_at,
      quantity: Math.abs(r.delta_quantity_canonical ?? 0),
      daysAgo: Math.floor((now.getTime() - d.getTime()) / 86400000),
    };
  }

  // 2. Last WITHDRAWAL event before this discrepancy
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: withdrawals } = await (supabase as any)
    .from("stock_events")
    .select("created_at, delta_quantity_canonical, created_by")
    .eq("establishment_id", establishmentId)
    .eq("product_id", productId)
    .eq("event_type", "WITHDRAWAL")
    .lt("created_at", beforeDate)
    .order("created_at", { ascending: false })
    .limit(1);

  if (withdrawals && withdrawals.length > 0) {
    const w = withdrawals[0];
    const d = new Date(w.created_at);
    result.lastWithdrawal = {
      date: w.created_at,
      quantity: Math.abs(w.delta_quantity_canonical ?? 0),
      user: w.created_by ?? null,
      daysAgo: Math.floor((now.getTime() - d.getTime()) / 86400000),
    };
  }

  // 3. Last completed inventory for this product
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: invLines } = await (supabase as any)
    .from("inventory_lines")
    .select("counted_at, quantity, session_id")
    .eq("product_id", productId)
    .not("counted_at", "is", null)
    .not("quantity", "is", null)
    .order("counted_at", { ascending: false })
    .limit(1);

  if (invLines && invLines.length > 0) {
    const inv = invLines[0];
    const d = new Date(inv.counted_at);
    result.lastInventory = {
      date: inv.counted_at,
      quantityCounted: inv.quantity,
      daysAgo: Math.floor((now.getTime() - d.getTime()) / 86400000),
    };
  }

  // 4. Recurrence check: how many discrepancies for same product?
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count } = await (supabase as any)
    .from("inventory_discrepancies")
    .select("id", { count: "exact", head: true })
    .eq("establishment_id", establishmentId)
    .eq("product_id", productId);

  result.totalDiscrepancies = count ?? 0;
  result.isRecurrent = (count ?? 0) > 1;

  return result;
}

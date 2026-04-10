/**
 * ═══════════════════════════════════════════════════════════════════════════
 * INVENTAIRE V0 — Session Service
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { supabase } from "@/integrations/supabase/client";
import type { InventorySession, InventoryStatus } from "../types";
import {
  resolveProductUnitContext,
  type ProductUnitInput,
} from "@/core/unitConversion/resolveProductUnitContext";
import { isProductInventoryEligible } from "@/modules/produitsV2";
import type { UnitWithFamily, ConversionRule } from "@/core/unitConversion/types";
import type { ConditioningConfig } from "@/modules/produitsV2";

// ═══════════════════════════════════════════════════════════════════════════
// FETCH sessions for an establishment (latest first)
// ═══════════════════════════════════════════════════════════════════════════

export async function fetchInventorySessions(establishmentId: string): Promise<InventorySession[]> {
  const { data, error } = await supabase
    .from("inventory_sessions")
    .select(
      "id, organization_id, establishment_id, storage_zone_id, status, started_at, paused_at, completed_at, cancelled_at, started_by, total_products, counted_products, created_at, updated_at"
    )
    .eq("establishment_id", establishmentId)
    .order("started_at", { ascending: false });

  if (error) {
    if (import.meta.env.DEV) console.error("[Inventaire] Sessions fetch error:", error);
    throw error;
  }
  return (data ?? []) as InventorySession[];
}

// ═══════════════════════════════════════════════════════════════════════════
// FETCH active session for a specific zone
// ═══════════════════════════════════════════════════════════════════════════

export async function fetchActiveSessionForZone(
  establishmentId: string,
  zoneId: string
): Promise<InventorySession | null> {
  const { data, error } = await supabase
    .from("inventory_sessions")
    .select(
      "id, organization_id, establishment_id, storage_zone_id, status, started_at, paused_at, completed_at, cancelled_at, started_by, total_products, counted_products, created_at, updated_at"
    )
    .eq("establishment_id", establishmentId)
    .eq("storage_zone_id", zoneId)
    .in("status", ["en_cours", "en_pause"] as InventoryStatus[])
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (import.meta.env.DEV) console.error("[Inventaire] Active session fetch error:", error);
    throw error;
  }
  return data as InventorySession | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// CREATE new session + pre-populate lines for all zone products
// ═══════════════════════════════════════════════════════════════════════════

export interface CreateSessionResult {
  session: InventorySession;
  excludedProductsCount: number;
}

export async function createInventorySession(params: {
  organizationId: string;
  establishmentId: string;
  zoneId: string;
  userId: string;
}): Promise<CreateSessionResult> {
  // ── P0-2: Guard — refuse if an active session already exists for this zone ──
  const existingActive = await fetchActiveSessionForZone(params.establishmentId, params.zoneId);
  if (existingActive) {
    throw new Error("SESSION_ACTIVE_EXISTS");
  }

  // 1. Get all products in this zone (with fields needed for FULL eligibility check)
  const { data: products, error: prodError } = await supabase
    .from("products_v2")
    .select(
      "id, stock_handling_unit_id, storage_zone_id, archived_at, final_unit_id, delivery_unit_id, supplier_billing_unit_id, conditionnement_config"
    )
    .eq("establishment_id", params.establishmentId)
    .eq("storage_zone_id", params.zoneId)
    .is("archived_at", null)
    .order("nom_produit", { ascending: true });

  if (prodError) throw prodError;

  // Fetch units + conversions for BFS eligibility resolution
  const { data: rawUnits } = await supabase
    .from("measurement_units")
    .select("id, name, abbreviation, category, family, is_reference, aliases")
    .eq("establishment_id", params.establishmentId);

  const { data: rawConversions } = await supabase
    .from("unit_conversions")
    .select("id, from_unit_id, to_unit_id, factor, establishment_id, is_active")
    .eq("establishment_id", params.establishmentId);

  const dbUnits = (rawUnits ?? []) as unknown as UnitWithFamily[];
  const dbConversions = (rawConversions ?? []) as unknown as ConversionRule[];

  // PHASE 2: Full eligibility check — identical to Desktop (isProductInventoryEligible)
  const eligibleProducts = (products ?? []).filter((p) => {
    const productInput: ProductUnitInput = {
      stock_handling_unit_id: p.stock_handling_unit_id,
      final_unit_id: p.final_unit_id,
      delivery_unit_id: p.delivery_unit_id,
      supplier_billing_unit_id: p.supplier_billing_unit_id,
      conditionnement_config: p.conditionnement_config as unknown as ConditioningConfig | null,
    };
    let unitContext;
    try {
      unitContext = resolveProductUnitContext(productInput, dbUnits, dbConversions);
    } catch {
      unitContext = null;
    }
    return isProductInventoryEligible(
      {
        storage_zone_id: p.storage_zone_id,
        stock_handling_unit_id: p.stock_handling_unit_id,
        archived_at: p.archived_at,
      },
      unitContext
    ).eligible;
  });
  const excludedByEligibility = (products ?? []).length - eligibleProducts.length;
  const productIds = eligibleProducts.map((p) => p.id);

  if (productIds.length === 0) {
    throw new Error(
      excludedByEligibility > 0
        ? `Aucun produit éligible dans cette zone (${excludedByEligibility} produit(s) à configurer)`
        : "Aucun produit dans cette zone"
    );
  }

  // PATCH 1: Count unassigned products for informational return
  const { count: unassignedCount } = await supabase
    .from("products_v2")
    .select("id", { count: "exact", head: true })
    .eq("establishment_id", params.establishmentId)
    .is("storage_zone_id", null)
    .is("archived_at", null);

  // 2. Create session (DB unique partial index prevents 2 active sessions per zone)
  const { data: session, error: sessionError } = await supabase
    .from("inventory_sessions")
    .insert({
      organization_id: params.organizationId,
      establishment_id: params.establishmentId,
      storage_zone_id: params.zoneId,
      started_by: params.userId,
      total_products: productIds.length,
      counted_products: 0,
      status: "en_cours" as InventoryStatus,
    })
    .select()
    .single();

  if (sessionError) {
    // Unique constraint violation → active session already exists (race condition caught by DB)
    if (sessionError.code === "23505") {
      throw new Error("SESSION_ACTIVE_EXISTS");
    }
    throw sessionError;
  }

  // 3. Pre-populate inventory lines (one per product, uncounted)
  //    Batch in chunks of 100 to avoid timeout on large catalogs (500+ products)
  const BATCH_SIZE = 100;
  const allLines = productIds.map((productId, index) => ({
    session_id: session.id,
    product_id: productId,
    display_order: index,
  }));

  for (let i = 0; i < allLines.length; i += BATCH_SIZE) {
    const batch = allLines.slice(i, i + BATCH_SIZE);
    const { error: linesError } = await supabase.from("inventory_lines").insert(batch);

    if (linesError) {
      // Rollback: delete the session (cascade deletes already-inserted lines)
      await supabase.from("inventory_sessions").delete().eq("id", session.id);
      throw linesError;
    }
  }

  return {
    session: session as InventorySession,
    excludedProductsCount: unassignedCount ?? 0,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// UPDATE session status
// ═══════════════════════════════════════════════════════════════════════════

export async function updateSessionStatus(
  sessionId: string,
  status: InventoryStatus
): Promise<void> {
  // ── "termine" uses atomic server-side RPC (fn_complete_inventory_session) ──
  if (status === "termine") {
    const { data, error } = await supabase.rpc("fn_complete_inventory_session", {
      p_session_id: sessionId,
    });

    if (error) throw error;

    const result = data as Record<string, unknown> | null;
    if (!result?.ok) {
      throw new Error((result?.error as string) ?? "COMPLETE_SESSION_FAILED");
    }
    return;
  }

  // Non-terminal status changes remain client-side (pause, resume, cancel)
  const updates: Record<string, unknown> = { status };

  if (status === "en_pause") updates.paused_at = new Date().toISOString();
  if (status === "annule") updates.cancelled_at = new Date().toISOString();

  const { error } = await supabase.from("inventory_sessions").update(updates).eq("id", sessionId);

  if (error) throw error;
}

// ═══════════════════════════════════════════════════════════════════════════
// CANCEL an active session — "Recommencer" (soft-delete via status)
// ═══════════════════════════════════════════════════════════════════════════

export async function cancelAndDeleteSession(sessionId: string): Promise<void> {
  // Soft-cancel: mark status as "annule" + set cancelled_at timestamp.
  // Preserves audit trail instead of hard-deleting.
  // @see docs/data-deletion-policy.md — default to soft-delete
  const { error } = await supabase
    .from("inventory_sessions")
    .update({
      status: "annule",
      cancelled_at: new Date().toISOString(),
    })
    .eq("id", sessionId);

  if (error) throw error;
}

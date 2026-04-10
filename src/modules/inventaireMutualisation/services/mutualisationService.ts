/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MUTUALISATION INVENTAIRE — CRUD Service (isolated, read/write only to
 * inventory_mutualisation_* tables, NEVER touches products_v2)
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { supabase } from "@/integrations/supabase/client";
import type { MutualisationGroup } from "../types";

// ── Fetch all groups for an establishment ────────────────────────────────

export async function fetchGroups(
  establishmentId: string
): Promise<MutualisationGroup[]> {
  const { data: groups, error: gErr } = await supabase
    .from("inventory_mutualisation_groups")
    .select("id, display_name, carrier_product_id, establishment_id, is_active, created_at, b2b_billing_unit_id, b2b_unit_price, b2b_price_strategy")
    .eq("establishment_id", establishmentId)
    .eq("is_active", true)
    .order("display_name");

  if (gErr) throw gErr;
  if (!groups || groups.length === 0) return [];

  const groupIds = groups.map((g) => g.id);

  const { data: members, error: mErr } = await supabase
    .from("inventory_mutualisation_members")
    .select("id, group_id, product_id")
    .in("group_id", groupIds);

  if (mErr) throw mErr;

  return groups.map((g) => ({
    ...g,
    members: (members ?? [])
      .filter((m) => m.group_id === g.id)
      .map((m) => ({ id: m.id, product_id: m.product_id })),
  }));
}

// ── Create a new group with members ──────────────────────────────────────

export async function createGroup(params: {
  establishmentId: string;
  displayName: string;
  carrierProductId: string;
  memberProductIds: string[];
  userId: string;
  b2bBillingUnitId?: string | null;
  b2bUnitPrice?: number | null;
  b2bPriceStrategy?: string | null;
}): Promise<string> {
  const { data, error } = await supabase
    .from("inventory_mutualisation_groups")
    .insert({
      establishment_id: params.establishmentId,
      display_name: params.displayName,
      carrier_product_id: params.carrierProductId,
      created_by: params.userId,
      b2b_billing_unit_id: params.b2bBillingUnitId ?? null,
      b2b_unit_price: params.b2bUnitPrice ?? null,
      b2b_price_strategy: params.b2bPriceStrategy ?? "carrier",
    })
    .select("id")
    .single();

  if (error) throw error;

  const groupId = data.id;

  // Insert members (carrier is also a member)
  const allIds = Array.from(new Set([params.carrierProductId, ...params.memberProductIds]));
  const rows = allIds.map((pid) => ({
    group_id: groupId,
    product_id: pid,
  }));

  const { error: mErr } = await supabase
    .from("inventory_mutualisation_members")
    .insert(rows);

  if (mErr) throw mErr;

  return groupId;
}

// ── Update B2B data on existing group ────────────────────────────────────

export async function updateGroupB2b(
  groupId: string,
  params: {
    b2bBillingUnitId: string | null;
    b2bUnitPrice: number | null;
    b2bPriceStrategy: string;
  }
): Promise<void> {
  const { error } = await supabase
    .from("inventory_mutualisation_groups")
    .update({
      b2b_billing_unit_id: params.b2bBillingUnitId,
      b2b_unit_price: params.b2bUnitPrice,
      b2b_price_strategy: params.b2bPriceStrategy,
      updated_at: new Date().toISOString(),
    })
    .eq("id", groupId);

  if (error) throw error;
}

// ── Delete (soft: set is_active = false) ─────────────────────────────────

export async function deactivateGroup(groupId: string): Promise<void> {
  const { error } = await supabase
    .from("inventory_mutualisation_groups")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", groupId);

  if (error) throw error;
}

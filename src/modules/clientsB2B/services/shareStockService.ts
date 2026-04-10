/**
 * Share Stock Service — Toggle + read supplier stock for B2B partnerships
 * 100% isolated, read-only stock estimation, no writes.
 */

import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface SupplierStockItem {
  client_product_id: string;
  supplier_product_id: string;
  estimated_stock: number | null;
  /** Supplier's stock unit ID — used for unit alignment check */
  supplier_unit_id: string | null;
  /** Supplier's stock unit abbreviation — for display */
  supplier_unit_label: string | null;
}

/** Toggle share_stock on a partnership (supplier-side only) */
export async function toggleShareStock(
  partnershipId: string,
  enabled: boolean
): Promise<void> {
  const { error } = await db
    .from("b2b_partnerships")
    .update({ share_stock: enabled })
    .eq("id", partnershipId);

  if (error) throw error;
}

/** Fetch estimated supplier stock for mapped products (read-only RPC) */
export async function getSupplierStock(
  supplierEstablishmentId: string,
  clientEstablishmentId: string,
  partnershipId: string
): Promise<SupplierStockItem[]> {
  try {
    const { data, error } = await supabase.rpc("fn_get_b2b_supplier_stock", {
      p_supplier_establishment_id: supplierEstablishmentId,
      p_client_establishment_id: clientEstablishmentId,
      p_partnership_id: partnershipId,
    });

    // (6) Non-blocking fallback: any error → empty array
    if (error) {
      if (import.meta.env.DEV) console.warn("[ShareStock] RPC error:", error.message);
      return [];
    }
    if (!data || !Array.isArray(data)) return [];
    return data as unknown as SupplierStockItem[];
  } catch (err) {
    if (import.meta.env.DEV) console.warn("[ShareStock] fetch error:", err);
    return [];
  }
}

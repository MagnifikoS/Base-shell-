/**
 * B2B Catalogue Service — RPC calls for catalogue & import
 */

import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { B2BCatalogResponse } from "./b2bTypes";

/**
 * Fetch the supplier's product catalogue via SECURITY DEFINER RPC.
 */
export async function getB2BCatalogue(
  partnershipId: string,
  clientEstablishmentId: string
): Promise<B2BCatalogResponse> {
  const { data, error } = await supabase.rpc("fn_get_b2b_catalogue", {
    p_partnership_id: partnershipId,
    p_client_establishment_id: clientEstablishmentId,
  });

  if (error) throw error;
  return data as unknown as B2BCatalogResponse;
}

/**
 * Fetch already-imported products for the current establishment.
 */
export async function getImportedProducts(
  establishmentId: string
): Promise<{ source_product_id: string; source_establishment_id: string; local_product_id: string }[]> {
  // Join with products_v2 to exclude archived/deleted products
  const { data, error } = await supabase
    .from("b2b_imported_products")
    .select("source_product_id, source_establishment_id, local_product_id, local_product:products_v2!b2b_imported_products_local_product_id_fkey(id, archived_at)")
    .eq("establishment_id", establishmentId);

  if (error) throw error;

  // Only keep imports where the local product still exists and is not archived
  return ((data ?? []) as unknown as {
    source_product_id: string;
    source_establishment_id: string;
    local_product_id: string;
    local_product: { id: string; archived_at: string | null } | null;
  }[])
    .filter((i) => i.local_product && !i.local_product.archived_at)
    .map((i) => ({
      source_product_id: i.source_product_id,
      source_establishment_id: i.source_establishment_id,
      local_product_id: i.local_product_id,
    }));
}

/**
 * Import a single product atomically via RPC.
 */
export async function importProductAtomic(params: {
  establishment_id: string;
  user_id: string;
  nom_produit: string;
  name_normalized: string;
  code_produit: string | null;
  category: string | null;
  category_id: string | null;
  supplier_id: string;
  final_unit_id: string;
  supplier_billing_unit_id: string | null;
  delivery_unit_id: string | null;
  stock_handling_unit_id: string | null;
  kitchen_unit_id: string | null;
  price_display_unit_id: string | null;
  min_stock_unit_id: string;
  final_unit_price: number;
  conditionnement_config: Record<string, unknown> | null;
  conditionnement_resume: string | null;
  min_stock_quantity_canonical: number;
  storage_zone_id: string;
  source_product_id: string;
  source_establishment_id: string;
  supplier_billing_quantity: number | null;
  supplier_billing_line_total: number | null;
  unit_mapping: Record<string, string>;
  allow_unit_sale?: boolean;
}): Promise<string> {
  const { data, error } = await supabase.rpc("fn_import_b2b_product_atomic" as never, {
    p_establishment_id: params.establishment_id,
    p_user_id: params.user_id,
    p_nom_produit: params.nom_produit,
    p_name_normalized: params.name_normalized,
    p_code_produit: params.code_produit ?? null,
    p_category: params.category ?? null,
    p_category_id: params.category_id ?? null,
    p_supplier_id: params.supplier_id,
    p_final_unit_id: params.final_unit_id,
    p_supplier_billing_unit_id: params.supplier_billing_unit_id ?? null,
    p_delivery_unit_id: params.delivery_unit_id ?? null,
    p_stock_handling_unit_id: params.stock_handling_unit_id ?? null,
    p_kitchen_unit_id: params.kitchen_unit_id ?? null,
    p_price_display_unit_id: params.price_display_unit_id ?? null,
    p_min_stock_unit_id: params.min_stock_unit_id,
    p_final_unit_price: params.final_unit_price,
    p_conditionnement_config: (params.conditionnement_config ?? null) as unknown as Json,
    p_conditionnement_resume: params.conditionnement_resume ?? null,
    p_min_stock_quantity_canonical: params.min_stock_quantity_canonical,
    p_storage_zone_id: params.storage_zone_id,
    p_source_product_id: params.source_product_id,
    p_source_establishment_id: params.source_establishment_id,
    p_supplier_billing_quantity: params.supplier_billing_quantity ?? null,
    p_supplier_billing_line_total: params.supplier_billing_line_total ?? null,
    p_unit_mapping: params.unit_mapping as unknown as Json,
    p_allow_unit_sale: params.allow_unit_sale ?? false,
  } as never);

  if (error) throw error;
  return data as string;
}

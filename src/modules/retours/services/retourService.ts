/**
 * retourService — DB access for product returns (isolated)
 */

import { supabase } from "@/integrations/supabase/client";
import type { ProductReturn, ReturnType, ReturnResolution } from "../types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export async function getReturnsForEstablishment(
  establishmentId: string
): Promise<ProductReturn[]> {
  const { data, error } = await db
    .from("product_returns")
    .select("*")
    .or(
      `client_establishment_id.eq.${establishmentId},supplier_establishment_id.eq.${establishmentId}`
    )
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ProductReturn[];
}

export async function getReturnsForCommande(
  commandeId: string
): Promise<ProductReturn[]> {
  const { data, error } = await db
    .from("product_returns")
    .select("*")
    .eq("commande_id", commandeId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ProductReturn[];
}

export async function createReturn(params: {
  commandeId: string;
  commandeLineId: string | null;
  productId: string;
  productNameSnapshot: string;
  quantity: number;
  canonicalUnitId: string | null;
  unitLabelSnapshot: string | null;
  returnType: ReturnType;
  reasonComment: string | null;
  clientEstablishmentId: string;
  supplierEstablishmentId: string;
  createdBy: string;
}): Promise<ProductReturn> {
  // Anti-duplicate guard: check if same line + type already exists (non-refused)
  if (params.commandeLineId) {
    const { data: existing } = await db
      .from("product_returns")
      .select("id")
      .eq("commande_line_id", params.commandeLineId)
      .eq("return_type", params.returnType)
      .neq("status", "refused")
      .limit(1);
    if (existing && existing.length > 0) {
      throw new Error("Un retour identique existe déjà pour cette ligne.");
    }
  }

  const { data, error } = await db.from("product_returns").insert({
    commande_id: params.commandeId,
    commande_line_id: params.commandeLineId,
    product_id: params.productId,
    product_name_snapshot: params.productNameSnapshot,
    quantity: params.quantity,
    canonical_unit_id: params.canonicalUnitId,
    unit_label_snapshot: params.unitLabelSnapshot,
    return_type: params.returnType,
    reason_comment: params.reasonComment,
    client_establishment_id: params.clientEstablishmentId,
    supplier_establishment_id: params.supplierEstablishmentId,
    created_by: params.createdBy,
  }).select().single();
  if (error) throw error;
  return data as ProductReturn;
}

export async function resolveReturn(
  returnId: string,
  status: "accepted" | "refused",
  resolution: ReturnResolution | null,
  supplierComment: string | null,
  resolvedBy: string
): Promise<ProductReturn> {
  const { data, error } = await db
    .from("product_returns")
    .update({
      status,
      resolution: status === "accepted" ? resolution : null,
      supplier_comment: supplierComment,
      resolved_by: resolvedBy,
      resolved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", returnId)
    .select()
    .single();
  if (error) throw error;
  return data as ProductReturn;
}

export async function uploadReturnPhoto(
  returnId: string,
  file: File
): Promise<string> {
  const ext = file.name.split(".").pop() ?? "jpg";
  const path = `${returnId}/${crypto.randomUUID()}.${ext}`;
  const { error: uploadErr } = await supabase.storage
    .from("return-photos")
    .upload(path, file);
  if (uploadErr) throw uploadErr;

  const { error: insertErr } = await db
    .from("product_return_photos")
    .insert({
      return_id: returnId,
      storage_path: path,
      original_name: file.name,
    });
  if (insertErr) throw insertErr;

  return path;
}

export async function getReturnPhotos(
  returnId: string
): Promise<{ storage_path: string; original_name: string | null }[]> {
  const { data, error } = await db
    .from("product_return_photos")
    .select("storage_path, original_name")
    .eq("return_id", returnId);
  if (error) throw error;
  return data ?? [];
}

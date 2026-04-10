/**
 * DLC V0 — Supabase service for reception_lot_dlc table.
 * Isolated: no dependency on stock/litiges/commandes RPCs.
 */

import { supabase } from "@/integrations/supabase/client";
import type { DlcUpsertInput, ReceptionLotDlc } from "../types";

/**
 * Upsert a DLC record for a commande line (insert or update on conflict).
 * Called after successful reception RPC — failure here does NOT revert reception.
 */
export async function upsertDlc(input: DlcUpsertInput): Promise<ReceptionLotDlc> {
  const { data: user } = await supabase.auth.getUser();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("reception_lot_dlc")
    .upsert(
      {
        commande_line_id: input.commande_line_id,
        establishment_id: input.establishment_id,
        product_id: input.product_id,
        dlc_date: input.dlc_date,
        quantity_received: input.quantity_received,
        canonical_unit_id: input.canonical_unit_id,
        created_by: user?.user?.id ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "commande_line_id" }
    )
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as ReceptionLotDlc;
}

/**
 * Batch upsert multiple DLC records (one per line).
 * Returns count of successfully written records.
 */
export async function batchUpsertDlc(inputs: DlcUpsertInput[]): Promise<number> {
  if (inputs.length === 0) return 0;

  const { data: user } = await supabase.auth.getUser();
  const userId = user?.user?.id ?? null;

  const rows = inputs.map((input) => ({
    commande_line_id: input.commande_line_id,
    establishment_id: input.establishment_id,
    product_id: input.product_id,
    dlc_date: input.dlc_date,
    quantity_received: input.quantity_received,
    canonical_unit_id: input.canonical_unit_id,
    created_by: userId,
    updated_at: new Date().toISOString(),
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("reception_lot_dlc")
    .upsert(rows, { onConflict: "commande_line_id" })
    .select("id");

  if (error) throw new Error(error.message);
  return (data as unknown[]).length;
}

/**
 * Fetch all DLC records for lines of a given commande.
 */
export async function getDlcForCommande(commandeLineIds: string[]): Promise<ReceptionLotDlc[]> {
  if (commandeLineIds.length === 0) return [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("reception_lot_dlc")
    .select("*")
    .in("commande_line_id", commandeLineIds);

  if (error) throw new Error(error.message);
  return (data ?? []) as ReceptionLotDlc[];
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Commande Service — All Supabase calls for the Commandes module
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { supabase } from "@/integrations/supabase/client";
import type { Commande, CommandeLine, CartItem } from "../types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

// ── List commandes for an establishment (client OR supplier side) ──

export async function getCommandes(establishmentId: string): Promise<Commande[]> {
  const { data, error } = await db
    .from("commandes")
    .select("*")
    .or(
      `client_establishment_id.eq.${establishmentId},supplier_establishment_id.eq.${establishmentId}`
    )
    .order("created_at", { ascending: false });

  if (error) throw error;
  const commandes = (data ?? []) as Commande[];

  // Resolve user display names (secure: scoped to these commandes only)
  const commandeIds = commandes.map((c) => c.id);

  if (commandeIds.length > 0) {
    const { data: resolved, error: resolveError } = await db.rpc("resolve_commande_actors", {
      p_ids: commandeIds,
    });

    if (resolveError) {
      if (import.meta.env.DEV) console.warn("[D-02] resolve_commande_actors error:", resolveError);
    } else if (resolved) {
      const nameMap = new Map<string, string>();
      for (const r of resolved as { user_id: string; display_name: string }[]) {
        if (r.display_name) nameMap.set(r.user_id, r.display_name);
      }
      for (const c of commandes) {
        c.created_by_name = nameMap.get(c.created_by) ?? null;
        c.opened_by_name = c.opened_by ? (nameMap.get(c.opened_by) ?? null) : null;
        c.shipped_by_name = c.shipped_by ? (nameMap.get(c.shipped_by) ?? null) : null;
        c.received_by_name = c.received_by ? (nameMap.get(c.received_by) ?? null) : null;
      }
    }
  }

  return commandes;
}

// ── Get commande detail with lines ──

export async function getCommandeWithLines(commandeId: string): Promise<{
  commande: Commande;
  lines: CommandeLine[];
}> {
  const [cmdResult, linesResult] = await Promise.all([
    db.from("commandes").select("*").eq("id", commandeId).single(),
    db
      .from("commande_lines")
      .select("*")
      .eq("commande_id", commandeId)
      .order("created_at", { ascending: true }),
  ]);

  if (cmdResult.error) throw cmdResult.error;
  if (linesResult.error) throw linesResult.error;

  const commande = cmdResult.data as Commande;

  // Resolve user names (secure: scoped to this commande)
  const { data: resolved, error: resolveError } = await db.rpc("resolve_commande_actors", {
    p_ids: [commandeId],
  });
  if (resolveError) {
    if (import.meta.env.DEV) console.warn("[D-02] resolve_commande_actors error:", resolveError);
  } else if (resolved) {
    const nameMap = new Map<string, string>();
    for (const r of resolved as { user_id: string; display_name: string }[]) {
      if (r.display_name) nameMap.set(r.user_id, r.display_name);
    }
    commande.created_by_name = nameMap.get(commande.created_by) ?? null;
    commande.opened_by_name = commande.opened_by ? (nameMap.get(commande.opened_by) ?? null) : null;
    commande.shipped_by_name = commande.shipped_by ? (nameMap.get(commande.shipped_by) ?? null) : null;
    commande.received_by_name = commande.received_by ? (nameMap.get(commande.received_by) ?? null) : null;
  }

  return {
    commande,
    lines: (linesResult.data ?? []) as CommandeLine[],
  };
}

// ── Find active draft for an establishment (max 1) ──

export async function getActiveDraft(establishmentId: string): Promise<Commande | null> {
  const { data, error } = await db
    .from("commandes")
    .select("*")
    .eq("client_establishment_id", establishmentId)
    .eq("status", "brouillon")
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) throw error;
  return (data && data.length > 0) ? (data[0] as Commande) : null;
}

// ── Create a draft commande ──

export async function createDraftCommande(params: {
  clientEstablishmentId: string;
  supplierEstablishmentId: string;
  partnershipId: string;
  createdBy: string;
  note?: string;
  sourceCommandeId?: string;
}): Promise<Commande> {
  const insertPayload: Record<string, unknown> = {
    client_establishment_id: params.clientEstablishmentId,
    supplier_establishment_id: params.supplierEstablishmentId,
    partnership_id: params.partnershipId,
    created_by: params.createdBy,
    note: params.note ?? null,
    status: "brouillon",
  };
  if (params.sourceCommandeId) {
    insertPayload.source_commande_id = params.sourceCommandeId;
  }

  const { data, error } = await db
    .from("commandes")
    .insert(insertPayload)
    .select()
    .single();

  if (error) throw error;
  return data as Commande;
}

// ── Add/update lines to a draft commande (upsert on product_id) ──

export async function upsertCommandeLines(
  commandeId: string,
  items: CartItem[]
): Promise<void> {
  if (items.length === 0) return;

  const rows = items.map((item) => {
    const inputEntries = item.inputEntries && item.inputEntries.length > 0
      ? item.inputEntries.map((e) => ({ unit_id: e.unit_id, quantity: e.quantity, unit_label: e.unit_label }))
      : null;

    return {
      commande_id: commandeId,
      product_id: item.productId,
      canonical_quantity: item.canonicalQuantity,
      canonical_unit_id: item.canonicalUnitId,
      product_name_snapshot: item.productName,
      unit_label_snapshot: item.canonicalUnitLabel,
      input_entries: inputEntries,
    };
  });

  const { error } = await db
    .from("commande_lines")
    .upsert(rows, { onConflict: "commande_id,product_id" });

  if (error) throw error;
}

// ── Remove a line from a commande ──

export async function removeCommandeLine(lineId: string): Promise<void> {
  const { error } = await db
    .from("commande_lines")
    .delete()
    .eq("id", lineId);

  if (error) throw error;
}

// ── Update commande note (direct update — only brouillon status) ──

export async function updateCommandeNote(
  commandeId: string,
  note: string
): Promise<void> {
  const { data, error } = await db
    .from("commandes")
    .update({ note })
    .eq("id", commandeId)
    .eq("status", "brouillon")
    .select("id");

  if (error) throw error;

  // If 0 rows updated, the commande is no longer brouillon (locked by FO)
  if (!data || (data as unknown[]).length === 0) {
    throw new Error("commande_locked");
  }
}

// ── Send commande (edge function) ──

export async function sendCommande(
  commandeId: string,
  establishmentId: string
): Promise<{ ok: boolean; error?: string }> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const url = `${supabaseUrl}/functions/v1/commandes-api?action=send`;

  const { data: { session }, error: sessionError } = await supabase.auth.refreshSession();
  if (sessionError || !session?.access_token) {
    throw new Error("Session expirée. Reconnectez-vous.");
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    },
    body: JSON.stringify({
      commande_id: commandeId,
      establishment_id: establishmentId,
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "send_failed");
  return data;
}

// ── Open commande (edge function, supplier side) ──

export async function openCommande(
  commandeId: string
): Promise<{ ok: boolean; error?: string; already_opened?: boolean }> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const url = `${supabaseUrl}/functions/v1/commandes-api?action=open`;

  const { data: { session }, error: sessionError } = await supabase.auth.refreshSession();
  if (sessionError || !session?.access_token) {
    throw new Error("Session expirée. Reconnectez-vous.");
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    },
    body: JSON.stringify({ commande_id: commandeId }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "open_failed");
  return data;
}

// ── Ship commande (edge function, supplier side) ──

export async function shipCommande(
  commandeId: string,
  lines: Array<{ line_id: string; shipped_quantity: number }>
): Promise<{ ok: boolean; error?: string }> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const url = `${supabaseUrl}/functions/v1/commandes-api?action=ship`;

  // Use refreshSession() to avoid cached expired tokens (same pattern as usePostDocument)
  const { data: { session }, error: sessionError } = await supabase.auth.refreshSession();
  if (sessionError || !session?.access_token) {
    throw new Error("Session expirée. Reconnectez-vous.");
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    },
    body: JSON.stringify({ commande_id: commandeId, lines }),
  });

  let data: Record<string, unknown>;
  try {
    data = await res.json();
  } catch {
    throw new Error("Réponse invalide du serveur");
  }

  if (!res.ok) {
    if (import.meta.env.DEV) {
      console.error("[shipCommande] error:", res.status, data);
    }
    throw new Error((data.error as string) || "ship_failed");
  }
  return data as { ok: boolean; error?: string };
}

// ── Receive commande (edge function, client side) ──

export async function receiveCommande(
  commandeId: string,
  establishmentId: string,
  lines: Array<{ line_id: string; received_quantity: number }>
): Promise<{ ok: boolean; error?: string; reception_type?: string }> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const url = `${supabaseUrl}/functions/v1/commandes-api?action=receive`;

  const { data: { session }, error: sessionError } = await supabase.auth.refreshSession();
  if (sessionError || !session?.access_token) {
    throw new Error("Session expirée. Reconnectez-vous.");
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    },
    body: JSON.stringify({ commande_id: commandeId, establishment_id: establishmentId, lines }),
  });

  let data: Record<string, unknown>;
  try {
    data = await res.json();
  } catch {
    throw new Error("Réponse invalide du serveur");
  }

  if (!res.ok) {
    if (import.meta.env.DEV) {
      console.error("[receiveCommande] error:", res.status, data);
    }
    throw new Error((data.error as string) || "receive_failed");
  }
  return data as { ok: boolean; error?: string; reception_type?: string };
}

// ── Update line preparation ──
// V3: No longer writes to DB. The backend writes shipped_quantity + line_status
// atomically during fn_ship_commande. This function is kept for API compat
// but returns a no-op result — the real persist happens at ship time.

export interface LinePreparationResult {
  clamped: boolean;
  actualQuantity: number;
}

export async function updateLinePreparation(
  _lineId: string,
  shippedQuantity: number,
  _lineStatus: string
): Promise<LinePreparationResult> {
  // V3: no-op — line state is local-only until ship
  return { clamped: false, actualQuantity: shippedQuantity };
}

// ── Delete a draft commande ──

export async function deleteDraftCommande(commandeId: string): Promise<void> {
  const { error } = await db
    .from("commandes")
    .delete()
    .eq("id", commandeId);

  if (error) throw error;
}

// ── Get partner establishments for dropdown ──

export async function getPartnerSuppliers(
  establishmentId: string
): Promise<Array<{ partnership_id: string; supplier_establishment_id: string; supplier_name: string; supplier_logo_url: string | null; share_stock: boolean }>> {
  const { data: partnerships, error } = await supabase
    .from("b2b_partnerships")
    .select("id, supplier_establishment_id, share_stock")
    .eq("client_establishment_id", establishmentId)
    .eq("status", "active");

  if (error) throw error;
  if (!partnerships || partnerships.length === 0) return [];

  // Resolve supplier names/logos via SECURITY DEFINER RPC (bypasses cross-org RLS)
  const profileResults = await Promise.all(
    partnerships.map(async (p) => {
      const { data } = await supabase.rpc("fn_get_b2b_partner_profile", {
        p_partner_establishment_id: p.supplier_establishment_id,
      });
      const profile = data as { ok: boolean; name?: string; trade_name?: string | null; logo_url?: string | null } | null;
      return {
        id: p.supplier_establishment_id,
        name: profile?.ok ? (profile.trade_name || profile.name || "Fournisseur") : "Fournisseur",
        logo_url: profile?.ok ? (profile.logo_url ?? null) : null,
      };
    })
  );

  const profileMap = new Map(profileResults.map((r) => [r.id, r]));

  return partnerships.map((p) => ({
    partnership_id: p.id,
    supplier_establishment_id: p.supplier_establishment_id,
    supplier_name: profileMap.get(p.supplier_establishment_id)?.name || "Fournisseur",
    supplier_logo_url: profileMap.get(p.supplier_establishment_id)?.logo_url ?? null,
    share_stock: p.share_stock ?? false,
  }));
}

// ── Get products linked to a supplier (via b2b_imported_products) ──

export async function getProductsForSupplier(
  establishmentId: string,
  supplierEstablishmentId: string
): Promise<
  Array<{
    id: string;
    nom_produit: string;
    stock_handling_unit_id: string | null;
    final_unit_id: string | null;
    delivery_unit_id: string | null;
    supplier_billing_unit_id: string | null;
    conditionnement_config: unknown;
    category: string | null;
  }>
> {
  const { data: imports, error: impErr } = await supabase
    .from("b2b_imported_products")
    .select("local_product_id")
    .eq("establishment_id", establishmentId)
    .eq("source_establishment_id", supplierEstablishmentId);

  if (impErr) throw impErr;
  if (!imports || imports.length === 0) return [];

  const productIds = imports.map((i) => i.local_product_id);

  const { data: products, error: prodErr } = await db
    .from("products_v2")
    .select(
      "id, nom_produit, stock_handling_unit_id, final_unit_id, delivery_unit_id, supplier_billing_unit_id, conditionnement_config, category"
    )
    .in("id", productIds)
    .is("archived_at", null)
    .order("nom_produit", { ascending: true });

  if (prodErr) throw prodErr;
  return (products ?? []) as Array<{
    id: string;
    nom_produit: string;
    stock_handling_unit_id: string | null;
    final_unit_id: string | null;
    delivery_unit_id: string | null;
    supplier_billing_unit_id: string | null;
    conditionnement_config: unknown;
    category: string | null;
  }>;
}

// ── Cancel shipment (supplier side) ──

export async function cancelShipment(commandeId: string) {
  const PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");

  const res = await fetch(
    `https://${PROJECT_ID}.supabase.co/functions/v1/commandes-api?action=cancel_shipment`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
      body: JSON.stringify({ commande_id: commandeId }),
    }
  );

  const json = await res.json();
  if (!res.ok || !json.ok) throw new Error(json.error || "cancel_shipment_failed");
  return json;
}

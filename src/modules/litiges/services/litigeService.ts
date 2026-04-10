/**
 * Litige Service — All Supabase calls for the Litiges module
 */

import { supabase } from "@/integrations/supabase/client";
import type { Litige, LitigeLine } from "../types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/** Get litiges for an establishment (via commandes join) */
export async function getLitiges(establishmentId: string): Promise<Litige[]> {
  const { data, error } = await db
    .from("litiges")
    .select("*, commandes!inner(client_establishment_id, supplier_establishment_id)")
    .or(
      `commandes.client_establishment_id.eq.${establishmentId},commandes.supplier_establishment_id.eq.${establishmentId}`
    )
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as Litige[];
}

/** Get litige detail with lines */
export async function getLitigeWithLines(litigeId: string): Promise<{
  litige: Litige;
  lines: LitigeLine[];
}> {
  const [litigeResult, linesResult] = await Promise.all([
    db.from("litiges").select("*").eq("id", litigeId).single(),
    db
      .from("litige_lines")
      .select("*")
      .eq("litige_id", litigeId)
      .order("created_at", { ascending: true }),
  ]);

  if (litigeResult.error) throw litigeResult.error;
  if (linesResult.error) throw linesResult.error;

  return {
    litige: litigeResult.data as Litige,
    lines: (linesResult.data ?? []) as LitigeLine[],
  };
}

/** Get litige for a specific commande */
export async function getLitigeForCommande(commandeId: string): Promise<Litige | null> {
  const { data, error } = await db
    .from("litiges")
    .select("*")
    .eq("commande_id", commandeId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) throw error;
  return data && data.length > 0 ? (data[0] as Litige) : null;
}

/** Resolve litige via edge function */
export async function resolveLitige(
  litigeId: string
): Promise<{ ok: boolean; error?: string }> {
  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  const url = `https://${projectId}.supabase.co/functions/v1/commandes-api?action=resolve_litige`;

  const session = await supabase.auth.getSession();
  const token = session.data.session?.access_token;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    },
    body: JSON.stringify({ litige_id: litigeId }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "resolve_failed");
  return data;
}

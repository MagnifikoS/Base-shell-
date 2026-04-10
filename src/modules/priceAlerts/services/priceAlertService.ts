/**
 * Module Alertes Prix V0 — Service (unique point d'accès DB)
 */
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { PriceAlert, PriceAlertSettings } from "../types";

export async function fetchPriceAlerts(establishmentId: string): Promise<PriceAlert[]> {
  const { data, error } = await supabase
    .from("price_alerts")
    .select("*")
    .eq("establishment_id", establishmentId)
    .order("day_date", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(200);

  if (error) throw error;
  return (data ?? []) as PriceAlert[];
}

export async function markAlertSeen(alertId: string): Promise<void> {
  const { error } = await supabase
    .from("price_alerts")
    .update({ seen_at: new Date().toISOString() })
    .eq("id", alertId);

  if (error) throw error;
}

export async function markAllAlertsSeen(establishmentId: string): Promise<void> {
  const { error } = await supabase
    .from("price_alerts")
    .update({ seen_at: new Date().toISOString() })
    .eq("establishment_id", establishmentId)
    .is("seen_at", null);

  if (error) throw error;
}

/** Mark a single alert as acknowledged (shown in commande popup). Idempotent. */
export async function markAlertAcked(alertId: string): Promise<void> {
  const { error } = await supabase
    .from("price_alerts")
    .update({ acked_at: new Date().toISOString() } as Record<string, unknown>)
    .eq("id", alertId)
    .is("acked_at", null);

  if (error) throw error;
}

/** Fetch unacked alerts for a specific product in an establishment. */
export async function fetchUnackedAlertForProduct(
  establishmentId: string,
  productId: string
): Promise<PriceAlert | null> {
  const { data, error } = await supabase
    .from("price_alerts")
    .select("*")
    .eq("establishment_id", establishmentId)
    .eq("product_id", productId)
    .is("acked_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data as PriceAlert | null;
}

export async function fetchAlertSettings(establishmentId: string): Promise<PriceAlertSettings | null> {
  const { data, error } = await supabase
    .from("price_alert_settings")
    .select("*")
    .eq("establishment_id", establishmentId)
    .maybeSingle();

  if (error) throw error;
  return data as PriceAlertSettings | null;
}

export async function upsertAlertSettings(settings: {
  establishment_id: string;
  enabled: boolean;
  global_threshold_pct: number;
  category_thresholds: Record<string, number>;
}): Promise<void> {
  const { error } = await supabase
    .from("price_alert_settings")
    .upsert(
      {
        establishment_id: settings.establishment_id,
        enabled: settings.enabled,
        global_threshold_pct: settings.global_threshold_pct,
        category_thresholds: settings.category_thresholds as unknown as Json,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "establishment_id" }
    );

  if (error) throw error;
}

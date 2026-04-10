/**
 * Module Alertes Prix V0 — Types
 */

export interface PriceAlert {
  id: string;
  establishment_id: string;
  product_id: string;
  source_product_id: string;
  supplier_name: string;
  product_name: string;
  category: string | null;
  old_price: number;
  new_price: number;
  variation_pct: number;
  day_date: string;
  seen_at: string | null;
  acked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PriceAlertSettings {
  establishment_id: string;
  enabled: boolean;
  global_threshold_pct: number;
  category_thresholds: Record<string, number>;
  created_at: string;
  updated_at: string;
}

export type PriceAlertFilter = "all" | "up" | "down" | "threshold";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MODULE INVENTAIRE V0 — Types
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * SSOT:
 * - Zones → storage_zones (lecture seule)
 * - Produits → products_v2 filtré par storage_zone_id (lecture seule)
 * - Unités → measurement_units (lecture seule)
 * - Sessions/Lignes → inventory_sessions + inventory_lines (écriture)
 * - Config zone/produit → inventory_zone_products (écriture)
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { ConditioningConfig } from "@/modules/produitsV2";

// ═══════════════════════════════════════════════════════════════════════════
// INVENTORY STATUS (enum DB)
// ═══════════════════════════════════════════════════════════════════════════

export type InventoryStatus = "en_cours" | "en_pause" | "termine" | "annule";

// ═══════════════════════════════════════════════════════════════════════════
// INVENTORY SESSION
// ═══════════════════════════════════════════════════════════════════════════

export interface InventorySession {
  id: string;
  organization_id: string;
  establishment_id: string;
  storage_zone_id: string;
  status: InventoryStatus;
  started_at: string;
  paused_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  started_by: string;
  total_products: number;
  counted_products: number;
  created_at: string;
  updated_at: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// INVENTORY LINE (one product counted)
// ═══════════════════════════════════════════════════════════════════════════

export interface InventoryLine {
  id: string;
  session_id: string;
  product_id: string;
  quantity: number | null;
  unit_id: string | null;
  counted_at: string | null;
  counted_by: string | null;
  display_order: number;
  created_at: string;
  updated_at: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// INVENTORY LINE WITH PRODUCT INFO (for display)
// ═══════════════════════════════════════════════════════════════════════════

export interface InventoryLineWithProduct extends InventoryLine {
  product_name: string;
  product_category: string | null;
  product_code: string | null;
  unit_name: string | null;
  unit_abbreviation: string | null;
  /** Product's stock handling unit (for mobile default) */
  product_stock_handling_unit_id: string | null;
  /** Product's internal reference unit (fallback for mobile default) */
  product_final_unit_id: string | null;
  /** Product's delivery unit */
  product_delivery_unit_id: string | null;
  /** Product's billing unit */
  product_supplier_billing_unit_id: string | null;
  /** Product's conditioning config (for graph building) */
  product_conditionnement_config: ConditioningConfig | null;
  /** True if the product was archived after session creation */
  product_archived?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// INVENTORY ZONE PRODUCT (pivot: order + preferred unit)
// ═══════════════════════════════════════════════════════════════════════════

export interface InventoryZoneProduct {
  id: string;
  establishment_id: string;
  storage_zone_id: string;
  product_id: string;
  preferred_unit_id: string | null;
  display_order: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// ZONE STATUS (computed, not stored)
// ═══════════════════════════════════════════════════════════════════════════

export type ZoneInventoryStatus = "not_started" | "in_progress" | "completed";

export interface ZoneWithInventoryStatus {
  id: string;
  name: string;
  display_order: number;
  inventoryStatus: ZoneInventoryStatus;
  /** Active session ID if in_progress */
  activeSessionId: string | null;
  totalProducts: number;
  countedProducts: number;
}

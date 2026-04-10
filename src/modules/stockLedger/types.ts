/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MODULE STOCK LEDGER V1 — Types
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * SSOT:
 * - stock_events (append-only ledger)
 * - stock_documents (lifecycle: DRAFT → POSTED → VOID)
 * - stock_document_lines (editable in DRAFT only)
 * - zone_stock_snapshots (active snapshot per zone)
 *
 * RULES:
 * - All quantities in canonical units
 * - context_hash captured at POST, never recalculated
 * - snapshot_version_id explicit, never "last completed"
 * ═══════════════════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════════════════════
// ENUMS (mirror DB)
// ═══════════════════════════════════════════════════════════════════════════

export type StockDocumentType = "RECEIPT" | "WITHDRAWAL" | "ADJUSTMENT" | "RECEIPT_CORRECTION";
export type StockDocumentStatus = "DRAFT" | "POSTED" | "VOID";
export type StockEventType = "RECEIPT" | "WITHDRAWAL" | "ADJUSTMENT" | "VOID";

// ═══════════════════════════════════════════════════════════════════════════
// ZONE STOCK SNAPSHOT
// ═══════════════════════════════════════════════════════════════════════════

export interface ZoneStockSnapshot {
  id: string;
  establishment_id: string;
  organization_id: string;
  storage_zone_id: string;
  snapshot_version_id: string;
  activated_at: string;
  activated_by: string | null;
  created_at: string;
  updated_at: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// STOCK DOCUMENT
// ═══════════════════════════════════════════════════════════════════════════

export interface StockDocument {
  id: string;
  establishment_id: string;
  organization_id: string;
  storage_zone_id: string;
  supplier_id: string | null;
  type: StockDocumentType;
  status: StockDocumentStatus;
  idempotency_key: string | null;
  lock_version: number;
  created_by: string | null;
  created_at: string;
  posted_at: string | null;
  posted_by: string | null;
  voided_at: string | null;
  voided_by: string | null;
  updated_at: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// STOCK DOCUMENT LINE
// ═══════════════════════════════════════════════════════════════════════════

export interface StockDocumentLine {
  id: string;
  document_id: string;
  product_id: string;
  input_payload: Record<string, unknown> | null;
  delta_quantity_canonical: number;
  canonical_unit_id: string;
  canonical_family: string;
  canonical_label: string | null;
  context_hash: string;
  created_at: string;
  updated_at: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// STOCK EVENT (APPEND-ONLY LEDGER)
// ═══════════════════════════════════════════════════════════════════════════

export interface StockEvent {
  id: string;
  establishment_id: string;
  organization_id: string;
  storage_zone_id: string;
  product_id: string;
  document_id: string;
  event_type: StockEventType;
  event_reason: string;
  delta_quantity_canonical: number;
  canonical_unit_id: string;
  canonical_family: string;
  canonical_label: string | null;
  context_hash: string;
  snapshot_version_id: string;
  override_flag: boolean;
  override_reason: string | null;
  posted_at: string;
  posted_by: string | null;
  voids_event_id: string | null;
  voids_document_id: string | null;
  created_at: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// STOCK ENGINE OUTPUT
// ═══════════════════════════════════════════════════════════════════════════

/** Warning emitted when events are filtered out during calculation */
export interface StockEngineWarning {
  code: "IGNORED_EVENTS_FAMILY_MISMATCH";
  /** Number of events ignored */
  eventCount: number;
  /** Optional: first few examples for diagnostics */
  examples?: Array<{ canonical_family: string }>;
}

export interface EstimatedStockResult {
  /** Product ID */
  product_id: string;
  /** Zone ID */
  storage_zone_id: string;
  /** Active snapshot session ID */
  snapshot_version_id: string;
  /** Quantity from last completed inventory (canonical) */
  snapshot_quantity: number;
  /** Sum of all POSTED events since snapshot */
  events_delta: number;
  /** snapshot_quantity + events_delta */
  estimated_quantity: number;
  /** Unit ID from the snapshot (inventory_lines.unit_id) — NEVER products_v2 current */
  canonical_unit_id: string;
  /** Family of the canonical unit */
  canonical_family: string;
  /** Human-readable label */
  canonical_label: string | null;
  /** Number of compatible events contributing to delta */
  events_count: number;
  /** Warnings about filtered/ignored data (empty = clean) */
  warnings: StockEngineWarning[];
}

export interface StockEngineError {
  code:
    | "NO_ACTIVE_SNAPSHOT"
    | "NO_SNAPSHOT_LINE"
    | "FAMILY_MISMATCH"
    | "INCOMPATIBLE_FAMILY_CHANGE"
    | "MISSING_UNIT_INFO";
  message: string;
  product_id: string;
  storage_zone_id: string;
}

export type EstimatedStockOutcome =
  | { ok: true; data: EstimatedStockResult }
  | { ok: false; error: StockEngineError };

// ═══════════════════════════════════════════════════════════════════════════
// CONTEXT HASH INPUT (deterministic)
// ═══════════════════════════════════════════════════════════════════════════

export interface ContextHashInput {
  canonical_unit_id: string;
  packaging_levels: Array<{
    type_unit_id: string | null;
    contains_unit_id: string | null;
    quantity: number;
  }>;
  equivalence: {
    source_unit_id: string | null;
    unit_id: string | null;
    quantity: number | null;
  } | null;
  billing_unit_id: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// POST DOCUMENT INPUT
// ═══════════════════════════════════════════════════════════════════════════

export interface PostDocumentInput {
  document_id: string;
  expected_lock_version: number;
  posted_by: string;
  event_reason: string;
}

export interface PostDocumentResult {
  ok: boolean;
  error?: string;
  events_created?: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// VOID DOCUMENT INPUT
// ═══════════════════════════════════════════════════════════════════════════

export interface VoidDocumentInput {
  document_id: string;
  voided_by: string;
  void_reason: string;
}

export interface VoidDocumentResult {
  ok: boolean;
  error?: string;
  void_events_created?: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// INPUT PAYLOAD HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/** Known fields stored in stock_document_lines.input_payload */
export interface StockLineInputPayload {
  product_name?: string;
  supplier_name?: string | null;
}

/** Type guard: safely extract product_name from input_payload */
export function getInputPayloadProductName(
  payload: Record<string, unknown> | null
): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const name = payload.product_name;
  return typeof name === "string" ? name : undefined;
}

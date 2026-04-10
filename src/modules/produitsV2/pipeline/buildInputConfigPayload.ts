/**
 * ═══════════════════════════════════════════════════════════════════════════
 * BUILD INPUT CONFIG PAYLOAD — Composes purchase/reception/internal configs (PR-4)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Composes the 3 existing SSOT build functions:
 * - buildPurchaseConfig  (always auto-computed, never manual)
 * - buildReceptionConfig (auto-computed by default, manual override possible)
 * - buildInternalConfig  (auto-computed by default, manual override possible)
 *
 * DECISION: conditioningConfig is NOT a parameter.
 * The 3 build functions consume packagingLevels, finalUnitId, etc. directly.
 * conditioningConfig is only used by wizardStateToProductForConfig (UI adapter).
 *
 * Zero side effects, zero React, zero hooks.
 */

import type { PackagingLevel } from "./types";
import { buildPurchaseConfig } from "@/modules/inputConfig/utils/buildPurchaseConfig";
import { buildReceptionConfig } from "@/modules/inputConfig/utils/buildReceptionConfig";
import { buildInternalConfig } from "@/modules/inputConfig/utils/buildInternalConfig";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface InputConfigPayloadInput {
  finalUnitId: string | null;
  billedUnitId: string | null;
  stockHandlingUnitId: string | null;
  packagingLevels: PackagingLevel[];
  allowUnitSale: boolean;

  /**
   * Manual overrides from wizard Step 4/5.
   * When set, these values are used as-is instead of auto-computing.
   */
  receptionModeOverride?: string | null;
  receptionUnitIdOverride?: string | null;
  receptionChainOverride?: string[] | null;
  internalModeOverride?: string | null;
  internalUnitIdOverride?: string | null;
  internalChainOverride?: string[] | null;
}

export interface InputConfigPayload {
  purchase_mode: string;
  purchase_preferred_unit_id: string | null;
  purchase_unit_chain: string[] | null;
  reception_mode: string;
  reception_preferred_unit_id: string | null;
  reception_unit_chain: string[] | null;
  internal_mode: string;
  internal_preferred_unit_id: string | null;
  internal_unit_chain: string[] | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// buildInputConfigPayload
// ─────────────────────────────────────────────────────────────────────────────

export function buildInputConfigPayload(
  input: InputConfigPayloadInput,
  dbUnits: Array<{ id: string; family: string | null }>,
): InputConfigPayload {
  // FALLBACK WIZARD : billedUnitId pré-rempli
  // avec finalUnitId si absent (reproduit
  // useWizardState.ts L106-114)
  const _billedUnitId = input.billedUnitId ?? input.finalUnitId;

  // ── 1. Purchase — always auto-computed ──
  const purchase = buildPurchaseConfig(
    input.packagingLevels,
    input.finalUnitId,
    dbUnits,
  );

  // ── 2. Reception — auto or manual override ──
  let reception;
  if (input.receptionModeOverride) {
    reception = {
      reception_mode: input.receptionModeOverride,
      reception_preferred_unit_id: input.receptionUnitIdOverride ?? null,
      reception_unit_chain: input.receptionChainOverride ?? null,
    };
  } else {
    reception = buildReceptionConfig(
      input.packagingLevels,
      input.allowUnitSale,
      input.finalUnitId,
      dbUnits,
    );
  }

  // ── 3. Internal — auto or manual override ──
  let internal;
  if (input.internalModeOverride) {
    internal = {
      internal_mode: input.internalModeOverride,
      internal_preferred_unit_id: input.internalUnitIdOverride ?? null,
      internal_unit_chain: input.internalChainOverride ?? null,
    };
  } else {
    internal = buildInternalConfig(
      input.packagingLevels,
      input.allowUnitSale,
      input.stockHandlingUnitId,
      input.finalUnitId,
      dbUnits,
    );
  }

  return {
    purchase_mode: purchase.purchase_mode,
    purchase_preferred_unit_id: purchase.purchase_preferred_unit_id,
    purchase_unit_chain: null, // purchase never has chain
    reception_mode: reception.reception_mode,
    reception_preferred_unit_id: reception.reception_preferred_unit_id,
    reception_unit_chain: reception.reception_unit_chain,
    internal_mode: internal.internal_mode,
    internal_preferred_unit_id: internal.internal_preferred_unit_id,
    internal_unit_chain: internal.internal_unit_chain,
  };
}

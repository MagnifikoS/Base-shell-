/**
 * ConditioningConfig — JSONB structure stored on products_v2.conditionnement_config
 *
 * Extracted to shared/ to break circular dependency:
 *   core/unitConversion -> produitsV2 -> components -> core/unitConversion
 *
 * Both core/unitConversion and modules/produitsV2 depend on this type.
 */

import type {
  PackagingLevel,
  FinalUnit,
  PriceLevel,
  Equivalence,
} from "@/modules/conditionnementV2";

export interface ConditioningConfig {
  finalUnit: FinalUnit | null;
  /** UUID FK -> measurement_units.id (SSOT -- replaces finalUnit text) */
  final_unit_id?: string | null;
  packagingLevels: PackagingLevel[];
  priceLevel: PriceLevel | null;
  equivalence: Equivalence | null;
}

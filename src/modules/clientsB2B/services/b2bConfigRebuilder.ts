/**
 * B2B Config Rebuilder — Phase D
 * Pure function: remaps all UUIDs in conditionnement_config from source → local
 */

import type { UnitMappingResult } from "./b2bTypes";

/**
 * Build a source→local UUID mapping table from unit mapping results.
 */
function buildUuidMap(mappings: UnitMappingResult[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of mappings) {
    if (m.status === "MAPPED" && m.localUnitId) {
      map.set(m.sourceUnitId, m.localUnitId);
    }
  }
  return map;
}

function remapUuid(uuidMap: Map<string, string>, sourceId: string | null | undefined): string | null {
  if (!sourceId) return null;
  return uuidMap.get(sourceId) ?? null;
}

let levelCounter = 0;
function generateLevelId(): string {
  levelCounter++;
  return `b2b-level-${Date.now()}-${levelCounter}`;
}

/**
 * Remap a conditionnement_config JSON, replacing all source UUIDs with local UUIDs.
 */
export function rebuildConditionnementConfig(
  sourceConfig: Record<string, unknown> | null,
  unitMappings: UnitMappingResult[]
): Record<string, unknown> | null {
  if (!sourceConfig) return null;

  const uuidMap = buildUuidMap(unitMappings);
  const result: Record<string, unknown> = { ...sourceConfig };

  // Remap final_unit_id
  if (typeof result.final_unit_id === "string") {
    result.final_unit_id = remapUuid(uuidMap, result.final_unit_id);
  }

  // Remap packagingLevels — build old→new level ID map for priceLevel.levelId remapping
  const levelIdMap = new Map<string, string>();
  if (Array.isArray(result.packagingLevels)) {
    result.packagingLevels = (result.packagingLevels as Record<string, unknown>[]).map((level) => {
      const oldId = level.id as string | undefined;
      const newId = generateLevelId();
      if (oldId) {
        levelIdMap.set(oldId, newId);
      }
      return {
        ...level,
        id: newId,
        type_unit_id: remapUuid(uuidMap, level.type_unit_id as string | null),
        contains_unit_id: remapUuid(uuidMap, level.contains_unit_id as string | null),
      };
    });
  }

  // Remap equivalence (Equivalence type uses source_unit_id / unit_id)
  if (result.equivalence && typeof result.equivalence === "object") {
    const eq = result.equivalence as Record<string, unknown>;
    result.equivalence = {
      ...eq,
      source_unit_id: remapUuid(uuidMap, eq.source_unit_id as string | null),
      unit_id: remapUuid(uuidMap, eq.unit_id as string | null),
    };
  }

  // FIX Phase 4: Remap priceLevel.billed_unit_id (was missing — root cause of cross-tenant contamination)
  // FIX Phase 5: Remap priceLevel.levelId to match regenerated packaging level IDs
  if (result.priceLevel && typeof result.priceLevel === "object") {
    const pl = result.priceLevel as Record<string, unknown>;
    const remapped: Record<string, unknown> = { ...pl };

    if (typeof pl.billed_unit_id === "string") {
      remapped.billed_unit_id = remapUuid(uuidMap, pl.billed_unit_id as string | null);
    }

    // Remap levelId: source level ID → new local level ID
    if (typeof pl.levelId === "string" && levelIdMap.size > 0) {
      remapped.levelId = levelIdMap.get(pl.levelId) ?? pl.levelId;
    }

    result.priceLevel = remapped;
  }

  return result;
}

/**
 * Remap a single direct unit column UUID.
 */
export function remapDirectUnit(
  sourceUnitId: string | null,
  unitMappings: UnitMappingResult[]
): string | null {
  if (!sourceUnitId) return null;
  const mapping = unitMappings.find((m) => m.sourceUnitId === sourceUnitId);
  if (!mapping || mapping.status !== "MAPPED") return null;
  return mapping.localUnitId;
}

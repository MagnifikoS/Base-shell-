/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MODULE CONDITIONNEMENT V2 — PACKAGING RESOLVER (UUID-STRICT)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * RÈGLE FONDAMENTALE :
 * - Toutes les comparaisons et conversions utilisent UNIQUEMENT des UUID
 * - Aucun resolveUnit(), aucun matching texte, aucun alias
 * - Si un UUID est manquant → la comparaison échoue (return false/null)
 * - Les textes (name/abbreviation) sont utilisés UNIQUEMENT pour les messages
 *
 * DB-DRIVEN: Utilise unit_conversions via UUID lookup direct.
 */

import type { PackagingLevel, Equivalence, FactorResult } from "./types";
import type { ConversionRule, UnitWithFamily } from "@/core/unitConversion/types";

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS — UUID-STRICT (zéro text matching)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if two unit references match — UUID ONLY.
 * Returns false if either ID is missing.
 */
function idsMatch(aId: string | null | undefined, bId: string | null | undefined): boolean {
  if (!aId || !bId) return false;
  return aId === bId;
}

/**
 * Try conversion between two units via DB rules — UUID ONLY.
 * Returns factor or null.
 */
function tryConvertById(
  fromId: string | null | undefined,
  toId: string | null | undefined,
  units: UnitWithFamily[],
  conversions: ConversionRule[]
): number | null {
  if (!fromId || !toId) return null;
  if (fromId === toId) return 1;

  // 1. Direct rule
  const direct = conversions.find((c) => c.from_unit_id === fromId && c.to_unit_id === toId);
  if (direct) return direct.factor;

  // 2. Via reference unit of same family
  const fromUnit = units.find((u) => u.id === fromId);
  const toUnit = units.find((u) => u.id === toId);
  if (fromUnit?.family && toUnit?.family && fromUnit.family === toUnit.family) {
    const ref = units.find((u) => u.family === fromUnit.family && u.is_reference);
    if (ref && ref.id !== fromId && ref.id !== toId) {
      const toRef = conversions.find((c) => c.from_unit_id === fromId && c.to_unit_id === ref.id);
      const fromRef = conversions.find((c) => c.from_unit_id === ref.id && c.to_unit_id === toId);
      if (toRef && fromRef) {
        return toRef.factor * fromRef.factor;
      }
    }
  }

  return null;
}

/**
 * Get family of a unit by UUID.
 */
function getFamilyById(id: string | null | undefined, units: UnitWithFamily[]): string | null {
  if (!id) return null;
  const u = units.find((u) => u.id === id);
  return u?.family ?? null;
}

/**
 * Get display label for a unit by ID (for error messages only).
 */
function unitLabel(text: string, id: string | null | undefined, units: UnitWithFamily[]): string {
  if (id) {
    const u = units.find((u) => u.id === id);
    if (u) return u.name || u.abbreviation;
  }
  return text || "?";
}

// ═══════════════════════════════════════════════════════════════════════════
// RESOLVER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Trouve l'index d'un niveau dans l'arbre par son type — UUID ONLY.
 */
function findLevelIndex(levels: PackagingLevel[], typeId: string | null | undefined): number {
  if (!typeId) return -1;
  for (let i = 0; i < levels.length; i++) {
    if (levels[i].type_unit_id === typeId) {
      return i;
    }
  }
  return -1;
}

/**
 * Résout le facteur de conversion entre deux unités en utilisant l'arbre de conditionnement.
 * UUID-STRICT: utilise uniquement des UUID pour toutes les comparaisons.
 */
export function resolveFactor(
  fromUnit: string,
  toUnit: string,
  levels: PackagingLevel[],
  equivalence?: Equivalence | null,
  units: UnitWithFamily[] = [],
  conversions: ConversionRule[] = [],
  fromUnitId?: string | null,
  toUnitId?: string | null
): FactorResult {
  const path: string[] = [];
  const warnings: string[] = [];
  const fromLabel = unitLabel(fromUnit, fromUnitId, units);
  const toLabel = unitLabel(toUnit, toUnitId, units);

  // Guard: both IDs required
  if (!fromUnitId || !toUnitId) {
    const missing = !fromUnitId ? fromUnit || "source" : toUnit || "cible";
    warnings.push(`UUID manquant pour "${missing}". Conversion impossible.`);
    return { factor: null, reached: false, warnings, path };
  }

  // CAS 1 : Même unité
  if (idsMatch(fromUnitId, toUnitId)) {
    return { factor: 1, reached: true, warnings: [], path: [`${fromLabel} = ${toLabel}`] };
  }

  // CAS 2 : Conversion physique directe (g→kg, ml→L via DB)
  const directFactor = tryConvertById(fromUnitId, toUnitId, units, conversions);
  if (directFactor !== null) {
    return {
      factor: directFactor,
      reached: true,
      warnings: [],
      path: [`1 ${fromLabel} = ${directFactor} ${toLabel} (conversion DB)`],
    };
  }

  // CAS 3 : Parcourir l'arbre de conditionnement
  const startIndex = findLevelIndex(levels, fromUnitId);

  if (startIndex !== -1) {
    let factor = 1;
    let currentLabel = fromLabel;
    let currentId: string | null | undefined = fromUnitId;
    path.push(fromLabel);

    for (let i = startIndex; i < levels.length; i++) {
      const level = levels[i];

      if (level.containsQuantity === null || level.containsQuantity <= 0) {
        warnings.push(`Quantité invalide pour "${level.type}"`);
        return { factor: null, reached: false, warnings, path };
      }

      factor *= level.containsQuantity;
      currentLabel = unitLabel(level.containsUnit, level.contains_unit_id, units);
      currentId = level.contains_unit_id;
      path.push(`×${level.containsQuantity} ${currentLabel}`);

      // STOP si on atteint l'unité cible
      if (idsMatch(currentId, toUnitId)) {
        return { factor, reached: true, warnings, path };
      }

      // STOP si conversion physique possible vers cible
      const convFactor = tryConvertById(currentId, toUnitId, units, conversions);
      if (convFactor !== null) {
        factor *= convFactor;
        path.push(`→ ${factor} ${toLabel} (conversion DB)`);
        return { factor, reached: true, warnings, path };
      }

      // STOP si l'équivalence permet de convertir
      if (
        equivalence &&
        equivalence.unit_id &&
        idsMatch(currentId, findEquivalenceSourceId(equivalence, levels))
      ) {
        if (idsMatch(equivalence.unit_id, toUnitId)) {
          factor *= equivalence.quantity;
          path.push(
            `→ équivalence: 1 ${equivalence.source} = ${equivalence.quantity} ${equivalence.unit}`
          );
          return { factor, reached: true, warnings, path };
        }

        const eqConv = tryConvertById(equivalence.unit_id, toUnitId, units, conversions);
        if (eqConv !== null) {
          factor *= equivalence.quantity * eqConv;
          path.push(
            `→ équivalence: 1 ${equivalence.source} = ${equivalence.quantity} ${equivalence.unit} → ${toLabel}`
          );
          return { factor, reached: true, warnings, path };
        }

        // Famille différente entre équivalence et cible
        const equivFamily = getFamilyById(equivalence.unit_id, units);
        const targetFamily = getFamilyById(toUnitId, units);
        if (equivFamily && targetFamily && equivFamily !== targetFamily) {
          warnings.push(
            `L'équivalence définit ${equivalence.source} = ${equivalence.quantity} ${equivalence.unit} ` +
              `mais l'unité finale est "${toLabel}" (famille différente). Conversion impossible.`
          );
          return { factor: null, reached: false, warnings, path };
        }
      }

      // STOP si on a changé de famille sans équivalence
      const currentFamily = getFamilyById(currentId, units);
      const targetFamily = getFamilyById(toUnitId, units);
      if (currentFamily && targetFamily && currentFamily !== targetFamily) {
        warnings.push(
          `Impossible de convertir "${currentLabel}" (${currentFamily}) vers "${toLabel}" (${targetFamily}) sans équivalence.`
        );
        return { factor: null, reached: false, warnings, path };
      }
    }

    // Fin de l'arbre — vérifier conversion physique
    const endConv = tryConvertById(currentId, toUnitId, units, conversions);
    if (endConv !== null) {
      factor *= endConv;
      path.push(`→ ${factor} ${toLabel} (conversion finale DB)`);
      return { factor, reached: true, warnings, path };
    }

    // Vérifier via équivalence en fin d'arbre
    if (equivalence && equivalence.unit_id) {
      const eqSourceId = findEquivalenceSourceId(equivalence, levels);
      if (idsMatch(currentId, eqSourceId)) {
        const eqMatch = idsMatch(equivalence.unit_id, toUnitId);
        const eqConv = !eqMatch
          ? tryConvertById(equivalence.unit_id, toUnitId, units, conversions)
          : null;
        if (eqMatch || eqConv !== null) {
          const convF = eqConv ?? 1;
          factor *= equivalence.quantity * convF;
          path.push(`→ équivalence: ${equivalence.quantity} ${equivalence.unit}`);
          return { factor, reached: true, warnings, path };
        }
      }
    }

    warnings.push(
      `L'arbre se termine sur "${currentLabel}" qui n'est pas convertible vers "${toLabel}".`
    );
    return { factor: null, reached: false, warnings, path };
  }

  // CAS 4 : fromUnit est une unité physique (pas dans l'arbre) — conversion via équivalence
  const fromFamily = getFamilyById(fromUnitId, units);
  if (fromFamily) {
    if (equivalence && equivalence.unit_id) {
      const eqConv = tryConvertById(fromUnitId, equivalence.unit_id, units, conversions);
      if (eqConv !== null && equivalence.quantity > 0) {
        const eqSourceId = findEquivalenceSourceId(equivalence, levels);
        if (idsMatch(eqSourceId, toUnitId)) {
          const factor = eqConv / equivalence.quantity;
          path.push(`1 ${fromLabel} = ${eqConv} ${equivalence.unit}`);
          path.push(`1 ${equivalence.source} = ${equivalence.quantity} ${equivalence.unit}`);
          path.push(`→ 1 ${fromLabel} = ${factor.toFixed(4)} ${toLabel}`);
          return { factor, reached: true, warnings, path };
        }
      }
    }

    warnings.push(
      `Impossible de convertir "${fromLabel}" vers "${toLabel}" sans équivalence valide.`
    );
    return { factor: null, reached: false, warnings, path };
  }

  // CAS 5 : fromUnit correspond à l'équivalence source
  if (equivalence && equivalence.unit_id) {
    const eqSourceId = findEquivalenceSourceId(equivalence, levels);
    if (idsMatch(fromUnitId, eqSourceId)) {
      if (idsMatch(equivalence.unit_id, toUnitId)) {
        return {
          factor: equivalence.quantity,
          reached: true,
          warnings,
          path: [`1 ${fromLabel} = ${equivalence.quantity} ${toLabel}`],
        };
      }

      const eqConv = tryConvertById(equivalence.unit_id, toUnitId, units, conversions);
      if (eqConv !== null) {
        const factor = equivalence.quantity * eqConv;
        path.push(
          `1 ${fromLabel} = ${equivalence.quantity} ${equivalence.unit} = ${factor} ${toLabel}`
        );
        return { factor, reached: true, warnings, path };
      }
    }
  }

  // Aucun chemin trouvé
  warnings.push(`Aucun chemin de conversion trouvé de "${fromLabel}" vers "${toLabel}".`);
  return { factor: null, reached: false, warnings, path };
}

/**
 * Find the UUID of the equivalence source.
 * The equivalence.source is a text label for a packaging type or final unit.
 * We match it via type_unit_id from packaging levels or fall back.
 */
function findEquivalenceSourceId(
  equivalence: Equivalence,
  levels: PackagingLevel[]
): string | null {
  // Equivalence source typically matches a packaging level type or final unit
  // Match by text against level types to find the corresponding UUID
  const sourceLower = equivalence.source.toLowerCase().trim();
  for (const level of levels) {
    if (level.type.toLowerCase().trim() === sourceLower && level.type_unit_id) {
      return level.type_unit_id;
    }
  }
  return null;
}

/**
 * Résout la conversion avec FinalUnit (string libre) + IDs optionnels.
 */
export function resolveFactorToFinal(
  fromUnit: string,
  finalUnit: string,
  levels: PackagingLevel[],
  equivalence?: Equivalence | null,
  units: UnitWithFamily[] = [],
  conversions: ConversionRule[] = [],
  fromUnitId?: string | null,
  finalUnitId?: string | null
): FactorResult {
  return resolveFactor(
    fromUnit,
    finalUnit,
    levels,
    equivalence,
    units,
    conversions,
    fromUnitId,
    finalUnitId
  );
}

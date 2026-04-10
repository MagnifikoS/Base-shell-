/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MODULE CONDITIONNEMENT V2 — GRAPHE DE CONVERSION (UUID-only)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Construit un graphe pondéré d'arêtes bidirectionnelles à partir de :
 *   A) unit_conversions (DB) — conversions physiques
 *   B) packagingLevels   — niveaux de conditionnement
 *   C) equivalence       — pièce ↔ poids/volume
 *
 * Puis cherche le chemin le plus court (BFS) entre from_unit_id et to_unit_id.
 *
 * RÈGLES :
 * - Entrées = UUID uniquement
 * - Zéro text matching, zéro alias, zéro resolveUnit
 * - Les labels texte ne sont utilisés que pour le chemin affiché (debug UX)
 */

import type { ConversionRule, UnitWithFamily } from "@/core/unitConversion/types";
import type { PackagingLevel, Equivalence } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface Edge {
  toId: string;
  factor: number;
  /** Human-readable label for the path (debug UX only) */
  label: string;
}

export interface ConversionGraphResult {
  factor: number | null;
  reached: boolean;
  warnings: string[];
  /** Human-readable conversion path for UX */
  path: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function unitDisplayLabel(unitId: string, units: UnitWithFamily[]): string {
  const u = units.find(u => u.id === unitId);
  return u ? (u.abbreviation || u.name) : unitId.substring(0, 8);
}

// ─────────────────────────────────────────────────────────────────────────────
// GRAPH BUILDER
// ─────────────────────────────────────────────────────────────────────────────

function buildGraph(
  dbConversions: ConversionRule[],
  packagingLevels: PackagingLevel[],
  equivalence: Equivalence | null | undefined,
  units: UnitWithFamily[]
): Map<string, Edge[]> {
  const graph = new Map<string, Edge[]>();

  function addEdge(fromId: string, toId: string, factor: number, label: string) {
    if (!fromId || !toId || factor <= 0) return;
    if (!graph.has(fromId)) graph.set(fromId, []);
    graph.get(fromId)!.push({ toId, factor, label });
  }

  // A) DB conversions — bidirectional
  for (const rule of dbConversions) {
    if (!rule.is_active) continue;
    const fromLabel = unitDisplayLabel(rule.from_unit_id, units);
    const toLabel = unitDisplayLabel(rule.to_unit_id, units);
    addEdge(rule.from_unit_id, rule.to_unit_id, rule.factor, `${fromLabel}→${toLabel} (DB)`);
    if (rule.factor !== 0) {
      addEdge(rule.to_unit_id, rule.from_unit_id, 1 / rule.factor, `${toLabel}→${fromLabel} (DB inv)`);
    }
  }

  // Also add via-reference conversions from same family
  // Group units by family
  const familyMap = new Map<string, UnitWithFamily[]>();
  for (const u of units) {
    if (u.family) {
      if (!familyMap.has(u.family)) familyMap.set(u.family, []);
      familyMap.get(u.family)!.push(u);
    }
  }
  for (const [, familyUnits] of familyMap) {
    const ref = familyUnits.find(u => u.is_reference);
    if (!ref) continue;
    for (const u of familyUnits) {
      if (u.id === ref.id) continue;
      // Check if direct conversion to ref exists
      const toRef = dbConversions.find(c => c.from_unit_id === u.id && c.to_unit_id === ref.id && c.is_active);
      const fromRef = dbConversions.find(c => c.from_unit_id === ref.id && c.to_unit_id === u.id && c.is_active);
      if (toRef) {
        // We already added these in the direct loop, but let's add the composed paths
        // For each other unit in the family, try to create an edge via ref
        for (const other of familyUnits) {
          if (other.id === u.id || other.id === ref.id) continue;
          // u → ref → other
          const refToOther = dbConversions.find(c => c.from_unit_id === ref.id && c.to_unit_id === other.id && c.is_active);
          if (refToOther) {
            const composed = toRef.factor * refToOther.factor;
            const uLabel = unitDisplayLabel(u.id, units);
            const otherLabel = unitDisplayLabel(other.id, units);
            addEdge(u.id, other.id, composed, `${uLabel}→${otherLabel} (via ${unitDisplayLabel(ref.id, units)})`);
          }
        }
      }
      if (fromRef) {
        for (const other of familyUnits) {
          if (other.id === u.id || other.id === ref.id) continue;
          const otherToRef = dbConversions.find(c => c.from_unit_id === other.id && c.to_unit_id === ref.id && c.is_active);
          if (otherToRef) {
            const composed = otherToRef.factor * fromRef.factor;
            const otherLabel = unitDisplayLabel(other.id, units);
            const uLabel = unitDisplayLabel(u.id, units);
            addEdge(other.id, u.id, composed, `${otherLabel}→${uLabel} (via ${unitDisplayLabel(ref.id, units)})`);
          }
        }
      }
    }
  }

  // B) Packaging levels — bidirectional
  for (const level of packagingLevels) {
    const typeId = level.type_unit_id;
    const containsId = level.contains_unit_id;
    const qty = level.containsQuantity;
    if (!typeId || !containsId || !qty || qty <= 0) continue;

    const typeLabel = unitDisplayLabel(typeId, units);
    const containsLabel = unitDisplayLabel(containsId, units);
    // 1 Type = qty Contains → Type→Contains factor=qty
    addEdge(typeId, containsId, qty, `1 ${typeLabel} = ${qty} ${containsLabel}`);
    // Contains→Type factor=1/qty
    addEdge(containsId, typeId, 1 / qty, `1 ${containsLabel} = ${(1/qty).toFixed(4)} ${typeLabel}`);
  }

  // C) Equivalence — bidirectional
  if (equivalence && equivalence.source_unit_id && equivalence.unit_id && equivalence.quantity > 0) {
    const srcLabel = unitDisplayLabel(equivalence.source_unit_id, units);
    const eqLabel = unitDisplayLabel(equivalence.unit_id, units);
    // 1 source = quantity unit → source→unit factor=quantity
    addEdge(equivalence.source_unit_id, equivalence.unit_id, equivalence.quantity, `1 ${srcLabel} = ${equivalence.quantity} ${eqLabel} (éq.)`);
    // unit→source factor=1/quantity
    addEdge(equivalence.unit_id, equivalence.source_unit_id, 1 / equivalence.quantity, `1 ${eqLabel} = ${(1/equivalence.quantity).toFixed(4)} ${srcLabel} (éq. inv.)`);
  }

  return graph;
}

// ─────────────────────────────────────────────────────────────────────────────
// BFS PATHFINDER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Find conversion path from `fromId` to `toId` using BFS on the graph.
 * Returns the cumulative factor and human-readable path.
 */
export function findConversionPath(
  fromId: string | null | undefined,
  toId: string | null | undefined,
  units: UnitWithFamily[],
  dbConversions: ConversionRule[],
  packagingLevels: PackagingLevel[],
  equivalence?: Equivalence | null
): ConversionGraphResult {
  const warnings: string[] = [];

  if (!fromId || !toId) {
    const missingLabel = !fromId ? "source" : "cible";
    warnings.push(`UUID manquant pour l'unité ${missingLabel}. Conversion impossible.`);
    return { factor: null, reached: false, warnings, path: [] };
  }

  if (fromId === toId) {
    const label = unitDisplayLabel(fromId, units);
    return { factor: 1, reached: true, warnings: [], path: [`${label} = ${label}`] };
  }

  const graph = buildGraph(dbConversions, packagingLevels, equivalence, units);

  // BFS
  interface QueueItem {
    nodeId: string;
    factor: number;
    pathLabels: string[];
  }

  const visited = new Set<string>();
  const queue: QueueItem[] = [{
    nodeId: fromId,
    factor: 1,
    pathLabels: [unitDisplayLabel(fromId, units)],
  }];
  visited.add(fromId);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const edges = graph.get(current.nodeId) ?? [];

    for (const edge of edges) {
      if (visited.has(edge.toId)) continue;

      const newFactor = current.factor * edge.factor;
      const newPath = [...current.pathLabels, edge.label];

      if (edge.toId === toId) {
        return {
          factor: newFactor,
          reached: true,
          warnings: [],
          path: newPath,
        };
      }

      visited.add(edge.toId);
      queue.push({
        nodeId: edge.toId,
        factor: newFactor,
        pathLabels: newPath,
      });
    }
  }

  // No path found
  const fromLabel = unitDisplayLabel(fromId, units);
  const toLabel = unitDisplayLabel(toId, units);
  warnings.push(`Aucun chemin de conversion trouvé de "${fromLabel}" vers "${toLabel}".`);
  return { factor: null, reached: false, warnings, path: [] };
}

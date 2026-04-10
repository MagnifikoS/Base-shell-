/**
 * ═══════════════════════════════════════════════════════════════════════════
 * RESOLVE INPUT UNIT FOR CONTEXT — Central SSOT resolver
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Single function that ALL flows must use to determine:
 *   - which unit to display for input
 *   - which mode to use (continuous, integer, etc.)
 *   - which steps to show
 *
 * SOURCE OF TRUTH:
 *   1. product_input_config (user preference) — REQUIRED
 *   2. BFS engine (reachable units + factors) — validation
 *
 * STRICT POLICY (Phase 2):
 *   - No config → BLOCKED (not_configured)
 *   - Config invalid → BLOCKED (needs_review)
 *   - No fallback ever allows input
 *
 * NEVER uses: delivery_unit_id, withdrawal_unit_id as input priority
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { ProductInputConfigRow, InputMode } from "../types";
import type { UnitWithFamily, ConversionRule } from "@/core/unitConversion/types";
import {
  resolveProductUnitContext,
  type ProductUnitInput,
  type ReachableUnit,
} from "@/core/unitConversion/resolveProductUnitContext";

// ─────────────────────────────────────────────────────────────────────────────
// INPUT
// ─────────────────────────────────────────────────────────────────────────────

export type InputContext = "purchase" | "b2b_sale" | "internal";

export interface ProductForResolution {
  id: string;
  nom_produit: string;
  final_unit_id: string | null;
  stock_handling_unit_id: string | null;
  delivery_unit_id?: string | null;
  supplier_billing_unit_id?: string | null;
  conditionnement_config: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// OUTPUT — Discriminated union (strict status)
// ─────────────────────────────────────────────────────────────────────────────

export type InputResolutionResult =
  | {
      status: "ok";
      mode: Exclude<InputMode, "multi_level">;
      unitId: string;
      unitName: string;
      steps: number[];
      defaultStep: number;
      canonicalUnitId: string;
      source: "config";
      reachableUnits: ReachableUnit[];
    }
  | {
      status: "ok";
      mode: "multi_level";
      unitChain: string[];
      unitNames: string[];
      unitFamilies: (string | null)[];
      canonicalUnitId: string;
      source: "config";
      reachableUnits: ReachableUnit[];
    }
  | {
      status: "not_configured";
      reason: string;
    }
  | {
      status: "needs_review";
      reason: string;
    };

/** @deprecated — Use InputResolutionResult instead */
export interface ResolvedInputUnit {
  unitId: string;
  unitName: string;
  mode: InputMode;
  steps: number[];
  defaultStep: number;
  source: "config" | "fallback";
  reachableUnits: ReachableUnit[];
  canonicalUnitId: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT STEPS BY MODE
// ─────────────────────────────────────────────────────────────────────────────

function defaultStepsForMode(mode: InputMode): { steps: number[]; defaultStep: number } {
  switch (mode) {
    case "continuous":
      return { steps: [0.1, 0.25, 0.5, 1, 5], defaultStep: 1 };
    case "decimal":
      return { steps: [0.5, 1, 5], defaultStep: 1 };
    case "integer":
      return { steps: [1, 2, 5, 10], defaultStep: 1 };
    case "fraction":
      return { steps: [0.25, 0.5, 1], defaultStep: 1 };
    case "multi_level":
      return { steps: [1], defaultStep: 1 };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN RESOLVER — STRICT (Phase 2)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Central resolver: determines the input unit and mode for a given product + context.
 *
 * STRICT POLICY:
 *   - No config → status: "not_configured" (blocked)
 *   - Config invalid against engine → status: "needs_review" (blocked)
 *   - Config valid → status: "ok"
 *
 * No fallback ever permits input.
 */
export function resolveInputUnitForContext(
  product: ProductForResolution,
  context: InputContext,
  config: ProductInputConfigRow | null,
  dbUnits: UnitWithFamily[],
  dbConversions: ConversionRule[],
): InputResolutionResult {
  // ── 1. Run BFS engine to get reachable units ──
  const engineInput: ProductUnitInput = {
    stock_handling_unit_id: product.stock_handling_unit_id,
    final_unit_id: product.final_unit_id,
    delivery_unit_id: product.delivery_unit_id ?? null,
    supplier_billing_unit_id: product.supplier_billing_unit_id ?? null,
    conditionnement_config: product.conditionnement_config as ProductUnitInput["conditionnement_config"],
  };

  const unitContext = resolveProductUnitContext(engineInput, dbUnits, dbConversions);
  const reachableUnits = unitContext.allowedInventoryEntryUnits;
  const canonicalUnitId = unitContext.canonicalInventoryUnitId
    ?? product.stock_handling_unit_id
    ?? product.final_unit_id
    ?? "";

  const reachableIds = new Set(reachableUnits.map((u) => u.id));

  // ── 2. No config → BLOCKED ──
  if (!config) {
    if (import.meta.env.DEV) {
      console.debug(
        `[InputResolution] BLOCKED ${product.nom_produit} | context=${context} | reason=not_configured`,
      );
    }
    return {
      status: "not_configured",
      reason: `Aucune configuration de saisie trouvée pour « ${product.nom_produit} ». Configurez les paramètres avancés.`,
    };
  }

  // ── 3. Read config for context ──
  const preferredMode = context === "purchase"
    ? config.purchase_mode
    : context === "b2b_sale"
      ? config.reception_mode
      : config.internal_mode;
  const preferredUnitId = context === "purchase"
    ? config.purchase_preferred_unit_id
    : context === "b2b_sale"
      ? config.reception_preferred_unit_id
      : config.internal_preferred_unit_id;

  // ── 3b. MULTI_LEVEL — dedicated branch (uses unit_chain, not preferred_unit_id) ──
  if (preferredMode === "multi_level") {
    const unitChain = context === "purchase"
      ? config.purchase_unit_chain
      : context === "b2b_sale"
        ? config.reception_unit_chain
        : config.internal_unit_chain;

    // Validate chain structure
    if (!unitChain || unitChain.length < 2) {
      if (import.meta.env.DEV) {
        console.debug(
          `[InputResolution] BLOCKED ${product.nom_produit} | context=${context} | reason=needs_review (unit_chain missing or < 2)`,
        );
      }
      return {
        status: "needs_review",
        reason: `La chaîne multi-niveaux pour « ${product.nom_produit} » est invalide (${unitChain?.length ?? 0} niveau(x)). Reconfigurez les paramètres avancés.`,
      };
    }

    // Validate no duplicates
    if (new Set(unitChain).size !== unitChain.length) {
      if (import.meta.env.DEV) {
        console.debug(
          `[InputResolution] BLOCKED ${product.nom_produit} | context=${context} | reason=needs_review (unit_chain has duplicates)`,
        );
      }
      return {
        status: "needs_review",
        reason: `La chaîne multi-niveaux pour « ${product.nom_produit} » contient des doublons. Reconfigurez les paramètres avancés.`,
      };
    }

    // Validate every unit in chain is reachable
    const unreachable = unitChain.filter((id) => !reachableIds.has(id));
    if (unreachable.length > 0) {
      if (import.meta.env.DEV) {
        console.debug(
          `[InputResolution] BLOCKED ${product.nom_produit} | context=${context} | reason=needs_review (${unreachable.length} units not reachable)`,
        );
      }
      return {
        status: "needs_review",
        reason: `Certaines unités de la chaîne multi-niveaux pour « ${product.nom_produit} » ne sont plus atteignables. Le conditionnement a peut-être changé.`,
      };
    }

    // Resolve names and families for each unit in chain
    const unitNames = unitChain.map((id) => {
      const reachable = reachableUnits.find((u) => u.id === id);
      return reachable?.name ?? dbUnits.find((u) => u.id === id)?.name ?? "unité";
    });
    const unitFamilies = unitChain.map((id) => {
      const reachable = reachableUnits.find((u) => u.id === id);
      return reachable?.family ?? dbUnits.find((u) => u.id === id)?.family ?? null;
    });

    if (import.meta.env.DEV) {
      console.debug(
        `[InputResolution] OK ${product.nom_produit} | context=${context} | mode=multi_level | chain=[${unitNames.join(", ")}]`,
      );
    }

    return {
      status: "ok",
      mode: "multi_level",
      unitChain,
      unitNames,
      unitFamilies,
      canonicalUnitId,
      source: "config",
      reachableUnits,
    };
  }

  // ── 4. No mode or no unit → not_configured for this context ──
  if (!preferredMode || !preferredUnitId) {
    if (import.meta.env.DEV) {
      console.debug(
        `[InputResolution] BLOCKED ${product.nom_produit} | context=${context} | reason=not_configured (missing mode/unit for context)`,
      );
    }
    return {
      status: "not_configured",
      reason: `La configuration de saisie « ${context === "purchase" ? "Achat" : context === "b2b_sale" ? "Vente B2B" : "Interne"} » n'est pas définie pour « ${product.nom_produit} ».`,
    };
  }

  // ── 5. Validate preferred unit against engine (reachability) ──
  if (!reachableIds.has(preferredUnitId)) {
    if (import.meta.env.DEV) {
      console.debug(
        `[InputResolution] BLOCKED ${product.nom_produit} | context=${context} | reason=needs_review (unit ${preferredUnitId} not reachable)`,
      );
    }
    return {
      status: "needs_review",
      reason: `L'unité de saisie configurée pour « ${product.nom_produit} » n'est plus atteignable. Le conditionnement a peut-être changé.`,
    };
  }

  // ── 6. Mode↔unit coherence ──
  // REMOVED: The previous modeExpectsPhysical check was a local abstraction
  // that could contradict BFS reachability (e.g. reject integer mode on a
  // discrete packaging unit for a weight-based product). The BFS reachability
  // check in step 5 is the sole gate — if the unit is reachable, the config
  // is structurally valid. Mode semantics are enforced at config-time by
  // buildUnitChoicesFromEngine, not at resolution-time.

  // ── 7. Config is valid — return OK ──
  // Both "continuous" (stepper) and "decimal" (free input) are kept distinct.
  // The user chooses explicitly in advanced settings.
  const resolvedMode: InputMode = preferredMode;

  const reachable = reachableUnits.find((u) => u.id === preferredUnitId);
  const unitName = reachable?.name
    ?? dbUnits.find((u) => u.id === preferredUnitId)?.name
    ?? "unité";
  const { steps, defaultStep } = defaultStepsForMode(resolvedMode);

  if (import.meta.env.DEV) {
    console.debug(
      `[InputResolution] OK ${product.nom_produit} | context=${context} | mode=${resolvedMode}${resolvedMode !== preferredMode ? ` (from ${preferredMode})` : ""} | unit=${unitName}`,
    );
  }

  return {
    status: "ok",
    unitId: preferredUnitId,
    unitName,
    mode: resolvedMode,
    steps,
    defaultStep,
    canonicalUnitId,
    source: "config",
    reachableUnits,
  };
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Stock Engine Error Diagnostics — Human-readable error reasons
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { StockEngineError } from "../types";

/** Map error codes to short user-facing labels */
export function getErrorDiagnosticLabel(code: StockEngineError["code"]): string {
  switch (code) {
    case "NO_ACTIVE_SNAPSHOT":
      return "Pas d'inventaire de référence pour cette zone";
    case "NO_SNAPSHOT_LINE":
      return "Produit absent du dernier inventaire (zone modifiée ?)";
    case "FAMILY_MISMATCH":
      return "Famille d'unité incohérente entre inventaire et mouvements";
    case "INCOMPATIBLE_FAMILY_CHANGE":
      return "Changement de famille d'unité incompatible";
    case "MISSING_UNIT_INFO":
      return "Unité de mesure non trouvée ou sans famille";
    default:
      return "Erreur technique inconnue";
  }
}

/** Map error codes to short action hints */
export function getErrorActionHint(code: StockEngineError["code"]): string {
  switch (code) {
    case "NO_ACTIVE_SNAPSHOT":
      return "Effectuez un inventaire complet de cette zone.";
    case "NO_SNAPSHOT_LINE":
      return "Refaites un inventaire pour cette zone ou vérifiez la zone du produit.";
    case "FAMILY_MISMATCH":
      return "Des mouvements corrompus existent. Contactez un administrateur pour une réparation append-only.";
    case "INCOMPATIBLE_FAMILY_CHANGE":
      return "Reconfigurer le produit dans le Wizard puis refaire un inventaire.";
    case "MISSING_UNIT_INFO":
      return "Vérifiez la configuration des unités du produit dans le Wizard.";
    default:
      return "Contactez le support technique.";
  }
}

/** Short code badge text */
export function getErrorCodeLabel(code: StockEngineError["code"]): string {
  switch (code) {
    case "NO_ACTIVE_SNAPSHOT":
      return "NO_SNAPSHOT";
    case "NO_SNAPSHOT_LINE":
      return "ABSENT_INV";
    case "FAMILY_MISMATCH":
      return "FAMILY_ERR";
    case "INCOMPATIBLE_FAMILY_CHANGE":
      return "FAMILY_CHG";
    case "MISSING_UNIT_INFO":
      return "UNIT_ERR";
    default:
      return "ERR";
  }
}

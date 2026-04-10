/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MODULE ALERTES PRIX (V0) — Public API
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Isolé et supprimable : `rm -rf src/modules/priceAlerts`
 * Points de branchement : onglet Stock & Achat + paramètres établissement
 * ═══════════════════════════════════════════════════════════════════════════
 */

export { PriceAlertsList } from "./components/PriceAlertsList";
export { PriceAlertSettingsPanel } from "./components/PriceAlertSettingsPanel";
export { PriceChangePopup } from "./components/PriceChangePopup";
export { usePriceAlertsEnabled, useMarkAlertAcked, useFetchUnackedAlert } from "./hooks/usePriceAlerts";
export type { PriceAlert, PriceAlertSettings, PriceAlertFilter } from "./types";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MODULE RETOURS MARCHANDISE — Entry Point
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Module isolé de gestion des retours produit (qualité, DLC, erreur).
 * Séparé du module Litiges (quantités) par design.
 *
 * RULES:
 * - Module autonome (types + hooks + services + composants)
 * - Dépendances : supabase client, UI components, commandes/types (import léger)
 * - N'impacte PAS le stock, les litiges, ni les RPC commandes
 *
 * SUPPRESSION COMPLÈTE:
 * 1. Supprimer src/modules/retours/
 * 2. Retirer l'onglet "Retours" dans CommandesList.tsx
 * 3. Retirer le bouton "Signaler" dans ReceptionDialog / CommandeDetailDialog
 * 4. DROP TABLE product_return_photos; DROP TABLE product_returns;
 * 5. DROP TYPE return_type; DROP TYPE return_status; DROP TYPE return_resolution;
 * 6. Supprimer le bucket storage 'return-photos'
 */

export type {
  ProductReturn,
  ProductReturnPhoto,
  ReturnType,
  ReturnStatus,
  ReturnResolution,
} from "./types";

export {
  RETURN_TYPE_LABELS,
  RETURN_STATUS_LABELS,
  RETURN_RESOLUTION_LABELS,
} from "./types";

export { RetoursList } from "./components/RetoursList";
export { RetourDetailDialog } from "./components/RetourDetailDialog";
export { SignalerRetourDialog, type PendingReturnData } from "./components/SignalerRetourDialog";
export { SignalerProduitNonCommandeDialog } from "./components/SignalerProduitNonCommandeDialog";
export {
  useReturns,
  useReturnsForCommande,
  useCreateReturn,
  useResolveReturn,
} from "./hooks/useRetours";

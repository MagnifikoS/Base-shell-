/**
 * Litiges module — barrel export
 * Isolated, supprimable sans impact sur le module Commandes.
 */

export type { Litige, LitigeLine, LitigeWithLines, LitigeStatus } from "./types";
export { LitigeDetailDialog } from "./components/LitigeDetailDialog";
export { useLitigeForCommande, useLitigeDetail, useResolveLitige } from "./hooks/useLitiges";
export { useStaleLitiges } from "./hooks/useStaleLitiges";
export { computeEcart, type EcartType, type EcartResult } from "./utils/ecart";

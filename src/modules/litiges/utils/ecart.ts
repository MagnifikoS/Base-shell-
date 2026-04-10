/**
 * Ecart (delta) computation utility — SSOT for Manque/Surplus logic.
 * Used by ReceptionDialog, LitigeDetailDialog, and CommandesList.
 */

export type EcartType = "manque" | "surplus" | "ok";

export interface EcartResult {
  /** shipped - received (positive = manque, negative = surplus) */
  delta: number;
  /** Absolute value of delta */
  absDelta: number;
  type: EcartType;
}

/**
 * Compute the écart between shipped and received quantities.
 * Convention: delta = shipped - received
 *   positive → manquant (client received less)
 *   negative → surplus  (client received more)
 */
export function computeEcart(shipped: number, received: number): EcartResult {
  const delta = shipped - received;
  const absDelta = Math.abs(delta);
  const type: EcartType = delta > 0 ? "manque" : delta < 0 ? "surplus" : "ok";
  return { delta, absDelta, type };
}

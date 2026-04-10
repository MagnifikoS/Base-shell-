/**
 * ═══════════════════════════════════════════════════════════════════════════
 * WITHDRAWAL REASONS — Predefined motifs for stock withdrawals
 * ═══════════════════════════════════════════════════════════════════════════
 */

export const WITHDRAWAL_REASONS = [
  { value: "CONSUMPTION", label: "Consommation cuisine" },
  { value: "EXPIRY", label: "Péremption" },
] as const;

export type WithdrawalReasonCode = (typeof WITHDRAWAL_REASONS)[number]["value"];

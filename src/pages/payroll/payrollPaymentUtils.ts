/**
 * Payment status helpers — pure functions shared between PaymentPopover and PayrollTable.
 *
 * Extracted to a separate file to satisfy react-refresh (only-export-components rule).
 */

import type { PayrollValidationFlags } from "@/lib/payroll/payroll.compute";

type PaymentMode = "full" | "partial" | "unpaid";
type PaymentStatus = "paid" | "partial" | "unpaid";

/**
 * Determine the visual state for the payment badge.
 * - paid=false -> "unpaid"
 * - paid=true + amountPaid=null -> "full" (legacy or explicit full)
 * - paid=true + amountPaid >= totalAmount -> "full"
 * - paid=true + amountPaid > 0 && amountPaid < totalAmount -> "partial"
 */
export function getPaymentBadgeState(
  paid: boolean,
  amountPaid: number | null,
  totalAmount: number
): PaymentMode {
  if (!paid) return "unpaid";
  if (amountPaid === null) return "full";
  if (amountPaid >= totalAmount) return "full";
  return "partial";
}

/**
 * Determine overall row payment status, accounting for partial amounts.
 *
 * - Both net AND cash fully paid -> "paid"
 * - Any partial amount or one channel unpaid -> "partial"
 * - Nothing paid -> "unpaid"
 */
export function getPaymentStatus(
  flags: PayrollValidationFlags | undefined,
  hasCash: boolean,
  netTotal: number,
  cashTotal: number
): PaymentStatus {
  const netPaid = flags?.netPaid ?? false;
  const cashPaid = flags?.cashPaid ?? false;

  const netState = getPaymentBadgeState(netPaid, flags?.netAmountPaid ?? null, netTotal);
  const cashState = hasCash
    ? getPaymentBadgeState(cashPaid, flags?.cashAmountPaid ?? null, cashTotal)
    : "full"; // No cash means that channel is "done"

  if (netState === "full" && cashState === "full") return "paid";
  if (netState === "unpaid" && cashState === "unpaid") return "unpaid";
  if (netState === "unpaid" && !hasCash) return "unpaid";
  return "partial";
}

/**
 * Compute the remaining amount for a single payment channel.
 *
 * Rules:
 * - paid=false -> remaining = totalAmount (nothing paid)
 * - paid=true + amountPaid=null -> remaining = 0 (fully paid / legacy)
 * - paid=true + amountPaid >= total -> remaining = 0
 * - paid=true + amountPaid < total -> remaining = totalAmount - amountPaid
 */
export function computeRemainingForChannel(
  paid: boolean,
  amountPaid: number | null,
  totalAmount: number
): { remaining: number; paidAmount: number } {
  if (!paid) {
    return { remaining: totalAmount, paidAmount: 0 };
  }
  // paid=true
  if (amountPaid === null) {
    // Legacy or explicit full payment
    return { remaining: 0, paidAmount: totalAmount };
  }
  if (amountPaid >= totalAmount) {
    return { remaining: 0, paidAmount: totalAmount };
  }
  return { remaining: totalAmount - amountPaid, paidAmount: amountPaid };
}

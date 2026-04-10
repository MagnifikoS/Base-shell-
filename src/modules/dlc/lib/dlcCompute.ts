/**
 * DLC V1 — Pure computation logic (SSOT).
 * Used by: DlcBadge, DlcReceptionSummaryDialog, DlcCritiquePage, notifications.
 * No React, no side effects, no imports beyond types.
 *
 * THRESHOLD RESOLUTION PRIORITY (SSOT):
 * 1. Product-level (products_v2.dlc_warning_days)
 * 2. Category-level (dlc_alert_settings.category_thresholds[categoryId])
 * 3. Establishment-level (dlc_alert_settings.default_warning_days)
 * 4. Hardcoded fallback (DLC_DEFAULT_WARNING_DAYS = 3)
 */

import type { DlcStatus } from "../types";
import { DLC_DEFAULT_WARNING_DAYS } from "../types";

/** Context needed to resolve the effective warning days for a product */
export interface DlcThresholdContext {
  /** Product-level override (products_v2.dlc_warning_days) */
  productWarningDays?: number | null;
  /** Product category ID (products_v2.category_id) */
  categoryId?: string | null;
  /** Category-level thresholds map: categoryId → days */
  categoryThresholds?: Record<string, number>;
  /** Establishment-level default */
  establishmentDefaultDays?: number | null;
}

/**
 * Resolve the effective DLC warning days using the priority chain:
 * Product > Category > Establishment > Fallback
 *
 * This is the SINGLE SOURCE OF TRUTH for threshold resolution.
 * No other module should compute this.
 */
export function resolveDlcWarningDays(ctx: DlcThresholdContext): number {
  // 1. Product-level
  if (ctx.productWarningDays != null && ctx.productWarningDays >= 0) {
    return ctx.productWarningDays;
  }

  // 2. Category-level
  if (ctx.categoryId && ctx.categoryThresholds) {
    const catDays = ctx.categoryThresholds[ctx.categoryId];
    if (catDays != null && catDays >= 0) {
      return catDays;
    }
  }

  // 3. Establishment-level
  if (ctx.establishmentDefaultDays != null && ctx.establishmentDefaultDays >= 0) {
    return ctx.establishmentDefaultDays;
  }

  // 4. Hardcoded fallback
  return DLC_DEFAULT_WARNING_DAYS;
}

/**
 * Compute the DLC status for a given date.
 * @param dlcDate  ISO date string (YYYY-MM-DD)
 * @param warningDays  Resolved threshold (use resolveDlcWarningDays for full resolution)
 * @returns DlcStatus: "ok" | "warning" | "expired"
 */
export function computeDlcStatus(
  dlcDate: string,
  warningDays: number | null | undefined
): DlcStatus {
  const threshold = warningDays ?? DLC_DEFAULT_WARNING_DAYS;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dlc = new Date(dlcDate + "T00:00:00");
  const diffMs = dlc.getTime() - today.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return "expired";
  if (diffDays <= threshold) return "warning";
  return "ok";
}

/**
 * Compute days remaining until DLC expiry.
 * Negative = already expired by N days.
 */
export function computeDlcDaysRemaining(dlcDate: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dlc = new Date(dlcDate + "T00:00:00");
  return Math.ceil((dlc.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Format an ISO date (YYYY-MM-DD) to French display (DD/MM/YYYY).
 */
export function formatDlcDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/**
 * Sort comparator: expired first, then warning (most urgent first), then ok.
 * Within same status, closest DLC date first.
 */
export function dlcUrgencyComparator(
  a: { dlcDate: string; warningDays?: number | null },
  b: { dlcDate: string; warningDays?: number | null }
): number {
  const statusOrder: Record<DlcStatus, number> = { expired: 0, warning: 1, ok: 2 };
  const statusA = computeDlcStatus(a.dlcDate, a.warningDays);
  const statusB = computeDlcStatus(b.dlcDate, b.warningDays);

  if (statusOrder[statusA] !== statusOrder[statusB]) {
    return statusOrder[statusA] - statusOrder[statusB];
  }
  // Same status: closest DLC first
  return a.dlcDate.localeCompare(b.dlcDate);
}

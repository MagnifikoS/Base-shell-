/**
 * DLC V0 — Visual badge showing DLC status (green/orange/red).
 * Pure presentational component — no side effects.
 * Computation logic delegated to dlcCompute.ts (SSOT).
 */

import { Badge } from "@/components/ui/badge";
import { CalendarClock } from "lucide-react";
import type { DlcStatus } from "../types";
import { computeDlcStatus, formatDlcDate } from "../lib/dlcCompute";

// Re-export for backward compatibility (external consumers)
export { computeDlcStatus } from "../lib/dlcCompute";

interface DlcBadgeProps {
  /** DLC date as ISO string (YYYY-MM-DD) or null if not set */
  dlcDate: string | null;
  /** Product-level warning threshold (days), falls back to DLC_DEFAULT_WARNING_DAYS */
  warningDays?: number | null;
  /** Show "À compléter" when no DLC set */
  showMissing?: boolean;
  /** Optional click handler */
  onClick?: () => void;
}

const STATUS_STYLES: Record<DlcStatus, string> = {
  ok: "bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-200",
  warning: "bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-200",
  expired: "bg-red-100 text-red-700 border-red-200 hover:bg-red-200",
};

const STATUS_LABELS: Record<DlcStatus, string> = {
  ok: "DLC OK",
  warning: "DLC proche",
  expired: "DLC dépassée",
};

export function DlcBadge({ dlcDate, warningDays, showMissing = false, onClick }: DlcBadgeProps) {
  if (!dlcDate) {
    if (!showMissing) return null;
    return (
      <Badge
        variant="outline"
        className="text-[10px] gap-1 cursor-pointer border-dashed border-amber-300 text-amber-600 hover:bg-amber-50"
        onClick={onClick}
      >
        <CalendarClock className="h-3 w-3" />
        À compléter
      </Badge>
    );
  }

  const status = computeDlcStatus(dlcDate, warningDays);

  return (
    <Badge
      variant="outline"
      className={`text-[10px] gap-1 border ${STATUS_STYLES[status]} ${onClick ? "cursor-pointer" : ""}`}
      onClick={onClick}
    >
      <CalendarClock className="h-3 w-3" />
      {STATUS_LABELS[status]} · {formatDlcDate(dlcDate)}
    </Badge>
  );
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * WITHDRAWAL HISTORY VIEW — Read-only, grouped by day, navigable by month
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Displays operational withdrawals from stock_events.
 * No actions, no editing, no stock recalculation.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useState } from "react";
import { Package, Loader2 } from "lucide-react";
import { formatQtyDisplay } from "@/modules/inventaire/components/inventoryDisplayUtils";
import { MonthSelector } from "@/components/shared/MonthSelector";
import {
  getCurrentMonth,
  toYearMonthString,
  type MonthNavigation,
} from "@/modules/shared/monthNavigation";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import {
  useWithdrawalHistory,
  type WithdrawalDayGroup,
  type WithdrawalHistoryEntry,
} from "../hooks/useWithdrawalHistory";

/** Format "2026-03-10" → "Lundi 10 mars" */
function formatDayLabel(dateStr: string): string {
  const date = new Date(dateStr + "T12:00:00"); // noon to avoid TZ issues
  return date.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

/** Format ISO timestamp → "10:42" */
function formatTime(isoStr: string): string {
  const date = new Date(isoStr);
  return date.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Paris",
  });
}

function DayGroup({ group }: { group: WithdrawalDayGroup }) {
  return (
    <div className="mb-4">
      <h3 className="text-sm font-semibold text-muted-foreground capitalize mb-2 px-1">
        {formatDayLabel(group.date)}
      </h3>
      <div className="space-y-1">
        {group.entries.map((entry) => (
          <HistoryRow key={entry.id} entry={entry} />
        ))}
      </div>
    </div>
  );
}

function HistoryRow({ entry }: { entry: WithdrawalHistoryEntry }) {
  return (
    <div className="flex items-center justify-between bg-card rounded-lg px-3 py-2.5 border">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{entry.product_name}</p>
        <p className="text-xs text-muted-foreground">
          {formatQtyDisplay(entry.quantity)} {entry.unit_name}
          {" — "}
          <span className="font-medium">{entry.author_name}</span>
          {" — "}
          {formatTime(entry.posted_at)}
        </p>
      </div>
    </div>
  );
}

export function WithdrawalHistoryView() {
  const { activeEstablishment } = useEstablishment();
  const estId = activeEstablishment?.id ?? null;

  const [currentMonth, setCurrentMonth] = useState<MonthNavigation>(getCurrentMonth);
  const yearMonth = toYearMonthString(currentMonth);

  const { data: groups = [], isLoading } = useWithdrawalHistory(estId, yearMonth);

  return (
    <div className="flex flex-col h-full">
      {/* Month navigation */}
      <div className="flex justify-center py-3">
        <MonthSelector value={currentMonth} onChange={setCurrentMonth} />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-3 pb-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Package className="h-10 w-10 mb-3 opacity-40" />
            <p className="text-sm">Aucun retrait ce mois</p>
          </div>
        ) : (
          groups.map((group) => <DayGroup key={group.date} group={group} />)
        )}
      </div>
    </div>
  );
}

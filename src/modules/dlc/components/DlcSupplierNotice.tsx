/**
 * DLC V0 — Disabled notice shown on the supplier side.
 * The supplier cannot enter DLC — it's done at reception by the restaurant.
 */

import { CalendarClock } from "lucide-react";

export function DlcSupplierNotice() {
  return (
    <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-muted/50 border border-border text-xs text-muted-foreground">
      <CalendarClock className="h-4 w-4 shrink-0 opacity-50" />
      <span>La DLC est renseignée lors de la réception par le restaurant.</span>
    </div>
  );
}

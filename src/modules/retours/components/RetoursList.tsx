/**
 * RetoursList — Shows product returns for the current establishment.
 * Used inside the CommandesList "Retours" tab.
 */

import { useState } from "react";
import { useReturns } from "../hooks/useRetours";
import { RetourDetailDialog } from "./RetourDetailDialog";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import {
  RETURN_TYPE_LABELS,
  RETURN_STATUS_LABELS,
} from "../types";
import type { ProductReturn } from "../types";
import {
  Clock,
  CheckCircle2,
  XCircle,
  Inbox,
  Loader2,
  RotateCcw,
} from "lucide-react";
import { formatParisHHMM } from "@/lib/time/paris";
import { formatParisDateKey } from "@/lib/time/dateKeyParis";

interface Props {
  establishmentNames: Record<string, string>;
}

function fmtDate(iso: string): string {
  const dateKey = formatParisDateKey(new Date(iso));
  const [, mm, dd] = dateKey.split("-");
  return `${dd}/${mm} · ${formatParisHHMM(iso)}`;
}

const STATUS_ICON: Record<string, typeof Clock> = {
  pending: Clock,
  accepted: CheckCircle2,
  refused: XCircle,
};

const STATUS_COLOR: Record<string, string> = {
  pending: "text-amber-500",
  accepted: "text-emerald-500",
  refused: "text-red-500",
};

export function RetoursList({ establishmentNames }: Props) {
  const { activeEstablishment } = useEstablishment();
  const estId = activeEstablishment?.id;
  const { data: returns, isLoading } = useReturns();
  const [selected, setSelected] = useState<ProductReturn | null>(null);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!returns || returns.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 sm:py-16 text-muted-foreground">
        <Inbox className="h-10 w-10 sm:h-12 sm:w-12 mb-3 opacity-40" />
        <p className="font-medium text-sm sm:text-base">Aucun retour</p>
        <p className="text-xs sm:text-sm mt-1">Les retours produit apparaîtront ici</p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-2">
        {returns.map((r) => {
          const isClient = r.client_establishment_id === estId;
          const partnerName = isClient
            ? establishmentNames[r.supplier_establishment_id] || "Fournisseur"
            : establishmentNames[r.client_establishment_id] || "Client";

          const Icon = STATUS_ICON[r.status] ?? Clock;
          const color = STATUS_COLOR[r.status] ?? "text-muted-foreground";

          return (
            <div
              key={r.id}
              className="flex items-center justify-between p-3 sm:p-4 rounded-lg border bg-card hover:bg-accent/50 cursor-pointer transition-colors active:scale-[0.99]"
              onClick={() => setSelected(r)}
            >
              <div className="flex-1 min-w-0 mr-2">
                <div className="flex items-center gap-2 mb-0.5">
                  <RotateCcw className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="font-medium text-sm truncate">
                    {r.product_name_snapshot}
                  </span>
                </div>
                <div className="text-[11px] sm:text-xs text-muted-foreground space-y-0.5">
                  <p className="truncate">
                    {RETURN_TYPE_LABELS[r.return_type]} · {partnerName}
                  </p>
                  <p className="truncate">{fmtDate(r.created_at)}</p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <span className={`flex items-center gap-1 text-xs font-medium ${color}`}>
                  <Icon className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{RETURN_STATUS_LABELS[r.status]}</span>
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {selected && (
        <RetourDetailDialog
          open={!!selected}
          onClose={() => setSelected(null)}
          productReturn={selected}
          establishmentNames={establishmentNames}
        />
      )}
    </>
  );
}

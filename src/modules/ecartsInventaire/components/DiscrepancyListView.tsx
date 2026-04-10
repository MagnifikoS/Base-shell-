/**
 * ═══════════════════════════════════════════════════════════════
 * DiscrepancyListView — List of inventory discrepancies
 * ═══════════════════════════════════════════════════════════════
 */

import { useState } from "react";
import { useDiscrepancies } from "../hooks/useDiscrepancies";
import { DiscrepancyDetailDrawer } from "./DiscrepancyDetailDrawer";
import type { DiscrepancyWithDetails } from "../types";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

const STATUS_LABELS: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
  open: { label: "Ouvert", variant: "default" },
  analyzed: { label: "Analysé", variant: "secondary" },
  closed: { label: "Clos", variant: "outline" },
};

export function DiscrepancyListView() {
  const { data: discrepancies, isLoading } = useDiscrepancies();
  const [selected, setSelected] = useState<DiscrepancyWithDetails | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const filtered = (discrepancies ?? []).filter((d) => {
    if (statusFilter !== "all" && d.status !== statusFilter) return false;
    if (search) {
      const term = search.toLowerCase();
      return d.product_name.toLowerCase().includes(term);
    }
    return true;
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Rechercher un produit…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-1.5">
          {[
            { key: "all", label: "Tous" },
            { key: "open", label: "Ouverts" },
            { key: "analyzed", label: "Analysés" },
            { key: "closed", label: "Clos" },
          ].map((f) => (
            <button
              key={f.key}
              onClick={() => setStatusFilter(f.key)}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                statusFilter === f.key
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-accent"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Empty state */}
      {filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
          <AlertTriangle className="h-10 w-10" />
          <p className="text-sm">
            {discrepancies?.length === 0
              ? "Aucun écart détecté. Tout est en ordre !"
              : "Aucun écart ne correspond à votre recherche."}
          </p>
        </div>
      )}

      {/* List */}
      <div className="space-y-2">
        {filtered.map((d) => {
          const st = STATUS_LABELS[d.status] ?? STATUS_LABELS.open;
          return (
            <button
              key={d.id}
              onClick={() => setSelected(d)}
              className="w-full text-left p-4 bg-card border border-border rounded-lg hover:bg-accent/50 transition-colors"
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground truncate">
                      {d.product_name}
                    </span>
                    <Badge variant={st.variant} className="text-xs shrink-0">
                      {st.label}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                    <span className="text-destructive font-medium">
                      écart {d.gap_quantity} {d.unit_label ?? ""}
                    </span>
                    {d.zone_name && <span>— {d.zone_name}</span>}
                    <span>
                      {format(new Date(d.withdrawn_at), "dd/MM HH:mm", { locale: fr })}
                    </span>
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Detail drawer */}
      <DiscrepancyDetailDrawer
        discrepancy={selected}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}

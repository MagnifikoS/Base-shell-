import { useState } from "react";
import { ChevronDown, ChevronUp, CheckCircle2, XCircle, Clock, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { ScanRun } from "../../types/scanHistory";

interface ScanRunCardProps {
  run: ScanRun;
  index: number;
  isSelected?: boolean;
  onToggleSelect?: (runId: string) => void;
  comparisonMode?: boolean;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(ms: number | null): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function ScanRunCard({
  run,
  index,
  isSelected,
  onToggleSelect,
  comparisonMode,
}: ScanRunCardProps) {
  const [expanded, setExpanded] = useState(false);
  const isSuccess = run.status === "success";

  return (
    <div
      className={`rounded-lg border transition-all ${
        isSelected ? "border-primary bg-primary/5" : "border-border/50"
      }`}
    >
      {/* Header */}
      <div className="flex items-center gap-3 p-3">
        {/* Status icon */}
        {isSuccess ? (
          <CheckCircle2 className="h-4 w-4 text-green-500 dark:text-green-400 flex-shrink-0" />
        ) : (
          <XCircle className="h-4 w-4 text-destructive flex-shrink-0" />
        )}

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Scan #{index + 1}</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
            <span>{formatDate(run.created_at)}</span>
            {run.duration_ms && (
              <>
                <span className="text-border">|</span>
                <Clock className="h-3 w-3" />
                <span>{formatDuration(run.duration_ms)}</span>
              </>
            )}
            {isSuccess && (
              <>
                <span className="text-border">|</span>
                <Package className="h-3 w-3" />
                <span>{run.items_count} produits</span>
              </>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1">
          {comparisonMode && onToggleSelect && (
            <Button
              variant={isSelected ? "default" : "outline"}
              size="sm"
              className="h-7 text-xs"
              onClick={() => onToggleSelect(run.id)}
            >
              {isSelected ? "Sélectionné" : "Comparer"}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="px-3 pb-3">
          <Separator className="mb-3" />

          {run.error_message && (
            <div className="text-sm text-destructive bg-destructive/10 p-2 rounded mb-3">
              {run.error_message}
            </div>
          )}

          {/* Invoice data */}
          {run.result_invoice && (
            <div className="mb-3">
              <h4 className="text-xs font-medium text-muted-foreground mb-1.5">Facture</h4>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-xs text-muted-foreground">Fournisseur</span>
                  <p className="font-medium truncate">{run.result_invoice.supplier_name || "—"}</p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Numéro</span>
                  <p className="font-medium truncate">{run.result_invoice.invoice_number || "—"}</p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Date</span>
                  <p className="font-medium">{run.result_invoice.invoice_date || "—"}</p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Total TTC</span>
                  <p className="font-medium">
                    {run.result_invoice.invoice_total != null
                      ? `${run.result_invoice.invoice_total.toFixed(2)} €`
                      : "—"}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Items table */}
          {run.result_items && run.result_items.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-muted-foreground mb-1.5">
                Produits ({run.result_items.length})
              </h4>
              <div className="rounded border border-border/50 overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted/30">
                      <th className="text-left px-2 py-1.5 font-medium">Produit</th>
                      <th className="text-right px-2 py-1.5 font-medium w-16">Qté</th>
                      <th className="text-right px-2 py-1.5 font-medium w-20">Montant</th>
                    </tr>
                  </thead>
                  <tbody>
                    {run.result_items.map((item, i) => (
                      <tr key={i} className="border-t border-border/30">
                        <td className="px-2 py-1.5 truncate max-w-[200px]">
                          {item.nom_produit_complet}
                        </td>
                        <td className="text-right px-2 py-1.5 text-muted-foreground">
                          {item.quantite_commandee ?? "—"}
                        </td>
                        <td className="text-right px-2 py-1.5">
                          {item.prix_total_ligne != null
                            ? `${item.prix_total_ligne.toFixed(2)} €`
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Insights */}
          {run.result_insights && run.result_insights.length > 0 && (
            <div className="mt-3">
              <h4 className="text-xs font-medium text-muted-foreground mb-1.5">
                Insights ({run.result_insights.length})
              </h4>
              <div className="space-y-1">
                {run.result_insights.map((insight, i) => (
                  <div key={i} className="flex items-baseline gap-2 text-xs">
                    <span className="text-muted-foreground">{insight.label}:</span>
                    <span className="font-medium">{insight.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

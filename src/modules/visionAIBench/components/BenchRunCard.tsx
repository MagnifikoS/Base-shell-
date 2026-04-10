import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BenchMetricsBadge } from "./BenchMetricsBadge";
import { scoreRating } from "../lib/scoring";
import type { BenchRun, BenchScore } from "../types";
import { Loader2, AlertCircle, CheckCircle2, ChevronDown, ChevronRight } from "lucide-react";

interface BenchRunCardProps {
  run: BenchRun;
  score?: BenchScore | null;
  isReference?: boolean;
}

export function BenchRunCard({ run, score, isReference }: BenchRunCardProps) {
  const inv = run.result_invoice;
  const items = run.result_items || [];
  const insights = run.result_insights || [];
  const [detailsOpen, setDetailsOpen] = useState(false);

  const hasScoreDetails =
    score &&
    (score.missedItems.length > 0 || score.extraItems.length > 0 || score.priceDiffs.length > 0);

  return (
    <Card className={`flex-1 min-w-[350px] ${isReference ? "ring-2 ring-blue-500" : ""}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm font-medium">{run.model_label}</CardTitle>
            {isReference && (
              <Badge
                variant="outline"
                className="text-[10px] border-blue-500 dark:border-blue-600 text-blue-600 dark:text-blue-400"
              >
                REF
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {score && !isReference && <ScoreBadge score={score.overall} />}
            <StatusBadge status={run.status} />
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{run.source === "auto-capture" ? "Auto" : "Manuel"}</span>
          <span>·</span>
          <span>{new Date(run.created_at).toLocaleString("fr-FR")}</span>
        </div>
        {run.status === "success" && <BenchMetricsBadge run={run} />}
      </CardHeader>
      <CardContent className="space-y-4">
        {run.status === "running" && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Extraction en cours...
          </div>
        )}

        {run.status === "error" && (
          <div className="flex items-start gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{run.error_message || "Erreur inconnue"}</span>
          </div>
        )}

        {run.status === "success" && inv && (
          <>
            {/* Score breakdown */}
            {score && !isReference && (
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <span className="text-muted-foreground">Facture</span>
                <span className="tabular-nums font-medium">{score.invoice}/100</span>
                <span className="text-muted-foreground">Items (F1)</span>
                <span className="tabular-nums font-medium">{score.items}/100</span>
                <span className="text-muted-foreground pl-2">Recall</span>
                <span className="tabular-nums text-muted-foreground">{score.itemsRecall}%</span>
                <span className="text-muted-foreground pl-2">Precision</span>
                <span className="tabular-nums text-muted-foreground">{score.itemsPrecision}%</span>
                <span className="text-muted-foreground">Insights</span>
                <span className="tabular-nums font-medium">{score.insights}/100</span>
                <span className="text-muted-foreground">Performance</span>
                <span className="tabular-nums font-medium">{score.performance}/100</span>
              </div>
            )}

            {/* Missed / Extra items details */}
            {hasScoreDetails && (
              <div>
                <button
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setDetailsOpen(!detailsOpen)}
                >
                  {detailsOpen ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                  {score.missedItems.length} manqué(s) · {score.extraItems.length} extra(s) ·{" "}
                  {score.priceDiffs.length} diff prix
                </button>
                {detailsOpen && (
                  <div className="mt-2 space-y-2 text-xs">
                    {score.missedItems.length > 0 && (
                      <div>
                        <p className="font-medium text-red-600 dark:text-red-400">Items manqués</p>
                        <ul className="list-disc pl-4 text-red-600 dark:text-red-400/80">
                          {score.missedItems.map((name, i) => (
                            <li key={i}>{name}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {score.extraItems.length > 0 && (
                      <div>
                        <p className="font-medium text-orange-600 dark:text-orange-400">
                          Items en trop (hallucinations?)
                        </p>
                        <ul className="list-disc pl-4 text-orange-600 dark:text-orange-400/80">
                          {score.extraItems.map((name, i) => (
                            <li key={i}>{name}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {score.priceDiffs.length > 0 && (
                      <div>
                        <p className="font-medium text-yellow-600 dark:text-yellow-400">
                          Différences de prix
                        </p>
                        <ul className="list-disc pl-4 text-yellow-600 dark:text-yellow-400/80">
                          {score.priceDiffs.map((d, i) => (
                            <li key={i}>
                              {d.name}: attendu {d.expected.toFixed(2)}€, obtenu {d.got.toFixed(2)}€
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Invoice summary */}
            <div className="space-y-1 text-sm">
              <p>
                <span className="text-muted-foreground">Fournisseur:</span>{" "}
                {inv.supplier_name || "—"}
              </p>
              <p>
                <span className="text-muted-foreground">N° Facture:</span>{" "}
                {inv.invoice_number || "—"}
              </p>
              <p>
                <span className="text-muted-foreground">Date:</span> {inv.invoice_date || "—"}
              </p>
              <p>
                <span className="text-muted-foreground">Total TTC:</span>{" "}
                {inv.invoice_total != null ? `${inv.invoice_total.toFixed(2)} €` : "—"}
              </p>
            </div>

            {/* Items table */}
            {items.length > 0 && (
              <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8">#</TableHead>
                      <TableHead>Produit</TableHead>
                      <TableHead className="text-right">Qté</TableHead>
                      <TableHead className="text-right">Prix</TableHead>
                      <TableHead>Unité</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="text-muted-foreground text-xs">{idx + 1}</TableCell>
                        <TableCell className="text-sm">{item.nom_produit_complet}</TableCell>
                        <TableCell className="text-right tabular-nums text-sm">
                          {item.quantite_commandee ?? "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm">
                          {item.prix_total_ligne != null
                            ? `${item.prix_total_ligne.toFixed(2)} €`
                            : "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {item.contenu_facture || "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {/* Insights */}
            {insights.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Insights</p>
                {insights.map((ins, idx) => (
                  <p key={idx} className="text-xs">
                    <span className="font-medium">{ins.label}:</span> {ins.value}
                  </p>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: BenchRun["status"] }) {
  switch (status) {
    case "success":
      return (
        <Badge variant="default" className="gap-1 bg-green-600 dark:bg-green-700">
          <CheckCircle2 className="h-3 w-3" />
          OK
        </Badge>
      );
    case "error":
      return (
        <Badge variant="destructive" className="gap-1">
          <AlertCircle className="h-3 w-3" />
          Erreur
        </Badge>
      );
    case "running":
      return (
        <Badge variant="secondary" className="gap-1">
          <Loader2 className="h-3 w-3 animate-spin" />
          En cours
        </Badge>
      );
    default:
      return <Badge variant="outline">En attente</Badge>;
  }
}

function ScoreBadge({ score }: { score: number }) {
  const { label, className } = scoreRating(score);
  return (
    <Badge className={`text-[10px] ${className}`}>
      {score} — {label}
    </Badge>
  );
}

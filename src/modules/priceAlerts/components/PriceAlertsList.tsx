/**
 * Module Alertes Prix V0 — Liste des alertes
 */
import { useState, useMemo } from "react";
import { ArrowUp, ArrowDown, Eye, CheckCheck, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePriceAlerts, useMarkAlertSeen, useMarkAllAlertsSeen } from "../hooks/usePriceAlerts";
import type { PriceAlert, PriceAlertFilter } from "../types";

interface Props {
  establishmentId: string;
}

export function PriceAlertsList({ establishmentId }: Props) {
  const { data: alerts = [], isLoading } = usePriceAlerts(establishmentId);
  const markSeen = useMarkAlertSeen(establishmentId);
  const markAllSeen = useMarkAllAlertsSeen(establishmentId);
  const [filter, setFilter] = useState<PriceAlertFilter>("all");

  const filtered = useMemo(() => {
    switch (filter) {
      case "up":
        return alerts.filter((a) => a.variation_pct > 0);
      case "down":
        return alerts.filter((a) => a.variation_pct < 0);
      case "threshold":
        return alerts.filter((a) => !a.seen_at);
      default:
        return alerts;
    }
  }, [alerts, filter]);

  const unseenCount = alerts.filter((a) => !a.seen_at).length;

  if (isLoading) {
    return <div className="p-6 text-muted-foreground">Chargement des alertes…</div>;
  }

  if (alerts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
        <AlertTriangle className="h-10 w-10 opacity-40" />
        <p className="text-sm">Aucune alerte de variation de prix pour le moment.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters + bulk action */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-2">
          {(
            [
              ["all", "Toutes"],
              ["up", "Hausse ↑"],
              ["down", "Baisse ↓"],
              ["threshold", "Non vues"],
            ] as [PriceAlertFilter, string][]
          ).map(([key, label]) => (
            <Button
              key={key}
              size="sm"
              variant={filter === key ? "default" : "outline"}
              onClick={() => setFilter(key)}
            >
              {label}
              {key === "threshold" && unseenCount > 0 && (
                <Badge variant="destructive" className="ml-1.5 px-1.5 py-0 text-xs">
                  {unseenCount}
                </Badge>
              )}
            </Button>
          ))}
        </div>

        {unseenCount > 0 && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => markAllSeen.mutate()}
            disabled={markAllSeen.isPending}
          >
            <CheckCheck className="h-4 w-4 mr-1" />
            Tout marquer vu
          </Button>
        )}
      </div>

      {/* Table */}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Produit</TableHead>
            <TableHead>Fournisseur</TableHead>
            <TableHead>Catégorie</TableHead>
            <TableHead className="text-right">Ancien prix</TableHead>
            <TableHead className="text-right">Nouveau prix</TableHead>
            <TableHead className="text-right">Variation</TableHead>
            <TableHead>Date</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((alert) => (
            <AlertRow
              key={alert.id}
              alert={alert}
              onMarkSeen={() => markSeen.mutate(alert.id)}
              isPending={markSeen.isPending}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function AlertRow({
  alert,
  onMarkSeen,
  isPending,
}: {
  alert: PriceAlert;
  onMarkSeen: () => void;
  isPending: boolean;
}) {
  const isUp = alert.variation_pct > 0;
  const isSeen = !!alert.seen_at;

  return (
    <TableRow className={isSeen ? "opacity-60" : ""}>
      <TableCell className="font-medium">{alert.product_name}</TableCell>
      <TableCell>{alert.supplier_name}</TableCell>
      <TableCell>
        {alert.category ? (
          <Badge variant="secondary" className="text-xs">
            {alert.category}
          </Badge>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        )}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {alert.old_price.toFixed(2)} €
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {alert.new_price.toFixed(2)} €
      </TableCell>
      <TableCell className="text-right">
        <span
          className={`inline-flex items-center gap-1 font-semibold tabular-nums ${
            isUp ? "text-destructive" : "text-emerald-600"
          }`}
        >
          {isUp ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />}
          {Math.abs(alert.variation_pct).toFixed(1)}%
        </span>
      </TableCell>
      <TableCell className="text-muted-foreground text-sm">
        {new Date(alert.day_date).toLocaleDateString("fr-FR")}
      </TableCell>
      <TableCell>
        {!isSeen && (
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={onMarkSeen}
            disabled={isPending}
            title="Marquer comme vu"
          >
            <Eye className="h-4 w-4" />
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}

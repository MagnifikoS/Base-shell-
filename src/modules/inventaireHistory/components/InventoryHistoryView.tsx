/**
 * ═══════════════════════════════════════════════════════════════════════════
 * INVENTORY HISTORY VIEW — Sous-onglet "Historique" de la page Inventaire
 * Une ligne par événement d'inventaire (groupement par minute de clôture).
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useState } from "react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { ChevronRight, AlertTriangle, ArrowLeft, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useInventoryHistoryList } from "../hooks/useInventoryHistoryList";
import { useInventoryVarianceDetail } from "../hooks/useInventoryVarianceDetail";
import type { InventoryEventGroup } from "../engine/inventoryHistoryVarianceEngine";

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return format(new Date(iso), "dd/MM/yyyy HH:mm", { locale: fr });
}

function formatDateOnly(iso: string) {
  return format(new Date(iso), "dd/MM/yyyy", { locale: fr });
}

function formatEur(v: number | null) {
  if (v === null) return <span className="text-muted-foreground tabular-nums">N/A</span>;
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : v > 0 ? "+" : "";
  const color = v < 0 ? "text-destructive" : v > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground";
  return <span className={`tabular-nums font-medium ${color}`}>{sign}{abs.toFixed(2)} €</span>;
}

function formatVariance(v: number) {
  const sign = v > 0 ? "+" : "";
  const color = v < 0 ? "text-destructive" : v > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground";
  return <span className={`tabular-nums font-mono text-sm ${color}`}>{sign}{v.toFixed(3)}</span>;
}

// ─────────────────────────────────────────────────────────────────────────────
// DETAIL VIEW
// ─────────────────────────────────────────────────────────────────────────────

function VarianceDetailView({
  group,
  onBack,
}: {
  group: InventoryEventGroup;
  onBack: () => void;
}) {
  const { data, isLoading, error } = useInventoryVarianceDetail(group.session_ids);

  // Premier inventaire pour toutes les zones : en attente du prochain
  if (!group.has_previous_snapshot) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-2">
          <ArrowLeft className="h-4 w-4" /> Retour à l'historique
        </Button>
        <div className="rounded-lg border bg-muted/20 p-8 flex flex-col items-center gap-3 text-center">
          <Clock className="h-10 w-10 text-muted-foreground/50" />
          <p className="font-semibold text-foreground">En attente du prochain inventaire</p>
          <p className="text-sm text-muted-foreground max-w-md">
            C'est le premier inventaire enregistré. Les écarts de comptage seront calculés
            automatiquement lors du prochain inventaire.
          </p>
          <div className="mt-2 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{group.total_counted}</span> produits comptés le {formatDate(group.completed_at)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-2">
          <ArrowLeft className="h-4 w-4" /> Retour à l'historique
        </Button>
        <div className="text-right">
          <p className="font-semibold">Inventaire du {formatDate(group.completed_at)}</p>
          <p className="text-xs text-muted-foreground">{group.sessions.length} zone{group.sessions.length > 1 ? "s" : ""} · {group.total_counted} produits comptés</p>
        </div>
      </div>

      {isLoading && (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>Erreur lors du calcul des écarts.</AlertDescription>
        </Alert>
      )}

      {data && data.lines.length === 0 && (
        <div className="rounded-lg border bg-muted/20 p-12 flex flex-col items-center gap-2 text-center">
          <p className="text-lg font-medium text-foreground">✓ Aucun écart détecté</p>
          <p className="text-sm text-muted-foreground">
            Tous les {group.total_counted} produits comptés correspondent au stock estimé.
          </p>
        </div>
      )}

      {data && data.lines.length > 0 && (
        <>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{data.lines.length}</span> produit{data.lines.length > 1 ? "s" : ""} avec écart
          </p>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produit</TableHead>
                  <TableHead>Zone</TableHead>
                  <TableHead className="text-right">Estimé avant</TableHead>
                  <TableHead className="text-right">Compté</TableHead>
                  <TableHead className="text-right">Écart</TableHead>
                  <TableHead>Unité</TableHead>
                  <TableHead className="text-right">Impact €</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.lines.map((line, i) => (
                  <TableRow key={`${line.product_id}-${i}`}>
                    <TableCell className="font-medium uppercase">{line.nom_produit}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{line.zone_name}</TableCell>
                    <TableCell className="text-right tabular-nums font-mono text-sm text-muted-foreground">
                      {line.estimated_before.toFixed(3)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-mono text-sm">
                      {line.counted.toFixed(3)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatVariance(line.variance)}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">{line.unit_label}</TableCell>
                    <TableCell className="text-right">{formatEur(line.variance_eur)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN LIST VIEW
// ─────────────────────────────────────────────────────────────────────────────

export function InventoryHistoryView() {
  const { data: groups, isLoading, error } = useInventoryHistoryList();
  const [selectedGroup, setSelectedGroup] = useState<InventoryEventGroup | null>(null);

  if (isLoading) {
    return (
      <div className="space-y-3 p-4">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive" className="m-4">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>Erreur lors du chargement de l'historique.</AlertDescription>
      </Alert>
    );
  }

  if (!groups || groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground gap-2">
        <p className="text-lg font-medium">Aucun inventaire terminé</p>
        <p className="text-sm">Les inventaires clôturés apparaîtront ici.</p>
      </div>
    );
  }

  // Vue détail
  if (selectedGroup) {
    return (
      <VarianceDetailView
        group={selectedGroup}
        onBack={() => setSelectedGroup(null)}
      />
    );
  }

  // Vue liste — une ligne par événement d'inventaire
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date de clôture</TableHead>
            <TableHead className="text-right">Produits comptés</TableHead>
            <TableHead>Écarts</TableHead>
            <TableHead className="text-right">Impact €</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.map((g) => (
            <TableRow
              key={g.group_key}
              className="cursor-pointer hover:bg-muted/50"
              onClick={() => setSelectedGroup(g)}
            >
              <TableCell className="font-medium">{formatDateOnly(g.group_key)}</TableCell>
              <TableCell className="text-right tabular-nums font-mono text-sm">
                {g.total_counted} / {g.total_products}
              </TableCell>
              <TableCell>
                {g.has_previous_snapshot ? (
                  g.variance_count === 0 ? (
                    <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Aucun écart</span>
                  ) : (
                    <span className="text-xs font-medium text-destructive">{g.variance_count} écart{g.variance_count > 1 ? "s" : ""}</span>
                  )
                ) : (
                  <span className="text-xs text-muted-foreground italic">Premier inventaire</span>
                )}
              </TableCell>
              <TableCell className="text-right">
                {g.has_previous_snapshot
                  ? formatEur(g.total_variance_eur)
                  : <span className="text-muted-foreground tabular-nums text-sm">N/A</span>}
              </TableCell>
              <TableCell>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

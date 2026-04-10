/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MARCHANDISE PAGE — Finance > Marchandise
 * Liste des périodes inter-inventaires + vue détail
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useState } from "react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { ChevronLeft, AlertTriangle, Info, TrendingDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ResponsiveLayout } from "@/components/mobile/ResponsiveLayout";
import { useMerchandisePeriods } from "../hooks/useMerchandisePeriods";
import { useMerchandisePeriodDetail } from "../hooks/useMerchandisePeriodDetail";
import type { MerchandisePeriod } from "../engine/monthlyMerchandiseEngine";

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function eur(v: number) {
  return v.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

function formatDateFull(iso: string) {
  return format(new Date(iso), "dd/MM/yyyy", { locale: fr });
}

// ─────────────────────────────────────────────────────────────────────────────
// PERIOD DETAIL VIEW
// ─────────────────────────────────────────────────────────────────────────────

function PeriodDetailView({
  period,
  onBack,
}: {
  period: MerchandisePeriod;
  onBack: () => void;
}) {
  const { data, isLoading, error } = useMerchandisePeriodDetail(period.session_a_id, period.session_b_id);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ChevronLeft className="h-4 w-4 mr-1" />
          Retour
        </Button>
        <div>
          <h2 className="text-lg font-semibold">
            Période {formatDateFull(period.session_a_completed_at)} → {formatDateFull(period.session_b_completed_at)}
          </h2>
          <p className="text-sm text-muted-foreground">{period.zone_name}</p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Stock début", value: eur(period.stock_start_eur), color: "text-foreground" },
          { label: "Réceptions", value: eur(period.receipts_eur), color: "text-primary" },
          { label: "Stock fin", value: eur(period.stock_end_eur), color: "text-foreground" },
          { label: "Consommation", value: eur(period.consumption_eur), color: period.consumption_eur > 0 ? "text-destructive" : "text-muted-foreground" },
        ].map(({ label, value, color }) => (
          <Card key={label}>
            <CardHeader className="pb-1 pt-3 px-4">
              <CardTitle className="text-xs text-muted-foreground font-medium">{label}</CardTitle>
            </CardHeader>
            <CardContent className="pb-3 px-4">
              <p className={`text-lg font-bold font-mono ${color}`}>{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {period.has_missing_prices && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            Certains produits n'ont pas de prix configuré — les totaux peuvent être sous-estimés.
            Les lignes concernées affichent un badge "Prix manquant".
          </AlertDescription>
        </Alert>
      )}

      {isLoading && (
        <div className="space-y-2">
          {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>Erreur lors du chargement du détail.</AlertDescription>
        </Alert>
      )}

      {data && (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produit</TableHead>
                <TableHead>Catégorie</TableHead>
                <TableHead>Fournisseur</TableHead>
                <TableHead className="text-right">Qté début</TableHead>
                <TableHead className="text-right">Qté reçue</TableHead>
                <TableHead className="text-right">Qté fin</TableHead>
                <TableHead className="text-right">Consommé</TableHead>
                <TableHead>Unité</TableHead>
                <TableHead className="text-right">Prix unitaire</TableHead>
                <TableHead className="text-right">Total €</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.lines.map((line) => (
                <TableRow key={line.product_id}>
                  <TableCell className="font-medium uppercase">
                    {line.nom_produit}
                    {!line.has_price && (
                      <Badge variant="outline" className="ml-2 text-xs text-amber-600 border-amber-400">
                        Prix manquant
                      </Badge>
                    )}
                    {line.price_is_live && line.has_price && (
                      <Badge variant="outline" className="ml-2 text-xs text-muted-foreground">
                        Prix actuel
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">{line.category ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{line.supplier_name ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{line.qty_start.toFixed(4)}</TableCell>
                  <TableCell className="text-right font-mono text-sm text-primary">{line.qty_received > 0 ? `+${line.qty_received.toFixed(4)}` : "—"}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{line.qty_end.toFixed(4)}</TableCell>
                  <TableCell className="text-right font-mono text-sm font-semibold">
                    {line.qty_consumed.toFixed(4)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{line.unit_label}</TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {line.has_price ? `${line.unit_price_eur.toFixed(2)} €` : "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono font-semibold">
                    {line.has_price ? eur(line.total_consumed_eur) : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────────────────────

export default function MarchandisePage() {
  const { data: periods, isLoading, error } = useMerchandisePeriods();
  const [selectedPeriod, setSelectedPeriod] = useState<MerchandisePeriod | null>(null);

  if (selectedPeriod) {
    return (
      <ResponsiveLayout>
        <PeriodDetailView period={selectedPeriod} onBack={() => setSelectedPeriod(null)} />
      </ResponsiveLayout>
    );
  }

  return (
    <ResponsiveLayout>
      <div className="space-y-4">
        <div>
          <h1 className="text-xl font-bold">Marchandise — Consommation par période</h1>
          <p className="text-sm text-muted-foreground">
            Calculé entre chaque inventaire terminé. Formule : Stock début + Réceptions − Stock fin.
          </p>
        </div>

        {isLoading && (
          <div className="space-y-2">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
          </div>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>Erreur lors du chargement des périodes.</AlertDescription>
          </Alert>
        )}

        {!isLoading && !error && (!periods || periods.length === 0) && (
          <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground gap-2">
            <TrendingDown className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-lg font-medium">Pas encore de périodes calculables</p>
            <p className="text-sm">Il faut au moins deux inventaires terminés sur la même zone pour calculer la consommation.</p>
          </div>
        )}

        {periods && periods.length > 0 && (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Période</TableHead>
                  <TableHead>Zone</TableHead>
                  <TableHead className="text-right">Stock début €</TableHead>
                  <TableHead className="text-right">Réceptions €</TableHead>
                  <TableHead className="text-right">Stock fin €</TableHead>
                  <TableHead className="text-right">Consommation €</TableHead>
                  <TableHead className="text-right">Produits</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {periods.map((p) => (
                  <TableRow
                    key={p.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => setSelectedPeriod(p)}
                  >
                    <TableCell className="font-medium">
                      {p.label}
                      {p.has_missing_prices && (
                        <Badge variant="outline" className="ml-2 text-xs text-amber-600 border-amber-400">
                          Prix incomplets
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{p.zone_name}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{eur(p.stock_start_eur)}</TableCell>
                    <TableCell className="text-right font-mono text-sm text-primary">+{eur(p.receipts_eur)}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{eur(p.stock_end_eur)}</TableCell>
                    <TableCell className="text-right font-mono font-semibold text-destructive">
                      {eur(p.consumption_eur)}
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">{p.product_count}</TableCell>
                    <TableCell>
                      <ChevronLeft className="h-4 w-4 text-muted-foreground rotate-180" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </ResponsiveLayout>
  );
}

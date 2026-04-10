/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MODULE ACHAT — Purchase Summary Table (Isolé, supprimable)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Tableau de récap mensuel des achats par produit.
 * Lecture seule — affiche les données depuis SSOT Achat.
 *
 * RÈGLES:
 * - Unité affichée = resolved via supplier_billing_unit_id → measurement_units
 * - Quantité = SUM(quantite_commandee) brut
 * - Aucune conversion
 * - Colonnes HT / TVA / TTC = calcul UI only, aucune écriture DB
 * - Clic sur ligne produit → drill-down prix (si THE_BRAIN actif)
 * - Lignes "Non lié" → bouton "Lier" ouvre LinkProductDrawer
 */

import { useState, useMemo, useCallback } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Package, FileText, TrendingUp, Link2, Lock, AlertTriangle, Zap } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { MonthlyPurchaseSummary } from "../types";
import { ProductPriceHistoryModal } from "./ProductPriceHistoryModal";
import { LinkProductDrawer, type UnlinkedLineInfo } from "./LinkProductDrawer";
import { THE_BRAIN_DISABLED } from "@/modules/theBrain";
import { computeTTC } from "../utils/vatUtils";
import { SMART_MATCH_ENABLED } from "@/config/featureFlags";
import { SmartMatchDrawer, useSmartMatch, smartMatchLearn } from "@/modules/smartMatch";

interface PurchaseSummaryTableProps {
  data: MonthlyPurchaseSummary[];
  isLoading: boolean;
  establishmentId: string | undefined;
  yearMonth: string;
}

const fmt2 = (v: number) =>
  v.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function PurchaseSummaryTable({
  data,
  isLoading,
  establishmentId,
  yearMonth,
}: PurchaseSummaryTableProps) {
  const [selectedProduct, setSelectedProduct] = useState<{
    id: string | null;
    name: string;
    billingUnit: string | null;
  } | null>(null);

  const [linkDrawerOpen, setLinkDrawerOpen] = useState(false);
  const [linkLineInfo, setLinkLineInfo] = useState<UnlinkedLineInfo | null>(null);

  // SmartMatch state
  const { drawerOpen: smDrawerOpen, request: smRequest, openSmartMatch, setDrawerOpen: setSmDrawerOpen } = useSmartMatch();
  const [smLineInfo, setSmLineInfo] = useState<{ row: MonthlyPurchaseSummary } | null>(null);

  const handleOpenSmartMatch = useCallback(
    (e: React.MouseEvent, row: MonthlyPurchaseSummary) => {
      e.stopPropagation();
      if (!establishmentId) return;
      setSmLineInfo({ row });
      openSmartMatch({
        establishment_id: establishmentId,
        supplier_id: row.supplier_id,
        raw_label: row.product_name,
        code_produit: row.product_code_snapshot,
        unit_of_sale: row.unit_snapshot,
      });
    },
    [establishmentId, openSmartMatch]
  );

  // Pre-compute TTC for all rows (UI only)
  const rowsWithTTC = useMemo(
    () =>
      data.map((row) => {
        const { ttc, vat } = computeTTC(row.total_amount, row.category, row.supplier_name);
        return { ...row, ttc, vat };
      }),
    [data]
  );

  const totalHT = useMemo(
    () => rowsWithTTC.reduce((s, r) => s + (r.total_amount ?? 0), 0),
    [rowsWithTTC]
  );

  const totalTTC = useMemo(() => rowsWithTTC.reduce((s, r) => s + (r.ttc ?? 0), 0), [rowsWithTTC]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        Chargement...
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <Package className="h-12 w-12 mb-4 opacity-50" />
        <p>Aucun achat enregistré pour ce mois</p>
        <p className="text-sm mt-1">
          Les achats apparaîtront ici après validation des factures dans Vision AI
        </p>
      </div>
    );
  }

  const totalInvoices = new Set(
    data.flatMap((row) => Array(row.invoice_count).fill(row.product_id))
  ).size;

  const canDrillDown = !THE_BRAIN_DISABLED;

  const handleProductClick = (row: MonthlyPurchaseSummary) => {
    if (!canDrillDown || !row.product_id) return;
    setSelectedProduct({
      id: row.product_id,
      name: row.product_name,
      billingUnit: row.billing_unit_label ?? null,
    });
  };

  const handleLinkClick = (e: React.MouseEvent, row: MonthlyPurchaseSummary) => {
    e.stopPropagation();
    setLinkLineInfo({
      productNameSnapshot: row.product_name,
      productCodeSnapshot: row.product_code_snapshot,
      unitSnapshot: row.unit_snapshot,
      totalQuantity: row.total_quantity,
      totalAmount: row.total_amount,
      supplierId: row.supplier_id,
      supplierName: row.supplier_name,
    });
    setLinkDrawerOpen(true);
  };

  return (
    <>
      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="font-semibold">Produit</TableHead>
              <TableHead className="font-semibold">Catégorie</TableHead>
              <TableHead className="text-right font-semibold">Quantité</TableHead>
              <TableHead className="text-right font-semibold">Nb Factures</TableHead>
              <TableHead className="text-right font-semibold">
                <Tooltip>
                  <TooltipTrigger className="inline-flex items-center gap-1">
                    HT €
                    <Lock className="h-3 w-3 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Montant hors taxes — source SSOT</p>
                  </TooltipContent>
                </Tooltip>
              </TableHead>
              <TableHead className="text-right font-semibold">TVA</TableHead>
              <TableHead className="text-right font-semibold">
                <Tooltip>
                  <TooltipTrigger className="inline-flex items-center gap-1">
                    TTC €
                    <Lock className="h-3 w-3 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Montant calculé à l'affichage — non enregistré</p>
                  </TooltipContent>
                </Tooltip>
              </TableHead>
              <TableHead className="w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rowsWithTTC.map((row, idx) => (
              <TableRow
                key={row.product_id ?? `unknown-${idx}`}
                className={canDrillDown && row.product_id ? "cursor-pointer hover:bg-muted/50" : ""}
                onClick={() => handleProductClick(row)}
              >
                <TableCell className="font-medium uppercase">
                  <div className="flex items-center gap-2">
                    {!row.product_id && (
                      <span className="text-xs bg-warning/20 text-warning px-1.5 py-0.5 rounded">
                        Non lié
                      </span>
                    )}
                    {row.product_name}
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">{row.category ?? "—"}</TableCell>
                <TableCell className="text-right font-mono">
                  {row.total_quantity !== null
                    ? `${row.total_quantity.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} ${row.billing_unit_label ?? "—"}`
                    : "—"}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <FileText className="h-3 w-3 text-muted-foreground" />
                    {row.invoice_count}
                  </div>
                </TableCell>
                {/* HT */}
                <TableCell className="text-right font-mono">
                  {row.total_amount !== null ? `${fmt2(row.total_amount)} €` : "—"}
                </TableCell>
                {/* TVA */}
                <TableCell className="text-right">
                  {row.vat.undefined ? (
                    <Tooltip>
                      <TooltipTrigger>
                        <Badge
                          variant="outline"
                          className="text-xs gap-1 border-warning text-warning"
                        >
                          <AlertTriangle className="h-3 w-3" />
                          N/A
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>TVA non définie — catégorie inconnue</p>
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    <span className="text-xs text-muted-foreground font-mono">{row.vat.label}</span>
                  )}
                </TableCell>
                {/* TTC */}
                <TableCell className="text-right font-mono">
                  {row.ttc !== null ? `${fmt2(row.ttc)} €` : "—"}
                </TableCell>
                <TableCell className="text-right">
                  {!row.product_id ? (
                    <div className="flex items-center justify-end gap-1">
                      {/* SmartMatch button (feature-flagged) */}
                      {SMART_MATCH_ENABLED && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-primary hover:text-primary/80 hover:bg-primary/10"
                              onClick={(e) => handleOpenSmartMatch(e, row)}
                              aria-label="SmartMatch"
                            >
                              <Zap className="h-3.5 w-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>SmartMatch — Recherche intelligente</p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-7 w-7"
                            onClick={(e) => handleLinkClick(e, row)}
                            aria-label="Lier à un produit"
                          >
                            <Link2 className="h-3.5 w-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Lier à un produit</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  ) : canDrillDown ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="p-1.5 rounded hover:bg-muted transition-colors"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleProductClick(row);
                          }}
                        >
                          <TrendingUp className="h-4 w-4 text-primary" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Voir l'évolution des prix</p>
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            ))}

            {/* Ligne de total */}
            <TableRow className="bg-muted/30 font-semibold">
              <TableCell>Total ({data.length} produits)</TableCell>
              <TableCell></TableCell>
              <TableCell className="text-right font-mono">—</TableCell>
              <TableCell className="text-right">{totalInvoices}</TableCell>
              <TableCell className="text-right font-mono">{fmt2(totalHT)} €</TableCell>
              <TableCell></TableCell>
              <TableCell className="text-right font-mono">{fmt2(totalTTC)} €</TableCell>
              <TableCell></TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>

      {/* Modal historique des prix */}
      <ProductPriceHistoryModal
        open={selectedProduct !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedProduct(null);
        }}
        productId={selectedProduct?.id ?? null}
        productName={selectedProduct?.name ?? ""}
        billingUnit={selectedProduct?.billingUnit}
      />

      {/* Drawer liaison produit */}
      <LinkProductDrawer
        open={linkDrawerOpen}
        onOpenChange={setLinkDrawerOpen}
        lineInfo={linkLineInfo}
        establishmentId={establishmentId}
        yearMonth={yearMonth}
      />

      {/* SmartMatch Drawer (feature-flagged) */}
      {SMART_MATCH_ENABLED && (
        <SmartMatchDrawer
          open={smDrawerOpen}
          onOpenChange={setSmDrawerOpen}
          request={smRequest}
          onSelectProduct={(productId, _productName) => {
            if (smLineInfo && establishmentId) {
              // Fire learning (fire-and-forget)
              smartMatchLearn({
                establishment_id: establishmentId,
                supplier_id: smLineInfo.row.supplier_id,
                raw_label: smLineInfo.row.product_name,
                code_produit: smLineInfo.row.product_code_snapshot,
                confirmed_product_id: productId,
                action: "corrected",
              }).catch(() => {});
              // Open LinkProductDrawer pre-filled so user can confirm the DB link
              setLinkLineInfo({
                productNameSnapshot: smLineInfo.row.product_name,
                productCodeSnapshot: smLineInfo.row.product_code_snapshot,
                unitSnapshot: smLineInfo.row.unit_snapshot,
                totalQuantity: smLineInfo.row.total_quantity,
                totalAmount: smLineInfo.row.total_amount,
                supplierId: smLineInfo.row.supplier_id,
                supplierName: smLineInfo.row.supplier_name,
              });
              setLinkDrawerOpen(true);
            }
            setSmLineInfo(null);
          }}
        />
      )}
    </>
  );
}

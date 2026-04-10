/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DELETE GUARD DIALOG — Option B confirmation with usage report
 * ═══════════════════════════════════════════════════════════════════════════
 */

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, AlertTriangle, Search } from "lucide-react";
import type { UnitUsageReport, MeasurementUnit } from "@/modules/visionAI";

interface DeleteGuardDialogProps {
  target: MeasurementUnit | null;
  loading: boolean;
  deletingOptionB: boolean;
  usageReport: UnitUsageReport | null;
  productSearch: string;
  filteredProducts: string[];
  onProductSearchChange: (v: string) => void;
  onClose: () => void;
  onDeleteSimple: () => void;
  onDeactivate: () => void;
  onOptionB: () => void;
  isDeleting: boolean;
}

export function DeleteGuardDialog({
  target,
  loading,
  deletingOptionB,
  usageReport,
  productSearch,
  filteredProducts,
  onProductSearchChange,
  onClose,
  onDeleteSimple,
  onDeactivate,
  onOptionB,
  isDeleting,
}: DeleteGuardDialogProps) {
  if (!target) return null;

  const used = usageReport?.isUsed ?? false;
  const blocked = usageReport?.hasInventoryHistory ?? false;
  const d = usageReport?.details;

  return (
    <Dialog
      open={!!target}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {used && <AlertTriangle className="h-5 w-5 text-destructive" />}
            Supprimer « {target.name} » ?
          </DialogTitle>
          <DialogDescription>
            {loading
              ? "Vérification de l'utilisation en cours…"
              : used
                ? "Cette unité est référencée dans le système."
                : "Cette unité n'est référencée nulle part."}
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center gap-2 py-4">
            <Loader2 className="h-4 w-4 animate-spin" /> Analyse en cours…
          </div>
        )}

        {usageReport && used && d && (
          <div className="space-y-4">
            <div className="border rounded-md overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Source</TableHead>
                    <TableHead className="text-xs text-right">Nb</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.productsFinalUnit > 0 && (
                    <UsageRow label="Produits — unité finale" count={d.productsFinalUnit} />
                  )}
                  {d.productsBillingUnit > 0 && (
                    <UsageRow label="Produits — unité facturée" count={d.productsBillingUnit} />
                  )}
                  {d.productsStockUnit > 0 && (
                    <UsageRow label="Produits — unité stock" count={d.productsStockUnit} />
                  )}
                  {d.productsKitchenUnit > 0 && (
                    <UsageRow label="Produits — unité cuisine" count={d.productsKitchenUnit} />
                  )}
                  {d.productsJsonb > 0 && (
                    <UsageRow label="Produits — conditionnement (JSONB)" count={d.productsJsonb} />
                  )}
                  {d.conversions > 0 && (
                    <UsageRow label="Règles de conversion" count={d.conversions} />
                  )}
                  {d.packagingFormats > 0 && (
                    <UsageRow label="Formats de conditionnement" count={d.packagingFormats} />
                  )}
                  {d.inventoryLines > 0 && (
                    <UsageRow label="Lignes d'inventaire (historique)" count={d.inventoryLines} />
                  )}
                </TableBody>
              </Table>
            </div>

            {usageReport.sampleProducts.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Search className="h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    value={productSearch}
                    onChange={(e) => onProductSearchChange(e.target.value)}
                    placeholder="Rechercher un produit…"
                    className="h-7 text-xs"
                    aria-label="Rechercher un produit"
                  />
                </div>
                <div className="border rounded p-2 max-h-40 overflow-y-auto">
                  <p className="text-xs font-medium mb-1">
                    Produits concernés ({filteredProducts.length}) :
                  </p>
                  {filteredProducts.map((name, i) => (
                    <p key={i} className="text-xs text-muted-foreground">
                      {name}
                    </p>
                  ))}
                  {filteredProducts.length === 0 && (
                    <p className="text-xs text-muted-foreground italic">Aucun résultat</p>
                  )}
                </div>
              </div>
            )}

            {blocked ? (
              <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm space-y-1">
                <p className="font-medium text-destructive">
                  🚫 Suppression bloquée — historique d'inventaire existant
                </p>
                <p className="text-muted-foreground text-xs">
                  Des lignes d'inventaire utilisent cette unité. Pour préserver l'intégrité
                  historique, la suppression est impossible. Vous pouvez désactiver l'unité à la
                  place.
                </p>
              </div>
            ) : (
              <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-sm space-y-1">
                <p className="font-medium text-amber-800 dark:text-amber-300">
                  ⚠️ Si vous supprimez cette unité :
                </p>
                <ul className="text-xs text-amber-700 dark:text-amber-400 list-disc pl-4 space-y-0.5">
                  <li>
                    Le conditionnement des produits listés sera <strong>réinitialisé</strong>
                  </li>
                  <li>
                    Les conversions associées seront <strong>supprimées</strong>
                  </li>
                  {d.packagingFormats > 0 && (
                    <li>
                      {d.packagingFormats} format(s) de conditionnement sera/seront{" "}
                      <strong>supprimé(s)</strong>
                    </li>
                  )}
                  <li>Aucune facture, achat ou fournisseur ne sera modifié</li>
                  <li>Les produits devront être reconfigurés via le Wizard</li>
                </ul>
              </div>
            )}
          </div>
        )}

        {usageReport && !used && (
          <p className="text-sm text-muted-foreground py-2">
            Cette unité n'est référencée nulle part. La suppression est sans risque.
          </p>
        )}

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>

          {usageReport && used && (
            <Button variant="secondary" onClick={onDeactivate}>
              Désactiver à la place
            </Button>
          )}

          {usageReport && !used && (
            <Button variant="destructive" onClick={onDeleteSimple} disabled={isDeleting}>
              Supprimer
            </Button>
          )}

          {usageReport && used && !blocked && (
            <Button variant="destructive" onClick={onOptionB} disabled={deletingOptionB}>
              {deletingOptionB && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Supprimer quand même
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UsageRow({ label, count }: { label: string; count: number }) {
  return (
    <TableRow>
      <TableCell className="text-xs py-1.5">{label}</TableCell>
      <TableCell className="text-xs text-right py-1.5 font-medium">{count}</TableCell>
    </TableRow>
  );
}

/**
 * LitigeDetailDialog — Clean ERP-style litige detail.
 * Compact table layout with clear Manque (amber) vs Surplus (blue) distinction.
 * Same component for FO (supplier) and CL (client) — CTA only visible for FO.
 */

import { useState, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import { Button } from "@/components/ui/button";
import {
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ArrowRight,
  Unlink,
} from "lucide-react";
import { toast } from "sonner";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { useLitigeForCommande, useLitigeDetail, useResolveLitige } from "../hooks/useLitiges";
import { useCommandeDetail } from "@/modules/commandes/hooks/useCommandes";
import type { Commande } from "@/modules/commandes/types";
import { useErpQuantityLabels } from "@/modules/commandes/hooks/useErpQuantityLabels";
import { formatParisHHMM } from "@/lib/time/paris";
import { formatParisDateKey } from "@/lib/time/dateKeyParis";
import { computeEcart } from "../utils/ecart";
import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

interface Props {
  open: boolean;
  onClose: () => void;
  commande: Commande;
  establishmentNames: Record<string, string>;
}

function fmtDateTime(iso: string): string {
  const dateKey = formatParisDateKey(new Date(iso));
  const [, mm, dd] = dateKey.split("-");
  return `${dd}/${mm} · ${formatParisHHMM(iso)}`;
}

export function LitigeDetailDialog({ open, onClose, commande, establishmentNames }: Props) {
  const { activeEstablishment } = useEstablishment();
  const estId = activeEstablishment?.id;
  const isSender = commande.client_establishment_id === estId;
  const isReceiver = commande.supplier_establishment_id === estId;

  const { data: litige, isLoading: litigeLoading } = useLitigeForCommande(
    open ? commande.id : null
  );
  const { data: litigeDetail, isLoading: detailLoading } = useLitigeDetail(
    litige?.id ?? null
  );
  const { data: commandeDetail } = useCommandeDetail(open ? commande.id : null);
  const resolveMutation = useResolveLitige();

  const [confirmResolve, setConfirmResolve] = useState(false);
  const [isResolving, setIsResolving] = useState(false);

  const lineProductIds = (commandeDetail?.lines ?? []).map((l) => l.product_id);
  const { formatQty: erpFormat } = useErpQuantityLabels({
    productIds: lineProductIds,
    clientEstablishmentId: commande.client_establishment_id,
    supplierEstablishmentId: commande.supplier_establishment_id,
  });

  const { data: b2bMappings } = useQuery({
    queryKey: ["b2b-mappings-litige", commande.client_establishment_id, commande.supplier_establishment_id, lineProductIds],
    queryFn: async () => {
      if (lineProductIds.length === 0) return [];
      const { data, error } = await db
        .from("b2b_imported_products")
        .select("local_product_id, source_product_id")
        .eq("establishment_id", commande.client_establishment_id)
        .eq("source_establishment_id", commande.supplier_establishment_id)
        .in("local_product_id", lineProductIds);
      if (error) throw error;
      return (data ?? []) as { local_product_id: string; source_product_id: string }[];
    },
    enabled: open && isReceiver && lineProductIds.length > 0,
    staleTime: 60_000,
  });

  const mappedProductIds = useMemo(() => {
    const set = new Set<string>();
    for (const m of b2bMappings ?? []) set.add(m.local_product_id);
    return set;
  }, [b2bMappings]);

  const partnerName = isSender
    ? establishmentNames[commande.supplier_establishment_id] || "Fournisseur"
    : establishmentNames[commande.client_establishment_id] || "Client";

  const isOpen = litige?.status === "open";
  const isResolved = litige?.status === "resolved";

  const lineMap = new Map<string, {
    product_name: string;
    product_id: string;
    canonical_unit_id: string;
    unit_label: string | null;
  }>();
  for (const cl of commandeDetail?.lines ?? []) {
    lineMap.set(cl.id, {
      product_name: cl.product_name_snapshot,
      product_id: cl.product_id,
      canonical_unit_id: cl.canonical_unit_id,
      unit_label: cl.unit_label_snapshot,
    });
  }

  const litigeLines = litigeDetail?.lines ?? [];

  const summary = useMemo(() => {
    let manqueCount = 0;
    let surplusCount = 0;
    let unmappedCount = 0;
    for (const ll of litigeLines) {
      const { type } = computeEcart(ll.shipped_quantity, ll.received_quantity);
      if (type === "manque") manqueCount++;
      else if (type === "surplus") surplusCount++;
      if (isReceiver) {
        const cl = lineMap.get(ll.commande_line_id);
        if (cl && !mappedProductIds.has(cl.product_id)) unmappedCount++;
      }
    }
    return { manqueCount, surplusCount, unmappedCount, total: litigeLines.length };
  }, [litigeLines, isReceiver, mappedProductIds, lineMap]);

  const handleResolve = useCallback(async () => {
    if (!litige) return;
    setIsResolving(true);
    try {
      await resolveMutation.mutateAsync(litige.id);
      toast.success("Litige validé — stock ajusté");
      setConfirmResolve(false);
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      toast.error(msg.includes("already_resolved") ? "Litige déjà résolu" : "Erreur lors de la validation");
    } finally {
      setIsResolving(false);
    }
  }, [litige, resolveMutation, onClose]);

  const isLoading = litigeLoading || detailLoading;

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="max-w-lg max-h-[95vh] sm:max-h-[85vh] overflow-hidden w-[calc(100vw-1rem)] sm:w-full p-0 flex flex-col gap-0">

          {/* ── Top section (non-scrollable) ── */}
          <div className="shrink-0">
            <DialogHeader className="px-5 pt-5 pb-3">
              <DialogTitle className="flex items-center gap-2.5 text-base sm:text-lg font-semibold">
                Litige
                {isOpen && (
                  <Clock className="h-4 w-4 text-amber-600" />
                )}
                {isResolved && (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                )}
              </DialogTitle>
            </DialogHeader>

            {isLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : !litige ? (
              <p className="text-sm text-muted-foreground py-12 text-center">
                Aucun litige trouvé.
              </p>
            ) : (
              <>
                {/* Partner row */}
                <div className="px-5 pb-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      {isSender ? "Fournisseur" : "Client"}
                    </span>
                    <span className="text-sm font-medium">{partnerName}</span>
                  </div>
                </div>

                {/* Status banner */}
                <div className="px-5 pb-3">
                  {isOpen && isSender && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-amber-50 border border-amber-200/80 text-amber-700 text-xs">
                      <Clock className="h-3.5 w-3.5 shrink-0" />
                      En attente de validation fournisseur
                    </div>
                  )}
                  {isOpen && isReceiver && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-amber-50 border border-amber-200/80 text-amber-700 text-xs">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                      Écarts déclarés — vérifiez et validez la correction
                    </div>
                  )}
                  {isResolved && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-emerald-50 border border-emerald-200/80 text-emerald-700 text-xs">
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                      Corrigé{litige.resolved_at ? ` le ${fmtDateTime(litige.resolved_at)}` : ""}
                    </div>
                  )}
                </div>

                {/* Summary chips */}
                <div className="px-5 pb-2 flex items-center gap-2 flex-wrap">
                  {summary.manqueCount > 0 && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-800 bg-amber-100/80 border border-amber-200 px-2.5 py-1 rounded-full">
                      ⚠ {summary.manqueCount} manque{summary.manqueCount > 1 ? "s" : ""}
                    </span>
                  )}
                  {summary.surplusCount > 0 && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-800 bg-blue-100/80 border border-blue-200 px-2.5 py-1 rounded-full">
                      ➕ {summary.surplusCount} surplus
                    </span>
                  )}
                </div>

                {/* Unmapped warning */}
                {isReceiver && summary.unmappedCount > 0 && isOpen && (
                  <div className="mx-5 mb-2 flex items-center gap-2 px-3 py-2 rounded-md bg-red-50 border border-red-200/80 text-red-700 text-[11px]">
                    <Unlink className="h-3.5 w-3.5 shrink-0" />
                    {summary.unmappedCount} produit{summary.unmappedCount > 1 ? "s" : ""} non lié{summary.unmappedCount > 1 ? "s" : ""} — correction stock impossible
                  </div>
                )}
              </>
            )}
          </div>

          {/* ── Scrollable product lines ── */}
          {!isLoading && litige && (
            <div className="flex-1 overflow-y-auto min-h-0 border-t">
              {/* Table header */}
              <div className="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm border-b">
                <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 px-5 py-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                  <span>Produit</span>
                  <span className="text-right w-20">Expédié</span>
                  <span className="w-4" />
                  <span className="text-right w-24">Reçu</span>
                </div>
              </div>

              {/* Lines */}
              <div className="divide-y divide-border/60">
                {litigeLines.map((ll) => {
                  const cl = lineMap.get(ll.commande_line_id);
                  const { type, absDelta } = computeEcart(ll.shipped_quantity, ll.received_quantity);
                  const isManquant = type === "manque";
                  const isSurplus = type === "surplus";
                  const isUnmapped = isReceiver && cl && !mappedProductIds.has(cl.product_id);

                  const shippedLabel = cl
                    ? erpFormat(cl.product_id, ll.shipped_quantity, cl.canonical_unit_id, cl.unit_label)
                    : String(ll.shipped_quantity);
                  const receivedLabel = cl
                    ? erpFormat(cl.product_id, ll.received_quantity, cl.canonical_unit_id, cl.unit_label)
                    : String(ll.received_quantity);

                  return (
                    <div
                      key={ll.id}
                      className={`px-5 py-3 ${
                        isSurplus
                          ? "bg-blue-50/40"
                          : isManquant
                            ? "bg-amber-50/40"
                            : ""
                      }`}
                    >
                      {/* Main row: product | shipped → received */}
                      <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2">
                        {/* Product name + delta inline */}
                        <div className="min-w-0 flex items-center gap-1.5">
                          <span className="font-medium text-sm truncate">
                            {cl?.product_name || "Produit"}
                          </span>
                          {isManquant && (
                            <span className="text-xs font-semibold text-amber-700 whitespace-nowrap">(−{absDelta})</span>
                          )}
                          {isSurplus && (
                            <span className="text-xs font-semibold text-blue-700 whitespace-nowrap">(+{absDelta})</span>
                          )}
                        </div>

                        {/* Shipped */}
                        <span className={`text-sm tabular-nums text-right w-20 whitespace-nowrap ${
                          (isManquant || isSurplus) ? "line-through text-muted-foreground/60" : "text-foreground font-medium"
                        }`}>
                          {shippedLabel}
                        </span>

                        {/* Arrow */}
                        <ArrowRight className="h-3 w-3 text-muted-foreground/40 shrink-0" />

                        {/* Received (prominent) */}
                        <span className={`text-right w-24 tabular-nums font-bold text-sm whitespace-nowrap ${
                          isSurplus ? "text-blue-700" : isManquant ? "text-amber-700" : "text-foreground"
                        }`}>
                          {receivedLabel}
                        </span>
                      </div>

                      {/* Unmapped / reason (only if needed) */}
                      {(isUnmapped || ll.reason) && (
                        <div className="flex items-center gap-2 mt-1">
                          {isUnmapped && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] text-red-600">
                              <Unlink className="h-2.5 w-2.5" />
                              Non lié
                            </span>
                          )}
                          {ll.reason && (
                            <span className="text-[10px] text-muted-foreground italic truncate">
                              {ll.reason}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Footer (sticky) ── */}
          {!isLoading && litige && (
            <div className="shrink-0 border-t bg-background px-5 py-3">
              {/* Note */}
              {litige.note && (
                <p className="text-xs text-muted-foreground italic mb-2.5 truncate">
                  📝 {litige.note}
                </p>
              )}

              <div className="flex items-center justify-between gap-3">
                <Button variant="outline" size="sm" onClick={onClose}>
                  Fermer
                </Button>
                {isOpen && isReceiver && (
                  <Button
                    size="sm"
                    onClick={() => setConfirmResolve(true)}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white"
                  >
                    <CheckCircle2 className="h-4 w-4 mr-1.5" />
                    Valider la correction
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Confirm resolve */}
      <AlertDialog open={confirmResolve} onOpenChange={setConfirmResolve}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Valider la correction</AlertDialogTitle>
            <AlertDialogDescription>
              En validant, le stock fournisseur sera ajusté pour les écarts constatés
              et la commande passera en "Terminée".
              {summary.unmappedCount > 0 && (
                <span className="block mt-2 text-red-600 font-medium">
                  ⚠ {summary.unmappedCount} produit{summary.unmappedCount > 1 ? "s" : ""} non lié{summary.unmappedCount > 1 ? "s" : ""} : pas de correction stock pour {summary.unmappedCount > 1 ? "ceux-ci" : "celui-ci"}.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isResolving}>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={handleResolve} disabled={isResolving}>
              {isResolving ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
              ) : (
                <CheckCircle2 className="h-4 w-4 mr-1.5" />
              )}
              Confirmer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

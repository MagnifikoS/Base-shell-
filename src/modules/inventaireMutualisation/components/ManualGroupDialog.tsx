/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MUTUALISATION INVENTAIRE — Manual Group Creation Dialog
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 3-step flow: select → configure (name + carrier) → B2B resolution → create.
 * Writes ONLY to inventory_mutualisation_* tables.
 */

import { useState, useMemo, useEffect } from "react";
import { normalizeSearch } from "@/utils/normalizeSearch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Search, Package, AlertTriangle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { useB2bResolution, type B2bResolvedData } from "../hooks/useB2bResolution";
import { B2bPriceResolution } from "./B2bPriceResolution";
import type { PriceStrategy } from "../services/resolveB2bPrice";

interface ManualGroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (params: {
    displayName: string;
    carrierProductId: string;
    memberProductIds: string[];
    b2bBillingUnitId?: string | null;
    b2bUnitPrice?: number | null;
    b2bPriceStrategy?: string | null;
  }) => void;
  isConfirming: boolean;
  existingGroupedProductIds: Set<string>;
}

interface ProductRow {
  id: string;
  nom_produit: string;
  supplier_name: string | null;
  category_id: string | null;
  stock_handling_unit_id: string | null;
  stock_unit_category: string | null;
  storage_zone_id: string | null;
}

type Step = "select" | "configure" | "b2b";

export function ManualGroupDialog({
  open,
  onOpenChange,
  onConfirm,
  isConfirming,
  existingGroupedProductIds,
}: ManualGroupDialogProps) {
  const { activeEstablishment } = useEstablishment();
  const establishmentId = activeEstablishment?.id ?? null;
  const { resolve, reset: resetB2b, isResolving, result: b2bResult, error: b2bError } = useB2bResolution();

  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [displayName, setDisplayName] = useState("");
  const [carrierId, setCarrierId] = useState("");
  const [step, setStep] = useState<Step>("select");
  const [resolvedB2b, setResolvedB2b] = useState<B2bResolvedData | null>(null);

  // Fetch all products for the establishment
  const { data: products = [], isLoading: productsLoading } = useQuery({
    queryKey: ["mutualisation-manual-products", establishmentId],
    enabled: !!establishmentId && open,
    queryFn: async (): Promise<ProductRow[]> => {
      const { data, error } = await supabase
        .from("products_v2")
        .select("id, nom_produit, category_id, stock_handling_unit_id, storage_zone_id, supplier_id, invoice_suppliers!supplier_id(name), measurement_units!stock_handling_unit_id(category)")
        .eq("establishment_id", establishmentId!)
        .is("archived_at", null)
        .order("nom_produit");
      if (error) throw error;
      return (data ?? []).map((p: Record<string, unknown>) => ({
        ...p,
        supplier_name: (p.invoice_suppliers as { name: string } | null)?.name ?? null,
        stock_unit_category: (p.measurement_units as { category: string } | null)?.category ?? null,
      })) as ProductRow[];
    },
  });

  // Filter by search + exclude already grouped
  const filtered = useMemo(() => {
    const term = normalizeSearch(search);
    return products.filter(
      (p) =>
        !existingGroupedProductIds.has(p.id) &&
        (term === "" || normalizeSearch(p.nom_produit).includes(term) ||
          normalizeSearch(p.supplier_name ?? "").includes(term))
    );
  }, [products, search, existingGroupedProductIds]);

  const selectedProducts = useMemo(
    () => products.filter((p) => selected.has(p.id)),
    [products, selected]
  );

  const unitMismatch = useMemo(() => {
    if (selectedProducts.length < 2) return false;
    const categories = new Set(
      selectedProducts.map((p) => p.stock_unit_category ?? p.stock_handling_unit_id)
    );
    return categories.size > 1;
  }, [selectedProducts]);

  const toggleProduct = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleNextStep = () => {
    setCarrierId(selectedProducts[0]?.id ?? "");
    setStep("configure");
  };

  // Trigger B2B resolution when moving to b2b step
  const handleGoToB2b = async () => {
    setStep("b2b");
    setResolvedB2b(null);
    await resolve(Array.from(selected), carrierId);
  };

  // Auto-resolve price when prices are equal
  useEffect(() => {
    if (step === "b2b" && b2bResult && b2bResult.pricing.pricesAreEqual) {
      const carrierPrice = b2bResult.pricing.memberPrices.find(
        (m) => m.productId === carrierId
      )?.convertedPrice;
      if (carrierPrice !== null && carrierPrice !== undefined) {
        setResolvedB2b({
          b2bBillingUnitId: b2bResult.billing.billingUnitId,
          b2bUnitPrice: carrierPrice,
          b2bPriceStrategy: "carrier",
        });
      }
    }
  }, [step, b2bResult, carrierId]);

  const handlePriceResolved = (price: number, strategy: PriceStrategy) => {
    if (!b2bResult) return;
    setResolvedB2b({
      b2bBillingUnitId: b2bResult.billing.billingUnitId,
      b2bUnitPrice: price,
      b2bPriceStrategy: strategy,
    });
  };

  const handleConfirm = () => {
    if (!carrierId || selected.size < 2) return;
    onConfirm({
      displayName: displayName.trim() || "Groupe manuel",
      carrierProductId: carrierId,
      memberProductIds: Array.from(selected),
      b2bBillingUnitId: resolvedB2b?.b2bBillingUnitId ?? null,
      b2bUnitPrice: resolvedB2b?.b2bUnitPrice ?? null,
      b2bPriceStrategy: resolvedB2b?.b2bPriceStrategy ?? null,
    });
  };

  const handleClose = (isOpen: boolean) => {
    if (!isOpen) {
      setSearch("");
      setSelected(new Set());
      setDisplayName("");
      setCarrierId("");
      setStep("select");
      setResolvedB2b(null);
      resetB2b();
    }
    onOpenChange(isOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Créer une mutualisation manuelle</DialogTitle>
          <DialogDescription>
            {step === "select"
              ? "Sélectionnez au moins 2 produits à regrouper."
              : step === "configure"
              ? "Nommez le groupe et choisissez le produit porteur de seuil."
              : "Résolution du prix B2B pour le groupe."}
          </DialogDescription>
        </DialogHeader>

        {step === "select" ? (
          <div className="space-y-3 py-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Rechercher un produit…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>

            <ScrollArea className="h-[300px] rounded-md border border-border">
              {productsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : filtered.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  Aucun produit trouvé.
                </p>
              ) : (
                <div className="divide-y divide-border">
                  {filtered.map((p) => (
                    <label
                      key={p.id}
                      className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-muted/50 transition-colors"
                    >
                      <Checkbox
                        checked={selected.has(p.id)}
                        onCheckedChange={() => toggleProduct(p.id)}
                      />
                      <Package className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium text-foreground truncate block uppercase">
                          {p.nom_produit}
                        </span>
                        {p.supplier_name && (
                          <span className="text-xs text-muted-foreground">
                            {p.supplier_name}
                          </span>
                        )}
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </ScrollArea>

            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {selected.size} produit{selected.size > 1 ? "s" : ""} sélectionné{selected.size > 1 ? "s" : ""}
              </span>
              {unitMismatch && (
                <span className="inline-flex items-center gap-1 text-xs text-destructive">
                  <AlertTriangle className="h-3 w-3" />
                  Unités de stock différentes
                </span>
              )}
            </div>
          </div>
        ) : step === "configure" ? (
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="manual-group-name">Nom du groupe</Label>
              <Input
                id="manual-group-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Ex: Lasagnes, Coca, Farine T55…"
              />
            </div>

            <div className="space-y-2">
              <Label>Produit porteur de seuil</Label>
              <RadioGroup value={carrierId} onValueChange={setCarrierId}>
                {selectedProducts.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center gap-3 rounded-md border border-border px-3 py-2"
                  >
                    <RadioGroupItem value={p.id} id={`manual-carrier-${p.id}`} />
                    <label
                      htmlFor={`manual-carrier-${p.id}`}
                      className="flex-1 cursor-pointer text-sm"
                    >
                      <span className="font-medium text-foreground uppercase">
                        {p.nom_produit}
                      </span>
                      {p.supplier_name && (
                        <span className="ml-2 text-muted-foreground">
                          ({p.supplier_name})
                        </span>
                      )}
                    </label>
                  </div>
                ))}
              </RadioGroup>
            </div>
          </div>
        ) : (
          /* step === "b2b" */
          <div className="space-y-4 py-2">
            {isResolving ? (
              <div className="flex items-center justify-center gap-2 py-8">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                <span className="text-sm text-muted-foreground">
                  Résolution B2B en cours…
                </span>
              </div>
            ) : b2bError ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                <div className="flex items-center gap-2 text-sm text-destructive">
                  <AlertTriangle className="h-4 w-4" />
                  {b2bError}
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Le groupe sera créé sans données B2B. Vous pourrez les configurer ultérieurement.
                </p>
              </div>
            ) : b2bResult ? (
              <div className="space-y-3">
                <div className="rounded-lg border border-border bg-muted/30 p-3">
                  <p className="text-sm text-muted-foreground">
                    Unité B2B résolue :{" "}
                    <span className="font-semibold text-foreground">
                      {b2bResult.billing.billingUnitName}
                    </span>
                    <span className="text-xs ml-2 text-muted-foreground">
                      ({b2bResult.billing.reason === "shared_packaging"
                        ? "packaging identique"
                        : "standard commercial"})
                    </span>
                  </p>
                </div>

                <B2bPriceResolution
                  memberPrices={b2bResult.pricing.memberPrices}
                  averagePrice={b2bResult.pricing.averagePrice}
                  pricesAreEqual={b2bResult.pricing.pricesAreEqual}
                  allConversionsOk={b2bResult.pricing.allConversionsOk}
                  billingUnitName={b2bResult.billing.billingUnitName}
                  carrierProductId={carrierId}
                  onPriceResolved={handlePriceResolved}
                />
              </div>
            ) : null}
          </div>
        )}

        <DialogFooter>
          {step === "select" ? (
            <>
              <Button variant="outline" onClick={() => handleClose(false)}>
                Annuler
              </Button>
              <Button
                onClick={handleNextStep}
                disabled={selected.size < 2 || unitMismatch}
              >
                Suivant
              </Button>
            </>
          ) : step === "configure" ? (
            <>
              <Button variant="outline" onClick={() => setStep("select")} disabled={isConfirming}>
                Retour
              </Button>
              <Button
                onClick={handleGoToB2b}
                disabled={!carrierId || !displayName.trim()}
              >
                Suivant
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setStep("configure")} disabled={isConfirming || isResolving}>
                Retour
              </Button>
              <Button
                onClick={handleConfirm}
                disabled={
                  isConfirming ||
                  isResolving ||
                  // Allow creation even without B2B (error case), but require price if resolution succeeded
                  (b2bResult !== null && !b2bError && !resolvedB2b)
                }
              >
                {isConfirming && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Créer le groupe
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

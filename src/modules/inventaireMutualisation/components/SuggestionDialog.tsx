/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MUTUALISATION INVENTAIRE — Suggestion Dialog
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Presents a suggested group for human validation.
 * 2-step flow: configure (name + carrier) → B2B resolution → create.
 * Writes ONLY to inventory_mutualisation_* tables.
 */

import { useState, useEffect } from "react";
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
import { Loader2, AlertTriangle } from "lucide-react";
import type { SuggestedGroup } from "../types";
import { useB2bResolution, type B2bResolvedData } from "../hooks/useB2bResolution";
import { B2bPriceResolution } from "./B2bPriceResolution";
import type { PriceStrategy } from "../services/resolveB2bPrice";

interface SuggestionDialogProps {
  suggestion: SuggestedGroup | null;
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
}

type Step = "configure" | "b2b";

export function SuggestionDialog({
  suggestion,
  open,
  onOpenChange,
  onConfirm,
  isConfirming,
}: SuggestionDialogProps) {
  const { resolve, reset: resetB2b, isResolving, result: b2bResult, error: b2bError } = useB2bResolution();

  const [displayName, setDisplayName] = useState("");
  const [carrierId, setCarrierId] = useState("");
  const [step, setStep] = useState<Step>("configure");
  const [resolvedB2b, setResolvedB2b] = useState<B2bResolvedData | null>(null);

  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen && suggestion) {
      setDisplayName(suggestion.displayName);
      setCarrierId(suggestion.productIds[0] ?? "");
      setStep("configure");
      setResolvedB2b(null);
      resetB2b();
    }
    onOpenChange(isOpen);
  };

  const handleGoToB2b = async () => {
    if (!suggestion) return;
    setStep("b2b");
    setResolvedB2b(null);
    await resolve(suggestion.productIds, carrierId);
  };

  // Auto-resolve when prices are equal
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
    if (!suggestion || !carrierId) return;
    onConfirm({
      displayName: displayName.trim() || suggestion.displayName,
      carrierProductId: carrierId,
      memberProductIds: suggestion.productIds,
      b2bBillingUnitId: resolvedB2b?.b2bBillingUnitId ?? null,
      b2bUnitPrice: resolvedB2b?.b2bUnitPrice ?? null,
      b2bPriceStrategy: resolvedB2b?.b2bPriceStrategy ?? null,
    });
  };

  if (!suggestion) return null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Créer un groupe de mutualisation</DialogTitle>
          <DialogDescription>
            {step === "configure"
              ? "Choisissez un nom de groupe et le produit porteur de seuil."
              : "Résolution du prix B2B pour le groupe."}
          </DialogDescription>
        </DialogHeader>

        {step === "configure" ? (
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="group-name">Nom du groupe</Label>
              <Input
                id="group-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={suggestion.displayName}
              />
            </div>

            <div className="space-y-2">
              <Label>Produit porteur de seuil</Label>
              <RadioGroup value={carrierId} onValueChange={setCarrierId}>
                {suggestion.products.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center gap-3 rounded-md border border-border px-3 py-2"
                  >
                    <RadioGroupItem value={p.id} id={`carrier-${p.id}`} />
                    <label
                      htmlFor={`carrier-${p.id}`}
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
                  Le groupe sera créé sans données B2B.
                </p>
              </div>
            ) : b2bResult ? (
              <div className="space-y-3">
                <div className="rounded-lg border border-border bg-muted/30 p-3">
                  <p className="text-sm text-muted-foreground">
                    Unité B2B :{" "}
                    <span className="font-semibold text-foreground">
                      {b2bResult.billing.billingUnitName}
                    </span>
                    <span className="text-xs ml-2">
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
          {step === "configure" ? (
            <>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isConfirming}
              >
                Annuler
              </Button>
              <Button
                onClick={handleGoToB2b}
                disabled={!carrierId}
              >
                Suivant
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => setStep("configure")}
                disabled={isConfirming || isResolving}
              >
                Retour
              </Button>
              <Button
                onClick={handleConfirm}
                disabled={
                  isConfirming ||
                  isResolving ||
                  (b2bResult !== null && !b2bError && !resolvedB2b)
                }
              >
                {isConfirming && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Valider le groupe
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

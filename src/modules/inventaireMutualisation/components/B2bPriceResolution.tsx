/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MUTUALISATION — B2B Price Resolution Step (UI Component)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Shown during group creation when member prices differ.
 * Lets the user choose: carrier price, average, manual input, or per-supplier.
 * 
 * ISOLATION: No writes to products_v2 or stock. Only produces a price + strategy.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useState } from "react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Check, Info } from "lucide-react";
import type { MemberPrice, PriceStrategy } from "../services/resolveB2bPrice";

interface B2bPriceResolutionProps {
  memberPrices: MemberPrice[];
  averagePrice: number;
  pricesAreEqual: boolean;
  allConversionsOk: boolean;
  billingUnitName: string;
  carrierProductId: string;
  onPriceResolved: (price: number, strategy: PriceStrategy) => void;
}

export function B2bPriceResolution({
  memberPrices,
  averagePrice,
  pricesAreEqual,
  allConversionsOk,
  billingUnitName,
  carrierProductId,
  onPriceResolved,
}: B2bPriceResolutionProps) {
  const [strategy, setStrategy] = useState<PriceStrategy>(
    pricesAreEqual ? "carrier" : "carrier"
  );
  const [manualPrice, setManualPrice] = useState("");

  const carrierPrice = memberPrices.find(
    (m) => m.productId === carrierProductId
  )?.convertedPrice;

  const handleStrategyChange = (value: string) => {
    const s = value as PriceStrategy;
    setStrategy(s);

    let price: number | null = null;
    switch (s) {
      case "carrier":
        price = carrierPrice ?? null;
        break;
      case "average":
        price = averagePrice;
        break;
      case "cheapest":
        price = Math.min(
          ...memberPrices.filter((m) => m.convertedPrice !== null).map((m) => m.convertedPrice!)
        );
        break;
      case "most_expensive":
        price = Math.max(
          ...memberPrices.filter((m) => m.convertedPrice !== null).map((m) => m.convertedPrice!)
        );
        break;
      case "manual":
        price = parseFloat(manualPrice) || null;
        break;
    }

    if (price !== null) {
      onPriceResolved(price, s);
    }
  };

  const handleManualPriceChange = (value: string) => {
    setManualPrice(value);
    const parsed = parseFloat(value);
    if (!isNaN(parsed) && parsed > 0) {
      onPriceResolved(parsed, "manual");
    }
  };

  // If all prices are equal, auto-resolve
  if (pricesAreEqual && carrierPrice !== null) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Check className="h-4 w-4 text-primary" />
          Prix B2B automatiquement résolu
        </div>
        <p className="text-sm text-muted-foreground">
          Tous les fournisseurs ont le même prix :{" "}
          <span className="font-semibold text-foreground">
            {carrierPrice.toFixed(4)} € / {billingUnitName}
          </span>
        </p>
      </div>
    );
  }

  if (!allConversionsOk) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium text-destructive">
          <AlertTriangle className="h-4 w-4" />
          Conversion de prix incomplète
        </div>
        <p className="text-sm text-muted-foreground">
          Certaines conversions BFS n'ont pas abouti. Vérifiez le conditionnement des produits.
        </p>
        <div className="space-y-1">
          {memberPrices
            .filter((m) => !m.conversionOk)
            .map((m) => (
              <div key={m.productId} className="text-xs text-destructive flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                {m.productName} — conversion échouée
              </div>
            ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Price comparison header */}
      <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Info className="h-4 w-4 text-primary" />
          Prix différents détectés
        </div>
        <div className="space-y-1">
          {memberPrices
            .filter((m) => m.conversionOk)
            .map((m) => (
              <div key={m.productId} className="flex justify-between text-sm">
                <span className="text-muted-foreground truncate max-w-[60%]">
                  {m.productName}
                </span>
                <span className="font-mono font-medium text-foreground">
                  {m.convertedPrice?.toFixed(4)} € / {billingUnitName}
                  {m.productId === carrierProductId && (
                    <Badge variant="outline" className="ml-2 text-[10px]">
                      Porteur
                    </Badge>
                  )}
                </span>
              </div>
            ))}
        </div>
      </div>

      {/* Strategy selection */}
      <div className="space-y-2">
        <Label>Choisir le prix B2B</Label>
        <RadioGroup value={strategy} onValueChange={handleStrategyChange}>
          <div className="flex items-center gap-3 rounded-md border border-border px-3 py-2">
            <RadioGroupItem value="carrier" id="price-carrier" />
            <label htmlFor="price-carrier" className="flex-1 cursor-pointer text-sm">
              Prix du porteur —{" "}
              <span className="font-mono font-semibold">
                {carrierPrice?.toFixed(4) ?? "—"} € / {billingUnitName}
              </span>
            </label>
          </div>
          <div className="flex items-center gap-3 rounded-md border border-border px-3 py-2">
            <RadioGroupItem value="average" id="price-average" />
            <label htmlFor="price-average" className="flex-1 cursor-pointer text-sm">
              Moyenne —{" "}
              <span className="font-mono font-semibold">
                {averagePrice.toFixed(4)} € / {billingUnitName}
              </span>
            </label>
          </div>
          <div className="flex items-center gap-3 rounded-md border border-border px-3 py-2">
            <RadioGroupItem value="cheapest" id="price-cheapest" />
            <label htmlFor="price-cheapest" className="flex-1 cursor-pointer text-sm">
              Prix le plus bas —{" "}
              <span className="font-mono font-semibold">
                {Math.min(
                  ...memberPrices.filter((m) => m.convertedPrice !== null).map((m) => m.convertedPrice!)
                ).toFixed(4)}{" "}
                € / {billingUnitName}
              </span>
            </label>
          </div>
          <div className="flex items-center gap-3 rounded-md border border-border px-3 py-2">
            <RadioGroupItem value="manual" id="price-manual" />
            <label htmlFor="price-manual" className="flex-1 cursor-pointer text-sm">
              Saisie manuelle
            </label>
          </div>
        </RadioGroup>

        {strategy === "manual" && (
          <div className="flex items-center gap-2 pl-7">
            <Input
              type="number"
              step="0.0001"
              min="0"
              value={manualPrice}
              onChange={(e) => handleManualPriceChange(e.target.value)}
              placeholder="0.0000"
              className="w-32 font-mono"
            />
            <span className="text-sm text-muted-foreground">€ / {billingUnitName}</span>
          </div>
        )}
      </div>
    </div>
  );
}

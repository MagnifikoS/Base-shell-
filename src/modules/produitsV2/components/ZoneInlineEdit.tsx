/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ZoneInlineEdit — Inline zone selector for ProductsV2Table
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Click zone name → Select opens → user picks → RPC fires → cache refetch.
 *
 * SSOT: products_v2.storage_zone_id (via fn_transfer_product_zone RPC)
 * No optimistic UI: displayed value always comes from DB via React Query.
 * No open={true} hack: uses defaultOpen so Radix manages dropdown lifecycle.
 */

import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, MapPin } from "lucide-react";
import { useTransferProductZone } from "@/modules/inventaire/hooks/useTransferProductZone";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import type { StorageZone } from "@/modules/produitsV2/hooks/useStorageZones";
import type { EstimatedStockOutcome } from "@/modules/stockLedger";

interface ZoneInlineEditProps {
  productId: string;
  currentZoneId: string | null;
  currentZoneName: string | null;
  zones: StorageZone[];
}

export function ZoneInlineEdit({
  productId,
  currentZoneId,
  currentZoneName,
  zones,
}: ZoneInlineEditProps) {
  const [isEditing, setIsEditing] = useState(false);
  const { transfer, isTransferring } = useTransferProductZone();
  const { activeEstablishment } = useEstablishment();
  const queryClient = useQueryClient();

  const handleZoneChange = useCallback(
    async (newZoneId: string) => {
      // Close select immediately
      setIsEditing(false);

      // Same zone = noop
      if (newZoneId === currentZoneId) return;

      // Read estimated stock from cache for ledger transfer
      let estimatedQty = 0;
      let canonicalUnitId: string | null = null;
      let canonicalFamily: string | null = null;

      const cachedStock = queryClient.getQueryData<
        Map<string, EstimatedStockOutcome>
      >(["estimated-stock", activeEstablishment?.id]);
      const productStock = cachedStock?.get(productId);
      if (productStock?.ok && productStock.data) {
        estimatedQty = productStock.data.estimated_quantity;
        canonicalUnitId = productStock.data.canonical_unit_id;
        canonicalFamily = productStock.data.canonical_family;
      }

      // Single RPC call — SSOT write path
      await transfer({
        productId,
        newZoneId,
        estimatedQty,
        canonicalUnitId,
        canonicalFamily,
        contextHash: null,
      });

      // Success: hook invalidates ["products-v2"] cache → parent re-renders with new zone
      // Failure: hook shows error toast → UI stays on current (DB) value
    },
    [productId, currentZoneId, transfer, queryClient, activeEstablishment?.id],
  );

  // Loading state during RPC
  if (isTransferring) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span>Transfert…</span>
      </span>
    );
  }

  // Edit mode: standard Radix Select, defaultOpen so it opens immediately
  if (isEditing) {
    return (
      <div onClick={(e) => e.stopPropagation()}>
        <Select
          value={currentZoneId ?? undefined}
          onValueChange={handleZoneChange}
          defaultOpen
          onOpenChange={(open) => {
            if (!open) setIsEditing(false);
          }}
        >
          <SelectTrigger className="h-7 text-xs w-[140px]">
            <SelectValue placeholder="Choisir zone" />
          </SelectTrigger>
          <SelectContent>
            {zones
              .filter((z) => z.is_active)
              .map((zone) => (
                <SelectItem key={zone.id} value={zone.id}>
                  {zone.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  // Display mode: clickable zone name
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        setIsEditing(true);
      }}
      className="group/zone inline-flex items-center gap-1 text-sm hover:text-primary transition-colors cursor-pointer"
      title="Cliquer pour changer la zone"
    >
      {currentZoneName ?? (
        <span className="text-muted-foreground">—</span>
      )}
      <MapPin className="h-3 w-3 opacity-0 group-hover/zone:opacity-60 transition-opacity" />
    </button>
  );
}

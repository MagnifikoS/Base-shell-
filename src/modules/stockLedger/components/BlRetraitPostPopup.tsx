/**
 * ═══════════════════════════════════════════════════════════════════════════
 * BL RETRAIT POST POPUP — Type de retrait chooser
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Shown BEFORE posting. Two choices:
 * 1. "Retrait interne" → POST stock document directly, no BL
 * 2. "Transfert inter-établissement" → POST + create BL Retrait
 *
 * Stock pre-check: Before posting a transfer, checks estimated stock.
 * If some products are insufficient, shows an adjustment confirmation
 * dialog. On confirm, adjusts the draft lines then proceeds.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import { Check, Loader2, Home, Truck, AlertTriangle, Trash2, ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { useAuth } from "@/contexts/AuthContext";
import { useCreateBlRetrait } from "../hooks/useCreateBlRetrait";
import { checkStockAvailability, type StockCheckResult } from "../hooks/useCheckStockAvailability";

import type { CreateBlRetraitLinePayload } from "../types/blRetrait";

interface CartLineInfo {
  product_id: string;
  product_name: string;
  quantity: number;
  canonical_label: string | null;
}

interface OtherEstablishment {
  id: string;
  name: string;
}

type WithdrawalMode = null | "internal" | "transfer";

interface BlRetraitPostPopupProps {
  open: boolean;
  onClose: () => void;
  stockDocumentId: string | null;
  lines: CartLineInfo[];
  /** Posts the stock document. Returns true on success. */
  onPostInternal: () => Promise<boolean>;
  isPosting: boolean;
  /** Pre-select "transfer" mode with this destination (e.g. from commande flow) */
  preselectedDestinationId?: string | null;
  /** Display name for the preselected destination (avoids RLS lookup issues) */
  preselectedDestinationName?: string | null;
  /** Lock destination so user cannot change it (mode strict) */
  lockDestination?: boolean;
  /** Called with BL Retrait ID + BL number after successful creation */
  onBlCreated?: (blId: string, blNumber: string) => void;
}

export function BlRetraitPostPopup({
  open,
  onClose,
  stockDocumentId,
  lines,
  onPostInternal,
  isPosting,
  preselectedDestinationId,
  preselectedDestinationName,
  lockDestination = false,
  onBlCreated,
}: BlRetraitPostPopupProps) {
  const { activeEstablishment } = useEstablishment();
  const { user } = useAuth();
  const createBlRetrait = useCreateBlRetrait();
  const inTransitMap = undefined;

  const estId = activeEstablishment?.id ?? null;
  const orgId = activeEstablishment?.organization_id ?? null;

  const [mode, setMode] = useState<WithdrawalMode>(
    preselectedDestinationId ? "transfer" : null
  );
  const [destinationId, setDestinationId] = useState<string>(
    preselectedDestinationId ?? ""
  );
  const [isCreating, setIsCreating] = useState(false);

  // Stock check state
  const [stockCheckResults, setStockCheckResults] = useState<StockCheckResult[] | null>(null);
  const [isCheckingStock, setIsCheckingStock] = useState(false);
  const [adjustedLines, setAdjustedLines] = useState<CartLineInfo[] | null>(null);

  useEffect(() => {
    if (!open) {
      setMode(null);
      setDestinationId("");
      setIsCreating(false);
      setStockCheckResults(null);
      setIsCheckingStock(false);
      setAdjustedLines(null);
    } else if (preselectedDestinationId) {
      setMode("transfer");
      setDestinationId(preselectedDestinationId);
    }
  }, [open, preselectedDestinationId]);

  const { data: otherEstablishments = [] } = useQuery<OtherEstablishment[]>({
    queryKey: ["establishments-for-bl-retrait", orgId, estId],
    queryFn: async () => {
      if (!orgId || !estId) return [];
      const { data, error } = await supabase
        .from("establishments")
        .select("id, name")
        .eq("organization_id", orgId)
        .eq("status", "active")
        .neq("id", estId)
        .order("name");
      if (error) throw error;
      return (data ?? []) as OtherEstablishment[];
    },
    enabled: open && !!orgId && !!estId,
  });

  const productIds = useMemo(() => lines.map((l) => l.product_id), [lines]);

  const { data: productPrices = [] } = useQuery({
    queryKey: ["product-prices-for-bl-retrait", productIds],
    queryFn: async () => {
      if (productIds.length === 0) return [];
      const { data, error } = await supabase
        .from("products_v2")
        .select("id, final_unit_price, stock_handling_unit_id")
        .in("id", productIds);
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string;
        final_unit_price: number | null;
        stock_handling_unit_id: string | null;
      }>;
    },
    enabled: open && productIds.length > 0,
  });

  const selectedEstablishment = otherEstablishments.find((e) => e.id === destinationId);

  // ═══ Internal: POST only, close on success ═══
  const handleInternal = async () => {
    const ok = await onPostInternal();
    if (ok) onClose();
  };

  // ═══ Transfer: Auto-adjust stock, then POST + BL (STOCK ZERO V1: no popup) ═══
  const handleTransferClick = useCallback(async () => {
    if (!estId) return;

    setIsCheckingStock(true);
    try {
      const checkLines = lines.map((l) => ({
        product_id: l.product_id,
        product_name: l.product_name,
        requested: Math.abs(l.quantity),
      }));

      const results = await checkStockAvailability(estId, checkLines, inTransitMap);
      const hasIssues = results.some((r) => r.action !== "ok");

      if (hasIssues) {
        // STOCK ZERO V1: Auto-adjust silently (no popup)
        const adjustedLines: CartLineInfo[] = [];
        for (const line of lines) {
          const check = results.find((r) => r.product_id === line.product_id);
          if (!check || check.action === "ok") {
            adjustedLines.push(line);
          } else if (check.action === "reduce") {
            adjustedLines.push({
              ...line,
              quantity: -Math.abs(check.available),
            });
          }
          // "remove" → skip line entirely
        }

        if (adjustedLines.length === 0) {
          toast.error("Aucun produit disponible — impossible de créer le BL");
          return;
        }

        setAdjustedLines(adjustedLines);
        await executeTransfer(adjustedLines, true);
      } else {
        await executeTransfer(lines);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erreur vérification stock";
      toast.error(message);
    } finally {
      setIsCheckingStock(false);
    }
  }, [estId, lines, inTransitMap]);

  // ═══ Execute the actual transfer (POST + BL) with given lines ═══
  const executeTransfer = useCallback(async (transferLines: CartLineInfo[], isAdjusted = false) => {
    if (!estId || !orgId || !user?.id || !stockDocumentId) return;

    // If lines were adjusted, update stock_document_lines BEFORE posting
    if (isAdjusted) {
      await applyLineAdjustments(stockDocumentId, lines, transferLines);
    }

    const ok = await onPostInternal();
    if (!ok) return;

    setIsCreating(true);
    try {
      // Fetch prices inline to avoid race condition with useQuery
      const pIds = transferLines.map((l) => l.product_id);
      const { data: freshPrices } = await supabase
        .from("products_v2")
        .select("id, final_unit_price, stock_handling_unit_id")
        .in("id", pIds);

      const priceMap = new Map<string, { price: number | null; unitId: string | null }>();
      for (const p of (freshPrices ?? [])) {
        priceMap.set(p.id, { price: p.final_unit_price, unitId: p.stock_handling_unit_id });
      }

      const blLines: CreateBlRetraitLinePayload[] = transferLines.map((line) => {
        const info = priceMap.get(line.product_id);
        return {
          product_id: line.product_id,
          product_name_snapshot: line.product_name,
          quantity: Math.abs(line.quantity),
          unit_label: line.canonical_label ?? null,
          canonical_unit_id: info?.unitId ?? null,
          unit_price: info?.price ?? null,
        };
      });

      const result = await createBlRetrait.mutateAsync({
        establishment_id: estId,
        organization_id: orgId,
        stock_document_id: stockDocumentId,
        destination_establishment_id: destinationId || preselectedDestinationId || null,
        destination_name: selectedEstablishment?.name ?? preselectedDestinationName ?? null,
        created_by: user.id,
        lines: blLines,
      });

      toast.success(`BL Retrait ${result.bl_number} enregistré`);
      onBlCreated?.(result.id, result.bl_number);
      onClose();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Erreur";
      toast.error(`Erreur BL Retrait : ${message}`);
    } finally {
      setIsCreating(false);
    }
  }, [estId, orgId, user?.id, stockDocumentId, destinationId, selectedEstablishment, onPostInternal, createBlRetrait, onClose, onBlCreated, lines]);

  // ═══ Confirm stock adjustments ═══
  const handleConfirmAdjustments = useCallback(async () => {
    if (!stockCheckResults) return;

    // Build adjusted lines: remove "remove" products, reduce "reduce" quantities
    const newLines: CartLineInfo[] = [];
    for (const line of lines) {
      const check = stockCheckResults.find((r) => r.product_id === line.product_id);
      if (!check || check.action === "ok") {
        newLines.push(line);
      } else if (check.action === "reduce") {
        newLines.push({
          ...line,
          quantity: -Math.abs(check.available), // negative for withdrawal
        });
      }
      // "remove" → skip line entirely
    }

    if (newLines.length === 0) {
      toast.error("Aucun produit disponible — impossible de créer le BL");
      setStockCheckResults(null);
      return;
    }

    setAdjustedLines(newLines);
    setStockCheckResults(null);

    // Execute with adjusted lines (isAdjusted=true to apply DB changes)
    await executeTransfer(newLines, true);
  }, [stockCheckResults, lines, executeTransfer]);

  const isBusy = isPosting || isCreating || isCheckingStock;

  // STOCK ZERO V1: Stock insufficiency sub-dialog removed — auto-adjusted silently

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !isBusy && onClose()}>
      <DialogContent className="max-w-[95vw] sm:max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle>Type de retrait</DialogTitle>
          <DialogDescription>
            {lines.length} produit{lines.length > 1 ? "s" : ""} à retirer du stock
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {/* Option 1: Retrait interne — hidden when destination is locked (commande flow) */}
          {!lockDestination && (
            <button
              onClick={() => setMode("internal")}
              className={`w-full text-left rounded-xl border p-4 flex items-center gap-3 transition-all ${
                mode === "internal"
                  ? "border-primary bg-primary/5"
                  : "border-border bg-card hover:border-primary/30"
              }`}
            >
              <div className={`h-10 w-10 rounded-full flex items-center justify-center shrink-0 ${
                mode === "internal" ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
              }`}>
                <Home className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">Retrait interne</p>
                <p className="text-xs text-muted-foreground">
                  Consommation, perte, casse — pas de BL
                </p>
              </div>
              {mode === "internal" && <Check className="h-5 w-5 text-primary shrink-0" />}
            </button>
          )}

          {/* Option 2: Transfert */}
          <button
            onClick={() => setMode("transfer")}
            className={`w-full text-left rounded-xl border p-4 flex items-center gap-3 transition-all ${
              mode === "transfer"
                ? "border-primary bg-primary/5"
                : "border-border bg-card hover:border-primary/30"
            }`}
          >
            <div className={`h-10 w-10 rounded-full flex items-center justify-center shrink-0 ${
              mode === "transfer" ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
            }`}>
              <Truck className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Transfert inter-établissement</p>
              <p className="text-xs text-muted-foreground">
                Génère un BL de retrait avec destination
              </p>
            </div>
            {mode === "transfer" && <Check className="h-5 w-5 text-primary shrink-0" />}
          </button>

          {/* Destination selector — only for transfer */}
          {mode === "transfer" && lockDestination && (preselectedDestinationId || destinationId) && (
            <div className="space-y-2 pl-[52px]">
              <label className="text-sm font-medium">Établissement destinataire</label>
              <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
                <span className="text-sm font-semibold">
                  {preselectedDestinationName || otherEstablishments.find((e) => e.id === (preselectedDestinationId || destinationId))?.name || preselectedDestinationId || destinationId}
                </span>
              </div>
            </div>
          )}
          {mode === "transfer" && !lockDestination && otherEstablishments.length > 0 && (
            <div className="space-y-2 pl-[52px]">
              <label className="text-sm font-medium">Établissement destinataire</label>
              <Select value={destinationId} onValueChange={setDestinationId}>
                <SelectTrigger>
                  <SelectValue placeholder="Sélectionner…" />
                </SelectTrigger>
                <SelectContent>
                  {otherEstablishments.map((est) => (
                    <SelectItem key={est.id} value={est.id}>
                      {est.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {mode === "transfer" && !lockDestination && otherEstablishments.length === 0 && (
            <p className="text-sm text-muted-foreground pl-[52px]">
              Aucun autre établissement disponible.
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={isBusy} className="flex-1">
            Annuler
          </Button>
          {mode === "internal" && (
            <Button
              variant="destructive"
              onClick={handleInternal}
              disabled={isBusy}
              className="flex-1"
            >
              {isBusy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Valider retrait
            </Button>
          )}
          {mode === "transfer" && (
            <Button
              onClick={handleTransferClick}
              disabled={isBusy || !destinationId}
              className="flex-1"
            >
              {(isBusy) && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Valider + BL
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Apply line adjustments to the stock document draft before posting.
 * - Remove lines for products not in adjustedLines
 * - Update quantities for reduced products
 */
async function applyLineAdjustments(
  documentId: string,
  originalLines: CartLineInfo[],
  adjustedLines: CartLineInfo[]
) {
  const adjustedMap = new Map(adjustedLines.map((l) => [l.product_id, l]));

  for (const original of originalLines) {
    const adjusted = adjustedMap.get(original.product_id);

    if (!adjusted) {
      // Product removed — delete line from draft
      await supabase
        .from("stock_document_lines")
        .delete()
        .eq("document_id", documentId)
        .eq("product_id", original.product_id);
    } else if (Math.abs(adjusted.quantity) !== Math.abs(original.quantity)) {
      // Quantity reduced — update line
      await supabase
        .from("stock_document_lines")
        .update({ delta_quantity_canonical: adjusted.quantity })
        .eq("document_id", documentId)
        .eq("product_id", adjusted.product_id);
    }
  }
}

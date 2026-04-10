/**
 * PreparationDialog — Full-screen supplier preparation flow (compact mobile UX)
 *
 * Swipe right = OK, Swipe left = Rupture, Tap = Edit qty via BFS modal
 * Color-coded rows: green (ok), red (rupture), amber (modifié)
 * State is persisted to DB immediately.
 * "Expédier" only when all lines processed.
 * Auto-opens (marks as "ouverte") if commande is "envoyee".
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { Button } from "@/components/ui/button";
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
import {
  ArrowLeft,
  Loader2,
  Truck,
  Check,
  X,
  Package,
  Clock,
  User,
  StickyNote,
} from "lucide-react";
import { toast } from "sonner";
import {
  useCommandeDetail,
  useOpenCommande,
  useShipCommande,
  useUpdateLinePreparation,
} from "../hooks/useCommandes";
import { CommandeStatusBadge } from "./CommandeStatusBadge";
import type { Commande, CommandeLine, LineStatus } from "../types";
import { useErpQuantityLabels } from "../hooks/useErpQuantityLabels";
import { formatInputEntries } from "../utils/formatInputEntries";
import { formatParisHHMM } from "@/lib/time/paris";
import { formatParisDateKey } from "@/lib/time/dateKeyParis";
import { useUnitConversions } from "@/core/unitConversion";
import { QuantityModalWithResolver } from "@/components/stock/QuantityModalWithResolver";
import { type QuantityProduct } from "@/components/stock/UniversalQuantityModal";
import { supabase } from "@/integrations/supabase/client";
import {
  resolveProductUnitContext,
} from "@/core/unitConversion/resolveProductUnitContext";
import type { ConditioningConfig } from "@/modules/shared/conditioningTypes";
import { translateClientQtyToSupplier, translateSupplierQtyToClient } from "../utils/b2bQuantity";

interface Props {
  open: boolean;
  onClose: () => void;
  commande: Commande;
  establishmentNames: Record<string, string>;
}

interface LocalLine extends CommandeLine {
  localShippedQty: number;
  localStatus: LineStatus | null;
}

function fmtDateTime(iso: string): string {
  const dateKey = formatParisDateKey(new Date(iso));
  const [, mm, dd] = dateKey.split("-");
  return `${dd}/${mm} · ${formatParisHHMM(iso)}`;
}

export function PreparationDialog({ open, onClose, commande, establishmentNames }: Props) {
  const { data, isLoading } = useCommandeDetail(open ? commande.id : null);
  const isMobile = useIsMobile();
  const openMutation = useOpenCommande();
  const shipMutation = useShipCommande();
  const updateLine = useUpdateLinePreparation();
  const [localLines, setLocalLines] = useState<LocalLine[]>([]);
  const [confirmShip, setConfirmShip] = useState(false);
  const [isShipping, setIsShipping] = useState(false);
  const [hasTriggeredOpen, setHasTriggeredOpen] = useState(false);
  const [showClampAlert, setShowClampAlert] = useState(false);

  // BFS modal state
  const { conversions: dbConversions, units: dbUnits } = useUnitConversions();
  const [bfsProduct, setBfsProduct] = useState<QuantityProduct | null>(null);
  const [bfsLineId, setBfsLineId] = useState<string | null>(null);
  const [bfsExistingQty, setBfsExistingQty] = useState<number | null>(null);
  const [bfsConversionFactor, setBfsConversionFactor] = useState<number>(1);

  // ERP quantity display
  const lineProductIds = localLines.length > 0 ? localLines.map((l) => l.product_id) : (data?.lines ?? []).map((l) => l.product_id);
  const { formatQty: erpFormat } = useErpQuantityLabels({
    productIds: lineProductIds,
    clientEstablishmentId: commande.client_establishment_id,
    supplierEstablishmentId: commande.supplier_establishment_id,
  });

  // Auto-open: mark commande as "ouverte" when supplier views "envoyee"
  useEffect(() => {
    if (!open || !commande || commande.status !== "envoyee" || hasTriggeredOpen) return;
    setHasTriggeredOpen(true);
    openMutation.mutate(commande.id, {
      onSuccess: (result) => {
        if (!result.already_opened) {
          toast.info("Commande marquée en préparation");
        }
      },
      onError: () => {
        toast.error("Erreur lors de l'ouverture");
      },
    });
  }, [open, commande, hasTriggeredOpen, openMutation]);

  // Initialize local state from DB lines
  useEffect(() => {
    if (data?.lines) {
      setLocalLines(
        data.lines.map((l) => ({
          ...l,
          localShippedQty: l.shipped_quantity ?? l.canonical_quantity,
          localStatus: l.line_status as LineStatus | null,
        }))
      );
    }
  }, [data?.lines]);

  const allProcessed = localLines.length > 0 && localLines.every((l) => l.localStatus !== null);
  const clientName = establishmentNames[commande.client_establishment_id] || "Client";

  const persistLine = useCallback(
    async (lineId: string, qty: number, status: LineStatus): Promise<{ clamped: boolean; actualQuantity: number }> => {
      try {
        const result = await updateLine.mutateAsync({ lineId, shippedQuantity: qty, lineStatus: status });
        return result;
      } catch {
        // silent — will be re-persisted on ship
        return { clamped: false, actualQuantity: qty };
      }
    },
    [updateLine]
  );

  const handleOk = useCallback(
    (line: LocalLine) => {
      const qty = line.canonical_quantity;
      setLocalLines((prev) =>
        prev.map((l) =>
          l.id === line.id ? { ...l, localShippedQty: qty, localStatus: "ok" } : l
        )
      );
      persistLine(line.id, qty, "ok");
    },
    [persistLine]
  );

  const handleRupture = useCallback(
    (line: LocalLine) => {
      setLocalLines((prev) =>
        prev.map((l) =>
          l.id === line.id ? { ...l, localShippedQty: 0, localStatus: "rupture" } : l
        )
      );
      persistLine(line.id, 0, "rupture");
    },
    [persistLine]
  );

  // Open BFS modal for a line
  const handleStartEdit = useCallback(async (line: LocalLine) => {
    // The product_id in commande_lines is the CLIENT's product.
    // The supplier can't read it directly (RLS). We resolve via b2b_imported_products
    // to find the supplier's own product (source_product_id) for BFS context.

    // Step 1: Find the supplier's own product via b2b mapping
    const { data: importMapping, error: mappingErr } = await supabase
      .from("b2b_imported_products")
      .select("source_product_id, unit_mapping")
      .eq("local_product_id", line.product_id)
      .eq("source_establishment_id", commande.supplier_establishment_id)
      .limit(1)
      .maybeSingle();

    if (import.meta.env.DEV && mappingErr) {
      console.warn("[PreparationDialog] b2b mapping lookup error:", mappingErr.message);
    }

    // No mapping = product is not a B2B import → cannot use BFS
    if (!importMapping?.source_product_id) {
      toast.error(
        "Ce produit n'est pas lié au catalogue fournisseur — la conversion d'unités n'est pas disponible."
      );
      return;
    }

    const productIdToFetch = importMapping.source_product_id;

    // Step 2: Fetch the supplier's own product for BFS context
    const { data: product, error: productErr } = await supabase
      .from("products_v2")
      .select("id, nom_produit, stock_handling_unit_id, final_unit_id, delivery_unit_id, supplier_billing_unit_id, conditionnement_config, category")
      .eq("id", productIdToFetch)
      .maybeSingle();

    if (import.meta.env.DEV && productErr) {
      console.warn("[PreparationDialog] product fetch error:", productErr.message);
    }

    if (!product) {
      toast.error("Produit fournisseur introuvable dans le catalogue.");
      return;
    }

    setBfsProduct(product as QuantityProduct);
    setBfsLineId(line.id);

    // ── B2B translation: convert client canonical qty → supplier canonical qty ──
    // Uses SAME logic as useErpQuantityLabels Pass 2 (no parallel duplication).
    // line.canonical_quantity is in CLIENT's canonical unit space.
    // We must translate it to SUPPLIER's canonical unit before injecting into modal.
    const supplierCtx = resolveProductUnitContext(
      {
        stock_handling_unit_id: product.stock_handling_unit_id,
        final_unit_id: product.final_unit_id,
        delivery_unit_id: product.delivery_unit_id,
        supplier_billing_unit_id: product.supplier_billing_unit_id,
        conditionnement_config: product.conditionnement_config as unknown as ConditioningConfig | null,
      },
      dbUnits,
      dbConversions,
    );
    const supplierOptions = supplierCtx.allowedInventoryEntryUnits;

    const persistedMapping = importMapping.unit_mapping as Record<string, string> | null;

    const translation = translateClientQtyToSupplier(
      line.canonical_quantity,
      line.unit_label_snapshot,
      supplierOptions,
      persistedMapping,
      line.canonical_unit_id,
    );

    setBfsConversionFactor(translation.factor);
    setBfsExistingQty(translation.quantity);
  }, [commande.supplier_establishment_id, dbUnits, dbConversions]);

  // BFS modal confirm: convert supplier-space qty back to client-space, then persist
  const handleBfsConfirm = useCallback(
    async (params: {
      productId: string;
      canonicalQuantity: number;
      canonicalUnitId: string;
      canonicalLabel: string | null;
    }) => {
      if (!bfsLineId) return;
      const supplierQty = params.canonicalQuantity;
      const line = localLines.find((l) => l.id === bfsLineId);
      if (!line) return;

      // Convert supplier-space → client-space before persisting
      const clientQty = translateSupplierQtyToClient(supplierQty, bfsConversionFactor);

      const status: LineStatus =
        clientQty === 0 ? "rupture" : clientQty === line.canonical_quantity ? "ok" : "modifie";

      // Persist in client-space — backend expects client reference
      const result = await persistLine(bfsLineId, clientQty, status);

      const finalQty = result.clamped ? result.actualQuantity : clientQty;
      const finalStatus: LineStatus =
        finalQty === 0 ? "rupture" : finalQty === line.canonical_quantity ? "ok" : "modifie";

      setLocalLines((prev) =>
        prev.map((l) =>
          l.id === bfsLineId ? { ...l, localShippedQty: finalQty, localStatus: finalStatus } : l
        )
      );

      // Show centered popup if clamped
      if (result.clamped) {
        setShowClampAlert(true);
      }

      setBfsProduct(null);
      setBfsLineId(null);
      setBfsExistingQty(null);
      setBfsConversionFactor(1);
    },
    [bfsLineId, localLines, persistLine, bfsConversionFactor]
  );

  const handleShip = useCallback(async () => {
    setIsShipping(true);
    try {
      const lines = localLines.map((l) => ({
        line_id: l.id,
        shipped_quantity: l.localShippedQty,
      }));
      await shipMutation.mutateAsync({ commandeId: commande.id, lines });
      toast.success("Commande expédiée !");
      setConfirmShip(false);
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      console.error("[PreparationDialog] ship failed:", msg, err);
      toast.error(msg.includes("invalid_status") ? "Commande déjà expédiée" : `Erreur lors de l'expédition${msg ? `: ${msg}` : ""}`);
    } finally {
      setIsShipping(false);
    }
  }, [localLines, shipMutation, commande.id, onClose]);

  const handleClose = useCallback(() => {
    setHasTriggeredOpen(false);
    onClose();
  }, [onClose]);

  if (!open) return null;

  const processedCount = localLines.filter((l) => l.localStatus).length;

  return (
    <>
      <div className="fixed inset-0 z-[55] bg-background flex flex-col animate-in fade-in slide-in-from-bottom-2 duration-200">
        {/* Header — always visible */}
        <header className="shrink-0 bg-background border-b z-10">
          <div className="flex items-center gap-3 px-4 sm:px-8 h-14 sm:h-16 max-w-2xl mx-auto">
            <button
              onClick={handleClose}
              className="flex items-center justify-center h-9 w-9 rounded-xl hover:bg-accent active:scale-95 transition-all -ml-1"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="flex-1 min-w-0">
              <h1 className="text-base sm:text-lg font-semibold truncate">
                Préparation
              </h1>
              <p className="text-xs text-muted-foreground truncate">
                {clientName}
              </p>
            </div>
            <CommandeStatusBadge status={data?.commande?.status ?? commande.status} isSender={false} />
          </div>
        </header>

        {/* Content — scrollable area */}
        <main className="flex-1 overflow-y-auto min-h-0">
          <div className="w-full px-3 sm:px-8 py-3 sm:py-4 space-y-2.5 max-w-2xl mx-auto">
            {/* Order info card */}
            <div className="rounded-xl border bg-card px-3 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                {commande.sent_at ? fmtDateTime(commande.sent_at) : fmtDateTime(commande.created_at)}
              </span>
              {commande.created_by_name && (
                <span className="flex items-center gap-1.5">
                  <User className="h-3.5 w-3.5" />
                  {commande.created_by_name}
                </span>
              )}
              {commande.note && (
                <span className="flex items-center gap-1.5 basis-full">
                  <StickyNote className="h-3.5 w-3.5 shrink-0" />
                  <span className="italic truncate">{commande.note}</span>
                </span>
              )}
            </div>

            {/* Lines */}
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Produits ({localLines.length})
                  </h2>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {processedCount}/{localLines.length}
                  </span>
                </div>

                {localLines.map((line) => (
                  <SwipeablePrepLine
                    key={line.id}
                    line={line}
                    erpFormat={erpFormat}
                    isMobile={isMobile}
                    onOk={() => handleOk(line)}
                    onRupture={() => handleRupture(line)}
                    onTap={() => handleStartEdit(line)}
                  />
                ))}
              </div>
            )}

            {/* Minimal safe-area spacer */}
            <div className="h-2 pb-safe-area-bottom" />
          </div>
        </main>

        {/* Footer — always visible */}
        <div className="shrink-0 border-t bg-background z-10 pb-safe-area-bottom">
          <div className="flex items-center justify-between px-4 sm:px-8 py-2.5 max-w-2xl mx-auto">
            <div className="text-sm text-muted-foreground tabular-nums">
              {processedCount}/{localLines.length} traité{localLines.length > 1 ? "s" : ""}
            </div>
            <Button
              onClick={() => setConfirmShip(true)}
              disabled={!allProcessed || isShipping}
              size="sm"
              className="shrink-0"
            >
              {isShipping ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
              ) : (
                <Truck className="h-4 w-4 mr-1.5" />
              )}
              Expédier
            </Button>
          </div>
        </div>
      </div>

      {/* BFS Quantity Modal */}
      <QuantityModalWithResolver
        open={!!bfsProduct}
        onClose={() => {
          setBfsProduct(null);
          setBfsLineId(null);
          setBfsExistingQty(null);
        }}
        product={bfsProduct}
        dbUnits={dbUnits}
        dbConversions={dbConversions}
        contextLabel="Préparation"
        contextType="order"
        existingQuantity={bfsExistingQty}
        onConfirm={handleBfsConfirm}
      />

      {/* Confirm ship dialog */}
      <AlertDialog open={confirmShip} onOpenChange={setConfirmShip}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmer l'expédition</AlertDialogTitle>
            <AlertDialogDescription>
              La commande sera marquée comme expédiée et le client sera notifié.
              {localLines.some((l) => l.localStatus === "rupture") && (
                <span className="block mt-2 text-red-600 font-medium">
                  ⚠️ Certains produits sont en rupture.
                </span>
              )}
              {localLines.some((l) => l.localStatus === "modifie") && (
                <span className="block mt-1 text-amber-600 font-medium">
                  ⚠️ Certaines quantités ont été modifiées.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isShipping}>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={handleShip} disabled={isShipping}>
              {isShipping ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
              ) : (
                <Truck className="h-4 w-4 mr-1.5" />
              )}
              Confirmer l'expédition
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Rule 0: Clamp alert popup */}
      <AlertDialog open={showClampAlert} onOpenChange={setShowClampAlert}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Quantité ajustée</AlertDialogTitle>
            <AlertDialogDescription>
              La quantité a été ramenée à la quantité commandée. Il n'est pas possible d'expédier plus que le commandé.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setShowClampAlert(false)}>
              OK
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/* ─── Swipeable Preparation Line ─────────────────────────────────────────── */

const SWIPE_THRESHOLD = 60;

interface SwipeablePrepLineProps {
  line: LocalLine;
  erpFormat: (productId: string, qty: number, unitId: string, unitLabel: string | null) => string;
  isMobile: boolean;
  onOk: () => void;
  onRupture: () => void;
  onTap: () => void;
}

function SwipeablePrepLine({ line, erpFormat, isMobile, onOk, onRupture, onTap }: SwipeablePrepLineProps) {
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const touchStartTime = useRef(0);
  const currentX = useRef(0);
  const maxDy = useRef(0);
  const isSwiping = useRef(false);
  const isLocked = useRef(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const bgLeftRef = useRef<HTMLDivElement>(null);
  const bgRightRef = useRef<HTMLDivElement>(null);

  const rowBg =
    line.localStatus === "ok"
      ? "bg-emerald-50/70 border-emerald-200/60 dark:bg-emerald-950/20 dark:border-emerald-800/40"
      : line.localStatus === "rupture"
      ? "bg-red-50/70 border-red-200/60 dark:bg-red-950/20 dark:border-red-800/40"
      : line.localStatus === "modifie"
      ? "bg-amber-50/70 border-amber-200/60 dark:bg-amber-950/20 dark:border-amber-800/40"
      : "bg-card border-border";

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    touchStartTime.current = Date.now();
    currentX.current = 0;
    maxDy.current = 0;
    isSwiping.current = false;
    isLocked.current = false;
    // Reset backgrounds to hidden
    if (bgLeftRef.current) bgLeftRef.current.style.opacity = "0";
    if (bgRightRef.current) bgRightRef.current.style.opacity = "0";
    // Remove transition for immediate response
    if (rowRef.current) rowRef.current.style.transition = "";
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const dx = e.touches[0].clientX - touchStartX.current;
    const dy = e.touches[0].clientY - touchStartY.current;

    // Track max vertical movement to suppress false taps during scroll
    maxDy.current = Math.max(maxDy.current, Math.abs(dy));

    // First movement: decide if horizontal or vertical scroll
    if (!isLocked.current && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      isLocked.current = true;
      isSwiping.current = Math.abs(dx) > Math.abs(dy) * 1.2;
    }

    if (!isSwiping.current) return;

    e.preventDefault();
    const clamped = Math.max(-120, Math.min(120, dx));
    currentX.current = clamped;

    if (rowRef.current) {
      rowRef.current.style.transform = `translateX(${clamped}px)`;
    }

    // Show only the relevant background based on direction
    const progress = Math.min(1, Math.abs(clamped) / SWIPE_THRESHOLD);
    if (clamped > 0) {
      if (bgLeftRef.current) bgLeftRef.current.style.opacity = String(progress);
      if (bgRightRef.current) bgRightRef.current.style.opacity = "0";
    } else if (clamped < 0) {
      if (bgRightRef.current) bgRightRef.current.style.opacity = String(progress);
      if (bgLeftRef.current) bgLeftRef.current.style.opacity = "0";
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    const wasSwiping = isSwiping.current;
    const finalX = currentX.current;
    const elapsed = Date.now() - touchStartTime.current;
    const verticalMoved = maxDy.current;

    // Animate card back
    if (rowRef.current) {
      rowRef.current.style.transition = "transform 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94)";
      rowRef.current.style.transform = "translateX(0)";
    }
    // Fade out backgrounds
    if (bgLeftRef.current) {
      bgLeftRef.current.style.transition = "opacity 0.2s ease";
      bgLeftRef.current.style.opacity = "0";
    }
    if (bgRightRef.current) {
      bgRightRef.current.style.transition = "opacity 0.2s ease";
      bgRightRef.current.style.opacity = "0";
    }
    // Clean transitions after animation
    setTimeout(() => {
      if (rowRef.current) rowRef.current.style.transition = "";
      if (bgLeftRef.current) bgLeftRef.current.style.transition = "";
      if (bgRightRef.current) bgRightRef.current.style.transition = "";
    }, 220);

    if (wasSwiping) {
      if (finalX >= SWIPE_THRESHOLD) {
        onOk();
      } else if (finalX <= -SWIPE_THRESHOLD) {
        onRupture();
      }
      isSwiping.current = false;
      return;
    }

    // Suppress tap if finger moved vertically (user was scrolling)
    if (elapsed < 250 && Math.abs(finalX) < 5 && verticalMoved < 15) {
      onTap();
    }
  }, [onOk, onRupture, onTap]);

  return (
    <div className="relative overflow-hidden rounded-xl">
      {/* Green background — revealed only on swipe RIGHT */}
      <div
        ref={bgLeftRef}
        className="absolute inset-0 bg-emerald-500 flex items-center pl-5 opacity-0"
        style={{ willChange: "opacity" }}
      >
        <Check className="h-5 w-5 text-white" />
        <span className="ml-2 text-sm font-semibold text-white">OK</span>
      </div>

      {/* Red background — revealed only on swipe LEFT */}
      <div
        ref={bgRightRef}
        className="absolute inset-0 bg-destructive flex items-center justify-end pr-5 opacity-0"
        style={{ willChange: "opacity" }}
      >
        <span className="mr-2 text-sm font-semibold text-white">Rupture</span>
        <X className="h-5 w-5 text-white" />
      </div>

      {/* Foreground swipeable card */}
      <div
        ref={rowRef}
        className={`relative z-10 border rounded-xl px-3.5 py-3.5 select-none ${rowBg} ${!isMobile ? "cursor-pointer hover:bg-accent/50 transition-colors" : ""}`}
        style={{ willChange: "transform", touchAction: "pan-y" }}
        onTouchStart={isMobile ? handleTouchStart : undefined}
        onTouchMove={isMobile ? handleTouchMove : undefined}
        onTouchEnd={isMobile ? handleTouchEnd : undefined}
        onClick={(e) => {
          if (isMobile) {
            if (!("ontouchstart" in window)) {
              e.stopPropagation();
              onTap();
            }
          } else {
            e.stopPropagation();
            onTap();
          }
        }}
      >
        <div className="flex items-center gap-2.5">
          {/* Status indicator */}
          {line.localStatus ? (
            <div className={`shrink-0 h-7 w-7 rounded-full flex items-center justify-center shadow-sm ${
              line.localStatus === "ok"
                ? "bg-emerald-500 text-white"
                : line.localStatus === "rupture"
                ? "bg-destructive text-white"
                : "bg-amber-500 text-white"
            }`}>
              {line.localStatus === "ok" && <Check className="h-4 w-4" />}
              {line.localStatus === "rupture" && <X className="h-4 w-4" />}
              {line.localStatus === "modifie" && <span className="text-xs font-bold">M</span>}
            </div>
          ) : (
            <div className="shrink-0 h-7 w-7 rounded-full border-2 border-muted-foreground/20" />
          )}

          {/* Product name */}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium leading-tight break-words">
              {line.product_name_snapshot}
            </p>
          </div>

          {/* Quantity */}
          <span className="shrink-0 text-sm tabular-nums whitespace-nowrap font-medium">
            {line.localStatus === "modifie" ? (
              <>
                <span className="line-through text-muted-foreground text-xs">{Array.isArray(line.input_entries) && line.input_entries.length > 0 ? formatInputEntries(line.input_entries, line.canonical_quantity, line.unit_label_snapshot) : erpFormat(line.product_id, line.canonical_quantity, line.canonical_unit_id, line.unit_label_snapshot)}</span>
                <span className="mx-0.5 text-muted-foreground">→</span>
                <span className="font-bold text-amber-600 dark:text-amber-400">
                  {erpFormat(line.product_id, line.localShippedQty, line.canonical_unit_id, line.unit_label_snapshot)}
                </span>
              </>
            ) : line.localStatus === "rupture" ? (
              <>
                <span className="line-through text-muted-foreground text-xs">{Array.isArray(line.input_entries) && line.input_entries.length > 0 ? formatInputEntries(line.input_entries, line.canonical_quantity, line.unit_label_snapshot) : erpFormat(line.product_id, line.canonical_quantity, line.canonical_unit_id, line.unit_label_snapshot)}</span>
                <span className="mx-0.5 text-muted-foreground">→</span>
                <span className="font-bold text-destructive">0</span>
              </>
            ) : (
              <span className="font-semibold text-foreground">{Array.isArray(line.input_entries) && line.input_entries.length > 0 ? formatInputEntries(line.input_entries, line.canonical_quantity, line.unit_label_snapshot) : erpFormat(line.product_id, line.canonical_quantity, line.canonical_unit_id, line.unit_label_snapshot)}</span>
            )}
          </span>

          {/* P2: Desktop quick action buttons — OK / Rupture */}
          {!isMobile && (
            <div className="shrink-0 flex items-center gap-1 ml-1">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onOk();
                }}
                className={`h-8 w-8 rounded-full flex items-center justify-center transition-colors ${
                  line.localStatus === "ok"
                    ? "bg-emerald-500 text-white"
                    : "hover:bg-emerald-100 text-emerald-600 dark:hover:bg-emerald-950 border border-emerald-300 dark:border-emerald-700"
                }`}
                aria-label="OK"
                title="OK — quantité conforme"
              >
                <Check className="h-4 w-4" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRupture();
                }}
                className={`h-8 w-8 rounded-full flex items-center justify-center transition-colors ${
                  line.localStatus === "rupture"
                    ? "bg-destructive text-white"
                    : "hover:bg-red-100 text-destructive dark:hover:bg-red-950 border border-red-300 dark:border-red-700"
                }`}
                aria-label="Rupture"
                title="Rupture — produit indisponible"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

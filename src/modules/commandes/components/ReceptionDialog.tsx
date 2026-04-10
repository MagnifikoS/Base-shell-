/**
 * ReceptionDialog — Full-screen client reception flow
 * Stage 4: Tap-to-edit received quantities via UniversalQuantityModal (SSOT pipeline)
 * Stage 5: Per-line "Signaler" button + "Produit non commandé" for returns
 *
 * UX: Clean read-only lines by default, tap quantity to open simple stepper popup.
 * Écarts shown with strikethrough + blue background.
 */

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
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
  PackageCheck,
  Package,
  Clock,
  Truck,
  AlertTriangle,
  PackagePlus,
  RotateCcw,
  Check,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useCommandeDetail, useReceiveCommande } from "../hooks/useCommandes";
import { CommandeStatusBadge } from "./CommandeStatusBadge";
import type { Commande, CommandeLine } from "../types";
import { useErpQuantityLabels } from "../hooks/useErpQuantityLabels";
import { formatInputEntries } from "../utils/formatInputEntries";
import { formatParisHHMM } from "@/lib/time/paris";
import { formatParisDateKey } from "@/lib/time/dateKeyParis";
import { UniversalQuantityModal, type QuantityEntry, type StepperConfig } from "@/components/stock/UniversalQuantityModal";
import { useUnitConversions } from "@/core/unitConversion";
import { useProductInputConfigs, resolveInputUnitForContext } from "@/modules/inputConfig";
import { resolveInputConversion, convertToCanonical } from "@/modules/stockLedger/utils/resolveInputConversion";
import { computeMultiLevelInitValues } from "../utils/computeMultiLevelInitValues";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

import { SignalerRetourDialog, SignalerProduitNonCommandeDialog, type PendingReturnData } from "@/modules/retours";
import { useCreateReturn, useUploadReturnPhoto } from "@/modules/retours/hooks/useRetours";
import {
  DlcBadge,
  DlcLineDetailSheet,
  DlcReceptionSummaryDialog,
  useDlcBatchUpsert,
  useDlcIssuesDetection,
  useDlcRefusalToReturn,
  useDlcRequiredProducts,
  type DlcUpsertInput,
  type DlcLineDecision,
} from "@/modules/dlc";

/** Validation state exposed to parent when embedded */
export interface ReceptionValidationState {
  isAllValidated: boolean;
  isReceiving: boolean;
  pendingCount: number;
  ecartCount: number;
  /** Trigger the validate flow (DLC check → confirm dialog → receive) — respects DLC gate */
  requestValidate: () => void;
}

interface Props {
  open: boolean;
  onClose: () => void;
  commande: Commande;
  establishmentNames: Record<string, string>;
  /**
   * When true, renders only the scrollable content + modals,
   * without the full-screen wrapper, header or footer.
   * Used by CompositeReceptionDialog to embed product reception
   * inside a unified view. Default: false.
   */
  embedded?: boolean;
  /** Called on every render when embedded=true so parent can read validation state */
  onValidationStateChange?: (state: ReceptionValidationState) => void;
  /** Called after product reception succeeds in embedded mode (replaces onClose) */
  onReceiveComplete?: () => void;
  /** Called when user chooses to reorder missing products after reception */
  onReorderMissing?: (commande: Commande, missingLines: Array<{ productId: string; productName: string; missingQty: number; canonicalUnitId: string; unitLabel: string | null }>) => void;
}

function fmtDateTime(iso: string): string {
  const dateKey = formatParisDateKey(new Date(iso));
  const [, mm, dd] = dateKey.split("-");
  return `${dd}/${mm} · ${formatParisHHMM(iso)}`;
}

const STATUS_SORT_ORDER: Record<string, number> = {
  rupture: 0,
  modifie: 1,
  ok: 2,
};

export function ReceptionDialog({ open, onClose, commande, establishmentNames, embedded = false, onValidationStateChange, onReceiveComplete, onReorderMissing }: Props) {
  const { data, isLoading } = useCommandeDetail(open ? commande.id : null);
  const receiveMutation = useReceiveCommande();
  const isMobile = useIsMobile();
  const [confirmReceive, setConfirmReceive] = useState(false);
  const [isReceiving, setIsReceiving] = useState(false);
  const [showReorderPrompt, setShowReorderPrompt] = useState(false);
  const [reorderMissingLines, setReorderMissingLines] = useState<Array<{ productId: string; productName: string; missingQty: number; canonicalUnitId: string; unitLabel: string | null }>>([]);
  const [signalerLine, setSignalerLine] = useState<CommandeLine | null>(null);
  const [showProduitNonCommande, setShowProduitNonCommande] = useState(false);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);

  // P0: Local staging for returns — deferred until final validation
  const [pendingReturns, setPendingReturns] = useState<Record<string, PendingReturnData>>({});
  const createReturnMutation = useCreateReturn();
  const uploadReturnPhoto = useUploadReturnPhoto();

  // DLC V0: local state for DLC dates during reception flow
  const [dlcDates, setDlcDates] = useState<Record<string, string>>({});
  
  const dlcBatchUpsert = useDlcBatchUpsert();
  // DLC V0: summary dialog state
  const [showDlcSummary, setShowDlcSummary] = useState(false);
  const [dlcDecisions, setDlcDecisions] = useState<Record<string, DlcLineDecision>>({});
  // DLC V1: gate line — when set, DlcLineDetailSheet opens as mandatory gate before conforme
  const [dlcGateLine, setDlcGateLine] = useState<CommandeLine | null>(null);
  const { handleDlcRefusals } = useDlcRefusalToReturn({
    commandeId: commande.id,
    clientEstablishmentId: commande.client_establishment_id,
    supplierEstablishmentId: commande.supplier_establishment_id,
  });

  // ── LocalStorage draft persistence ──
  const draftKey = `reception-draft-${commande.id}`;
  const saveDraft = useCallback((
    qtys: Record<string, number>,
    validated: Record<string, "conforme" | "manquant" | "modified">,
    dlc: Record<string, string>,
  ) => {
    try {
      localStorage.setItem(draftKey, JSON.stringify({ receivedQtys: qtys, validatedLines: validated, dlcDates: dlc, ts: Date.now() }));
    } catch { /* quota exceeded — ignore */ }
  }, [draftKey]);
  const clearDraft = useCallback(() => {
    try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
  }, [draftKey]);

  // Editable received quantities: line_id → received_quantity
  const [receivedQtys, setReceivedQtys] = useState<Record<string, number>>({});
  const [initialized, setInitialized] = useState(false);
  // Per-line validation state: lines start as pending (user must validate each)
  const [validatedLines, setValidatedLines] = useState<Record<string, "conforme" | "manquant" | "modified">>({});

  // Surplus confirmation state
  const [surplusConfirm, setSurplusConfirm] = useState<{
    lineId: string;
    productName: string;
    shipped: number;
    received: number;
  } | null>(null);
  const [pendingBfsResult, setPendingBfsResult] = useState<{
    lineId: string;
    canonicalQuantity: number;
  } | null>(null);

  // SSOT: popup state — stores lineId + productId for UQM resolution
  const [receptionPopupLineId, setReceptionPopupLineId] = useState<string | null>(null);

  const lineProductIds = (data?.lines ?? []).map((l) => l.product_id);
  const { formatQty: erpFormat } = useErpQuantityLabels({
    productIds: lineProductIds,
    clientEstablishmentId: commande.client_establishment_id,
    supplierEstablishmentId: commande.supplier_establishment_id,
  });

  // SSOT: fetch product data for BFS resolution (client's own products — no B2B mapping needed)
  const { units: dbUnits, conversions: dbConversions } = useUnitConversions();
  const inputConfigs = useProductInputConfigs();

  const { data: productDataMap = {} } = useQuery({
    queryKey: ["reception-product-data", commande.client_establishment_id, lineProductIds.join(",")],
    queryFn: async () => {
      if (lineProductIds.length === 0) return {};
      const { data: products } = await supabase
        .from("products_v2")
        .select("id, nom_produit, stock_handling_unit_id, final_unit_id, delivery_unit_id, supplier_billing_unit_id, conditionnement_config, category")
        .in("id", lineProductIds);
      const map: Record<string, {
        id: string;
        nom_produit: string;
        stock_handling_unit_id: string | null;
        final_unit_id: string | null;
        delivery_unit_id: string | null;
        supplier_billing_unit_id: string | null;
        conditionnement_config: unknown;
        category: string | null;
      }> = {};
      for (const p of products ?? []) map[p.id] = p;
      return map;
    },
    enabled: lineProductIds.length > 0,
    staleTime: 60_000,
  });

  const supplierName = establishmentNames[commande.supplier_establishment_id] || "Fournisseur";

  const sortedLines = useMemo(() => {
    if (!data?.lines) return [];
    return [...data.lines].sort((a, b) => {
      const aOrder = a.line_status ? (STATUS_SORT_ORDER[a.line_status] ?? 3) : 3;
      const bOrder = b.line_status ? (STATUS_SORT_ORDER[b.line_status] ?? 3) : 3;
      return aOrder - bOrder;
    });
  }, [data?.lines]);

  // Initialize receivedQtys when lines load (once)
  // Auto-validate supplier ruptures (shipped_quantity = 0) as "manquant"
  useEffect(() => {
    if (sortedLines.length > 0 && !initialized) {
      // Try to restore a saved draft first
      let restored = false;
      try {
        const raw = localStorage.getItem(draftKey);
        if (raw) {
          const draft = JSON.parse(raw) as {
            receivedQtys?: Record<string, number>;
            validatedLines?: Record<string, "conforme" | "manquant" | "modified">;
            dlcDates?: Record<string, string>;
            ts?: number;
          };
          // Only restore if draft is < 24h old
          if (draft.ts && Date.now() - draft.ts < 24 * 60 * 60 * 1000) {
            // Merge with current lines (in case lines changed)
            const initial: Record<string, number> = {};
            const autoValidated: Record<string, "conforme" | "manquant" | "modified"> = {};
            for (const l of sortedLines) {
              const shipped = l.shipped_quantity ?? l.canonical_quantity;
              initial[l.id] = draft.receivedQtys?.[l.id] ?? shipped;
              if (shipped === 0) {
                autoValidated[l.id] = "manquant";
              }
            }
            setReceivedQtys(initial);
            setValidatedLines({
              ...autoValidated,
              ...(draft.validatedLines ?? {}),
            });
            if (draft.dlcDates) {
              setDlcDates(draft.dlcDates);
            }
            restored = true;
          }
        }
      } catch { /* corrupted draft — ignore */ }

      if (!restored) {
        const initial: Record<string, number> = {};
        const autoValidated: Record<string, "conforme" | "manquant" | "modified"> = {};
        for (const l of sortedLines) {
          const shipped = l.shipped_quantity ?? l.canonical_quantity;
          initial[l.id] = shipped;
          if (shipped === 0) {
            autoValidated[l.id] = "manquant";
          }
        }
        setReceivedQtys(initial);
        if (Object.keys(autoValidated).length > 0) {
          setValidatedLines((prev) => ({ ...prev, ...autoValidated }));
        }
      }
      setInitialized(true);
    }
  }, [sortedLines, initialized, draftKey]);

  // Persist draft to localStorage on changes
  useEffect(() => {
    if (initialized && Object.keys(validatedLines).length > 0) {
      saveDraft(receivedQtys, validatedLines, dlcDates);
    }
  }, [receivedQtys, validatedLines, dlcDates, initialized, saveDraft]);

  // Reset when dialog closes (but DON'T clear draft — user may return)
  useEffect(() => {
    if (!open) {
      setReceivedQtys({});
      setInitialized(false);
      setReceptionPopupLineId(null);
      setSurplusConfirm(null);
      setPendingBfsResult(null);
      setDlcDates({});
      
      setShowDlcSummary(false);
      setDlcDecisions({});
      setSelectedLineId(null);
      setValidatedLines({});
      setPendingReturns({});
      setDlcGateLine(null);
    }
  }, [open]);

  // P0: Handler for locally staging a return during reception
  const handleLocalReturnSubmit = useCallback((data: PendingReturnData) => {
    setPendingReturns((prev) => ({ ...prev, [data.commandeLineId]: data }));
  }, []);

  // DLC V0: all DLC detection logic delegated to the DLC module
  const { dlcIssues, productWarningDays } = useDlcIssuesDetection({
    productIds: lineProductIds,
    lines: sortedLines,
    dlcDates,
    receivedQtys,
  });

  // DLC V1: dedicated hook for mandatory DLC flag (isolated from issue detection)
  const { isDlcRequired } = useDlcRequiredProducts(lineProductIds);

  // DLC V1: handler for conforme action — gates through DLC sheet if required
  const handleConformeWithDlcGate = useCallback((line: CommandeLine) => {
    const shippedQty = line.shipped_quantity ?? line.canonical_quantity;
    // If DLC required and not yet entered, open the DLC gate sheet
    if (isDlcRequired(line.product_id) && !dlcDates[line.id]) {
      setDlcGateLine(line);
      return;
    }
    // Otherwise, validate directly
    setReceivedQtys((prev) => ({ ...prev, [line.id]: shippedQty }));
    setValidatedLines((prev) => ({ ...prev, [line.id]: "conforme" }));
  }, [isDlcRequired, dlcDates]);

  // DLC V1: callback when DLC gate sheet confirms a date
  const handleDlcGateConfirm = useCallback((date: string) => {
    if (!dlcGateLine) return;
    const shippedQty = dlcGateLine.shipped_quantity ?? dlcGateLine.canonical_quantity;
    // Store the DLC date
    setDlcDates((prev) => ({ ...prev, [dlcGateLine.id]: date }));
    // Now validate the line as conforme
    setReceivedQtys((prev) => ({ ...prev, [dlcGateLine.id]: shippedQty }));
    setValidatedLines((prev) => ({ ...prev, [dlcGateLine.id]: "conforme" }));
    setDlcGateLine(null);
  }, [dlcGateLine]);

  const getReceivedQty = (lineId: string, fallback: number) =>
    receivedQtys[lineId] ?? fallback;

  // Detect écarts (received != shipped)
  const ecarts = useMemo(() => {
    return sortedLines.filter((l) => {
      const shipped = l.shipped_quantity ?? l.canonical_quantity;
      const received = getReceivedQty(l.id, shipped);
      return received !== shipped;
    });
  }, [sortedLines, receivedQtys]);

  // Detect surplus écarts specifically
  const surplusEcarts = useMemo(() => {
    return sortedLines.filter((l) => {
      const shipped = l.shipped_quantity ?? l.canonical_quantity;
      const received = getReceivedQty(l.id, shipped);
      return received > shipped;
    });
  }, [sortedLines, receivedQtys]);

  const hasEcarts = ecarts.length > 0;
  const hasSurplus = surplusEcarts.length > 0;

  const handleValidateClick = useCallback(() => {
    if (dlcIssues.length > 0) {
      setShowDlcSummary(true);
    } else {
      setConfirmReceive(true);
    }
  }, [dlcIssues]);

  // DLC V0: after DLC summary confirmation, proceed to standard confirm
  const handleDlcSummaryConfirm = useCallback((decisions: Record<string, DlcLineDecision>) => {
    setDlcDecisions(decisions);
    setShowDlcSummary(false);
    setConfirmReceive(true);
  }, []);

  // SSOT: Open UQM for a line
  const handleOpenReceptionPopup = useCallback((line: CommandeLine) => {
    setReceptionPopupLineId(line.id);
  }, []);

  // SSOT: UQM confirm — convert raw entries to canonical, then apply
  const handleReceptionConfirmRaw = useCallback(
    (entries: QuantityEntry[]) => {
      if (!receptionPopupLineId) return;
      const line = sortedLines.find((l) => l.id === receptionPopupLineId);
      if (!line) return;

      const product = productDataMap[line.product_id];
      const canonicalId = product?.stock_handling_unit_id ?? product?.final_unit_id ?? line.canonical_unit_id;

      const { result: convResult, error: convError } = convertToCanonical(
        entries,
        canonicalId,
        (product?.conditionnement_config ?? null) as import("@/integrations/supabase/types").Json,
        dbUnits,
        dbConversions,
      );

      if (convError || !convResult) {
        return;
      }

      const shipped = line.shipped_quantity ?? line.canonical_quantity;

      if (convResult.canonicalQuantity > shipped) {
        setPendingBfsResult({ lineId: receptionPopupLineId, canonicalQuantity: convResult.canonicalQuantity });
        setSurplusConfirm({
          lineId: receptionPopupLineId,
          productName: line.product_name_snapshot,
          shipped,
          received: convResult.canonicalQuantity,
        });
        setReceptionPopupLineId(null);
        return;
      }

      setReceivedQtys((prev) => ({
        ...prev,
        [receptionPopupLineId]: convResult.canonicalQuantity,
      }));
      setValidatedLines((prev) => ({ ...prev, [receptionPopupLineId]: "modified" }));
      setReceptionPopupLineId(null);
    },
    [receptionPopupLineId, sortedLines, productDataMap, dbUnits, dbConversions]
  );

  // Surplus confirmed by user
  const handleSurplusConfirmed = useCallback(() => {
    if (!pendingBfsResult) return;
    setReceivedQtys((prev) => ({
      ...prev,
      [pendingBfsResult.lineId]: pendingBfsResult.canonicalQuantity,
    }));
    setValidatedLines((prev) => ({ ...prev, [pendingBfsResult.lineId]: "modified" }));
    setSurplusConfirm(null);
    setPendingBfsResult(null);
  }, [pendingBfsResult]);

  // Surplus cancelled — revert to shipped qty
  const handleSurplusCancelled = useCallback(() => {
    setSurplusConfirm(null);
    setPendingBfsResult(null);
  }, []);

  const handleReceive = useCallback(async () => {
    setIsReceiving(true);
    try {
      const lines = sortedLines.map((l) => ({
        line_id: l.id,
        received_quantity: getReceivedQty(l.id, l.shipped_quantity ?? l.canonical_quantity),
      }));
      const result = await receiveMutation.mutateAsync({
        commandeId: commande.id,
        lines,
      });

      // DLC V0: batch-write DLC records AFTER successful reception (non-blocking)
      const dlcInputs: DlcUpsertInput[] = sortedLines
        .filter((l) => dlcDates[l.id])
        .map((l) => ({
          commande_line_id: l.id,
          establishment_id: commande.client_establishment_id,
          product_id: l.product_id,
          dlc_date: dlcDates[l.id],
          quantity_received: getReceivedQty(l.id, l.shipped_quantity ?? l.canonical_quantity),
          canonical_unit_id: l.canonical_unit_id,
        }));

      if (dlcInputs.length > 0) {
        try {
          await dlcBatchUpsert.mutateAsync(dlcInputs);
        } catch {
          toast.warning("DLC à compléter depuis le détail commande");
        }
      }

      // DLC V0: create returns for refused DLC lines (delegated to DLC module)
      await handleDlcRefusals({
        lines: sortedLines,
        dlcDates,
        dlcDecisions,
        productWarningDays,
        getReceivedQty,
      });

      // P0: Commit locally-staged manual returns AFTER successful reception
      const returnEntries = Object.values(pendingReturns);
      for (const pr of returnEntries) {
        try {
          const created = await createReturnMutation.mutateAsync({
            commandeId: commande.id,
            commandeLineId: pr.commandeLineId,
            productId: pr.productId,
            productNameSnapshot: pr.productNameSnapshot,
            quantity: pr.quantity,
            canonicalUnitId: pr.canonicalUnitId,
            unitLabelSnapshot: pr.unitLabelSnapshot,
            returnType: pr.returnType,
            reasonComment: pr.reasonComment,
            clientEstablishmentId: commande.client_establishment_id,
            supplierEstablishmentId: commande.supplier_establishment_id,
          });
          if (pr.photo) {
            try {
              await uploadReturnPhoto.mutateAsync({ returnId: created.id, file: pr.photo });
            } catch {
              /* photo upload non-blocking */
            }
          }
        } catch {
          toast.warning("Un retour n'a pas pu être créé");
        }
      }

      // Clear persisted draft on successful reception
      clearDraft();

      const hasLitige = (result as { has_litige?: boolean }).has_litige;
      if (hasLitige) {
        toast.success("Réception validée — litige créé pour les écarts");
      } else {
        const type = (result as { reception_type?: string }).reception_type;
        toast.success(
          type === "complete" ? "Réception complète validée !" : "Réception partielle validée"
        );
      }
      setConfirmReceive(false);

      // Check for missing products to propose reorder (works in both standalone and embedded)
      if (onReorderMissing) {
        const missing = sortedLines
          .map((l) => {
            const received = getReceivedQty(l.id, l.shipped_quantity ?? l.canonical_quantity);
            const gap = l.canonical_quantity - received;
            return gap > 0 ? {
              productId: l.product_id,
              productName: l.product_name_snapshot,
              missingQty: gap,
              canonicalUnitId: l.canonical_unit_id,
              unitLabel: l.unit_label_snapshot,
            } : null;
          })
          .filter((x): x is NonNullable<typeof x> => x !== null);

        if (missing.length > 0) {
          setReorderMissingLines(missing);
          setShowReorderPrompt(true);
          return; // Don't close yet — wait for user decision
        }
      }

      if (embedded && onReceiveComplete) {
        onReceiveComplete();
      } else {
        onClose();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      toast.error(msg.includes("invalid_status") ? "Commande déjà réceptionnée" : "Erreur lors de la réception");
    } finally {
      setIsReceiving(false);
    }
  }, [sortedLines, receivedQtys, receiveMutation, commande.id, commande.client_establishment_id, commande.supplier_establishment_id, dlcDates, dlcBatchUpsert, dlcDecisions, productWarningDays, handleDlcRefusals, onClose, embedded, onReceiveComplete, onReorderMissing, clearDraft]);

  // ── Embedded mode: report validation state to parent ──
  const productAllValidated = sortedLines.length > 0 && Object.keys(validatedLines).length >= sortedLines.length;
  const productPendingCount = sortedLines.length - Object.keys(validatedLines).length;

  useEffect(() => {
    if (embedded && onValidationStateChange) {
      onValidationStateChange({
        isAllValidated: productAllValidated,
        isReceiving,
        pendingCount: productPendingCount,
        ecartCount: ecarts.length,
        requestValidate: handleValidateClick,
      });
    }
  });

  if (!open && !embedded) return null;

  const ruptureCount = sortedLines.filter((l) => l.line_status === "rupture").length;
  const modifiedCount = sortedLines.filter((l) => l.line_status === "modifie").length;

  // ── Embedded mode: render only content + modals, no wrapper/header/footer ──
  if (embedded) {
    return (
      <>
        {/* Product section content */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center h-6 w-6 rounded-md bg-primary/10">
              <Package className="h-3 w-3 text-primary" />
            </div>
            <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Produits ({sortedLines.length})
            </h2>
            <span className="ml-auto text-xs text-muted-foreground tabular-nums">
              {Object.keys(validatedLines).length}/{sortedLines.length}
            </span>
          </div>

          <div className="rounded-lg border bg-card px-3 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" />
              {commande.sent_at ? fmtDateTime(commande.sent_at) : fmtDateTime(commande.created_at)}
            </span>
            {commande.shipped_at && (
              <span className="flex items-center gap-1.5">
                <Truck className="h-3.5 w-3.5" />
                Expédiée {fmtDateTime(commande.shipped_at)}
              </span>
            )}
          </div>

          {(ruptureCount > 0 || modifiedCount > 0) && (
            <div className="flex items-center gap-2 flex-wrap text-xs">
              {ruptureCount > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-red-100 text-red-700 font-medium">
                  {ruptureCount} rupture{ruptureCount > 1 ? "s" : ""}
                </span>
              )}
              {modifiedCount > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-amber-100 text-amber-700 font-medium">
                  {modifiedCount} modifié{modifiedCount > 1 ? "s" : ""}
                </span>
              )}
            </div>
          )}

          {hasEcarts && (
            <div className={`flex items-center gap-2 p-2.5 rounded-lg text-xs sm:text-sm ${
              hasSurplus
                ? "bg-orange-50 border border-orange-200 text-orange-700"
                : "bg-blue-50 border border-blue-200 text-blue-700"
            }`}>
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>
                {ecarts.length} écart{ecarts.length > 1 ? "s" : ""}
                {hasSurplus ? ` (dont ${surplusEcarts.length} surplus)` : ""}
                {" "}— un litige sera créé automatiquement
              </span>
            </div>
          )}

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-1.5">
              {sortedLines.map((line) => {
                const shippedQty = line.shipped_quantity ?? line.canonical_quantity;
                const receivedQty = getReceivedQty(line.id, shippedQty);
                const lineValidation = validatedLines[line.id] ?? null;
                const hasEcart = lineValidation != null && receivedQty !== shippedQty;
                const isRupture = line.line_status === "rupture";
                const isSupplierRupture = shippedQty === 0;
                const isModifie = line.line_status === "modifie";

                return (
                  <SwipeableReceptionLine
                    key={line.id}
                    line={line}
                    orderedQty={line.canonical_quantity}
                    shippedQty={shippedQty}
                    receivedQty={receivedQty}
                    hasEcart={hasEcart}
                    isRupture={isRupture}
                    isModifie={isModifie}
                    isSupplierRupture={isSupplierRupture}
                    dlcDate={dlcDates[line.id] ?? null}
                    hasPendingReturn={!!pendingReturns[line.id]}
                    erpFormat={erpFormat}
                    lineValidation={lineValidation}
                    isMobile={isMobile}
                    onConforme={() => handleConformeWithDlcGate(line)}
                    onManquant={() => {
                      setReceivedQtys((prev) => ({ ...prev, [line.id]: 0 }));
                      setValidatedLines((prev) => ({ ...prev, [line.id]: "manquant" }));
                    }}
                    onTap={() => {
                      handleOpenReceptionPopup(line);
                    }}
                  />
                );
              })}
            </div>
          )}

          <button
            onClick={() => setShowProduitNonCommande(true)}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-dashed text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
          >
            <PackagePlus className="h-4 w-4" />
            Signaler un produit non commandé
          </button>
        </div>

        {/* All modals — identical to standalone mode */}
        <AlertDialog open={!!selectedLineId} onOpenChange={(v) => { if (!v) setSelectedLineId(null); }}>
          <AlertDialogContent className="max-w-[320px] rounded-2xl p-0 overflow-hidden gap-0">
            {(() => {
              const line = sortedLines.find((l) => l.id === selectedLineId);
              if (!line) return null;
              const linePendingReturn = !!pendingReturns[line.id];
              return (
                <>
                  <div className="px-5 pt-5 pb-3 text-center">
                    <AlertDialogTitle className="text-base font-bold tracking-tight">{line.product_name_snapshot}</AlertDialogTitle>
                    <AlertDialogDescription className="text-xs text-muted-foreground mt-1">
                      Choisissez une action pour ce produit
                    </AlertDialogDescription>
                  </div>
                  <div className="flex flex-col gap-1.5 px-4 pb-2">
                    <button
                      onClick={() => { setSelectedLineId(null); handleOpenReceptionPopup(line); }}
                      className="flex items-center gap-3 w-full px-4 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-medium transition-colors hover:bg-primary/90"
                    >
                      <PackageCheck className="h-4.5 w-4.5 shrink-0" />
                      Saisir quantité
                    </button>
                    <button
                      onClick={() => { setSelectedLineId(null); setSignalerLine(line); }}
                      className={`flex items-center gap-3 w-full px-4 py-3 rounded-xl border text-sm font-medium transition-colors ${
                        linePendingReturn
                          ? "bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-400"
                          : "bg-background text-foreground hover:bg-accent"
                      }`}
                    >
                      <RotateCcw className={`h-4.5 w-4.5 shrink-0 ${linePendingReturn ? "text-amber-500" : "text-muted-foreground"}`} />
                      {linePendingReturn ? "Retour signalé" : "Signaler un problème"}
                    </button>
                  </div>
                  <div className="px-4 pb-4 pt-1">
                    <AlertDialogCancel className="w-full rounded-xl h-11 text-sm font-medium">Annuler</AlertDialogCancel>
                  </div>
                </>
              );
            })()}
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={confirmReceive} onOpenChange={setConfirmReceive}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Confirmer la réception</AlertDialogTitle>
              <AlertDialogDescription>
                {hasEcarts
                  ? `${ecarts.length} écart${ecarts.length > 1 ? "s" : ""} détecté${ecarts.length > 1 ? "s" : ""}. Un litige sera créé automatiquement pour validation fournisseur.`
                  : "Tous les produits correspondent à l'expédition. Le fournisseur sera notifié."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isReceiving}>Annuler</AlertDialogCancel>
              <AlertDialogAction onClick={handleReceive} disabled={isReceiving}>
                {isReceiving ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                ) : (
                  <PackageCheck className="h-4 w-4 mr-1.5" />
                )}
                {hasEcarts ? "Valider + créer litige" : "Confirmer"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={!!surplusConfirm} onOpenChange={(v) => !v && handleSurplusCancelled()}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-orange-500" />
                Quantité supérieure à l'expédié
              </AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-2">
                  <p>
                    <span className="font-medium text-foreground">{surplusConfirm?.productName}</span> :
                    vous déclarez recevoir{" "}
                    <span className="font-bold text-orange-600">{surplusConfirm?.received}</span>{" "}
                    alors que{" "}
                    <span className="font-medium">{surplusConfirm?.shipped}</span>{" "}
                    ont été expédiés.
                  </p>
                  <p>
                    Un surplus de{" "}
                    <span className="font-bold text-orange-600">
                      +{(surplusConfirm?.received ?? 0) - (surplusConfirm?.shipped ?? 0)}
                    </span>{" "}
                    sera déclaré.
                  </p>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Corriger</AlertDialogCancel>
              <AlertDialogAction onClick={handleSurplusConfirmed} className="bg-orange-600 hover:bg-orange-700 text-white">
                Confirmer le surplus
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* SSOT: Universal Quantity Modal for reception (embedded mode) */}
        {(() => {
          const popupLine = receptionPopupLineId ? sortedLines.find((l) => l.id === receptionPopupLineId) : null;
          const popupProduct = popupLine ? productDataMap[popupLine.product_id] : null;
          const shipped = popupLine ? (popupLine.shipped_quantity ?? popupLine.canonical_quantity) : 0;
          const currentReceived = popupLine ? getReceivedQty(popupLine.id, shipped) : 0;

          const stepperCfg: StepperConfig | null = popupProduct ? (() => {
            const config = inputConfigs.get(popupProduct.id) ?? null;
            const resolved = resolveInputUnitForContext(
              popupProduct as Parameters<typeof resolveInputUnitForContext>[0],
              "b2b_sale",
              config,
              dbUnits,
              dbConversions,
            );

            if (resolved.status !== "ok") {
              return {
                productId: popupProduct.id,
                productName: popupProduct.nom_produit,
                unitId: "",
                unitName: "",
                steps: [],
                defaultStep: 1,
                blockedMessage: {
                  title: resolved.status === "not_configured" ? "Produit non configuré" : "Configuration à revoir",
                  description: resolved.reason,
                },
              } satisfies StepperConfig;
            }

            if (resolved.mode === "multi_level") {
              const initVals = currentReceived > 0 ? computeMultiLevelInitValues(
                currentReceived,
                resolved.unitChain,
                resolved.unitFamilies ?? [],
                resolved.canonicalUnitId,
                popupProduct.conditionnement_config as import("@/integrations/supabase/types").Json,
                dbUnits,
                dbConversions,
              ) : undefined;
              return {
                productId: popupProduct.id,
                productName: popupProduct.nom_produit,
                unitId: "",
                unitName: "",
                steps: [],
                defaultStep: 1,
                unitChain: resolved.unitChain,
                unitNames: resolved.unitNames,
                unitFamilies: resolved.unitFamilies,
                headerLabel: "Réception en",
                confirmLabel: "Confirmer la réception",
                inputMode: "multi_level",
                initialMultiValues: initVals,
              } satisfies StepperConfig;
            }

            // Reverse-convert existing canonical qty to input unit
            const convCheck = resolveInputConversion(
              resolved.unitId,
              resolved.canonicalUnitId,
              popupProduct.conditionnement_config as import("@/integrations/supabase/types").Json,
              dbUnits,
              dbConversions,
            );
            let initialQty: number | undefined;
            if (currentReceived > 0 && convCheck.factor && convCheck.factor > 0) {
              initialQty = +(currentReceived / convCheck.factor).toFixed(4);
            }

            return {
              productId: popupProduct.id,
              productName: popupProduct.nom_produit,
              unitId: resolved.unitId,
              unitName: resolved.unitName,
              steps: resolved.steps,
              defaultStep: resolved.defaultStep,
              initialQuantity: initialQty,
              conversionError: convCheck.error,
              headerLabel: "Réception en",
              confirmLabel: "Confirmer la réception",
              inputMode: resolved.mode,
            } satisfies StepperConfig;
          })() : null;

          return (
            <UniversalQuantityModal
              open={!!receptionPopupLineId}
              onClose={() => setReceptionPopupLineId(null)}
              uiMode="stepper"
              stepperConfig={stepperCfg}
            onConfirmRaw={handleReceptionConfirmRaw}
            contextType="order"
            />
          );
        })()}

        {signalerLine && (
          <SignalerRetourDialog
            open={!!signalerLine}
            onClose={() => setSignalerLine(null)}
            commande={commande}
            line={signalerLine}
            onLocalSubmit={handleLocalReturnSubmit}
          />
        )}

        <SignalerProduitNonCommandeDialog
          open={showProduitNonCommande}
          onClose={() => setShowProduitNonCommande(false)}
          commande={commande}
        />


        {/* DLC V1: mandatory DLC gate sheet (opens when validating a DLC-required product) */}
        {dlcGateLine && (
          <DlcLineDetailSheet
            open={!!dlcGateLine}
            onClose={() => setDlcGateLine(null)}
            productName={dlcGateLine.product_name_snapshot}
            quantityLabel={erpFormat(
              dlcGateLine.product_id,
              getReceivedQty(dlcGateLine.id, dlcGateLine.shipped_quantity ?? dlcGateLine.canonical_quantity),
              dlcGateLine.canonical_unit_id,
              dlcGateLine.unit_label_snapshot
            )}
            currentDlcDate={dlcDates[dlcGateLine.id] ?? null}
            upsertData={null}
            isReceptionFlow
            onDlcSelected={handleDlcGateConfirm}
          />
        )}

        <DlcReceptionSummaryDialog
          open={showDlcSummary}
          onClose={() => setShowDlcSummary(false)}
          issues={dlcIssues}
          onConfirm={handleDlcSummaryConfirm}
        />
      </>
    );
  }

  // ── Standalone mode: full-screen dialog (original behavior, untouched) ──
  return (
    <>
      <div className="fixed inset-0 z-[55] bg-background flex flex-col pb-[calc(64px+env(safe-area-inset-bottom))] animate-in fade-in slide-in-from-bottom-2 duration-200">
        <header className="shrink-0 bg-background/95 backdrop-blur-sm sticky top-0 z-10 border-b">
          <div className="flex items-center gap-3 px-4 sm:px-8 h-14 sm:h-16">
            <button
              onClick={onClose}
              className="flex items-center justify-center h-9 w-9 rounded-lg hover:bg-accent transition-colors -ml-1"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="flex-1 min-w-0">
              <h1 className="text-base sm:text-lg font-semibold truncate">Réception</h1>
              <p className="text-xs text-muted-foreground truncate">{supplierName}</p>
            </div>
            <CommandeStatusBadge status={commande.status} isSender={true} />
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <div className="w-full px-3 sm:px-8 py-3 sm:py-6 space-y-3 max-w-2xl mx-auto">
            <div className="rounded-lg border bg-card px-3 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                {commande.sent_at ? fmtDateTime(commande.sent_at) : fmtDateTime(commande.created_at)}
              </span>
              {commande.shipped_at && (
                <span className="flex items-center gap-1.5">
                  <Truck className="h-3.5 w-3.5" />
                  Expédiée {fmtDateTime(commande.shipped_at)}
                </span>
              )}
            </div>

            {(ruptureCount > 0 || modifiedCount > 0) && (
              <div className="flex items-center gap-2 flex-wrap text-xs">
                {ruptureCount > 0 && (
                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-red-100 text-red-700 font-medium">
                    {ruptureCount} rupture{ruptureCount > 1 ? "s" : ""}
                  </span>
                )}
                {modifiedCount > 0 && (
                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-amber-100 text-amber-700 font-medium">
                    {modifiedCount} modifié{modifiedCount > 1 ? "s" : ""}
                  </span>
                )}
              </div>
            )}

            {/* Écarts summary */}
            {hasEcarts && (
              <div className={`flex items-center gap-2 p-2.5 rounded-lg text-xs sm:text-sm ${
                hasSurplus
                  ? "bg-orange-50 border border-orange-200 text-orange-700"
                  : "bg-blue-50 border border-blue-200 text-blue-700"
              }`}>
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>
                  {ecarts.length} écart{ecarts.length > 1 ? "s" : ""}
                  {hasSurplus ? ` (dont ${surplusEcarts.length} surplus)` : ""}
                  {" "}— un litige sera créé automatiquement
                </span>
              </div>
            )}

            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="space-y-1.5">
                {sortedLines.map((line) => {
                  const shippedQty = line.shipped_quantity ?? line.canonical_quantity;
                  const receivedQty = getReceivedQty(line.id, shippedQty);
                  const lineValidation = validatedLines[line.id] ?? null;
                  const hasEcart = lineValidation != null && receivedQty !== shippedQty;
                  const isRupture = line.line_status === "rupture";
                  const isSupplierRupture = shippedQty === 0;
                  const isModifie = line.line_status === "modifie";

                  return (
                    <SwipeableReceptionLine
                      key={line.id}
                      line={line}
                      orderedQty={line.canonical_quantity}
                      shippedQty={shippedQty}
                      receivedQty={receivedQty}
                      hasEcart={hasEcart}
                      isRupture={isRupture}
                      isModifie={isModifie}
                      isSupplierRupture={isSupplierRupture}
                      dlcDate={dlcDates[line.id] ?? null}
                      hasPendingReturn={!!pendingReturns[line.id]}
                      erpFormat={erpFormat}
                      lineValidation={lineValidation}
                      isMobile={isMobile}
                      onConforme={() => handleConformeWithDlcGate(line)}
                      onManquant={() => {
                        setReceivedQtys((prev) => ({ ...prev, [line.id]: 0 }));
                        setValidatedLines((prev) => ({ ...prev, [line.id]: "manquant" }));
                      }}
                      onTap={() => {
                        handleOpenReceptionPopup(line);
                      }}
                    />
                  );
                })}
              </div>
            )}
            {/* Signal unordered product */}
            <button
              onClick={() => setShowProduitNonCommande(true)}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-dashed text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
            >
              <PackagePlus className="h-4 w-4" />
              Signaler un produit non commandé
            </button>

            {/* ─── Validate section — inline after lines for Android visibility ─── */}
            <div className="mt-4 rounded-lg border bg-card p-4 space-y-3">
              <div className="text-xs text-muted-foreground text-center">
                {(() => {
                  const validatedCount = Object.keys(validatedLines).length;
                  const totalLines = sortedLines.length;
                  const pendingCount = totalLines - validatedCount;
                  if (pendingCount > 0) {
                    return (
                      <span className="text-amber-600 font-medium">
                        {pendingCount} à vérifier
                      </span>
                    );
                  }
                  if (hasEcarts) {
                    return (
                      <span className="text-blue-600 font-medium">
                        {ecarts.length} écart{ecarts.length > 1 ? "s" : ""}
                      </span>
                    );
                  }
                  return <span className="text-emerald-600 font-medium">✓ Tout conforme</span>;
                })()}
              </div>
              <Button
                onClick={handleValidateClick}
                disabled={isReceiving || Object.keys(validatedLines).length < sortedLines.length}
                className="w-full"
              >
                {isReceiving ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                ) : (
                  <PackageCheck className="h-4 w-4 mr-1.5" />
                )}
                Valider réception
              </Button>
            </div>

            <div className="h-8" />
          </div>
        </main>
      </div>

      {/* ─── Line action popup (replaces bottom bar contextual actions) ─── */}
      <AlertDialog open={!!selectedLineId} onOpenChange={(v) => { if (!v) setSelectedLineId(null); }}>
        <AlertDialogContent className="max-w-[320px] rounded-2xl p-0 overflow-hidden gap-0">
          {(() => {
            const line = sortedLines.find((l) => l.id === selectedLineId);
            if (!line) return null;
            const linePendingReturn = !!pendingReturns[line.id];
            return (
              <>
                <div className="px-5 pt-5 pb-3 text-center">
                  <AlertDialogTitle className="text-base font-bold tracking-tight">{line.product_name_snapshot}</AlertDialogTitle>
                  <AlertDialogDescription className="text-xs text-muted-foreground mt-1">
                    Choisissez une action pour ce produit
                  </AlertDialogDescription>
                </div>
                <div className="flex flex-col gap-1.5 px-4 pb-2">
                  <button
                    onClick={() => {
                      const l = line;
                      setSelectedLineId(null);
                      handleOpenReceptionPopup(l);
                    }}
                    className="flex items-center gap-3 w-full px-4 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-medium transition-colors hover:bg-primary/90"
                  >
                    <PackageCheck className="h-4.5 w-4.5 shrink-0" />
                    Saisir quantité
                  </button>
                  <button
                    onClick={() => {
                      const l = line;
                      setSelectedLineId(null);
                      setSignalerLine(l);
                    }}
                    className={`flex items-center gap-3 w-full px-4 py-3 rounded-xl border text-sm font-medium transition-colors ${
                      linePendingReturn
                        ? "bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-400"
                        : "bg-background text-foreground hover:bg-accent"
                    }`}
                  >
                    <RotateCcw className={`h-4.5 w-4.5 shrink-0 ${linePendingReturn ? "text-amber-500" : "text-muted-foreground"}`} />
                    {linePendingReturn ? "Retour signalé" : "Signaler un problème"}
                  </button>
                </div>
                <div className="px-4 pb-4 pt-1">
                  <AlertDialogCancel className="w-full rounded-xl h-11 text-sm font-medium">Annuler</AlertDialogCancel>
                </div>
              </>
            );
          })()}
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirm receive */}
      <AlertDialog open={confirmReceive} onOpenChange={setConfirmReceive}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmer la réception</AlertDialogTitle>
            <AlertDialogDescription>
              {hasEcarts
                ? `${ecarts.length} écart${ecarts.length > 1 ? "s" : ""} détecté${ecarts.length > 1 ? "s" : ""}. Un litige sera créé automatiquement pour validation fournisseur.`
                : "Tous les produits correspondent à l'expédition. Le fournisseur sera notifié."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isReceiving}>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={handleReceive} disabled={isReceiving}>
              {isReceiving ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
              ) : (
                <PackageCheck className="h-4 w-4 mr-1.5" />
              )}
              {hasEcarts ? "Valider + créer litige" : "Confirmer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Post-reception: propose reorder missing */}
      <AlertDialog open={showReorderPrompt} onOpenChange={(v) => {
        if (!v) {
          setShowReorderPrompt(false);
          setReorderMissingLines([]);
          if (embedded && onReceiveComplete) { onReceiveComplete(); } else { onClose(); }
        }
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <PackagePlus className="h-5 w-5 text-primary" />
              Produits manquants détectés
            </AlertDialogTitle>
            <AlertDialogDescription>
              {reorderMissingLines.length} produit{reorderMissingLines.length > 1 ? "s" : ""} n&apos;{reorderMissingLines.length > 1 ? "ont" : "a"} pas été livré{reorderMissingLines.length > 1 ? "s" : ""} en totalité. Souhaitez-vous créer un brouillon de commande pour les manquants ?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => {
              setShowReorderPrompt(false);
              setReorderMissingLines([]);
              if (embedded && onReceiveComplete) { onReceiveComplete(); } else { onClose(); }
            }}>
              Non merci
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              setShowReorderPrompt(false);
              onReorderMissing?.(commande, reorderMissingLines);
              setReorderMissingLines([]);
              if (embedded && onReceiveComplete) { onReceiveComplete(); } else { onClose(); }
            }}>
              <PackagePlus className="h-4 w-4 mr-1.5" />
              Recommander les manquants
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>


      <AlertDialog open={!!surplusConfirm} onOpenChange={(v) => !v && handleSurplusCancelled()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-orange-500" />
              Quantité supérieure à l'expédié
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  <span className="font-medium text-foreground">{surplusConfirm?.productName}</span> :
                  vous déclarez recevoir{" "}
                  <span className="font-bold text-orange-600">{surplusConfirm?.received}</span>{" "}
                  alors que{" "}
                  <span className="font-medium">{surplusConfirm?.shipped}</span>{" "}
                  ont été expédiés.
                </p>
                <p>
                  Un surplus de{" "}
                  <span className="font-bold text-orange-600">
                    +{(surplusConfirm?.received ?? 0) - (surplusConfirm?.shipped ?? 0)}
                  </span>{" "}
                  sera déclaré. Vérifiez la quantité réellement reçue.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Corriger</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleSurplusConfirmed}
              className="bg-orange-600 hover:bg-orange-700 text-white"
            >
              Confirmer le surplus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* SSOT: Universal Quantity Modal for reception (standalone mode) */}
      {(() => {
        const popupLine = receptionPopupLineId ? sortedLines.find((l) => l.id === receptionPopupLineId) : null;
        const popupProduct = popupLine ? productDataMap[popupLine.product_id] : null;
        const shipped = popupLine ? (popupLine.shipped_quantity ?? popupLine.canonical_quantity) : 0;
        const currentReceived = popupLine ? getReceivedQty(popupLine.id, shipped) : 0;

        const stepperCfg: StepperConfig | null = popupProduct ? (() => {
          const config = inputConfigs.get(popupProduct.id) ?? null;
          const resolved = resolveInputUnitForContext(
            popupProduct as Parameters<typeof resolveInputUnitForContext>[0],
            "b2b_sale",
            config,
            dbUnits,
            dbConversions,
          );

          if (resolved.status !== "ok") {
            return {
              productId: popupProduct.id,
              productName: popupProduct.nom_produit,
              unitId: "",
              unitName: "",
              steps: [],
              defaultStep: 1,
              blockedMessage: {
                title: resolved.status === "not_configured" ? "Produit non configuré" : "Configuration à revoir",
                description: resolved.reason,
              },
            } satisfies StepperConfig;
          }

          if (resolved.mode === "multi_level") {
            const initVals = currentReceived > 0 ? computeMultiLevelInitValues(
              currentReceived,
              resolved.unitChain,
              resolved.unitFamilies ?? [],
              resolved.canonicalUnitId,
              popupProduct.conditionnement_config as import("@/integrations/supabase/types").Json,
              dbUnits,
              dbConversions,
            ) : undefined;
            return {
              productId: popupProduct.id,
              productName: popupProduct.nom_produit,
              unitId: "",
              unitName: "",
              steps: [],
              defaultStep: 1,
              unitChain: resolved.unitChain,
              unitNames: resolved.unitNames,
              unitFamilies: resolved.unitFamilies,
              headerLabel: "Réception en",
              confirmLabel: "Confirmer la réception",
              inputMode: "multi_level",
              initialMultiValues: initVals,
            } satisfies StepperConfig;
          }

          const convCheck = resolveInputConversion(
            resolved.unitId,
            resolved.canonicalUnitId,
            popupProduct.conditionnement_config as import("@/integrations/supabase/types").Json,
            dbUnits,
            dbConversions,
          );
          let initialQty: number | undefined;
          if (currentReceived > 0 && convCheck.factor && convCheck.factor > 0) {
            initialQty = +(currentReceived / convCheck.factor).toFixed(4);
          }

          return {
            productId: popupProduct.id,
            productName: popupProduct.nom_produit,
            unitId: resolved.unitId,
            unitName: resolved.unitName,
            steps: resolved.steps,
            defaultStep: resolved.defaultStep,
            initialQuantity: initialQty,
            conversionError: convCheck.error,
            headerLabel: "Réception en",
            confirmLabel: "Confirmer la réception",
            inputMode: resolved.mode,
          } satisfies StepperConfig;
        })() : null;

        return (
          <UniversalQuantityModal
            open={!!receptionPopupLineId}
            onClose={() => setReceptionPopupLineId(null)}
            uiMode="stepper"
            stepperConfig={stepperCfg}
            onConfirmRaw={handleReceptionConfirmRaw}
            contextType="order"
          />
        );
      })()}

      {/* Signaler retour dialog (per-line) — uses local staging during reception */}
      {signalerLine && (
        <SignalerRetourDialog
          open={!!signalerLine}
          onClose={() => setSignalerLine(null)}
          commande={commande}
          line={signalerLine}
          onLocalSubmit={handleLocalReturnSubmit}
        />
      )}

      {/* Signaler produit non commandé */}
      <SignalerProduitNonCommandeDialog
        open={showProduitNonCommande}
        onClose={() => setShowProduitNonCommande(false)}
        commande={commande}
      />


      {/* DLC V1: mandatory DLC gate sheet (opens when validating a DLC-required product) */}
      {dlcGateLine && (
        <DlcLineDetailSheet
          open={!!dlcGateLine}
          onClose={() => setDlcGateLine(null)}
          productName={dlcGateLine.product_name_snapshot}
          quantityLabel={erpFormat(
            dlcGateLine.product_id,
            getReceivedQty(dlcGateLine.id, dlcGateLine.shipped_quantity ?? dlcGateLine.canonical_quantity),
            dlcGateLine.canonical_unit_id,
            dlcGateLine.unit_label_snapshot
          )}
          currentDlcDate={dlcDates[dlcGateLine.id] ?? null}
          upsertData={null}
          isReceptionFlow
          onDlcSelected={handleDlcGateConfirm}
        />
      )}

      {/* DLC V0: Summary dialog before reception validation */}
      <DlcReceptionSummaryDialog
        open={showDlcSummary}
        onClose={() => setShowDlcSummary(false)}
        issues={dlcIssues}
        onConfirm={handleDlcSummaryConfirm}
      />
    </>
  );
}

/* ─── Swipeable Reception Line ───────────────────────────────────────────── */

const SWIPE_THRESHOLD = 60;

interface SwipeableReceptionLineProps {
  line: CommandeLine;
  orderedQty: number;
  shippedQty: number;
  receivedQty: number;
  hasEcart: boolean;
  isRupture: boolean;
  isModifie: boolean;
  isSupplierRupture: boolean;
  dlcDate: string | null;
  hasPendingReturn: boolean;
  erpFormat: (productId: string, qty: number, unitId: string, unitLabel: string | null) => string;
  lineValidation: "conforme" | "manquant" | "modified" | null;
  isMobile: boolean;
  onConforme: () => void;
  onManquant: () => void;
  onTap: () => void;
}

function SwipeableReceptionLine({
  line,
  orderedQty,
  shippedQty,
  receivedQty,
  hasEcart,
  isRupture,
  isModifie,
  isSupplierRupture,
  dlcDate,
  hasPendingReturn,
  erpFormat,
  lineValidation,
  isMobile,
  onConforme,
  onManquant,
  onTap,
}: SwipeableReceptionLineProps) {
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

  const isSurplus = receivedQty > shippedQty;
  const isManquant = lineValidation === "manquant";
  const isPending = lineValidation === null;

  const rowBg = isPending
    ? "bg-card border-border"
    : isManquant
      ? "bg-red-50/70 border-red-200/60 dark:bg-red-950/20 dark:border-red-800/40"
      : hasEcart
        ? isSurplus
          ? "bg-orange-50/70 border-orange-200/60 dark:bg-orange-950/20 dark:border-orange-800/40"
          : "bg-blue-50/70 border-blue-200/60 dark:bg-blue-950/20 dark:border-blue-800/40"
        : isRupture
          ? "bg-red-50/70 border-red-200/60 dark:bg-red-950/20 dark:border-red-800/40"
          : isModifie
            ? "bg-amber-50/70 border-amber-200/60 dark:bg-amber-950/20 dark:border-amber-800/40"
            : lineValidation === "conforme"
              ? "bg-emerald-50/70 border-emerald-200/60 dark:bg-emerald-950/20 dark:border-emerald-800/40"
              : "bg-card border-border";

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    touchStartTime.current = Date.now();
    currentX.current = 0;
    maxDy.current = 0;
    isSwiping.current = false;
    isLocked.current = false;
    if (bgLeftRef.current) bgLeftRef.current.style.opacity = "0";
    if (bgRightRef.current) bgRightRef.current.style.opacity = "0";
    if (rowRef.current) rowRef.current.style.transition = "";
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const dx = e.touches[0].clientX - touchStartX.current;
    const dy = e.touches[0].clientY - touchStartY.current;

    // Track max vertical movement to suppress false taps during scroll
    maxDy.current = Math.max(maxDy.current, Math.abs(dy));

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

    if (rowRef.current) {
      rowRef.current.style.transition = "transform 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94)";
      rowRef.current.style.transform = "translateX(0)";
    }
    if (bgLeftRef.current) {
      bgLeftRef.current.style.transition = "opacity 0.2s ease";
      bgLeftRef.current.style.opacity = "0";
    }
    if (bgRightRef.current) {
      bgRightRef.current.style.transition = "opacity 0.2s ease";
      bgRightRef.current.style.opacity = "0";
    }
    setTimeout(() => {
      if (rowRef.current) rowRef.current.style.transition = "";
      if (bgLeftRef.current) bgLeftRef.current.style.transition = "";
      if (bgRightRef.current) bgRightRef.current.style.transition = "";
    }, 220);

    if (wasSwiping) {
      if (finalX >= SWIPE_THRESHOLD) {
        onConforme();
      } else if (finalX <= -SWIPE_THRESHOLD) {
        onManquant();
      }
      isSwiping.current = false;
      return;
    }

    // Suppress tap if finger moved vertically (user was scrolling)
    if (elapsed < 250 && Math.abs(finalX) < 5 && verticalMoved < 15) {
      onTap();
    }
  }, [onConforme, onManquant, onTap]);

  const orderedLabel = Array.isArray(line.input_entries) && line.input_entries.length > 0
    ? formatInputEntries(line.input_entries, orderedQty, line.unit_label_snapshot)
    : erpFormat(line.product_id, orderedQty, line.canonical_unit_id, line.unit_label_snapshot);
  const shippedLabel = erpFormat(line.product_id, shippedQty, line.canonical_unit_id, line.unit_label_snapshot);
  const receivedLabel = hasEcart
    ? erpFormat(line.product_id, receivedQty, line.canonical_unit_id, line.unit_label_snapshot)
    : null;
  const shippedDiffersFromOrdered = shippedQty !== orderedQty;

  return (
    <div className="relative overflow-hidden rounded-xl">
      {/* Green background — swipe RIGHT = Conforme (mobile only) */}
      {isMobile && (
        <div
          ref={bgLeftRef}
          className="absolute inset-0 bg-emerald-500 flex items-center pl-5 opacity-0"
          style={{ willChange: "opacity" }}
        >
          <Check className="h-5 w-5 text-white" />
          <span className="ml-2 text-sm font-semibold text-white">Conforme</span>
        </div>
      )}

      {/* Red background — swipe LEFT = Manquant (mobile only) */}
      {isMobile && (
        <div
          ref={bgRightRef}
          className="absolute inset-0 bg-destructive flex items-center justify-end pr-5 opacity-0"
          style={{ willChange: "opacity" }}
        >
          <span className="mr-2 text-sm font-semibold text-white">Manquant</span>
          <X className="h-5 w-5 text-white" />
        </div>
      )}

      {/* Foreground card */}
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
          {hasPendingReturn && !isSupplierRupture ? (
            <div className="shrink-0 h-7 w-7 rounded-full flex items-center justify-center shadow-sm bg-amber-500 text-white">
              <AlertTriangle className="h-4 w-4" />
            </div>
          ) : isPending ? (
            <div className="shrink-0 h-7 w-7 rounded-full flex items-center justify-center shadow-sm border-2 border-muted-foreground/30 bg-background">
              <span className="text-xs text-muted-foreground">?</span>
            </div>
          ) : isSupplierRupture ? (
            <div className="shrink-0 h-7 w-7 rounded-full flex items-center justify-center shadow-sm bg-destructive text-white">
              <X className="h-4 w-4" />
            </div>
          ) : isManquant ? (
            <div className="shrink-0 h-7 w-7 rounded-full flex items-center justify-center shadow-sm bg-destructive text-white">
              <X className="h-4 w-4" />
            </div>
          ) : hasEcart ? (
            <div className={`shrink-0 h-7 w-7 rounded-full flex items-center justify-center shadow-sm ${
              isSurplus ? "bg-orange-500 text-white" : "bg-blue-500 text-white"
            }`}>
              <span className="text-xs font-bold">M</span>
            </div>
          ) : lineValidation === "conforme" ? (
            <div className="shrink-0 h-7 w-7 rounded-full flex items-center justify-center shadow-sm bg-emerald-500 text-white">
              <Check className="h-4 w-4" />
            </div>
          ) : null}

          {/* Product name */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <p className={`text-sm font-medium leading-tight break-words ${isSupplierRupture ? "line-through text-muted-foreground" : ""}`}>
                {line.product_name_snapshot}
              </p>
              {isSupplierRupture && (
                <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400">
                  Rupture
                </span>
              )}
              {hasPendingReturn && (
                <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400 border border-amber-200/60 dark:border-amber-800/40">
                  <RotateCcw className="h-2.5 w-2.5" />
                  Retour
                </span>
              )}
            </div>
            {dlcDate && (
              <div className="mt-0.5">
                <DlcBadge dlcDate={dlcDate} showMissing={false} />
              </div>
            )}
          </div>

          {/* Quantity — right-aligned */}
          <div className="shrink-0 text-right tabular-nums whitespace-nowrap">
            {/* Show ordered qty struck through when supplier shipped less/more */}
            {shippedDiffersFromOrdered && (
              <span className="text-xs text-muted-foreground line-through block leading-tight">
                {orderedLabel}
              </span>
            )}
            {hasEcart ? (
              <>
                {/* shipped label (struck through only if ordered wasn't already shown struck) */}
                <span className={`text-xs text-muted-foreground line-through block leading-tight`}>
                  {shippedLabel}
                </span>
                <span className="text-sm font-bold text-primary leading-tight">
                  {receivedQty === 0 ? "0" : receivedLabel}
                </span>
              </>
            ) : (
              <span className={`text-sm font-semibold ${shippedDiffersFromOrdered ? "text-primary" : "text-foreground"} leading-tight`}>
                {shippedLabel}
              </span>
            )}
          </div>

          {/* Desktop action buttons — check / cross */}
          {!isMobile && !isSupplierRupture && (
            <div className="shrink-0 flex items-center gap-1 ml-1">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onConforme();
                }}
                className={`h-8 w-8 rounded-full flex items-center justify-center transition-colors ${
                  lineValidation === "conforme" && !hasEcart
                    ? "bg-emerald-500 text-white"
                    : "hover:bg-emerald-100 text-emerald-600 dark:hover:bg-emerald-950 border border-emerald-300 dark:border-emerald-700"
                }`}
                aria-label="Conforme"
                title="Conforme"
              >
                <Check className="h-4 w-4" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onManquant();
                }}
                className={`h-8 w-8 rounded-full flex items-center justify-center transition-colors ${
                  isManquant
                    ? "bg-destructive text-white"
                    : "hover:bg-red-100 text-destructive dark:hover:bg-red-950 border border-red-300 dark:border-red-700"
                }`}
                aria-label="Manquant"
                title="Manquant"
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
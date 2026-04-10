/**
 * CommandeDetailDialog — View a commande (detail + lines)
 * Mobile-adapted with responsive sizing
 *
 * Stage 2: shows shipped/received info, action buttons for preparation/reception
 */

import { useCallback, useState, useRef } from "react";
import { SignalerRetourDialog, SignalerProduitNonCommandeDialog } from "@/modules/retours";
import {
  DlcBadge,
  DlcLineDetailSheet,
  DlcSupplierNotice,
  useDlcForCommande,
} from "@/modules/dlc";
import { GenerateInvoiceButton } from "@/modules/factureApp";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Loader2,
  Lock,
  Pencil,
  Package,
  Trash2,
  Save,
  Send,
  Plus,
  ShoppingCart,
  Truck,
  PackageCheck,
  Clock,
  User,
  AlertTriangle,
  RotateCcw,
  XCircle,
  Check,
  PackagePlus,
} from "lucide-react";
import { toast } from "sonner";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import {
  useCommandeDetail,
  useRemoveCommandeLine,
  useUpdateCommandeNote,
  useUpsertCommandeLines,
  useSendCommande,
  useDeleteDraftCommande,
  useSupplierProducts,
} from "../hooks/useCommandes";
import { useSupplierStock } from "../hooks/useSupplierStock";
import { useUnitConversions } from "@/core/unitConversion";
import { QuantityModalWithResolver } from "@/components/stock/QuantityModalWithResolver";
import { type QuantityProduct } from "@/components/stock/UniversalQuantityModal";
import { CommandeStatusBadge } from "./CommandeStatusBadge";
import { LineStatusBadge } from "./LineStatusBadge";
import type { Commande, CommandeLine } from "../types";
import { useErpQuantityLabels } from "../hooks/useErpQuantityLabels";
import { formatInputEntries } from "../utils/formatInputEntries";
import { formatParisHHMM } from "@/lib/time/paris";
import { formatParisDateKey } from "@/lib/time/dateKeyParis";

interface Props {
  open: boolean;
  onClose: () => void;
  commande: Commande | null;
  establishmentNames: Record<string, string>;
}

function fmtDateTime(iso: string): string {
  const dateKey = formatParisDateKey(new Date(iso));
  const [, mm, dd] = dateKey.split("-");
  return `${dd}/${mm} · ${formatParisHHMM(iso)}`;
}

/** Swipe-to-delete row wrapper (iOS-style) */
function SwipeableRow({
  children,
  enabled,
  onDelete,
}: {
  children: React.ReactNode;
  enabled: boolean;
  onDelete: () => void;
}) {
  const startX = useRef(0);
  const swiping = useRef(false);
  const [offset, setOffset] = useState(0);
  const [showDelete, setShowDelete] = useState(false);

  const THRESHOLD = 80;

  if (!enabled) return <>{children}</>;

  const handleTouchStart = (e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX;
    swiping.current = true;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!swiping.current) return;
    const diff = startX.current - e.touches[0].clientX;
    if (diff > 0) {
      setOffset(Math.min(diff, THRESHOLD + 20));
    } else {
      setOffset(0);
    }
  };

  const handleTouchEnd = () => {
    swiping.current = false;
    if (offset >= THRESHOLD) {
      setShowDelete(true);
      setOffset(THRESHOLD);
    } else {
      setOffset(0);
      setShowDelete(false);
    }
  };

  const handleDelete = () => {
    setOffset(0);
    setShowDelete(false);
    onDelete();
  };

  const handleCancel = () => {
    setOffset(0);
    setShowDelete(false);
  };

  return (
    <div className="relative overflow-hidden">
      {/* Delete background */}
      <div
        className="absolute inset-y-0 right-0 flex items-center justify-end bg-destructive transition-opacity"
        style={{ width: THRESHOLD, opacity: offset > 10 ? 1 : 0 }}
      >
        <button
          onClick={handleDelete}
          className="flex items-center justify-center h-full w-full text-destructive-foreground text-xs font-medium"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {/* Swipeable content */}
      <div
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={() => {
          if (showDelete) handleCancel();
        }}
        className="relative bg-background transition-transform"
        style={{
          transform: `translateX(-${offset}px)`,
          transition: swiping.current ? "none" : "transform 0.25s ease-out",
        }}
      >
        {children}
      </div>
    </div>
  );
}

export function CommandeDetailDialog({
  open,
  onClose,
  commande,
  establishmentNames,
}: Props) {
  const { activeEstablishment } = useEstablishment();
  const estId = activeEstablishment?.id;
  const isSender = commande?.client_establishment_id === estId;
  const isReceiver = commande?.supplier_establishment_id === estId;

  const { data, isLoading, refetch } = useCommandeDetail(open ? commande?.id ?? null : null);
  const removeLine = useRemoveCommandeLine();
  const updateNote = useUpdateCommandeNote();
  const upsertLines = useUpsertCommandeLines();
  const sendCommande = useSendCommande();
  const deleteDraft = useDeleteDraftCommande();

  const [editingNote, setEditingNote] = useState(false);
  const [noteValue, setNoteValue] = useState("");
  const [quantityProduct, setQuantityProduct] = useState<QuantityProduct | null>(null);
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [signalerLine, setSignalerLine] = useState<CommandeLine | null>(null);
  const [showProduitNonCommande, setShowProduitNonCommande] = useState(false);
  const [dlcSheetLine, setDlcSheetLine] = useState<CommandeLine | null>(null);

  const currentStatus = data?.commande?.status ?? commande?.status;
  const isEditable = isSender && (currentStatus === "envoyee" || currentStatus === "brouillon");
  const isDraft = isSender && currentStatus === "brouillon";

  const supplierEstId = commande?.supplier_establishment_id ?? null;
  const { data: products = [] } = useSupplierProducts(
    isSender && isEditable ? supplierEstId : null
  );
  const { conversions: dbConversions, units: dbUnits } = useUnitConversions();

  const { getStockForProduct, isShareStockActive } = useSupplierStock({
    supplierEstablishmentId: isReceiver ? estId ?? null : null,
    clientEstablishmentId: isReceiver ? commande?.client_establishment_id ?? null : null,
    partnershipId: isReceiver ? commande?.partnership_id ?? null : null,
  });

  const lineProductIds = (data?.lines ?? []).map((l) => l.product_id);
  const { formatQty: erpFormat } = useErpQuantityLabels(
    commande
      ? {
          productIds: lineProductIds,
          clientEstablishmentId: commande.client_establishment_id,
          supplierEstablishmentId: commande.supplier_establishment_id,
        }
      : null,
  );

  /** Ordered quantity display: uses input_entries when available (client & supplier), falls back to erpFormat */
  const formatOrderedQty = useCallback(
    (line: { product_id: string; canonical_quantity: number; canonical_unit_id: string; unit_label_snapshot: string | null; input_entries?: unknown }) => {
      if (Array.isArray(line.input_entries) && line.input_entries.length > 0) {
        return formatInputEntries(
          line.input_entries as Array<{ unit_id: string; quantity: number; unit_label: string }>,
          line.canonical_quantity,
          line.unit_label_snapshot,
        );
      }
      return erpFormat(line.product_id, line.canonical_quantity, line.canonical_unit_id, line.unit_label_snapshot);
    },
    [erpFormat],
  );

  const handleClose = useCallback(() => {
    setEditingNote(false);
    setQuantityProduct(null);
    setEditingLineId(null);
    setCartOpen(false);
    onClose();
  }, [onClose]);

  const partnerName = commande
    ? isSender
      ? establishmentNames[commande.supplier_establishment_id] || "Fournisseur"
      : establishmentNames[commande.client_establishment_id] || "Client"
    : "";

  const lines = data?.lines ?? [];
  const cmdData = data?.commande ?? commande;

  // DLC V0: fetch DLC data for received commandes (client side only)
  const isReceivedStatus = currentStatus === "recue" || currentStatus === "cloturee";
  const dlcLineIds = (isSender && isReceivedStatus) ? lines.map((l) => l.id) : null;
  const { dlcMap, refetch: refetchDlc } = useDlcForCommande(dlcLineIds);

  const handleEditNote = useCallback(() => {
    setNoteValue(commande?.note ?? "");
    setEditingNote(true);
  }, [commande]);

  const handleSaveNote = useCallback(async () => {
    if (!commande) return;
    try {
      await updateNote.mutateAsync({
        commandeId: commande.id,
        note: noteValue.trim(),
      });
      toast.success("Note mise à jour");
      setEditingNote(false);
      refetch();
    } catch (err) {
      const msg = err instanceof Error && err.message === "commande_locked"
        ? "Commande verrouillée après ouverture fournisseur"
        : "Erreur lors de la mise à jour";
      toast.error(msg);
    }
  }, [commande, noteValue, updateNote, refetch]);

  const handleRemoveLine = useCallback(
    async (lineId: string) => {
      if (currentStatus === "envoyee" && lines.length <= 1) {
        toast.error("Impossible : une commande envoyée doit contenir au moins un produit.");
        return;
      }
      try {
        await removeLine.mutateAsync(lineId);
        toast.success("Produit retiré");
        refetch();
      } catch (err: unknown) {
        const msg =
          (err instanceof Error ? err.message : "") ||
          (typeof err === "object" && err !== null && "message" in err
            ? String((err as { message: unknown }).message)
            : "");
        if (msg.includes("LAST_LINE_ENVOYEE")) {
          toast.error("Impossible : une commande envoyée doit contenir au moins un produit.");
        } else {
          toast.error("Erreur lors de la suppression");
        }
      }
    },
    [removeLine, refetch, currentStatus, lines]
  );

  const handleEditLine = useCallback(
    (line: typeof lines[number]) => {
      const product = products.find((p) => p.id === line.product_id);
      if (!product) {
        toast.error("Produit introuvable pour la modification");
        return;
      }
      setEditingLineId(line.id);
      setQuantityProduct({
        id: product.id,
        nom_produit: product.nom_produit,
        stock_handling_unit_id: product.stock_handling_unit_id,
        final_unit_id: product.final_unit_id,
        delivery_unit_id: product.delivery_unit_id,
        supplier_billing_unit_id: product.supplier_billing_unit_id,
        conditionnement_config: product.conditionnement_config as QuantityProduct["conditionnement_config"],
        category: product.category,
      });
    },
    [products]
  );

  const handleAddProduct = useCallback(
    (product: typeof products[number]) => {
      setQuantityProduct({
        id: product.id,
        nom_produit: product.nom_produit,
        stock_handling_unit_id: product.stock_handling_unit_id,
        final_unit_id: product.final_unit_id,
        delivery_unit_id: product.delivery_unit_id,
        supplier_billing_unit_id: product.supplier_billing_unit_id,
        conditionnement_config: product.conditionnement_config as QuantityProduct["conditionnement_config"],
        category: product.category,
      });
    },
    []
  );

  const handleQuantityConfirm = useCallback(
    async (params: {
      productId: string;
      canonicalQuantity: number;
      canonicalUnitId: string;
      canonicalLabel: string | null;
      inputEntries?: Array<{ unit_id: string; quantity: number; unit_label: string }>;
    }) => {
      if (!commande) return;
      const product = products.find((p) => p.id === params.productId);
      if (!product) return;

      try {
        await upsertLines.mutateAsync({
          commandeId: commande.id,
          items: [
            {
              productId: params.productId,
              productName: product.nom_produit,
              canonicalQuantity: params.canonicalQuantity,
              canonicalUnitId: params.canonicalUnitId,
              canonicalUnitLabel: params.canonicalLabel,
              inputEntries: params.inputEntries,
            },
          ],
        });
        toast.success("Quantité mise à jour");
        refetch();
      } catch {
        toast.error("Erreur lors de la mise à jour");
      }
      setQuantityProduct(null);
      setEditingLineId(null);
    },
    [commande, products, upsertLines, refetch]
  );

  const handleSend = useCallback(async () => {
    if (!commande || lines.length === 0) return;
    setIsSending(true);
    try {
      await sendCommande.mutateAsync(commande.id);
      toast.success("Commande envoyée !");
      handleClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("no_lines")) {
        toast.error("Ajoute au moins un produit avant d'envoyer.");
      } else if (msg.includes("unconvertible_prices")) {
        toast.error("Certains produits n'ont pas de conversion de prix valide. Vérifiez les unités configurées.");
      } else {
        toast.error("Erreur lors de l'envoi");
      }
    } finally {
      setIsSending(false);
    }
  }, [commande, lines.length, sendCommande, handleClose]);

  const handleDelete = useCallback(async () => {
    if (!commande) return;
    try {
      await deleteDraft.mutateAsync(commande.id);
      toast.success("Brouillon supprimé");
      handleClose();
    } catch {
      toast.error("Erreur lors de la suppression");
    }
  }, [commande, deleteDraft, handleClose]);

  const existingProductIds = new Set(lines.map((l) => l.product_id));
  const availableProducts = products.filter((p) => !existingProductIds.has(p.id));

  const showShipped = currentStatus === "expediee" || currentStatus === "recue" || currentStatus === "cloturee";
  const isReceived = currentStatus === "recue" || currentStatus === "cloturee";
  const canSignalReturn = isSender && (currentStatus === "recue" || currentStatus === "cloturee" || currentStatus === "litige");

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
        <DialogContent className="z-[65] max-w-lg max-h-[95vh] sm:max-h-[80vh] overflow-y-auto w-[calc(100vw-1rem)] sm:w-full p-0" overlayClassName="z-[65]">
          {/* Header */}
          <div className="px-5 pt-5 pb-3">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2.5 text-base sm:text-lg pr-10">
                <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-gradient-to-br from-primary/15 to-primary/5 border border-primary/10 shrink-0">
                  <Package className="h-4 w-4 text-primary" />
                </div>
                <span className="truncate flex-1 min-w-0">
                  {cmdData?.order_number ? cmdData.order_number : "Commande"}
                </span>
              </DialogTitle>
            </DialogHeader>

            <div className="flex items-center justify-between mt-2">
              <p className="text-sm text-muted-foreground">
                {isSender ? "Destinataire" : "Expéditeur"} · <span className="text-foreground font-medium">{partnerName}</span>
              </p>
              {commande && currentStatus && (
                <CommandeStatusBadge status={currentStatus} isSender={isSender} />
              )}
            </div>

            {/* Inline status notice — directly under destinataire */}
            {isSender && currentStatus === "envoyee" && (
              <div className="flex items-center gap-2 mt-2 p-2 rounded-lg bg-secondary border border-border text-secondary-foreground text-xs">
                <Pencil className="h-3.5 w-3.5 shrink-0" />
                <span>Modifiable tant que le fournisseur n'a pas consulté</span>
              </div>
            )}
            {isSender && currentStatus === "ouverte" && (
              <div className="flex items-center gap-2 mt-2 p-2 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs">
                <Lock className="h-3.5 w-3.5 shrink-0" />
                <span>Verrouillée — modifications impossibles</span>
              </div>
            )}
            {isDraft && (
              <div className="flex items-center gap-2 mt-2 p-2 rounded-lg bg-accent border border-border text-accent-foreground text-xs">
                <Pencil className="h-3.5 w-3.5 shrink-0" />
                <span>Brouillon — ajoutez des produits et envoyez</span>
              </div>
            )}
            {isSender && currentStatus === "expediee" && (
              <div className="flex items-center gap-2 mt-2 p-2 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 text-xs">
                <Truck className="h-3.5 w-3.5 shrink-0" />
                <span>Expédiée — en attente de réception</span>
              </div>
            )}
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-0">
              {/* Metadata */}
              <div className="px-5 pb-3">
                <div className="rounded-lg border bg-muted/30 p-3 space-y-1.5 text-xs text-muted-foreground">
                  {cmdData?.sent_at && (
                    <div className="flex items-center gap-2">
                      <Clock className="h-3.5 w-3.5 shrink-0" />
                      <span>Envoyée le {fmtDateTime(cmdData.sent_at)}</span>
                    </div>
                  )}
                  {(cmdData?.created_by_name_snapshot || cmdData?.created_by_name) && (
                    <div className="flex items-center gap-2">
                      <User className="h-3.5 w-3.5 shrink-0" />
                      <span>Par <span className="font-medium text-foreground">{cmdData.created_by_name_snapshot || cmdData.created_by_name}</span></span>
                    </div>
                  )}
                  {cmdData?.shipped_by_name && cmdData.shipped_at && (
                    <div className="flex items-center gap-2">
                      <Truck className="h-3.5 w-3.5 shrink-0" />
                      <span>Expédiée par <span className="font-medium text-foreground">{cmdData.shipped_by_name}</span> · {fmtDateTime(cmdData.shipped_at)}</span>
                    </div>
                  )}
                  {cmdData?.received_by_name && cmdData.received_at && (
                    <div className="flex items-center gap-2">
                      <PackageCheck className="h-3.5 w-3.5 shrink-0" />
                      <span>
                        Reçue par <span className="font-medium text-foreground">{cmdData.received_by_name}</span> · {fmtDateTime(cmdData.received_at)}
                        {cmdData.reception_type && (
                          <span className={`ml-1 font-medium ${cmdData.reception_type === "complete" ? "text-emerald-600" : "text-amber-600"}`}>
                            ({cmdData.reception_type === "complete" ? "complète" : "partielle"})
                          </span>
                        )}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* DLC V0: supplier notice */}
              {isReceiver && isReceivedStatus && (
                <div className="px-5 pt-2">
                  <DlcSupplierNotice />
                </div>
              )}

              {/* Product lines */}
              <div className="mt-3">
                <div className="px-5 pb-2">
                  <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Produits ({lines.length})
                  </h3>
                </div>

                {lines.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">Aucun produit</p>
                ) : (() => {
                  // Sort: rupture first, then modifié, then the rest
                  const sortedLines = [...lines].sort((a, b) => {
                    const order = (s: string | null) =>
                      s === "rupture" ? 0 : s === "modifie" ? 1 : 2;
                    return order(a.line_status) - order(b.line_status);
                  });

                  const ruptureLines = showShipped ? sortedLines.filter(l => l.line_status === "rupture") : [];
                  const modifieLines = showShipped ? sortedLines.filter(l => l.line_status === "modifie") : [];
                  const okLines = showShipped
                    ? sortedLines.filter(l => l.line_status !== "rupture" && l.line_status !== "modifie")
                    : sortedLines;

                  return (
                    <div className="space-y-0">
                      {/* ── Rupture section ── */}
                      {ruptureLines.length > 0 && (
                        <div className="bg-destructive/[0.04]">
                          <div className="px-5 pt-3 pb-1.5 flex items-center gap-2">
                            <span className="text-[11px] font-semibold uppercase tracking-wider text-destructive">
                              Rupture
                            </span>
                            <span className="text-[10px] text-destructive/60 font-medium">{ruptureLines.length}</span>
                          </div>
                          <div className="divide-y divide-destructive/10">
                            {ruptureLines.map((line) => (
                              <div key={line.id} className="flex items-center gap-3 px-5 py-3">
                                <div className="h-7 w-7 rounded-full flex items-center justify-center bg-destructive/10 shrink-0">
                                  <XCircle className="h-3.5 w-3.5 text-destructive" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium text-foreground/80 break-words">{line.product_name_snapshot}</p>
                                </div>
                                <div className="shrink-0 text-right">
                                  <span className="text-sm text-muted-foreground line-through tabular-nums">
                                    {formatOrderedQty(line)}
                                  </span>
                                </div>
                                {canSignalReturn && (
                                  <button
                                    type="button"
                                    onClick={() => setSignalerLine(line as CommandeLine)}
                                    className="shrink-0 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                                  >
                                    <RotateCcw className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* ── Modifié section ── */}
                      {modifieLines.length > 0 && (
                        <div className="bg-amber-50/40 dark:bg-amber-950/10">
                          <div className="px-5 pt-3 pb-1.5 flex items-center gap-2">
                            <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                              Quantité ajustée
                            </span>
                            <span className="text-[10px] text-amber-500/60 font-medium">{modifieLines.length}</span>
                          </div>
                          <div className="divide-y divide-amber-200/40 dark:divide-amber-800/20">
                            {modifieLines.map((line) => (
                              <div key={line.id} className="flex items-center gap-3 px-5 py-3">
                                <div className="h-7 w-7 rounded-full flex items-center justify-center bg-amber-100 dark:bg-amber-900/30 shrink-0">
                                  <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium break-words">{line.product_name_snapshot}</p>
                                </div>
                                <div className="shrink-0 text-right">
                                  <span className="text-xs text-muted-foreground line-through tabular-nums block">
                                    {formatOrderedQty(line)}
                                  </span>
                                  <span className="text-sm font-bold tabular-nums text-amber-700 dark:text-amber-300">
                                    {erpFormat(line.product_id, isReceived && line.received_quantity != null ? line.received_quantity : (line.shipped_quantity ?? 0), line.canonical_unit_id, line.unit_label_snapshot)}
                                  </span>
                                </div>
                                {canSignalReturn && (
                                  <button
                                    type="button"
                                    onClick={() => setSignalerLine(line as CommandeLine)}
                                    className="shrink-0 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                                  >
                                    <RotateCcw className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* ── OK / Conforme section ── */}
                      {okLines.length > 0 && (
                        <div>
                          {showShipped && (ruptureLines.length > 0 || modifieLines.length > 0) && (
                            <div className="px-5 pt-3 pb-1.5 flex items-center gap-2">
                              <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                                Conforme
                              </span>
                              <span className="text-[10px] text-emerald-500/60 font-medium">{okLines.length}</span>
                            </div>
                          )}
                          <div className="divide-y divide-border/60">
                            {okLines.map((line) => {
                              const supplierStock = isReceiver && isShareStockActive
                                ? getStockForProduct(line.product_id)
                                : null;
                              const isOverStock = supplierStock !== null && line.canonical_quantity > supplierStock;

                              const rowContent = (
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (isEditable) handleEditLine(line);
                                  }}
                                  className={`w-full flex items-center gap-3 px-5 py-3 text-left transition-colors ${
                                    isEditable ? "active:bg-accent/60 cursor-pointer" : "cursor-default"
                                  }`}
                                >
                                  {showShipped && (ruptureLines.length > 0 || modifieLines.length > 0) && (
                                    <div className="h-7 w-7 rounded-full flex items-center justify-center bg-emerald-50 dark:bg-emerald-900/20 shrink-0">
                                      <Check className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-400" />
                                    </div>
                                  )}
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium break-words">{line.product_name_snapshot}</p>
                                    {/* DLC V0: show badge on received lines (client side) */}
                                    {isSender && isReceivedStatus && (() => {
                                      const dlcRecord = dlcMap.get(line.id);
                                      return (
                                        <div className="mt-1">
                                          <DlcBadge
                                            dlcDate={dlcRecord?.dlc_date ?? null}
                                            showMissing
                                            onClick={() => setDlcSheetLine(line as CommandeLine)}
                                          />
                                        </div>
                                      );
                                    })()}
                                  </div>
                                  <div className="shrink-0 text-right">
                                    <span className="text-sm font-bold tabular-nums">
                                      {isReceived && line.received_quantity != null
                                        ? erpFormat(line.product_id, line.received_quantity, line.canonical_unit_id, line.unit_label_snapshot)
                                        : showShipped
                                          ? erpFormat(line.product_id, line.shipped_quantity ?? line.canonical_quantity, line.canonical_unit_id, line.unit_label_snapshot)
                                          : formatOrderedQty(line)
                                      }
                                    </span>
                                  </div>
                                  {canSignalReturn && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setSignalerLine(line as CommandeLine);
                                      }}
                                      className="shrink-0 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                                    >
                                      <RotateCcw className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                </button>
                              );

                              return (
                                <SwipeableRow
                                  key={line.id}
                                  enabled={isEditable}
                                  onDelete={() => handleRemoveLine(line.id)}
                                >
                                  {rowContent}
                                </SwipeableRow>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>

              {/* Note */}
              {((data?.commande?.note ?? commande?.note) || isEditable) && (
                <div className="px-5 pt-3">
                  <div className="border-t pt-3">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Note</span>
                      {isEditable && !editingNote && (
                        <button onClick={handleEditNote} className="text-muted-foreground hover:text-foreground transition-colors">
                          <Pencil className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                    {editingNote ? (
                      <div className="space-y-2">
                        <Textarea value={noteValue} onChange={(e) => setNoteValue(e.target.value)} rows={2} placeholder="Note de commande…" />
                        <div className="flex gap-2">
                          <Button size="sm" onClick={handleSaveNote} disabled={updateNote.isPending}>
                            {updateNote.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Save className="h-3.5 w-3.5 mr-1" />}
                            Sauver
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingNote(false)}>
                            Annuler
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-muted-foreground text-xs italic">{(data?.commande?.note ?? commande?.note) || "—"}</p>
                    )}
                  </div>
                </div>
              )}

              {/* Add products */}
              {isEditable && availableProducts.length > 0 && (
                <div className="px-5 pt-3">
                  <Sheet open={cartOpen} onOpenChange={setCartOpen}>
                    <SheetTrigger asChild>
                      <button className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed border-primary/30 text-sm text-primary font-medium hover:bg-primary/5 transition-colors">
                        <Plus className="h-4 w-4" />
                        Ajouter des produits ({availableProducts.length})
                      </button>
                    </SheetTrigger>
                    <SheetContent side="bottom" className="z-[70] max-h-[70vh] sm:max-h-[60vh]" overlayClassName="z-[70]">
                      <SheetHeader>
                        <SheetTitle className="flex items-center gap-2 text-base">
                          <ShoppingCart className="h-5 w-5" />
                          Produits disponibles
                        </SheetTitle>
                      </SheetHeader>
                      <div className="mt-4 divide-y divide-border/60 overflow-y-auto max-h-[50vh] sm:max-h-[40vh]">
                        {availableProducts.map((product) => (
                          <button
                            key={product.id}
                            onClick={() => {
                              handleAddProduct(product);
                              setCartOpen(false);
                            }}
                            className="flex items-center gap-3 w-full px-3 py-3.5 text-left hover:bg-accent/50 transition-colors active:bg-accent/70"
                          >
                            <span className="text-sm break-words flex-1 uppercase">{product.nom_produit}</span>
                            <Plus className="h-4 w-4 shrink-0 text-primary" />
                          </button>
                        ))}
                      </div>
                    </SheetContent>
                  </Sheet>
                </div>
              )}

              {/* Signal unordered product */}
              {canSignalReturn && (
                <div className="px-5 pt-3">
                  <button
                    onClick={() => setShowProduitNonCommande(true)}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-dashed text-xs text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
                  >
                    <PackagePlus className="h-3.5 w-3.5" />
                    Signaler un produit non commandé
                  </button>
                </div>
              )}


              {/* Facture App: Generate invoice button (supplier side, facturable commandes) */}
              {isReceiver && currentStatus && (
                <div className="px-5 pt-3">
                  <GenerateInvoiceButton
                    commandeId={commande!.id}
                    commandeStatus={currentStatus}
                  />
                </div>
              )}

              {/* Footer */}
              <div className="px-5 py-4 mt-2 border-t flex items-center justify-between gap-2">
                <div className="flex gap-2">
                  {isDraft && (
                    <Button variant="destructive" size="sm" onClick={handleDelete} disabled={deleteDraft.isPending}>
                      {deleteDraft.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    </Button>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={handleClose}>
                    Fermer
                  </Button>
                  {isDraft && (
                    <Button size="sm" onClick={handleSend} disabled={lines.length === 0 || isSending}>
                      {isSending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Send className="h-4 w-4 mr-1" />}
                      Envoyer ({lines.length})
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Quantity edit modal */}
      <QuantityModalWithResolver
        open={!!quantityProduct}
        onClose={() => {
          setQuantityProduct(null);
          setEditingLineId(null);
        }}
        product={quantityProduct}
        dbUnits={dbUnits}
        dbConversions={dbConversions}
        contextLabel="Commande"
        contextType="order"
        onConfirm={async (params) => {
          await handleQuantityConfirm(params);
        }}
      />

      {/* Signaler retour dialog */}
      {signalerLine && commande && (
        <SignalerRetourDialog
          open={!!signalerLine}
          onClose={() => setSignalerLine(null)}
          commande={commande}
          line={signalerLine}
        />
      )}

      {/* Signaler produit non commandé */}
      {commande && (
        <SignalerProduitNonCommandeDialog
          open={showProduitNonCommande}
          onClose={() => setShowProduitNonCommande(false)}
          commande={commande}
        />
      )}

      {/* DLC V0: Line detail sheet for post-reception DLC capture/edit */}
      {dlcSheetLine && commande && (
        <DlcLineDetailSheet
          open={!!dlcSheetLine}
          onClose={() => setDlcSheetLine(null)}
          productName={dlcSheetLine.product_name_snapshot}
          quantityLabel={erpFormat(
            dlcSheetLine.product_id,
            dlcSheetLine.received_quantity ?? dlcSheetLine.canonical_quantity,
            dlcSheetLine.canonical_unit_id,
            dlcSheetLine.unit_label_snapshot
          )}
          currentDlcDate={dlcMap.get(dlcSheetLine.id)?.dlc_date ?? null}
          upsertData={{
            commande_line_id: dlcSheetLine.id,
            establishment_id: commande.client_establishment_id,
            product_id: dlcSheetLine.product_id,
            quantity_received: dlcSheetLine.received_quantity ?? dlcSheetLine.canonical_quantity,
            canonical_unit_id: dlcSheetLine.canonical_unit_id,
          }}
          onSaved={() => refetchDlc()}
        />
      )}
    </>
  );
}

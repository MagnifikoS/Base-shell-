/**
 * NouvelleCommandeDialog — Full-page flow for creating and sending a commande
 *
 * Universal draft mechanism:
 * - Draft created in DB when supplier is chosen
 * - Cart changes persisted to DB immediately
 * - Closing UI never deletes the draft
 * - Optional resumeDraft prop to continue an existing draft
 *
 * Share Stock (V0): If supplier has share_stock ON, shows estimated
 * availability per product. Warnings + adjust actions. Never blocks.
 */

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { normalizeSearch } from "@/utils/normalizeSearch";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { SearchInput } from "@/components/ui/SearchInput";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
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
  Send,
  Loader2,
  ShoppingCart,
  Package,
  Pencil,
  Trash2,
  ArrowLeft,
  ChevronRight,
  StickyNote,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import {
  usePartnerSuppliers,
  useSupplierProducts,
  useCreateDraftCommande,
  useUpsertCommandeLines,
  useRemoveCommandeLine,
  useUpdateCommandeNote,
  useSendCommande,
  useCommandeDetail,
} from "../hooks/useCommandes";
import { useSupplierStock } from "../hooks/useSupplierStock";
import { useUnitConversions } from "@/core/unitConversion";
import { useProductInputConfigs } from "@/modules/inputConfig";
import { formatSupplierStockForOrder } from "../utils/formatSupplierStockForOrder";
import { QuantityModalWithResolver } from "@/components/stock/QuantityModalWithResolver";
import { type QuantityProduct } from "@/components/stock/UniversalQuantityModal";
import { PriceChangePopup, useMarkAlertAcked, useFetchUnackedAlert } from "@/modules/priceAlerts";
import type { PriceAlert } from "@/modules/priceAlerts";
import type { Commande, CartItem } from "../types";
import { formatInputEntries } from "../utils/formatInputEntries";

interface Props {
  open: boolean;
  onClose: () => void;
  resumeDraft?: Commande | null;
}

type Step = "supplier" | "products";

export function NouvelleCommandeDialog({ open, onClose, resumeDraft }: Props) {
  const { activeEstablishment } = useEstablishment();
  const estId = activeEstablishment?.id;

  // Current draft commande in DB
  const [draftId, setDraftId] = useState<string | null>(resumeDraft?.id ?? null);
  const [step, setStep] = useState<Step>(resumeDraft ? "products" : "supplier");
  const [selectedSupplier, setSelectedSupplier] = useState<string | null>(
    resumeDraft?.supplier_establishment_id ?? null
  );
  const [selectedSupplierName, setSelectedSupplierName] = useState("");
  const [selectedPartnershipId, setSelectedPartnershipId] = useState<string | null>(
    resumeDraft?.partnership_id ?? null
  );
  const [cart, setCart] = useState<CartItem[]>([]);
  const [note, setNote] = useState(resumeDraft?.note ?? "");
  const [search, setSearch] = useState("");
  const [quantityProduct, setQuantityProduct] = useState<QuantityProduct | null>(null);
  const [editingCartItem, setEditingCartItem] = useState<CartItem | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [preSendCheck, setPreSendCheck] = useState(false);
  const [priceAlertPopup, setPriceAlertPopup] = useState<PriceAlert | null>(null);

  const { data: suppliers = [], isLoading: loadingSuppliers } = usePartnerSuppliers();
  const { data: products = [], isLoading: loadingProducts } = useSupplierProducts(selectedSupplier);
  const { conversions: dbConversions, units: dbUnits } = useUnitConversions();
  const inputConfigMap = useProductInputConfigs();

  // ── Share Stock (V0) — read-only, isolated ──
  const {
    isShareStockActive,
    getStockForProduct,
    getSupplierUnitForProduct,
    getSupplierUnitLabelForProduct,
    refetch: refetchStock,
  } = useSupplierStock({
    supplierEstablishmentId: selectedSupplier,
    clientEstablishmentId: estId ?? null,
    partnershipId: selectedPartnershipId,
  });

  // Load existing draft lines if resuming
  const { data: draftDetail } = useCommandeDetail(resumeDraft?.id ?? null);

  const createDraft = useCreateDraftCommande();
  const upsertLines = useUpsertCommandeLines();
  const removeLineApi = useRemoveCommandeLine();
  const updateNoteApi = useUpdateCommandeNote();
  const send = useSendCommande();
  const markAcked = useMarkAlertAcked(estId);
  const { fetchUnackedAlertForProduct } = useFetchUnackedAlert();

  // Debounce ref for note saving
  const noteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initialize from resumed draft
  useEffect(() => {
    if (resumeDraft && draftDetail) {
      setDraftId(resumeDraft.id);
      setSelectedSupplier(resumeDraft.supplier_establishment_id);
      setSelectedPartnershipId(resumeDraft.partnership_id);
      setNote(resumeDraft.note ?? "");
      setStep("products");

      // Populate cart from existing lines
      const items: CartItem[] = draftDetail.lines.map((l) => ({
        productId: l.product_id,
        productName: l.product_name_snapshot,
        canonicalQuantity: l.canonical_quantity,
        canonicalUnitId: l.canonical_unit_id,
        canonicalUnitLabel: l.unit_label_snapshot,
        inputEntries: Array.isArray(l.input_entries) ? l.input_entries : undefined,
      }));
      setCart(items);
    }
  }, [resumeDraft, draftDetail]);

  // Set supplier name from suppliers list
  useEffect(() => {
    if (selectedSupplier && suppliers.length > 0) {
      const s = suppliers.find((s) => s.supplier_establishment_id === selectedSupplier);
      if (s) setSelectedSupplierName(s.supplier_name);
    }
  }, [selectedSupplier, suppliers]);

  // Filter products by search query
  const filteredProducts = useMemo(() => {
    const q = normalizeSearch(search);
    if (!q) return products;
    return products.filter((p) => normalizeSearch(p.nom_produit).includes(q));
  }, [products, search]);

  // ── Stock overage helpers ──
  const getOverages = useCallback(() => {
    if (!isShareStockActive) return [];
    return cart
      .map((item) => {
        const stock = getStockForProduct(item.productId);
        if (stock === null) return null;
        if (item.canonicalQuantity > stock) {
          return { ...item, available: stock };
        }
        return null;
      })
      .filter(Boolean) as (CartItem & { available: number })[];
  }, [cart, isShareStockActive, getStockForProduct]);

  const overages = getOverages();
  const hasOverages = overages.length > 0;

  /** Adjust all cart items to available stock */
  const handleAdjustAll = useCallback(async () => {
    if (!draftId) return;
    const adjusted: CartItem[] = cart.map((item) => {
      const stock = getStockForProduct(item.productId);
      if (stock !== null && item.canonicalQuantity > stock && stock > 0) {
        return { ...item, canonicalQuantity: stock };
      }
      return item;
    }).filter((item) => item.canonicalQuantity > 0);

    setCart(adjusted);

    // Persist adjusted lines
    try {
      await upsertLines.mutateAsync({ commandeId: draftId, items: adjusted });
      toast.success("Quantités ajustées au stock disponible");
    } catch (err) {
      if (import.meta.env.DEV) console.error("[NouvelleCommande] adjust error:", err);
    }
  }, [cart, draftId, getStockForProduct, upsertLines]);

  // ── Create draft in DB when supplier is chosen ──
  const handleSelectSupplier = useCallback(async (supplierId: string) => {
    const supplier = suppliers.find((s) => s.supplier_establishment_id === supplierId);
    if (!supplier || !estId) return;

    setSelectedSupplier(supplierId);
    setSelectedSupplierName(supplier.supplier_name);
    setSelectedPartnershipId(supplier.partnership_id);
    setCart([]);
    setSearch("");

    try {
      const draft = await createDraft.mutateAsync({
        supplierEstablishmentId: supplierId,
        partnershipId: supplier.partnership_id,
      });
      setDraftId(draft.id);
      setStep("products");
    } catch (err) {
      toast.error("Erreur lors de la création du brouillon");
      if (import.meta.env.DEV) console.error("[NouvelleCommande] draft create error:", err);
    }
  }, [suppliers, estId, createDraft]);

  const handleAddProduct = useCallback(
    (product: typeof products[number]) => {
      // If product already in cart, pre-fill with existing quantity
      const existing = cart.find((c) => c.productId === product.id);
      if (existing) {
        setEditingCartItem(existing);
      }
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
    [cart]
  );

  const handleEditCartItem = useCallback(
    (item: CartItem) => {
      const product = products.find((p) => p.id === item.productId);
      if (!product) return;
      setEditingCartItem(item);
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

  // ── Persist cart change to DB immediately ──
  const handleQuantityConfirm = useCallback(
    async (params: {
      productId: string;
      canonicalQuantity: number;
      canonicalUnitId: string;
      canonicalLabel: string | null;
      inputEntries?: Array<{ unit_id: string; quantity: number; unit_label: string }>;
    }) => {
      const product = products.find((p) => p.id === params.productId);
      if (!product || !draftId) return;

      const item: CartItem = {
        productId: params.productId,
        productName: product.nom_produit,
        canonicalQuantity: params.canonicalQuantity,
        canonicalUnitId: params.canonicalUnitId,
        canonicalUnitLabel: params.canonicalLabel,
        inputEntries: params.inputEntries,
      };

      // Update local cart
      setCart((prev) => {
        const existing = prev.findIndex((c) => c.productId === params.productId);
        if (existing >= 0) {
          const next = [...prev];
          next[existing] = item;
          return next;
        }
        return [...prev, item];
      });
      setQuantityProduct(null);
      setEditingCartItem(null);

      // Persist to DB
      try {
        await upsertLines.mutateAsync({ commandeId: draftId, items: [item] });
      } catch (err) {
        if (import.meta.env.DEV) console.error("[NouvelleCommande] upsert error:", err);
      }

      // Check for unacked price alert (fire-and-forget, never blocks)
      if (estId) {
        try {
          const alert = await fetchUnackedAlertForProduct(estId, params.productId);
          if (alert) {
            setPriceAlertPopup(alert);
          }
        } catch {
          // Silent — popup is informational only
        }
      }
    },
    [products, draftId, upsertLines, estId, fetchUnackedAlertForProduct]
  );

  const handleRemoveFromCart = useCallback(async (productId: string) => {
    // Find line ID from detail and delete from DB
    if (draftId && draftDetail) {
      const line = draftDetail.lines.find((l) => l.product_id === productId);
      if (line) {
        try {
          await removeLineApi.mutateAsync(line.id);
          // Only update local cart after successful DB delete
          setCart((prev) => prev.filter((c) => c.productId !== productId));
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
            if (import.meta.env.DEV) console.error("[NouvelleCommande] remove line error:", err);
          }
        }
      } else {
        // Line not in DB yet — safe to remove from local cart
        setCart((prev) => prev.filter((c) => c.productId !== productId));
      }
    } else {
      // No draft persisted yet — just update local cart
      setCart((prev) => prev.filter((c) => c.productId !== productId));
    }
  }, [draftId, draftDetail, removeLineApi]);

  // ── Save note with debounce ──
  const handleNoteChange = useCallback((value: string) => {
    setNote(value);
    if (noteTimerRef.current) clearTimeout(noteTimerRef.current);
    if (draftId) {
      noteTimerRef.current = setTimeout(async () => {
        try {
          await updateNoteApi.mutateAsync({ commandeId: draftId, note: value });
        } catch (err) {
          const msg = err instanceof Error && err.message === "commande_locked"
            ? "Commande verrouillée après ouverture fournisseur"
            : "Erreur de sauvegarde de la note";
          toast.error(msg);
          if (import.meta.env.DEV) console.error("[NouvelleCommande] note save error:", err);
        }
      }, 800);
    }
  }, [draftId, updateNoteApi]);

  // ── Pre-send: re-check stock then send ──
  const handlePreSend = useCallback(async () => {
    if (!estId || !draftId || cart.length === 0) return;

    if (isShareStockActive) {
      // Re-fetch stock before sending
      await refetchStock();
      const freshOverages = getOverages();
      if (freshOverages.length > 0) {
        setPreSendCheck(true);
        return;
      }
    }

    // No overages or no share stock — send directly
    await doSend();
  }, [estId, draftId, cart, isShareStockActive, refetchStock, getOverages]);

  const doSend = useCallback(async () => {
    if (!estId || !draftId || cart.length === 0) return;
    setIsSending(true);
    setPreSendCheck(false);
    try {
      await send.mutateAsync(draftId);
      toast.success("Commande envoyée !");
      resetAndClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("no_lines")) {
        toast.error("Ajoute au moins un produit avant d'envoyer la commande.");
      } else if (msg.includes("unconvertible_prices")) {
        toast.error("Certains produits n'ont pas de conversion de prix valide. Vérifiez les unités configurées.");
      } else {
        toast.error("Erreur lors de l'envoi de la commande");
      }
      if (import.meta.env.DEV) console.error("[NouvelleCommande] error:", err);
    } finally {
      setIsSending(false);
    }
  }, [estId, draftId, cart, send]);

  const handleAdjustAndSend = useCallback(async () => {
    await handleAdjustAll();
    // Wait a tick for state to settle then send
    setTimeout(() => doSend(), 100);
  }, [handleAdjustAll, doSend]);

  const resetAndClose = useCallback(() => {
    setSelectedSupplier(null);
    setSelectedSupplierName("");
    setSelectedPartnershipId(null);
    setDraftId(null);
    setCart([]);
    setNote("");
    setSearch("");
    setStep("supplier");
    setQuantityProduct(null);
    setEditingCartItem(null);
    setIsSending(false);
    setCartOpen(false);
    setNoteOpen(false);
    setPreSendCheck(false);
    setPriceAlertPopup(null);
    onClose();
  }, [onClose]);

  // Close = just close UI, draft stays in DB
  const handleClose = useCallback(() => {
    if (draftId && cart.length > 0) {
      toast.success("Brouillon sauvegardé");
    }
    resetAndClose();
  }, [draftId, cart, resetAndClose]);

  const handleBack = useCallback(() => {
    if (step === "products") {
      // Going back doesn't delete the draft — it stays in DB
      if (draftId && cart.length > 0) {
        toast.success("Brouillon sauvegardé");
      }
      resetAndClose();
    }
  }, [step, draftId, cart, resetAndClose]);

  if (!open) return null;

  return (
    <>
      {/* Full-page overlay */}
      <div className="absolute inset-0 z-40 bg-background flex flex-col animate-in fade-in slide-in-from-bottom-2 duration-200">
        {/* ── Header ── */}
        <header className="shrink-0 bg-background/95 backdrop-blur-sm sticky top-0 z-10">
          <div className="flex items-center gap-3 px-4 sm:px-8 lg:px-12 h-14 sm:h-16 w-full">
            <button
              onClick={step === "products" ? handleBack : handleClose}
              className="flex items-center justify-center h-9 w-9 rounded-lg hover:bg-accent transition-colors -ml-1"
              aria-label="Retour"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="flex-1 min-w-0">
              <h1 className="text-base sm:text-lg font-semibold truncate">
                {step === "supplier" ? "Nouvelle commande" : selectedSupplierName}
              </h1>
              {step === "products" && (
                <p className="text-xs text-muted-foreground truncate">
                  {cart.length} produit{cart.length !== 1 ? "s" : ""} sélectionné{cart.length !== 1 ? "s" : ""}
                </p>
              )}
            </div>
            {step === "products" && (
              <Button
                size="sm"
                onClick={handlePreSend}
                disabled={cart.length === 0 || isSending}
                className="shrink-0"
              >
                {isSending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4 mr-1.5" />
                )}
                <span className="hidden sm:inline">Envoyer</span>
                {cart.length > 0 && (
                  <span className="ml-1 text-xs opacity-80">({cart.length})</span>
                )}
              </Button>
            )}
          </div>

          {/* Search bar in products step */}
          {step === "products" && (
            <div className="px-4 sm:px-8 lg:px-12 pb-3 w-full">
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder="Rechercher un produit…"
              />
            </div>
          )}
        </header>

        {/* ── Content ── */}
        <main className="flex-1 overflow-y-auto">
          <div className="w-full px-4 sm:px-8 lg:px-12 py-4 sm:py-6">
            {step === "supplier" && (
              <SupplierStep
                suppliers={suppliers}
                loading={loadingSuppliers}
                onSelect={handleSelectSupplier}
              />
            )}

            {step === "products" && (
              <ProductsStep
                products={filteredProducts}
                loading={loadingProducts}
                cart={cart}
                search={search}
                onAddProduct={handleAddProduct}
                isShareStockActive={isShareStockActive}
                getStockForProduct={getStockForProduct}
                getSupplierUnitLabelForProduct={getSupplierUnitLabelForProduct}
                allProducts={products}
                inputConfigMap={inputConfigMap}
                dbUnits={dbUnits}
                dbConversions={dbConversions}
              />
            )}
          </div>

          {/* Bottom spacer for floating bar */}
          {step === "products" && <div className="h-36 sm:h-24" />}
        </main>

        {/* ── Floating bottom bar (products step) ── */}
        {step === "products" && (
          <div className="shrink-0 border-t bg-background/95 backdrop-blur-sm sticky bottom-0 z-10">
            <div className="flex items-center gap-2 px-4 sm:px-8 lg:px-12 py-3 w-full">
              {/* Note toggle */}
              <button
                onClick={() => setNoteOpen(!noteOpen)}
                className={`flex items-center justify-center h-10 w-10 rounded-lg border transition-colors ${
                  note ? "border-primary/40 bg-primary/5 text-primary" : "border-border hover:bg-accent"
                }`}
                aria-label="Ajouter une note"
              >
                <StickyNote className="h-4 w-4" />
              </button>

              {/* Cart Sheet trigger */}
              <Sheet open={cartOpen} onOpenChange={setCartOpen}>
                <SheetTrigger asChild>
                  <button
                    className="relative flex items-center gap-2 h-10 px-4 rounded-lg border border-border hover:bg-accent transition-colors disabled:opacity-40"
                    disabled={cart.length === 0}
                  >
                    <ShoppingCart className="h-4 w-4" />
                    <span className="text-sm font-medium">Panier</span>
                    {cart.length > 0 && (
                      <Badge
                        variant="default"
                        className="h-5 min-w-[20px] px-1.5 flex items-center justify-center text-[10px] rounded-full"
                      >
                        {cart.length}
                      </Badge>
                    )}
                    {hasOverages && (
                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                    )}
                  </button>
                </SheetTrigger>
                <SheetContent side="bottom" className="max-h-[75vh]">
                  <SheetHeader>
                    <SheetTitle className="flex items-center gap-2 text-base">
                      <ShoppingCart className="h-5 w-5" />
                      Panier ({cart.length} produit{cart.length > 1 ? "s" : ""})
                    </SheetTitle>
                  </SheetHeader>

                  {/* Stock overage badge + adjust button in cart */}
                  {hasOverages && (
                    <div className="mt-3 p-3 rounded-lg bg-amber-50 border border-amber-200 space-y-2">
                      <div className="flex items-center gap-2 text-amber-700 text-sm">
                        <AlertTriangle className="h-4 w-4 shrink-0" />
                        <span>Certains produits dépassent le stock indicatif</span>
                      </div>
                      <p className="text-xs text-amber-600/80">Le stock peut varier, confirmation finale à l'expédition.</p>
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full border-amber-300 text-amber-700 hover:bg-amber-100"
                        onClick={handleAdjustAll}
                      >
                        Ajuster tout au stock disponible
                      </Button>
                    </div>
                  )}

                  <div className="mt-4 space-y-2 overflow-y-auto max-h-[55vh]">
                    {cart.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-8">
                        Panier vide
                      </p>
                    ) : (
                      cart.map((item) => {
                        const stock = isShareStockActive ? getStockForProduct(item.productId) : null;
                        const isOver = stock !== null && item.canonicalQuantity > stock;

                        // Project stock into ordering units for cart warning display
                        let cartStockLabel: string | null = null;
                        if (isOver && stock !== null) {
                          const fullProduct = products.find((p) => p.id === item.productId);
                          if (fullProduct) {
                            const config = inputConfigMap.get(item.productId) ?? null;
                            cartStockLabel = formatSupplierStockForOrder(
                              Math.max(0, stock),
                              fullProduct,
                              config,
                              dbUnits,
                              dbConversions,
                            );
                          }
                          if (!cartStockLabel) {
                            cartStockLabel = String(Math.max(0, Math.round(stock * 100) / 100));
                          }
                        }

                        return (
                          <div
                            key={item.productId}
                            className={`flex items-center gap-3 p-3 rounded-xl border ${
                              isOver ? "border-amber-300 bg-amber-50/50" : "bg-card"
                            }`}
                          >
                            <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-muted shrink-0">
                              <Package className="h-4 w-4 text-muted-foreground" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium break-words">
                                {item.productName}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {formatInputEntries(item.inputEntries ?? null, item.canonicalQuantity, item.canonicalUnitLabel)}
                                {isOver && cartStockLabel && (
                                  <span className="text-amber-600 ml-1">
                                    — Stock indicatif {cartStockLabel}
                                  </span>
                                )}
                              </p>
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 shrink-0"
                              onClick={() => {
                                setCartOpen(false);
                                handleEditCartItem(item);
                              }}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 shrink-0 text-destructive hover:text-destructive"
                              onClick={() => handleRemoveFromCart(item.productId)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        );
                      })
                    )}
                  </div>
                </SheetContent>
              </Sheet>

              <div className="flex-1" />

              <Button
                variant="outline"
                size="sm"
                onClick={handleClose}
                className="shrink-0"
              >
                Fermer
              </Button>
              <Button
                size="sm"
                onClick={handlePreSend}
                disabled={cart.length === 0 || isSending}
                className="shrink-0"
              >
                {isSending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4 mr-1.5" />
                )}
                Envoyer
              </Button>
            </div>

            {/* Collapsible note */}
            {noteOpen && (
              <div className="px-4 sm:px-8 lg:px-12 pb-3 w-full animate-in slide-in-from-bottom-1 duration-150">
                <Textarea
                  value={note}
                  onChange={(e) => handleNoteChange(e.target.value)}
                  placeholder="Note pour le fournisseur (ex : Livrer avant 10h)…"
                  rows={2}
                  className="text-sm"
                  autoFocus
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Pre-send stock check dialog */}
      <AlertDialog open={preSendCheck} onOpenChange={setPreSendCheck}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Stock indicatif dépassé
            </AlertDialogTitle>
            <AlertDialogDescription>
              {overages.length} produit{overages.length > 1 ? "s" : ""} dépasse{overages.length > 1 ? "nt" : ""} le stock indicatif du fournisseur.
              Le stock peut varier, la confirmation finale se fait à l'expédition.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row gap-2">
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleAdjustAndSend}
              className="bg-primary"
            >
              Ajuster et envoyer
            </AlertDialogAction>
            <AlertDialogAction
              onClick={() => doSend()}
              className="bg-secondary text-secondary-foreground hover:bg-secondary/80"
            >
              Envoyer quand même
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Quantity Modal */}
      <QuantityModalWithResolver
        open={!!quantityProduct}
        onClose={() => {
          setQuantityProduct(null);
          setEditingCartItem(null);
        }}
        product={quantityProduct}
        dbUnits={dbUnits}
        dbConversions={dbConversions}
        contextLabel="Commande"
        contextType="order"
        existingQuantity={editingCartItem?.canonicalQuantity ?? null}
        onConfirm={async (params) => {
          await handleQuantityConfirm(params);
        }}
      />

      {/* Price change popup — shown once per unacked alert */}
      <PriceChangePopup
        alert={priceAlertPopup}
        onDismiss={() => {
          if (priceAlertPopup) {
            markAcked.mutate(priceAlertPopup.id);
          }
          setPriceAlertPopup(null);
        }}
      />
    </>
  );
}

/* ─── Sub-components ──────────────────────────────────────────────────────── */

interface SupplierStepProps {
  suppliers: { supplier_establishment_id: string; supplier_name: string; supplier_logo_url?: string | null; partnership_id: string }[];
  loading: boolean;
  onSelect: (id: string) => void;
}

function SupplierStep({ suppliers, loading, onSelect }: SupplierStepProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (suppliers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <Package className="h-10 w-10 mb-3 opacity-40" />
        <p className="font-medium">Aucun partenaire B2B</p>
        <p className="text-sm mt-1">Créez d'abord un partenariat fournisseur</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Sélectionnez le fournisseur pour votre commande
      </p>
      <div className="space-y-2">
        {suppliers.map((s) => (
          <button
            key={s.supplier_establishment_id}
            onClick={() => onSelect(s.supplier_establishment_id)}
            className="w-full flex items-center gap-3 p-4 rounded-xl border bg-card hover:bg-accent/50 transition-colors text-left active:scale-[0.99]"
          >
            {s.supplier_logo_url ? (
              <img
                src={s.supplier_logo_url}
                alt={s.supplier_name}
                className="h-11 w-11 rounded-lg object-contain border bg-background shrink-0"
              />
            ) : (
              <div className="flex items-center justify-center h-11 w-11 rounded-lg bg-gradient-to-br from-primary/15 to-primary/5 border border-primary/10 shadow-sm shrink-0">
                <Package className="h-5 w-5 text-primary" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm truncate">{s.supplier_name}</p>
              <p className="text-xs text-muted-foreground">Fournisseur partenaire</p>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
          </button>
        ))}
      </div>
    </div>
  );
}

interface ProductsStepProps {
  products: { id: string; nom_produit: string; category: string | null }[];
  loading: boolean;
  cart: CartItem[];
  search: string;
  onAddProduct: (product: { id: string; nom_produit: string; category: string | null; stock_handling_unit_id: string | null; final_unit_id: string | null; delivery_unit_id: string | null; supplier_billing_unit_id: string | null; conditionnement_config: unknown }) => void;
  isShareStockActive: boolean;
  getStockForProduct: (productId: string) => number | null;
  getSupplierUnitLabelForProduct: (productId: string) => string | null;
  allProducts: { id: string; nom_produit: string; stock_handling_unit_id: string | null; final_unit_id: string | null; delivery_unit_id: string | null; supplier_billing_unit_id: string | null; conditionnement_config: unknown; category: string | null }[];
  inputConfigMap: Map<string, import("@/modules/inputConfig/types").ProductInputConfigRow>;
  dbUnits: import("@/core/unitConversion/types").UnitWithFamily[];
  dbConversions: import("@/core/unitConversion/types").ConversionRule[];
}

function ProductsStep({ products, loading, cart, search, onAddProduct, isShareStockActive, getStockForProduct, getSupplierUnitLabelForProduct, allProducts, inputConfigMap, dbUnits, dbConversions }: ProductsStepProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (products.length === 0 && !search) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <Package className="h-10 w-10 mb-3 opacity-40" />
        <p className="font-medium">Aucun produit disponible</p>
        <p className="text-sm mt-1">Ce fournisseur n'a pas de produits importés</p>
      </div>
    );
  }

  if (products.length === 0 && search) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <Package className="h-10 w-10 mb-3 opacity-40" />
        <p className="font-medium">Aucun résultat</p>
        <p className="text-sm mt-1">Essayez un autre terme de recherche</p>
      </div>
    );
  }

  const sorted = [...products].sort((a, b) =>
    a.nom_produit.localeCompare(b.nom_produit, "fr")
  );
  const cartIds = new Set(cart.map((c) => c.productId));

  return (
    <div>
      {/* Column header */}
      {isShareStockActive && (
        <div className="flex items-center justify-between px-4 py-2 mb-1">
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Produit</span>
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Stock fournisseur</span>
        </div>
      )}
      <div className="divide-y divide-border/60">
        {sorted.map((product) => {
          const inCart = cartIds.has(product.id);
          const cartItem = cart.find((c) => c.productId === product.id);
          const stock = isShareStockActive ? getStockForProduct(product.id) : null;
          const stockUnit = isShareStockActive ? getSupplierUnitLabelForProduct(product.id) : null;

          // Project stock into authorized ordering units
          let stockLabel: string | null = null;
          if (stock !== null && isShareStockActive) {
            const fullProduct = allProducts.find((p) => p.id === product.id);
            if (fullProduct) {
              const config = inputConfigMap.get(product.id) ?? null;
              stockLabel = formatSupplierStockForOrder(
                Math.max(0, stock),
                fullProduct,
                config,
                dbUnits,
                dbConversions,
              );
            }
            // Fallback: raw display if projection fails
            if (!stockLabel) {
              stockLabel = `${Math.max(0, Math.round(stock * 100) / 100)}${stockUnit ? ` ${stockUnit}` : ""}`;
            }
          }

          return (
            <button
              key={product.id}
              onClick={() => onAddProduct(product as Parameters<typeof onAddProduct>[0])}
              className={`w-full flex items-center justify-between px-4 py-3.5 text-left transition-all active:scale-[0.99] ${
                inCart
                  ? "bg-primary/5"
                  : "hover:bg-accent/40"
              }`}
            >
              <div className="flex-1 min-w-0">
                <span className={`text-sm break-words uppercase ${inCart ? "font-semibold text-primary" : ""}`}>
                  {product.nom_produit}
                </span>
              </div>
              <div className="w-28 shrink-0 text-right">
                {inCart && cartItem ? (
                  <span className="text-sm font-semibold tabular-nums text-foreground">
                    {formatInputEntries(cartItem.inputEntries ?? null, cartItem.canonicalQuantity, cartItem.canonicalUnitLabel)}
                  </span>
                ) : null}
              </div>
              {isShareStockActive && (
                <span className="text-right text-xs tabular-nums text-muted-foreground shrink-0 whitespace-nowrap">
                  {stockLabel ?? "—"}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

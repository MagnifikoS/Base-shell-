/**
 * NouvelleCommandeCompositeDialog — Product-only order creation dialog.
 * Single entry point for ordering products from a supplier.
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
import { supabase } from "@/integrations/supabase/client";
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
} from "@/modules/commandes/hooks/useCommandes";
import { useSupplierStock } from "@/modules/commandes/hooks/useSupplierStock";
import { useUnitConversions } from "@/core/unitConversion";
import { useProductInputConfigs } from "@/modules/inputConfig";
import { formatSupplierStockForOrder } from "@/modules/commandes/utils/formatSupplierStockForOrder";
import { QuantityModalWithResolver } from "@/components/stock/QuantityModalWithResolver";
import { type QuantityProduct } from "@/components/stock/UniversalQuantityModal";
import { PriceChangePopup, useMarkAlertAcked, useFetchUnackedAlert } from "@/modules/priceAlerts";
import type { PriceAlert } from "@/modules/priceAlerts";
import type { Commande, CartItem } from "@/modules/commandes/types";
import { formatInputEntries } from "@/modules/commandes/utils/formatInputEntries";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/* ── Types ── */

interface SupplierItem {
  supplier_establishment_id: string;
  supplier_name: string;
  supplier_logo_url: string | null;
  partnership_id: string;
  shareStock: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  resumeProductDraft?: Commande | null;
}

type Step = "supplier" | "catalog";

export function NouvelleCommandeCompositeDialog({ open, onClose, resumeProductDraft }: Props) {
  const { activeEstablishment } = useEstablishment();
  const estId = activeEstablishment?.id;

  // ── Step & navigation ──
  const [step, setStep] = useState<Step>(resumeProductDraft ? "catalog" : "supplier");

  // ── Supplier ──
  const [selectedSupplier, setSelectedSupplier] = useState<SupplierItem | null>(null);

  // ── Product state ──
  const [productDraftId, setProductDraftId] = useState<string | null>(resumeProductDraft?.id ?? null);
  const [productCart, setProductCart] = useState<CartItem[]>([]);
  const [note, setNote] = useState(resumeProductDraft?.note ?? "");
  const [search, setSearch] = useState("");
  const [quantityProduct, setQuantityProduct] = useState<QuantityProduct | null>(null);
  const [editingCartItem, setEditingCartItem] = useState<CartItem | null>(null);
  const [preSendCheck, setPreSendCheck] = useState(false);
  const [priceAlertPopup, setPriceAlertPopup] = useState<PriceAlert | null>(null);

  // ── UI state ──
  const [isSending, setIsSending] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);

  // ── Data hooks ──
  const { data: productSuppliers = [], isLoading: loadingSuppliers } = usePartnerSuppliers();
  const { data: products = [], isLoading: loadingProducts } = useSupplierProducts(
    selectedSupplier?.supplier_establishment_id ?? null
  );
  const { conversions: dbConversions, units: dbUnits } = useUnitConversions();
  const inputConfigMap = useProductInputConfigs();

  // ── Share Stock ──
  const {
    isShareStockActive,
    getStockForProduct,
    getSupplierUnitLabelForProduct,
    refetch: refetchStock,
  } = useSupplierStock({
    supplierEstablishmentId: selectedSupplier?.supplier_establishment_id ?? null,
    clientEstablishmentId: estId ?? null,
    partnershipId: selectedSupplier?.partnership_id ?? null,
  });

  // ── Mutations ──
  const createProductDraft = useCreateDraftCommande();
  const upsertProductLines = useUpsertCommandeLines();
  const removeProductLine = useRemoveCommandeLine();
  const updateNoteApi = useUpdateCommandeNote();
  const sendProduct = useSendCommande();
  const markAcked = useMarkAlertAcked(estId);
  const { fetchUnackedAlertForProduct } = useFetchUnackedAlert();

  // ── Resume product draft ──
  const { data: draftDetail } = useCommandeDetail(resumeProductDraft?.id ?? null);
  const noteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Supplier list ──
  const suppliers = useMemo<SupplierItem[]>(() => {
    return productSuppliers.map((ps) => ({
      supplier_establishment_id: ps.supplier_establishment_id,
      supplier_name: ps.supplier_name,
      supplier_logo_url: ps.supplier_logo_url ?? null,
      partnership_id: ps.partnership_id,
      shareStock: ps.share_stock ?? false,
    })).sort((a, b) => a.supplier_name.localeCompare(b.supplier_name, "fr"));
  }, [productSuppliers]);

  // ── Initialize from resumed draft ──
  useEffect(() => {
    if (resumeProductDraft && draftDetail) {
      setProductDraftId(resumeProductDraft.id);
      setNote(resumeProductDraft.note ?? "");
      setStep("catalog");

      const supplier = suppliers.find(
        (s) => s.supplier_establishment_id === resumeProductDraft.supplier_establishment_id
      );
      if (supplier) {
        setSelectedSupplier(supplier);
      } else {
        setSelectedSupplier({
          supplier_establishment_id: resumeProductDraft.supplier_establishment_id,
          supplier_name: "",
          supplier_logo_url: null,
          partnership_id: resumeProductDraft.partnership_id,
          shareStock: false,
        });
      }

      const items: CartItem[] = draftDetail.lines.map((l) => ({
        productId: l.product_id,
        productName: l.product_name_snapshot,
        canonicalQuantity: l.canonical_quantity,
        canonicalUnitId: l.canonical_unit_id,
        canonicalUnitLabel: l.unit_label_snapshot,
        inputEntries: Array.isArray(l.input_entries) ? l.input_entries : undefined,
      }));
      setProductCart(items);
    }
  }, [resumeProductDraft, draftDetail, suppliers]);

  // ── Filtered products ──
  const filteredProducts = useMemo(() => {
    const q = normalizeSearch(search);
    if (!q) return products;
    return products.filter((p) => normalizeSearch(p.nom_produit).includes(q));
  }, [products, search]);

  // ── Stock overages ──
  const overages = useMemo(() => {
    if (!isShareStockActive) return [];
    return productCart
      .map((item) => {
        const stock = getStockForProduct(item.productId);
        if (stock === null) return null;
        if (item.canonicalQuantity > stock) return { ...item, available: stock };
        return null;
      })
      .filter(Boolean) as (CartItem & { available: number })[];
  }, [productCart, isShareStockActive, getStockForProduct]);

  const hasOverages = overages.length > 0;

  // ── Counts ──
  const totalCount = productCart.length;

  // ── Supplier selection ──
  const handleSelectSupplier = useCallback(
    async (supplier: SupplierItem) => {
      setSelectedSupplier(supplier);
      setProductCart([]);
      setSearch("");

      if (!productDraftId) {
        try {
          const draft = await createProductDraft.mutateAsync({
            supplierEstablishmentId: supplier.supplier_establishment_id,
            partnershipId: supplier.partnership_id,
          });
          setProductDraftId(draft.id);
        } catch {
          toast.error("Erreur lors de la création du brouillon");
          return;
        }
      }

      setStep("catalog");
    },
    [productDraftId, createProductDraft]
  );

  // ── Product: add via BFS modal ──
  const handleAddProduct = useCallback(
    (product: typeof products[number]) => {
      const existing = productCart.find((c) => c.productId === product.id);
      if (existing) setEditingCartItem(existing);
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
    [productCart]
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

  // ── Persist product cart ──
  const handleQuantityConfirm = useCallback(
    async (params: {
      productId: string;
      canonicalQuantity: number;
      canonicalUnitId: string;
      canonicalLabel: string | null;
      inputEntries?: Array<{ unit_id: string; quantity: number; unit_label: string }>;
    }) => {
      const product = products.find((p) => p.id === params.productId);
      if (!product || !productDraftId) return;

      const item: CartItem = {
        productId: params.productId,
        productName: product.nom_produit,
        canonicalQuantity: params.canonicalQuantity,
        canonicalUnitId: params.canonicalUnitId,
        canonicalUnitLabel: params.canonicalLabel,
        inputEntries: params.inputEntries,
      };

      setProductCart((prev) => {
        const idx = prev.findIndex((c) => c.productId === params.productId);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = item;
          return next;
        }
        return [...prev, item];
      });
      setQuantityProduct(null);
      setEditingCartItem(null);

      try {
        await upsertProductLines.mutateAsync({ commandeId: productDraftId, items: [item] });
      } catch (err) {
        if (import.meta.env.DEV) console.error("[NouvelleCommande] upsert error:", err);
      }

      // Price alert check
      if (estId) {
        try {
          const alert = await fetchUnackedAlertForProduct(estId, params.productId);
          if (alert) setPriceAlertPopup(alert);
        } catch { /* silent */ }
      }
    },
    [products, productDraftId, upsertProductLines, estId, fetchUnackedAlertForProduct]
  );

  const handleRemoveProduct = useCallback(
    async (productId: string) => {
      if (productDraftId && draftDetail) {
        const line = draftDetail.lines.find((l) => l.product_id === productId);
        if (line) {
          try {
            await removeProductLine.mutateAsync(line.id);
            setProductCart((prev) => prev.filter((c) => c.productId !== productId));
          } catch (err: unknown) {
            const msg = (err instanceof Error ? err.message : "") || "";
            if (msg.includes("LAST_LINE_ENVOYEE")) {
              toast.error("Impossible : une commande envoyée doit contenir au moins un produit.");
            } else {
              toast.error("Erreur lors de la suppression");
            }
          }
        } else {
          setProductCart((prev) => prev.filter((c) => c.productId !== productId));
        }
      } else {
        setProductCart((prev) => prev.filter((c) => c.productId !== productId));
      }
    },
    [productDraftId, draftDetail, removeProductLine]
  );

  // ── Note (debounced) ──
  const handleNoteChange = useCallback(
    (value: string) => {
      setNote(value);
      if (noteTimerRef.current) clearTimeout(noteTimerRef.current);
      if (productDraftId) {
        noteTimerRef.current = setTimeout(async () => {
          try {
            await updateNoteApi.mutateAsync({ commandeId: productDraftId, note: value });
          } catch {
            toast.error("Erreur de sauvegarde de la note");
          }
        }, 800);
      }
    },
    [productDraftId, updateNoteApi]
  );

  // ── Adjust stock overages ──
  const handleAdjustAll = useCallback(async () => {
    if (!productDraftId) return;
    const adjusted = productCart
      .map((item) => {
        const stock = getStockForProduct(item.productId);
        if (stock !== null && item.canonicalQuantity > stock && stock > 0) {
          return { ...item, canonicalQuantity: stock };
        }
        return item;
      })
      .filter((item) => item.canonicalQuantity > 0);

    setProductCart(adjusted);
    try {
      await upsertProductLines.mutateAsync({ commandeId: productDraftId, items: adjusted });
      toast.success("Quantités ajustées au stock disponible");
    } catch { /* silent */ }
  }, [productCart, productDraftId, getStockForProduct, upsertProductLines]);

  // ── Send ──
  const handlePreSend = useCallback(async () => {
    if (!estId || totalCount === 0) return;

    if (isShareStockActive) {
      await refetchStock();
      if (overages.length > 0) {
        setPreSendCheck(true);
        return;
      }
    }
    await doSend();
  }, [estId, totalCount, isShareStockActive, refetchStock, overages]);

  const doSend = useCallback(async () => {
    if (!estId || totalCount === 0 || !productDraftId) return;
    setIsSending(true);
    setPreSendCheck(false);

    try {
      await sendProduct.mutateAsync(productDraftId);
      toast.success("Commande envoyée !");
      resetAndClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("no_lines")) {
        toast.error("Ajoute au moins un article avant d'envoyer.");
      } else {
        toast.error("Erreur lors de l'envoi de la commande");
      }
      if (import.meta.env.DEV) console.error("[NouvelleCommande] send error:", err);
    } finally {
      setIsSending(false);
    }
  }, [estId, totalCount, productDraftId, sendProduct]);

  const handleAdjustAndSend = useCallback(async () => {
    await handleAdjustAll();
    setTimeout(() => doSend(), 100);
  }, [handleAdjustAll, doSend]);

  // ── Close / Reset ──
  const resetAndClose = useCallback(() => {
    setSelectedSupplier(null);
    setProductDraftId(null);
    setProductCart([]);
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

  const handleClose = useCallback(() => {
    if (productDraftId && productCart.length > 0) {
      toast.success("Brouillon sauvegardé");
    }
    resetAndClose();
  }, [productDraftId, productCart, resetAndClose]);

  const handleBack = useCallback(() => {
    if (step === "catalog") {
      if (productDraftId && productCart.length > 0) {
        toast.success("Brouillon sauvegardé");
      }
      resetAndClose();
    }
  }, [step, productDraftId, productCart, resetAndClose]);

  if (!open) return null;

  // ── Product list ──
  const sortedProducts = [...filteredProducts].sort((a, b) =>
    a.nom_produit.localeCompare(b.nom_produit, "fr")
  );
  const productCartIds = new Set(productCart.map((c) => c.productId));

  return (
    <>
      <div className="absolute inset-0 z-40 bg-background flex flex-col animate-in fade-in slide-in-from-bottom-2 duration-200">
        {/* ── Header ── */}
        <header className="shrink-0 bg-background/95 backdrop-blur-sm sticky top-0 z-10">
          <div className="flex items-center gap-3 px-4 sm:px-8 lg:px-12 h-14 sm:h-16 w-full">
            <button
              onClick={step === "catalog" ? handleBack : handleClose}
              className="flex items-center justify-center h-9 w-9 rounded-lg hover:bg-accent transition-colors -ml-1"
              aria-label="Retour"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="flex-1 min-w-0">
              <h1 className="text-base sm:text-lg font-semibold truncate">
                {step === "supplier" ? "Nouvelle commande" : selectedSupplier?.supplier_name}
              </h1>
              {step === "catalog" && totalCount > 0 && (
                <p className="text-xs text-muted-foreground truncate">
                  {totalCount} produit{totalCount > 1 ? "s" : ""}
                </p>
              )}
            </div>
            {step === "catalog" && (
              <Button
                size="sm"
                onClick={handlePreSend}
                disabled={totalCount === 0 || isSending}
                className="shrink-0"
              >
                {isSending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4 mr-1.5" />
                )}
                <span className="hidden sm:inline">Envoyer</span>
                {totalCount > 0 && (
                  <span className="ml-1 text-xs opacity-80">({totalCount})</span>
                )}
              </Button>
            )}
          </div>

          {/* Search */}
          {step === "catalog" && (
            <div className="px-4 sm:px-8 lg:px-12 pb-3 w-full space-y-2">
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
            {/* Supplier step */}
            {step === "supplier" && (
              <div className="space-y-3">
                {loadingSuppliers ? (
                  <div className="flex items-center justify-center py-20">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : suppliers.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                    <Package className="h-10 w-10 mb-3 opacity-40" />
                    <p className="font-medium">Aucun partenaire B2B</p>
                    <p className="text-sm mt-1">Créez d'abord un partenariat fournisseur</p>
                  </div>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground">
                      Sélectionnez le fournisseur pour votre commande
                    </p>
                    <div className="space-y-2">
                      {suppliers.map((s) => (
                        <button
                          key={s.supplier_establishment_id}
                          onClick={() => handleSelectSupplier(s)}
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
                            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                              <Package className="h-3 w-3" /> Produits
                            </span>
                          </div>
                          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Catalog step — Products */}
            {step === "catalog" && (
              <div>
                {loadingProducts ? (
                  <div className="flex items-center justify-center py-20">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : sortedProducts.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                    <Package className="h-10 w-10 mb-3 opacity-40" />
                    <p className="font-medium">{search ? "Aucun résultat" : "Aucun produit disponible"}</p>
                    <p className="text-sm mt-1">{search ? "Essayez un autre terme" : "Ce fournisseur n'a pas de produits"}</p>
                  </div>
                ) : (
                  <>
                    {isShareStockActive && (
                      <div className="flex items-center justify-between px-4 py-2 mb-1">
                        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Produit</span>
                        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Stock fournisseur</span>
                      </div>
                    )}
                    <div className="divide-y divide-border/60">
                    {sortedProducts.map((product) => {
                        const inCart = productCartIds.has(product.id);
                        const cartItem = productCart.find((c) => c.productId === product.id);
                        const stock = isShareStockActive ? getStockForProduct(product.id) : null;
                        const stockUnit = isShareStockActive ? getSupplierUnitLabelForProduct(product.id) : null;

                        // Project stock into authorized ordering units
                        let stockLabel: string | null = null;
                        if (stock !== null && isShareStockActive) {
                          const config = inputConfigMap.get(product.id) ?? null;
                          stockLabel = formatSupplierStockForOrder(
                            Math.max(0, stock),
                            product,
                            config,
                            dbUnits,
                            dbConversions,
                          );
                          // Fallback: raw display if projection fails
                          if (!stockLabel) {
                            stockLabel = `${Math.max(0, Math.round(stock * 100) / 100)}${stockUnit ? ` ${stockUnit}` : ""}`;
                          }
                        }

                        return (
                          <button
                            key={product.id}
                            onClick={() => handleAddProduct(product)}
                            className={`w-full flex items-center justify-between px-4 py-3.5 text-left transition-all active:scale-[0.99] ${
                              inCart ? "bg-primary/5" : "hover:bg-accent/40"
                            }`}
                          >
                            <div className="flex-1 min-w-0">
                              <span className={`text-sm truncate block uppercase ${inCart ? "font-semibold text-primary" : ""}`}>
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
                  </>
                )}
              </div>
            )}
          </div>

          {/* Bottom spacer */}
          {step === "catalog" && <div className="h-36 sm:h-24" />}
        </main>

        {/* ── Floating bottom bar ── */}
        {step === "catalog" && (
          <div className="shrink-0 border-t bg-background/95 backdrop-blur-sm sticky bottom-0 z-10">
            <div className="flex items-center gap-2 px-4 sm:px-8 lg:px-12 py-3 w-full">
              {/* Note */}
              <button
                onClick={() => setNoteOpen(!noteOpen)}
                className={`flex items-center justify-center h-10 w-10 rounded-lg border transition-colors ${
                  note ? "border-primary/40 bg-primary/5 text-primary" : "border-border hover:bg-accent"
                }`}
                aria-label="Ajouter une note"
              >
                <StickyNote className="h-4 w-4" />
              </button>

              {/* Cart Sheet */}
              <Sheet open={cartOpen} onOpenChange={setCartOpen}>
                <SheetTrigger asChild>
                  <button
                    className="relative flex items-center gap-2 h-10 px-4 rounded-lg border border-border hover:bg-accent transition-colors disabled:opacity-40"
                    disabled={totalCount === 0}
                  >
                    <ShoppingCart className="h-4 w-4" />
                    <span className="text-sm font-medium">Panier</span>
                    {totalCount > 0 && (
                      <Badge
                        variant="default"
                        className="h-5 min-w-[20px] px-1.5 flex items-center justify-center text-[10px] rounded-full"
                      >
                        {totalCount}
                      </Badge>
                    )}
                    {hasOverages && <AlertTriangle className="h-4 w-4 text-amber-500" />}
                  </button>
                </SheetTrigger>
                <SheetContent side="bottom" className="max-h-[75vh]">
                  <SheetHeader>
                    <SheetTitle className="flex items-center gap-2 text-base">
                      <ShoppingCart className="h-5 w-5" />
                      Panier ({totalCount} article{totalCount > 1 ? "s" : ""})
                    </SheetTitle>
                  </SheetHeader>

                  {hasOverages && (
                    <div className="mt-3 p-3 rounded-lg bg-amber-50 border border-amber-200 space-y-2">
                      <div className="flex items-center gap-2 text-amber-700 text-sm">
                        <AlertTriangle className="h-4 w-4 shrink-0" />
                        <span>Certains produits dépassent le stock indicatif</span>
                      </div>
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

                  <div className="mt-4 space-y-4 overflow-y-auto max-h-[55vh]">
                    {productCart.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                          <Package className="h-3 w-3" /> Produits ({productCart.length})
                        </p>
                        {productCart.map((item) => {
                          const stock = isShareStockActive ? getStockForProduct(item.productId) : null;
                          const isOver = stock !== null && item.canonicalQuantity > stock;

                          // Project stock for cart warning display
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
                                <p className="text-sm font-medium truncate">{item.productName}</p>
                                <p className="text-xs text-muted-foreground">
                                  {formatInputEntries(item.inputEntries ?? null, item.canonicalQuantity, item.canonicalUnitLabel)}
                                  {isOver && cartStockLabel && (
                                    <span className="text-amber-600 ml-1">— Stock {cartStockLabel}</span>
                                  )}
                                </p>
                              </div>
                              <Button
                                variant="ghost" size="icon" className="h-8 w-8 shrink-0"
                                onClick={() => { setCartOpen(false); handleEditCartItem(item); }}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost" size="icon"
                                className="h-8 w-8 shrink-0 text-destructive hover:text-destructive"
                                onClick={() => handleRemoveProduct(item.productId)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {totalCount === 0 && (
                      <p className="text-sm text-muted-foreground text-center py-8">Panier vide</p>
                    )}
                  </div>
                </SheetContent>
              </Sheet>

              <div className="flex-1" />

              <Button variant="outline" size="sm" onClick={handleClose} className="shrink-0">
                Fermer
              </Button>
              <Button
                size="sm"
                onClick={handlePreSend}
                disabled={totalCount === 0 || isSending}
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

            {/* Note area */}
            {noteOpen && (
              <div className="px-4 sm:px-8 lg:px-12 pb-3 w-full animate-in slide-in-from-bottom-1 duration-150">
                <Textarea
                  value={note}
                  onChange={(e) => handleNoteChange(e.target.value)}
                  placeholder="Note pour le fournisseur…"
                  rows={2}
                  className="text-sm"
                  autoFocus
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Pre-send stock dialog */}
      <AlertDialog open={preSendCheck} onOpenChange={setPreSendCheck}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Stock indicatif dépassé
            </AlertDialogTitle>
            <AlertDialogDescription>
              {overages.length} produit{overages.length > 1 ? "s" : ""} dépasse{overages.length > 1 ? "nt" : ""} le stock indicatif.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row gap-2">
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={handleAdjustAndSend} className="bg-primary">
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
        onClose={() => { setQuantityProduct(null); setEditingCartItem(null); }}
        product={quantityProduct}
        dbUnits={dbUnits}
        dbConversions={dbConversions}
        contextLabel="Commande"
        contextType="order"
        existingQuantity={editingCartItem?.canonicalQuantity ?? null}
        onConfirm={async (params) => { await handleQuantityConfirm(params); }}
      />

      {/* Price change popup */}
      <PriceChangePopup
        alert={priceAlertPopup}
        onDismiss={() => {
          if (priceAlertPopup) markAcked.mutate(priceAlertPopup.id);
          setPriceAlertPopup(null);
        }}
      />
    </>
  );
}

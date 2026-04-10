/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MOBILE RECEPTION VIEW — Supplier → Flat product list (NO categories)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * FLOW:
 * 1. Select Supplier
 * 2. Flat product list + search bar (no category navigation)
 * 3. Tap product → ReceptionQuantityModal
 * 4. Sticky "Valider réception" → BL popup → POST
 * 5. After POST success → stay on supplier product list + toast
 *
 * RULES:
 * - Zone resolved server-side from establishment_stock_settings
 * - ensureDraft() called only on explicit supplier selection
 * - NO auto-create after POST, NO auto-open BL modal
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useState, useMemo, useRef, useCallback } from "react";
import {
  ArrowLeft,
  Send,
  Loader2,
  Search,
  MapPin,
  Package,
  AlertTriangle,
  Plus,
  Check,
  Settings2,
} from "lucide-react";
import { MobileCartDrawer, CartTriggerButton, type CartLine } from "./MobileCartDrawer";
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
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { useSuppliersList, useStorageZones } from "@/modules/produitsV2";
import { useReceiptDraft } from "../hooks/useReceiptDraft";
import { usePostDocument, type PostResult } from "../hooks/usePostDocument";
import { useUnitConversions } from "@/core/unitConversion";
import { buildCanonicalLine } from "../engine/buildCanonicalLine";
import { getInputPayloadProductName } from "../types";
import type { Json } from "@/integrations/supabase/types";

import { type StepperConfig, type QuantityEntry } from "./ReceptionQuantityModal";
import { UniversalQuantityModal } from "@/components/stock/UniversalQuantityModal";
import { resolveInputConversion, convertToCanonical } from "../utils/resolveInputConversion";
import { useProductInputConfigs, resolveInputUnitForContext } from "@/modules/inputConfig";
import { ReceptionToleranceSettings } from "./ReceptionToleranceSettings";
import { ToleranceWarningDialog } from "./ToleranceWarningDialog";
import { checkTolerance, type ToleranceWarning } from "../utils/toleranceCheck";
import type { PostPopupComponent } from "@/modules/shared";
import { useAuth } from "@/contexts/AuthContext";
import { Settings } from "lucide-react";
import { formatQuantityForContext } from "@/lib/units/formatQuantityForContext";

interface Props {
  onBack?: () => void;
  /** Optional BL-APP popup component injected to avoid circular dependency */
  PostPopup?: PostPopupComponent;
}

interface SupplierProduct {
  id: string;
  nom_produit: string;
  category: string | null;
  supplier_id?: string;
  storage_zone_id: string | null;
  final_unit_id: string | null;
  stock_handling_unit_id: string | null;
  supplier_billing_unit_id: string | null;
  delivery_unit_id: string | null;
  conditionnement_config: Json | null;
  delivery_unit_name: string | null;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function MobileReceptionView({ onBack, PostPopup }: Props) {
  const { activeEstablishment } = useEstablishment();
  const estId = activeEstablishment?.id;
  const { user } = useAuth();
  const { data: suppliers = [] } = useSuppliersList();
  const { zones } = useStorageZones();
  const { units: dbUnits, conversions: dbConversions } = useUnitConversions();
  const inputConfigs = useProductInputConfigs();

  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const [globalSearch, setGlobalSearch] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [toleranceSettingsOpen, setToleranceSettingsOpen] = useState(false);
  const [toleranceWarning, setToleranceWarning] = useState<{
    productName: string;
    warning: ToleranceWarning;
    onProceed: () => void;
  } | null>(null);
  const [showBlPopup, setShowBlPopup] = useState(false);
  const [_postError, setPostError] = useState<PostResult | null>(null);
  const [postGuard, setPostGuard] = useState(false);

  // BL-APP popup state — capture document ID at popup open time
  const [blAppStockDocId, setBlAppStockDocId] = useState<string | null>(null);
  const [blAppSupplierId, setBlAppSupplierId] = useState<string | null>(null);
  const [blAppSupplierName, setBlAppSupplierName] = useState<string | null>(null);

  // Pre-POST zone warning state
  const [zoneWarningOpen, setZoneWarningOpen] = useState(false);
  const [productsWithoutZone, setProductsWithoutZone] = useState<string[]>([]);

  // Quantity modal state
  const [modalProduct, setModalProduct] = useState<SupplierProduct | null>(null);
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  

  const {
    document,
    lines,
    isLoading,
    isDraftCreating,
    draftError,
    defaultZone,
    zoneMissing,
    zoneNeedsSelection,
    availableZones,
    setReceiptZoneId,
    zoneIsManualSelection,
    ensureDraft,
    addLine,
    updateLine,
    removeLine,
    updateSupplier,
  } = useReceiptDraft();
  const { post, isPosting } = usePostDocument();

  // Guard: prevent post-success callbacks from running twice
  const hasCompletedRef = useRef(false);

  // ═══ Load product counts per supplier (for card badges) ═══
  const { data: supplierProductCounts = {} } = useQuery({
    queryKey: ["reception-supplier-product-counts", estId],
    queryFn: async () => {
      if (!estId) return {};
      const { data, error } = await supabase
        .from("products_v2")
        .select("supplier_id")
        .eq("establishment_id", estId)
        .is("archived_at", null);
      if (error) throw error;
      const counts: Record<string, number> = {};
      for (const row of data) {
        counts[row.supplier_id] = (counts[row.supplier_id] || 0) + 1;
      }
      return counts;
    },
    enabled: !!estId,
  });

  // ═══ Load ALL products for global search (across all suppliers) ═══
  const { data: allEstablishmentProducts = [] } = useQuery({
    queryKey: ["reception-all-products-global", estId],
    queryFn: async () => {
      if (!estId) return [];
      const { data, error } = await supabase
        .from("products_v2")
        .select(
          "id, nom_produit, category, supplier_id, storage_zone_id, final_unit_id, stock_handling_unit_id, supplier_billing_unit_id, delivery_unit_id, conditionnement_config, delivery_unit:measurement_units!products_v2_delivery_unit_id_fkey(id, name)"
        )
        .eq("establishment_id", estId)
        .is("archived_at", null)
        .order("nom_produit")
        .limit(5000);
      if (error) throw error;
      return (data ?? []).reduce<(SupplierProduct & { supplier_id: string })[]>((acc, d: Record<string, unknown>) => {
        try {
          acc.push({
            ...d,
            delivery_unit_name: (d.delivery_unit as { name: string } | null)?.name ?? null,
          } as SupplierProduct & { supplier_id: string });
        } catch (e) {
          if (import.meta.env.DEV) console.warn(`[ReceptionView] Skipped corrupted product ${d.id}`, e);
        }
        return acc;
      }, []);
    },
    enabled: !!estId,
    staleTime: 60_000,
  });

  // ═══ Global search results (all products, all suppliers) ═══
  const globalSearchResults = useMemo(() => {
    const term = normalize(globalSearch);
    if (!term) return [];
    return allEstablishmentProducts.filter((p) => normalize(p.nom_produit).includes(term));
  }, [allEstablishmentProducts, globalSearch]);

  // ═══ Load products for selected supplier ═══
  const { data: supplierProducts = [], isLoading: productsLoading, error: productsError } = useQuery({
    queryKey: ["reception-supplier-products", estId, selectedSupplierId],
    queryFn: async () => {
      if (!estId || !selectedSupplierId) return [];
      const { data, error } = await supabase
        .from("products_v2")
        .select(
          "id, nom_produit, category, supplier_id, storage_zone_id, final_unit_id, stock_handling_unit_id, supplier_billing_unit_id, delivery_unit_id, conditionnement_config, delivery_unit:measurement_units!products_v2_delivery_unit_id_fkey(id, name)"
        )
        .eq("establishment_id", estId)
        .eq("supplier_id", selectedSupplierId)
        .is("archived_at", null)
        .order("nom_produit")
        .limit(5000);
      if (error) throw error;
      return (data ?? []).reduce<SupplierProduct[]>((acc, d: Record<string, unknown>) => {
        try {
          acc.push({
            ...d,
            delivery_unit_name: (d.delivery_unit as { name: string } | null)?.name ?? null,
          } as SupplierProduct);
        } catch (e) {
          if (import.meta.env.DEV) console.warn(`[ReceptionView] Skipped corrupted product ${d.id}`, e);
        }
        return acc;
      }, []);
    },
    enabled: !!estId && !!selectedSupplierId,
  });

  // ═══ Client-side search (no category filter) ═══
  const filteredProducts = useMemo(() => {
    const term = normalize(productSearch);
    if (!term) return supplierProducts;
    return supplierProducts.filter((p) => normalize(p.nom_produit).includes(term));
  }, [supplierProducts, productSearch]);

  // Track which products are already added
  const addedProductIds = useMemo(() => new Set(lines.map((l) => l.product_id)), [lines]);

  // Zone name lookup
  const zoneNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const z of zones) map[z.id] = z.name;
    return map;
  }, [zones]);

  // Collapsible added section state
  const [cartOpen, setCartOpen] = useState(false);

  // Back-to-suppliers confirmation dialog state
  const [backConfirmOpen, setBackConfirmOpen] = useState(false);

  const selectedSupplier = suppliers.find((s) => s.id === selectedSupplierId);

  const handleSupplierSelect = async (supplierId: string) => {
    setSelectedSupplierId(supplierId);
    setProductSearch("");
    hasCompletedRef.current = false;
    // Ensure a DRAFT exists for this reception (explicit user action)
    const result = await ensureDraft();
    if (result.ok && result.documentId) {
      updateSupplier.mutate({ documentId: result.documentId, supplierId });
    }
  };

  const confirmBackToSuppliers = useCallback(() => {
    setSelectedSupplierId(null);
    setProductSearch("");
    setBackConfirmOpen(false);
  }, []);

  const handleBackToSuppliers = () => {
    if (document && lines.length > 0) {
      setBackConfirmOpen(true);
      return;
    }
    confirmBackToSuppliers();
  };

  // ═══ Tap product → open modal ═══
  const handleProductTap = (product: SupplierProduct) => {
    setModalProduct(product);
    setEditingLineId(null);
  };

  // ═══ Tap existing line → edit in modal ═══
  const handleLineTap = (lineId: string) => {
    const line = lines.find((l) => l.id === lineId);
    if (!line) return;
    const product = supplierProducts.find((p) => p.id === line.product_id);
    if (!product) return;
    setModalProduct(product);
    setEditingLineId(lineId);
  };

  // ═══ Tolerance data for products (§7) — min + max + unit per product ═══
  const { data: toleranceMap = {} } = useQuery({
    queryKey: ["reception-tolerances", estId],
    queryFn: async (): Promise<
      Record<string, { min: number | null; max: number | null; unitId: string | null }>
    > => {
      if (!estId) return {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any).from("products_v2")
        .select(
          "id, reception_tolerance_min, reception_tolerance_max, reception_tolerance_unit_id, stock_handling_unit_id"
        )
        .eq("establishment_id", estId)
        .is("archived_at", null);
      const map: Record<string, { min: number | null; max: number | null; unitId: string | null }> =
        {};
      for (const row of data ?? []) {
        if (row.reception_tolerance_min != null || row.reception_tolerance_max != null) {
          map[row.id] = {
            min: row.reception_tolerance_min != null ? Number(row.reception_tolerance_min) : null,
            max: row.reception_tolerance_max != null ? Number(row.reception_tolerance_max) : null,
            unitId: row.reception_tolerance_unit_id ?? row.stock_handling_unit_id ?? null,
          };
        }
      }
      return map;
    },
    enabled: !!estId,
    staleTime: 60_000,
  });

  // ═══ Inner confirm (after tolerance check passes) ═══
  const executeModalConfirm = async (params: {
    productId: string;
    canonicalQuantity: number;
    canonicalUnitId: string;
    canonicalFamily: string;
    canonicalLabel: string | null;
  }) => {
    if (!document) return;

    const product = supplierProducts.find((p) => p.id === params.productId);

    try {
      if (editingLineId) {
        await updateLine.mutateAsync({
          lineId: editingLineId,
          deltaQuantity: params.canonicalQuantity,
          inputPayload: {
            product_name: product?.nom_produit ?? params.productId,
            supplier_name: product?.supplier_id ? (suppliers.find((s) => s.id === product.supplier_id)?.name ?? null) : null,
          },
        });
        toast.success("Ligne mise à jour ✓");
      } else {
        const canonical = buildCanonicalLine({
          canonicalUnitId: params.canonicalUnitId,
          product: {
            supplier_billing_unit_id: product?.supplier_billing_unit_id ?? null,
            conditionnement_config: product?.conditionnement_config,
          },
          units: dbUnits,
        });

        await addLine.mutateAsync({
          documentId: document.id,
          productId: params.productId,
          deltaQuantity: params.canonicalQuantity,
          canonicalUnitId: canonical.canonical_unit_id,
          canonicalFamily: canonical.canonical_family,
          canonicalLabel: canonical.canonical_label,
          contextHash: canonical.context_hash,
          inputPayload: {
            product_name: product?.nom_produit ?? params.productId,
            supplier_name: product?.supplier_id ? (suppliers.find((s) => s.id === product.supplier_id)?.name ?? null) : null,
          },
        });
        toast.success(`${product?.nom_produit ?? "Produit"} ajouté ✓`);
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Erreur";
      toast.error(message);
      throw e;
    }
  };

  // ═══ Modal confirm with tolerance check — accepts raw entries from UQM (single or multi-level) ═══
  const handleModalConfirmRaw = useCallback((entries: QuantityEntry[]) => {
    if (!document || entries.length === 0 || !modalProduct) return;

    const canonicalId = modalProduct.stock_handling_unit_id ?? modalProduct.final_unit_id;
    if (!canonicalId) return;

    // Unified conversion: works for both single and multi-level entries
    const { result: convResult, error: convError } = convertToCanonical(
      entries,
      canonicalId,
      modalProduct.conditionnement_config as import("@/integrations/supabase/types").Json,
      dbUnits,
      dbConversions,
    );

    if (convError || !convResult) {
      toast.error(convError ?? "Conversion impossible");
      return;
    }

    const params = {
      productId: modalProduct.id,
      canonicalQuantity: convResult.canonicalQuantity,
      canonicalUnitId: convResult.canonicalUnitId,
      canonicalFamily: convResult.canonicalFamily,
      canonicalLabel: convResult.canonicalLabel,
    };

    // Tolerance check
    const product = supplierProducts.find((p) => p.id === params.productId)
      ?? allEstablishmentProducts.find((p) => p.id === params.productId);
    const tol = toleranceMap[params.productId];

    const warning = checkTolerance({
      canonicalQuantity: params.canonicalQuantity,
      canonicalUnitId: params.canonicalUnitId,
      tolerance: tol ?? null,
      product: {
        stock_handling_unit_id: product?.stock_handling_unit_id ?? null,
        final_unit_id: product?.final_unit_id ?? null,
        delivery_unit_id: product?.delivery_unit_id ?? null,
        supplier_billing_unit_id: product?.supplier_billing_unit_id ?? null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        conditionnement_config: product?.conditionnement_config as any,
      },
      dbUnits,
      dbConversions,
    });

    if (warning) {
      setToleranceWarning({
        productName: product?.nom_produit ?? "Produit",
        warning,
        onProceed: () => {
          setToleranceWarning(null);
          executeModalConfirm(params);
        },
      });
      return;
    }

    // No tolerance issue — proceed directly
    executeModalConfirm(params);
  }, [document, modalProduct, supplierProducts, allEstablishmentProducts, toleranceMap, dbUnits, dbConversions, executeModalConfirm]);

  /**
   * Called by BlAppPostPopup in pre-post mode.
   */
  const handlePostForPopup = async (): Promise<{ ok: boolean; error?: string }> => {
    if (!document || postGuard || hasCompletedRef.current)
      return { ok: false, error: "NO_DOCUMENT" };
    setPostGuard(true);
    setPostError(null);
    try {
      const result = await post({
        documentId: document.id,
        establishmentId: document.establishment_id,
        expectedLockVersion: document.lock_version,
        eventReason: "RECEIPT",
      });
      if (result.ok) {
        hasCompletedRef.current = true;
        if (result.warnings && result.warnings.length > 0) {
          for (const w of result.warnings) {
            const msg =
              typeof w === "string"
                ? w
                : typeof w === "object" && w !== null && "product_name" in w
                  ? `${(w as { product_name: string; product_zone_name?: string }).product_name} enregistré en zone ${(w as { product_zone_name?: string }).product_zone_name ?? "inconnue"}`
                  : JSON.stringify(w);
            toast.warning(msg, { duration: 8000 });
          }
        }
        return { ok: true };
      } else {
        setPostError(result);
        return { ok: false, error: result.error };
      }
    } finally {
      setPostGuard(false);
    }
  };

  /**
   * Pre-POST zone check: warn if any draft lines reference products without storage_zone_id.
   * These products will cause PRODUCT_NO_ZONE in fn_post_stock_document.
   */
  const checkZonesAndProceed = useCallback(() => {
    if (!document) return;

    // Cross-reference draft lines with loaded products to find zone-less ones
    const missingZoneNames: string[] = [];
    for (const line of lines) {
      const product = supplierProducts.find((p) => p.id === line.product_id);
      if (product && !product.storage_zone_id) {
        missingZoneNames.push(product.nom_produit);
      }
    }

    if (missingZoneNames.length > 0) {
      setProductsWithoutZone(missingZoneNames);
      setZoneWarningOpen(true);
      return;
    }

    // No issues — open BL popup directly
    setBlAppStockDocId(document.id);
    setBlAppSupplierId(document.supplier_id ?? null);
    setBlAppSupplierName(selectedSupplier?.name ?? null);
    setShowBlPopup(true);
  }, [document, lines, supplierProducts, selectedSupplier]);

  const editingLine = editingLineId ? lines.find((l) => l.id === editingLineId) : null;

  // ═══ GUARD: No zones exist at all ═══
  // §7: Tolerance settings — rendered OUTSIDE screen guards so it works from any screen
  const toleranceSheet = (
    <ReceptionToleranceSettings
      open={toleranceSettingsOpen}
      onClose={() => setToleranceSettingsOpen(false)}
    />
  );

  if (zoneMissing) {
    return (
      <div className="py-12 px-6 text-center space-y-4">
        <AlertTriangle className="h-12 w-12 text-amber-500 dark:text-amber-400 mx-auto" />
        <h2 className="text-lg font-semibold">Aucune zone de stockage</h2>
        <p className="text-sm text-muted-foreground">
          Aucune zone de stockage n'est configurée pour cet établissement. Créez des zones dans les
          paramètres avant de réceptionner des produits.
        </p>
      </div>
    );
  }

  // ═══ Auto-select first zone if none configured — never show zone selection screen ═══
  // Per Reception spec §2: entry point goes directly to supplier list, no zone step.
  if (zoneNeedsSelection && availableZones.length > 0) {
    setReceiptZoneId(availableZones[0].id);
  }

  // ═══ Loading ═══
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SCREEN 1: Supplier list (no supplier selected)
  // ═══════════════════════════════════════════════════════════════════════
  if (!selectedSupplierId) {
    return (
      <div className="py-4 px-4 space-y-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          {onBack && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onBack}
              className="shrink-0"
              aria-label="Retour"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
          )}
          <h1 className="text-lg font-semibold flex-1">Réception</h1>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setToleranceSettingsOpen(true)}
            className="shrink-0 h-9 w-9"
            aria-label="Paramètres de tolérance"
            title="Paramètres de tolérance réception"
          >
            <Settings className="h-4 w-4" />
          </Button>
        </div>

        {/* ── GLOBAL SEARCH — search across ALL products / suppliers ── */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Rechercher un produit (tous fournisseurs)…"
            value={globalSearch}
            onChange={(e) => setGlobalSearch(e.target.value)}
            className="pl-9 pr-8"
            aria-label="Recherche globale produit"
          />
          {globalSearch && (
            <button
              type="button"
              onClick={() => setGlobalSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Effacer la recherche"
            >
              ✕
            </button>
          )}
        </div>

        {/* ── GLOBAL SEARCH RESULTS ── */}
        {globalSearch && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              {globalSearchResults.length} résultat{globalSearchResults.length > 1 ? "s" : ""}
            </p>
            {globalSearchResults.length === 0 ? (
              <p className="text-center text-muted-foreground text-sm py-6">Aucun produit trouvé</p>
            ) : (
              <div className="space-y-1.5">
                {globalSearchResults.map((p) => {
                  const isIneligible = !p.storage_zone_id || !p.stock_handling_unit_id;
                  const isAdded = lines.some((l) => l.product_id === p.id);
                  const addedLine = lines.find((l) => l.product_id === p.id);
                  const supplierName = suppliers.find((s) => s.id === p.supplier_id)?.name ?? null;
                  return (
                    <button
                      key={p.id}
                      className={`w-full text-left rounded-xl border p-3 flex items-center gap-3 transition-all active:scale-[0.98] ${
                        isIneligible
                          ? "border-border bg-muted/50 opacity-60 cursor-not-allowed"
                          : isAdded
                            ? "border-primary/20 bg-primary/5"
                            : "border-border bg-card hover:border-primary/20 hover:bg-accent/50"
                      }`}
                      onClick={async () => {
                        if (isIneligible) {
                          toast.error("Ce produit doit être configuré via le Wizard avant utilisation.");
                          return;
                        }
                        // Auto-select supplier and ensure draft, then open quantity modal
                        if (p.supplier_id && p.supplier_id !== selectedSupplierId) {
                          await handleSupplierSelect(p.supplier_id);
                        }
                        setGlobalSearch("");
                        // Open quantity modal (cast to SupplierProduct, supplier_id is extra but harmless)
                        setModalProduct(p as SupplierProduct);
                        setEditingLineId(isAdded && addedLine ? addedLine.id : null);
                      }}
                      disabled={isIneligible}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate uppercase">{p.nom_produit}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {supplierName ?? "—"}
                          {p.storage_zone_id && zoneNameMap[p.storage_zone_id]
                            ? ` · ${zoneNameMap[p.storage_zone_id]}`
                            : ""}
                        </p>
                      </div>
                      {isIneligible ? (
                        <Badge
                          variant="outline"
                          className="shrink-0 text-xs border-amber-300 dark:border-amber-700 text-amber-600 dark:text-amber-400"
                        >
                          À configurer
                        </Badge>
                      ) : isAdded ? (
                        <Badge variant="secondary" className="shrink-0 bg-primary/10 text-primary border-0 text-xs">
                          <Check className="h-3 w-3 mr-1" />
                          {addedLine ? (formatQuantityForContext(
                            Math.abs(addedLine.delta_quantity_canonical),
                            p as unknown as import("@/modules/inputConfig/utils/resolveInputUnitForContext").ProductForResolution,
                            "purchase",
                            inputConfigs.get(p.id) ?? null,
                            dbUnits,
                            dbConversions,
                          ) ?? `${Math.abs(addedLine.delta_quantity_canonical)} ${addedLine.canonical_label ?? ""}`) : ""}
                        </Badge>
                      ) : (
                        <span className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-primary">
                          <Plus className="h-3.5 w-3.5" />
                          Ajouter
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── SUPPLIER LIST (hidden when global search is active) ── */}
        {!globalSearch && (
          <>
            {/* Zone info badge — discrete, only if manually selected */}
            {defaultZone && zoneIsManualSelection && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 rounded-lg px-3 py-2">
                <MapPin className="h-3.5 w-3.5 shrink-0" />
                <span className="flex-1">
                  Zone : <strong>{defaultZone.zoneName}</strong>
                </span>
                {availableZones.length > 1 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => setReceiptZoneId(null)}
                  >
                    Changer
                  </Button>
                )}
              </div>
            )}

            {/* Supplier cards */}
            {suppliers.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Aucun fournisseur configuré.</p>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                  Ou sélectionner un fournisseur
                </p>
                {suppliers.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => handleSupplierSelect(s.id)}
                    className="w-full text-left rounded-2xl border-2 border-border bg-card p-5 flex items-center gap-4 hover:border-primary/30 hover:bg-primary/5 transition-all hover:shadow-lg active:scale-[0.98]"
                  >
                    <span className="font-semibold text-base flex-1">
                      {s.name}
                      {s.trade_name ? ` (${s.trade_name})` : ""}
                    </span>
                    {supplierProductCounts[s.id] != null && (
                      <Badge variant="secondary" className="shrink-0">
                        {supplierProductCounts[s.id]} produit
                        {supplierProductCounts[s.id] > 1 ? "s" : ""}
                      </Badge>
                    )}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
        {toleranceSheet}
      </div>
    );
  }


  // ═══════════════════════════════════════════════════════════════════════
  // SCREEN 2: Flat product list for selected supplier (NO categories)
  // ═══════════════════════════════════════════════════════════════════════

  return (
    <div
      className={`flex flex-col min-h-[calc(100dvh-8rem)] ${document && lines.length > 0 ? "pb-24" : ""}`}
    >
      {/* ── HEADER ── */}
      <div className="bg-card border-b border-border px-4 pt-3 pb-3 space-y-3">
        {/* Row 1: Back + Title */}
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleBackToSuppliers}
            className="shrink-0 -ml-2 h-9 w-9"
            aria-label="Retour aux fournisseurs"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
              Réception
            </p>
            <h1 className="text-base font-semibold truncate">
              {selectedSupplier?.name ?? "Fournisseur"}
            </h1>
          </div>
        </div>

        {/* Row 2: Chips */}
        <div className="flex items-center gap-2 flex-wrap">
          {defaultZone && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium bg-muted text-muted-foreground rounded-full px-3 py-1">
              <MapPin className="h-3 w-3" />
              {defaultZone.zoneName}
            </span>
          )}
          <CartTriggerButton
            count={lines.length}
            onClick={() => setCartOpen(true)}
            variant="reception"
          />
        </div>

        {/* Row 3: Search bar (sticky in header) */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Rechercher un produit…"
            value={productSearch}
            onChange={(e) => setProductSearch(e.target.value)}
            className="pl-9"
            aria-label="Rechercher un produit"
          />
        </div>
      </div>

      {!document ? (
        <div className="flex flex-col items-center justify-center py-12 flex-1 gap-4 px-6">
          {draftError ? (
            <>
              <AlertTriangle className="h-10 w-10 text-destructive" />
              <p className="text-sm text-destructive text-center font-medium">{draftError}</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => ensureDraft()}>
                  Réessayer
                </Button>
                <Button variant="ghost" size="sm" onClick={handleBackToSuppliers}>
                  Retour
                </Button>
              </div>
            </>
          ) : isDraftCreating ? (
            <>
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Création du brouillon…</span>
            </>
          ) : (
            <>
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Chargement…</span>
              <Button variant="outline" size="sm" className="mt-2" onClick={() => ensureDraft()}>
                Forcer la création
              </Button>
            </>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {/* Cart drawer replaces collapsible "Produits ajoutés" */}

          {/* ── PRODUCT LIST (flat, alphabetical, no categories) ── */}
          <div className="px-4 py-3">
            <p className="text-xs text-muted-foreground mb-3">
              {filteredProducts.length} produit{filteredProducts.length > 1 ? "s" : ""} disponible
              {filteredProducts.length > 1 ? "s" : ""}
            </p>

            {productsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : productsError ? (
              <div className="flex flex-col items-center justify-center py-8 gap-3 px-4">
                <AlertTriangle className="h-8 w-8 text-destructive" />
                <p className="text-sm text-destructive text-center font-medium">
                  Erreur lors du chargement des produits
                </p>
                {import.meta.env.DEV && (
                  <p className="text-xs text-muted-foreground text-center">
                    {productsError instanceof Error ? productsError.message : "Erreur inconnue"}
                  </p>
                )}
              </div>
            ) : filteredProducts.length === 0 ? (
              <p className="text-center text-muted-foreground text-sm py-8">
                {supplierProducts.length === 0
                  ? "Aucun produit pour ce fournisseur"
                  : "Aucun résultat"}
              </p>
            ) : (
              <div className="space-y-1.5">
                {filteredProducts.map((p) => {
                  const isAdded = addedProductIds.has(p.id);
                  const addedLine = isAdded ? lines.find((l) => l.product_id === p.id) : null;
                  const isIneligible = !p.storage_zone_id || !p.stock_handling_unit_id;
                  return (
                    <button
                      key={p.id}
                      className={`w-full text-left rounded-xl border p-3 flex items-center gap-3 transition-all active:scale-[0.98] ${
                        isIneligible
                          ? "border-border bg-muted/50 opacity-60 cursor-not-allowed"
                          : isAdded
                            ? "border-primary/20 bg-primary/5"
                            : "border-border bg-card hover:border-primary/20 hover:bg-accent/50"
                      }`}
                      onClick={() => {
                        if (isIneligible) {
                          toast.error(
                            "Ce produit doit être configuré via le Wizard avant utilisation."
                          );
                          return;
                        }
                        if (isAdded && addedLine) {
                          handleLineTap(addedLine.id);
                        } else {
                          handleProductTap(p);
                        }
                      }}
                      disabled={isIneligible}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate uppercase">{p.nom_produit}</p>
                        {p.storage_zone_id && zoneNameMap[p.storage_zone_id] && (
                          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground mt-0.5">
                            <MapPin className="h-2.5 w-2.5" />
                            {zoneNameMap[p.storage_zone_id]}
                          </span>
                        )}
                      </div>
                      {isIneligible ? (
                        <Badge
                          variant="outline"
                          className="shrink-0 text-xs border-amber-300 dark:border-amber-700 text-amber-600 dark:text-amber-400 gap-1"
                        >
                          <Settings2 className="h-3 w-3" />À configurer
                        </Badge>
                      ) : isAdded && addedLine ? (
                        <Badge
                          variant="secondary"
                          className="shrink-0 bg-primary/10 text-primary border-0 text-xs"
                        >
                          <Check className="h-3 w-3 mr-1" />
                          {formatQuantityForContext(
                            Math.abs(addedLine.delta_quantity_canonical),
                            p as unknown as import("@/modules/inputConfig/utils/resolveInputUnitForContext").ProductForResolution,
                            "purchase",
                            inputConfigs.get(p.id) ?? null,
                            dbUnits,
                            dbConversions,
                          ) ?? `${Math.abs(addedLine.delta_quantity_canonical)} ${addedLine.canonical_label ?? ""}`}
                        </Badge>
                      ) : (
                        <span className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-primary">
                          <Plus className="h-3.5 w-3.5" />
                          Ajouter
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── FLOATING BOTTOM: Post button ── */}
      {document && lines.length > 0 && (
        <div className="fixed bottom-[calc(80px+env(safe-area-inset-bottom))] right-6 z-40">
          <Button
            className="h-11 px-6 text-sm font-semibold rounded-full shadow-lg"
            onClick={checkZonesAndProceed}
            disabled={isPosting || postGuard}
          >
            {isPosting ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Send className="h-4 w-4 mr-2" />
            )}
            Valider réception ({lines.length})
          </Button>
        </div>
      )}

      {/* Quantity popup — UQM stepper mode (pure UI, no conversion) */}
      <UniversalQuantityModal
        open={!!modalProduct}
        onClose={() => {
          setModalProduct(null);
          setEditingLineId(null);
        }}
        uiMode="stepper"
        stepperConfig={
          modalProduct
            ? (() => {
                // ── SSOT: resolve from product_input_config + BFS engine ──
                const config = inputConfigs.get(modalProduct.id) ?? null;
                const resolved = resolveInputUnitForContext(
                  modalProduct,
                  "purchase",
                  config,
                  dbUnits,
                  dbConversions,
                );

                // ── BLOCKED: not configured or needs review ──
                if (resolved.status !== "ok") {
                  return {
                    productId: modalProduct.id,
                    productName: modalProduct.nom_produit,
                    unitId: "",
                    unitName: "",
                    steps: [],
                    defaultStep: 1,
                    blockedMessage: {
                      title: resolved.status === "not_configured"
                        ? "Produit non configuré"
                        : "Configuration à revoir",
                      description: resolved.reason,
                    },
                  } satisfies StepperConfig;
                }

                // ── MULTI_LEVEL: dedicated stepper config ──
                if (resolved.mode === "multi_level") {
                  // Pre-check conversion for each unit in chain
                  const chainErrors = resolved.unitChain.map((uid) =>
                    resolveInputConversion(uid, resolved.canonicalUnitId, modalProduct.conditionnement_config, dbUnits, dbConversions).error
                  ).filter(Boolean);

                  return {
                    productId: modalProduct.id,
                    productName: modalProduct.nom_produit,
                    unitId: "",
                    unitName: "",
                    steps: [],
                    defaultStep: 1,
                    unitChain: resolved.unitChain,
                    unitNames: resolved.unitNames,
                    unitFamilies: resolved.unitFamilies,
                    conversionError: chainErrors.length > 0 ? chainErrors[0] : null,
                    headerLabel: "Réception en",
                    confirmLabel: "Ajouter à la réception",
                    inputMode: "multi_level",
                  } satisfies StepperConfig;
                }

                // Pre-check conversion (for error display in modal)
                const convCheck = resolveInputConversion(
                  resolved.unitId,
                  resolved.canonicalUnitId,
                  modalProduct.conditionnement_config,
                  dbUnits,
                  dbConversions,
                );

                // Convert existing canonical quantity back to input unit for editing
                let initialQty: number | undefined;
                const existingCanonical = editingLine?.delta_quantity_canonical;
                if (existingCanonical && existingCanonical > 0 && convCheck.factor && convCheck.factor > 0) {
                  initialQty = +(existingCanonical / convCheck.factor).toFixed(4);
                }

                return {
                  productId: modalProduct.id,
                  productName: modalProduct.nom_produit,
                  unitId: resolved.unitId,
                  unitName: resolved.unitName,
                  steps: resolved.steps,
                  defaultStep: resolved.defaultStep,
                  initialQuantity: initialQty,
                  conversionError: convCheck.error,
                  headerLabel: "Réception en",
                  confirmLabel: "Ajouter à la réception",
                  inputMode: resolved.mode,
                } satisfies StepperConfig;
              })()
            : null
        }
        onConfirmRaw={handleModalConfirmRaw}
      />

      {/* BL-APP popup — single confirmation (pre-post mode, injected via PostPopup prop) */}
      {PostPopup && blAppStockDocId && estId && user?.id && (
        <PostPopup
          open={showBlPopup}
          onClose={() => {
            setShowBlPopup(false);
            setBlAppStockDocId(null);
            setBlAppSupplierId(null);
            setBlAppSupplierName(null);
            // Reset to supplier list so a fresh draft can be created for next reception
            setSelectedSupplierId(null);
          }}
          stockDocumentId={blAppStockDocId}
          establishmentId={estId}
          supplierId={blAppSupplierId}
          supplierName={blAppSupplierName}
          userId={user.id}
          onPostStock={handlePostForPopup}
          linesCount={lines.length}
        />
      )}

      {/* Cart drawer */}
      <MobileCartDrawer
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        variant="reception"
        lines={lines.map((l): CartLine => {
          const product = supplierProducts.find((p) => p.id === l.product_id)
            ?? allEstablishmentProducts.find((p) => p.id === l.product_id);
          const displayLabel = product
            ? formatQuantityForContext(
                Math.abs(l.delta_quantity_canonical),
                product as unknown as import("@/modules/inputConfig/utils/resolveInputUnitForContext").ProductForResolution,
                "purchase",
                inputConfigs.get(l.product_id) ?? null,
                dbUnits,
                dbConversions,
              )
            : null;
          return {
            id: l.id,
            product_id: l.product_id,
            product_name: getInputPayloadProductName(l.input_payload) ?? l.product_id.slice(0, 8),
            delta_quantity_canonical: l.delta_quantity_canonical,
            canonical_label: l.canonical_label ?? null,
            displayLabel,
          };
        })}
        onEditLine={(lineId) => {
          setCartOpen(false);
          handleLineTap(lineId);
        }}
        onDeleteLine={(lineId) => removeLine.mutate(lineId)}
        onValidate={() => {
          setCartOpen(false);
          checkZonesAndProceed();
        }}
        validateLabel={`Valider la réception de ${selectedSupplier?.name ?? "fournisseur"}`}
        validateDisabled={isPosting || postGuard}
      />

      {/* Back-to-suppliers confirmation dialog */}
      <AlertDialog open={backConfirmOpen} onOpenChange={setBackConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revenir aux fournisseurs ?</AlertDialogTitle>
            <AlertDialogDescription>
              Un brouillon avec {lines.length} ligne(s) existe. Le brouillon restera sauvegardé.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={confirmBackToSuppliers}>Revenir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* §7: Tolerance warning popup */}
      <AlertDialog
        open={!!toleranceWarning}
        onOpenChange={(open) => !open && setToleranceWarning(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-5 w-5" />
              Vérification de la quantité
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                {toleranceWarning && (
                  <>
                    <p className="text-muted-foreground mb-3">
                      {`La quantité saisie semble élevée. Vous avez bien saisi ${toleranceWarning.warning.qtyInTolUnit} ${toleranceWarning.warning.tolUnitAbbr} de `}
                      <span className="font-medium text-foreground">{String(toleranceWarning.productName ?? "")}</span>
                      {toleranceWarning.warning.tolUnitAbbr !== toleranceWarning.warning.canonicalAbbr
                        ? ` (soit ${toleranceWarning.warning.canonicalTotal} ${toleranceWarning.warning.canonicalAbbr}) ?`
                        : ` ?`}
                    </p>
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setToleranceWarning(null)}>
              Corriger
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => toleranceWarning?.onProceed()}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              Continuer quand même
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Pre-POST warning: products without zone */}
      <AlertDialog open={zoneWarningOpen} onOpenChange={setZoneWarningOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-5 w-5" />
              Produits sans zone de stockage
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  {productsWithoutZone.length} produit(s) dans ce brouillon n&apos;ont pas de zone
                  de stockage assignée. La validation échouera pour ces produits.
                </p>
                <ul className="text-sm space-y-1 border rounded-md p-3 bg-amber-50 dark:bg-amber-950/20">
                  {productsWithoutZone.map((name) => (
                    <li key={name} className="truncate">
                      {name}
                    </li>
                  ))}
                </ul>
                <p className="text-sm text-muted-foreground">
                  Configurez ces produits dans le catalogue (Wizard) ou retirez-les du brouillon
                  avant de valider.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Retour</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setZoneWarningOpen(false);
                if (document) {
                  setBlAppStockDocId(document.id);
                  setBlAppSupplierId(document.supplier_id ?? null);
                  setBlAppSupplierName(selectedSupplier?.name ?? null);
                }
                setShowBlPopup(true);
              }}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              Continuer quand même
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

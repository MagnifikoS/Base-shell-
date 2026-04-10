/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MOBILE WITHDRAWAL VIEW — Direct single-product withdrawal (no cart)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * FLOW:
 * - 2 motif pills (CONSUMPTION / EXPIRY)
 * - Search bar
 * - ALL products alphabetical A/B/C…
 * - Tap → WithdrawalQuantityPopup
 * - Confirm → POST immediately (1 line = 1 document)
 * - Green badge stays on row for the session
 *
 * RULES:
 * - No cart / no batch validation
 * - Each withdrawal is immediate and definitive
 * - Session-local badges track what was withdrawn (reset on unmount)
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import {
  ChevronLeft,
  Loader2,
  Search,
  Package,
  Check,
  Factory,
  Timer,
  Settings2,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { checkStockAvailability } from "../hooks/useCheckStockAvailability";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { useAuth } from "@/contexts/AuthContext";
import { useStorageZones } from "@/modules/produitsV2";
import { usePostDocument, type PostResult } from "../hooks/usePostDocument";
import { useUnitConversions } from "@/core/unitConversion";
import { buildCanonicalLine } from "../engine/buildCanonicalLine";
import type { Json } from "@/integrations/supabase/types";
import { type StepperConfig, type QuantityEntry } from "./ReceptionQuantityModal";
import { UniversalQuantityModal } from "@/components/stock/UniversalQuantityModal";
import { resolveInputConversion, convertToCanonical } from "../utils/resolveInputConversion";
import { useProductInputConfigs, resolveInputUnitForContext } from "@/modules/inputConfig";
import { formatQuantityForContext } from "@/lib/units/formatQuantityForContext";
import type { WithdrawalReasonCode } from "../constants/withdrawalReasons";

interface Props {
  onBack?: () => void;
}

interface ProductRow {
  id: string;
  nom_produit: string;
  category_name: string | null;
  supplier_name: string | null;
  storage_zone_id: string | null;
  final_unit_id: string | null;
  stock_handling_unit_id: string | null;
  supplier_billing_unit_id: string | null;
  delivery_unit_id: string | null;
  conditionnement_config: Json | null;
}

/** Session-local record of a withdrawn product */
interface WithdrawnRecord {
  qty: number;
  label: string;
}

/** Normalize text for fuzzy search */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ═══ 2 motifs only ═══
const REASON_OPTIONS = [
  { value: "CONSUMPTION" as WithdrawalReasonCode, label: "Consommation cuisine", icon: Factory },
  { value: "EXPIRY" as WithdrawalReasonCode, label: "Péremption", icon: Timer },
];

const REASON_LABELS: Record<string, string> = {
  CONSUMPTION: "Consommation cuisine",
  EXPIRY: "Péremption",
};

export function MobileWithdrawalView({ onBack }: Props) {
  const { activeEstablishment } = useEstablishment();
  const { user } = useAuth();
  const estId = activeEstablishment?.id;
  const orgId = activeEstablishment?.organization_id;
  const queryClient = useQueryClient();

  const { zones } = useStorageZones();
  const { units: dbUnits, conversions: dbConversions } = useUnitConversions();
  const inputConfigs = useProductInputConfigs();

  // ═══ ZONE GUARD (display only — actual zone comes from product) ═══
  const hasAnyZone = zones.length > 0;

  const [productSearch, setProductSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  // Reason toggle — default CONSUMPTION
  const [reasonCode, setReasonCode] = useState<WithdrawalReasonCode>("CONSUMPTION");

  // Quantity modal state
  const [modalProduct, setModalProduct] = useState<ProductRow | null>(null);

  // ═══ SESSION-LOCAL WITHDRAWN PRODUCTS (badges) ═══
  // Resets on unmount (leaving the screen / app)
  const [withdrawnProducts, setWithdrawnProducts] = useState<Map<string, WithdrawnRecord>>(new Map());
  const [successFlash, setSuccessFlash] = useState<string | null>(null);


  const { post, isPosting } = usePostDocument();

  const effectiveReason = REASON_LABELS[reasonCode] ?? "";

  // Auto-focus search on mount
  useEffect(() => {
    const t = setTimeout(() => searchRef.current?.focus(), 200);
    return () => clearTimeout(t);
  }, []);

  // ═══ Load ALL products ═══
  const { data: allProducts = [], isLoading: productsLoading, error: productsError, isError: productsHasError } = useQuery({
    queryKey: ["withdrawal-all-products", estId],
    queryFn: async () => {
      if (!estId) return [];
      const { data, error } = await supabase
        .from("products_v2")
        .select(
          `id, nom_produit, storage_zone_id, final_unit_id, stock_handling_unit_id, supplier_billing_unit_id, delivery_unit_id, conditionnement_config, supplier_id, invoice_suppliers!supplier_id(name), product_categories(name)`
        )
        .eq("establishment_id", estId)
        .is("archived_at", null)
        .order("nom_produit")
        .limit(5000);
      if (error) throw error;
      return (data ?? []).reduce<ProductRow[]>((acc, d) => {
        try {
          acc.push({
            ...d,
            category_name: (d.product_categories as { name: string } | null)?.name ?? null,
            supplier_name: (d.invoice_suppliers as { name: string } | null)?.name ?? null,
          } as ProductRow);
        } catch (e) {
          if (import.meta.env.DEV) console.warn(`[WithdrawalView] Skipped corrupted product ${d.id}`, e);
        }
        return acc;
      }, []);
    },
    enabled: !!estId,
  });

  // ═══ Load stock estimates ═══
  const productIds = useMemo(() => allProducts.map((p) => p.id), [allProducts]);
  const { data: stockByProduct } = useQuery({
    queryKey: ["withdrawal-stock-estimates-ssot", estId, productIds.length],
    queryFn: async () => {
      if (!estId || productIds.length === 0) return new Map<string, { qty: number; unit: string | null }>();
      const checkLines = allProducts.map((p) => ({
        product_id: p.id,
        product_name: p.nom_produit,
        requested: 0,
      }));
      const results = await checkStockAvailability(estId, checkLines);
      const map = new Map<string, { qty: number; unit: string | null }>();
      for (const r of results) {
        const product = allProducts.find((p) => p.id === r.product_id);
        const unitId = product?.stock_handling_unit_id ?? product?.final_unit_id;
        let unitLabel: string | null = null;
        if (unitId) {
          const u = dbUnits.find((x: { id: string; name: string; abbreviation: string }) => x.id === unitId);
          unitLabel = u ? (u.name || u.abbreviation) : null;
        }
        map.set(r.product_id, { qty: r.available, unit: unitLabel });
      }
      return map;
    },
    enabled: !!estId && productIds.length > 0,
    staleTime: 15_000,
  });

  // ═══ Client-side search ═══
  const filteredProducts = useMemo(() => {
    const term = normalize(productSearch);
    return allProducts
      .filter((p) => {
        if (!term) return true;
        return normalize(p.nom_produit).includes(term);
      })
      .sort((a, b) => a.nom_produit.localeCompare(b.nom_produit));
  }, [allProducts, productSearch]);

  // ═══ Alphabetical grouping ═══
  const alphabeticalGroups = useMemo(() => {
    const groups = new Map<string, ProductRow[]>();
    for (const p of filteredProducts) {
      const letter = (p.nom_produit[0] || "#").toUpperCase();
      if (!groups.has(letter)) groups.set(letter, []);
      groups.get(letter)!.push(p);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filteredProducts]);

  // ═══ Tap product → open modal ═══
  const handleProductTap = (product: ProductRow) => {
    setModalProduct(product);
  };

  // ═══ DIRECT WITHDRAWAL: create draft → add line → POST → cleanup ═══
  const handleDirectWithdrawal = useCallback(async (params: {
    productId: string;
    canonicalQuantity: number;
    canonicalUnitId: string;
    canonicalFamily: string;
    canonicalLabel: string | null;
  }) => {
    const product = allProducts.find((p) => p.id === params.productId);
    const productName = product?.nom_produit ?? params.productId;
    const productZoneId = product?.storage_zone_id;

    if (!estId || !orgId || !productZoneId || !user?.id) {
      toast.error("Paramètres manquants (établissement, zone produit ou utilisateur).");
      return;
    }

    try {
      // 1. Find existing DRAFT or create one (respects unique constraint)
      let doc: { id: string; establishment_id: string; organization_id: string; storage_zone_id: string; lock_version: number };

      const { data: existingDraft } = await supabase
        .from("stock_documents")
        .select("id, establishment_id, organization_id, storage_zone_id, lock_version")
        .eq("establishment_id", estId)
        .eq("storage_zone_id", productZoneId)
        .eq("type", "WITHDRAWAL")
        .eq("status", "DRAFT")
        .maybeSingle();

      if (existingDraft) {
        doc = existingDraft;
        // Clear any leftover lines from previous usage
        await supabase
          .from("stock_document_lines")
          .delete()
          .eq("document_id", doc.id);
      } else {
        // Abandon stale drafts first, then create
        await supabase.rpc("fn_abandon_stale_drafts", {
          p_establishment_id: estId,
          p_storage_zone_id: productZoneId,
          p_type: "WITHDRAWAL",
        });

        const { data: newDoc, error: docErr } = await supabase
          .from("stock_documents")
          .insert({
            establishment_id: estId,
            organization_id: orgId,
            storage_zone_id: productZoneId,
            type: "WITHDRAWAL" as const,
            status: "DRAFT" as const,
            created_by: user.id,
          })
          .select("id, establishment_id, organization_id, storage_zone_id, lock_version")
          .single();

        if (docErr) throw new Error(docErr.message);
        doc = newDoc;
      }

      // 3. Add the single line (negative delta)
      const canonical = buildCanonicalLine({
        canonicalUnitId: params.canonicalUnitId,
        product: {
          supplier_billing_unit_id: product?.supplier_billing_unit_id ?? null,
          conditionnement_config: product?.conditionnement_config,
        },
        units: dbUnits,
      });

      const negativeDelta = params.canonicalQuantity > 0 ? -params.canonicalQuantity : params.canonicalQuantity;

      const { error: lineErr } = await supabase
        .from("stock_document_lines")
        .insert({
          document_id: doc.id,
          product_id: params.productId,
          delta_quantity_canonical: negativeDelta,
          canonical_unit_id: canonical.canonical_unit_id,
          canonical_family: canonical.canonical_family,
          canonical_label: canonical.canonical_label,
          context_hash: canonical.context_hash,
          input_payload: {
            product_name: productName,
            supplier_name: product?.supplier_name ?? null,
          } as unknown as Json,
        });

      if (lineErr) throw new Error(lineErr.message);

      // 4. POST immediately
      const result = await post({
        documentId: doc.id,
        establishmentId: estId,
        expectedLockVersion: doc.lock_version,
        eventReason: effectiveReason,
      });

      if (result.ok) {
        // ✅ Success — add to session badges
        const absQty = Math.abs(negativeDelta);
        // Project into internal context for display
        const contextLabel = formatQuantityForContext(
          absQty,
          product!,
          "internal",
          inputConfigs.get(params.productId) ?? null,
          dbUnits,
          dbConversions,
        );
        setWithdrawnProducts((prev) => {
          const next = new Map(prev);
          const existing = next.get(params.productId);
          const prevQty = existing?.qty ?? 0;
          const totalQty = prevQty + absQty;
          // Re-project total for cumulative display
          const totalLabel = formatQuantityForContext(
            totalQty,
            product!,
            "internal",
            inputConfigs.get(params.productId) ?? null,
            dbUnits,
            dbConversions,
          );
          next.set(params.productId, {
            qty: totalQty,
            label: totalLabel ?? params.canonicalLabel ?? canonical.canonical_label ?? "",
          });
          return next;
        });

        toast.success(`${productName} retiré ✓`);
        setSuccessFlash(productName);
        setTimeout(() => setSuccessFlash(null), 2000);

        // Invalidate stock estimates so badges update
        queryClient.invalidateQueries({ queryKey: ["withdrawal-stock-estimates-ssot"] });
        queryClient.invalidateQueries({ queryKey: ["estimated-stock"] });
        queryClient.invalidateQueries({ queryKey: ["product-current-stock"] });
        queryClient.invalidateQueries({ queryKey: ["product-has-stock"] });
        queryClient.invalidateQueries({ queryKey: ["stock-alerts"] });
        queryClient.invalidateQueries({ queryKey: ["desktop-stock"] });

        // STOCK ZERO V1: Discrepancy detection removed — backend clamps silently
      } else {
        // Handle POST errors
        if (result.error === "LOCK_CONFLICT") {
          toast.error("Conflit. Réessayez.");
        } else if (result.error === "NO_ACTIVE_SNAPSHOT") {
          toast.error("Aucun inventaire de référence pour cette zone.");
        } else {
          toast.error(`Erreur : ${result.error}`);
        }
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Erreur";
      toast.error(message);
    }
  }, [estId, orgId, user?.id, allProducts, dbUnits, effectiveReason, post, queryClient]);

  // ═══ Modal confirm: convert raw entries → canonical → direct withdrawal (supports multi-level) ═══
  const handleModalConfirmRaw = useCallback((entries: QuantityEntry[]) => {
    if (!modalProduct || entries.length === 0) return;

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

    handleDirectWithdrawal({
      productId: modalProduct.id,
      canonicalQuantity: convResult.canonicalQuantity,
      canonicalUnitId: convResult.canonicalUnitId,
      canonicalFamily: convResult.canonicalFamily,
      canonicalLabel: convResult.canonicalLabel,
    });
  }, [modalProduct, dbUnits, dbConversions, handleDirectWithdrawal]);

  // STOCK ZERO V1: handleOverridePost removed — backend clamps silently, no override needed

  // ═══ No zones configured guard ═══
  if (!hasAnyZone) {
    return (
      <div className="py-4 px-4 space-y-5">
        <div className="flex items-center gap-3">
          {onBack && (
            <Button variant="ghost" size="sm" onClick={onBack} className="gap-1 -ml-2">
              <ChevronLeft className="h-4 w-4" /> Retour
            </Button>
          )}
          <h2 className="text-lg font-bold text-foreground flex-1">Retrait</h2>
        </div>
        <div className="text-center py-12 text-muted-foreground">
          <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>Aucune zone de stockage configurée.</p>
          <p className="text-sm mt-1">Configurez vos zones dans Produits → Paramètres.</p>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // MAIN VIEW
  // ═══════════════════════════════════════════════════════════════════════
  return (
    <div className="relative flex flex-col min-h-[calc(100dvh-8rem)]">
      {/* ── SUCCESS FLASH OVERLAY ── */}
      {successFlash && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm animate-fade-in">
          <div className="flex flex-col items-center gap-3 animate-scale-in">
            <div className="h-20 w-20 rounded-full bg-emerald-500 flex items-center justify-center shadow-lg">
              <Check className="h-10 w-10 text-white" strokeWidth={3} />
            </div>
            <p className="text-lg font-semibold text-foreground">{successFlash} retiré</p>
          </div>
        </div>
      )}
      {/* ── HEADER ── */}
      <div className="px-4 pt-3 pb-2 space-y-2.5">
        {/* Top row: back + search + badge */}
        <div className="flex items-center gap-2">
          {onBack && (
            <button
              onClick={onBack}
              className="shrink-0 h-8 w-8 rounded-lg bg-muted/50 flex items-center justify-center transition-all active:scale-95 hover:bg-muted"
              aria-label="Retour"
            >
              <ChevronLeft className="h-4 w-4 text-muted-foreground" />
            </button>
          )}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              ref={searchRef}
              placeholder="Rechercher un produit…"
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              className="pl-9 h-8 text-sm rounded-lg border-border/60 bg-muted/30 focus:bg-card"
              aria-label="Rechercher un produit"
            />
          </div>
          {withdrawnProducts.size > 0 && (
            <div className="shrink-0 flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-950/40 px-2 py-1">
              <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" strokeWidth={3} />
              <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400 tabular-nums">
                {withdrawnProducts.size}
              </span>
            </div>
          )}
        </div>

        {/* Motif — small discrete pills */}
        <div className="flex items-center gap-1.5">
          {REASON_OPTIONS.map((opt) => {
            const isActive = reasonCode === opt.value;
            const IconComp = opt.icon;
            return (
              <button
                key={opt.value}
                onClick={() => setReasonCode(opt.value)}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium transition-all active:scale-[0.97] ${
                  isActive
                    ? "bg-foreground text-background shadow-sm"
                    : "bg-muted/50 text-muted-foreground hover:bg-muted"
                }`}
              >
                <IconComp className="h-3 w-3" />
                {opt.value === "CONSUMPTION" ? "Conso" : "Péremption"}
              </button>
            );
          })}
          <span className="text-[10px] text-muted-foreground ml-auto tabular-nums">
            {filteredProducts.length} produit{filteredProducts.length > 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {/* ── CONTENT ── */}
      <div className="flex-1 overflow-y-auto">

        {/* Product list */}
        <div className="px-4 pb-4">
          {productsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : productsHasError ? (
            <div className="flex flex-col items-center justify-center py-8 gap-3 px-4">
              <AlertTriangle className="h-8 w-8 text-destructive" />
              <p className="text-sm text-destructive text-center font-medium">
                Erreur lors du chargement des produits
              </p>
              {import.meta.env.DEV && productsError instanceof Error && (
                <p className="text-xs text-muted-foreground text-center">{productsError.message}</p>
              )}
            </div>
          ) : filteredProducts.length === 0 ? (
            <p className="text-center text-muted-foreground text-sm py-8">
              {allProducts.length === 0 ? "Aucun produit configuré" : "Aucun résultat"}
            </p>
          ) : (
            <div className="space-y-4">
              {alphabeticalGroups.map(([letter, products]) => (
                <div key={letter}>
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-1">
                    {letter}
                  </p>
                  <div className="space-y-1.5">
                    {products.map((p) => {
                      const withdrawn = withdrawnProducts.get(p.id);
                      const isIneligible = !p.storage_zone_id || !p.stock_handling_unit_id;
                      return (
                        <button
                          key={p.id}
                          className={`w-full text-left rounded-xl border p-3 flex items-center gap-3 transition-all active:scale-[0.98] ${
                            isIneligible
                              ? "border-border bg-muted/50 opacity-60 cursor-not-allowed"
                              : withdrawn
                                ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30"
                                : "border-border bg-card hover:border-primary/20 hover:bg-accent/50"
                          }`}
                          onClick={() => {
                            if (isIneligible) {
                              toast.error("Ce produit doit être configuré via le Wizard avant utilisation.");
                              return;
                            }
                            handleProductTap(p);
                          }}
                          disabled={isIneligible || isPosting}
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate uppercase">
                              {p.nom_produit}
                            </p>
                            {p.category_name && (
                              <p className="text-[10px] text-muted-foreground mt-0.5">
                                {p.category_name}
                              </p>
                            )}
                          </div>
                          {isIneligible ? (
                            <Badge
                              variant="outline"
                              className="shrink-0 text-xs border-amber-300 dark:border-amber-700 text-amber-600 dark:text-amber-400 gap-1"
                            >
                              <Settings2 className="h-3 w-3" />À configurer
                            </Badge>
                          ) : withdrawn ? (
                            <Badge
                              variant="secondary"
                              className="shrink-0 bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 border-0 text-xs"
                            >
                              <Check className="h-3 w-3 mr-1" />
                              {withdrawn.label}
                            </Badge>
                          ) : (
                            <span className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground tabular-nums">
                              {(() => {
                                const s = stockByProduct?.get(p.id);
                                if (!s) return "–";
                                // Project stock into internal context
                                const projected = formatQuantityForContext(
                                  s.qty,
                                  p,
                                  "internal",
                                  inputConfigs.get(p.id) ?? null,
                                  dbUnits,
                                  dbConversions,
                                );
                                return projected ?? `${s.qty}${s.unit ? ` ${s.unit}` : ""}`;
                              })()}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Withdrawal quantity popup — UQM stepper mode (pure UI, no conversion) */}
      <UniversalQuantityModal
        open={!!modalProduct}
        onClose={() => setModalProduct(null)}
        uiMode="stepper"
        stepperConfig={
          modalProduct
            ? (() => {
                // ── SSOT: resolve from product_input_config + BFS engine ──
                const config = inputConfigs.get(modalProduct.id) ?? null;
                const resolved = resolveInputUnitForContext(
                  modalProduct,
                  "internal",
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
                    headerLabel: "Retrait en",
                    confirmLabel: "Ajouter au retrait",
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

                return {
                  productId: modalProduct.id,
                  productName: modalProduct.nom_produit,
                  unitId: resolved.unitId,
                  unitName: resolved.unitName,
                  steps: resolved.steps,
                  defaultStep: resolved.defaultStep,
                  conversionError: convCheck.error,
                  headerLabel: "Retrait en",
                  confirmLabel: "Ajouter au retrait",
                  inputMode: resolved.mode,
                } satisfies StepperConfig;
              })()
            : null
        }
        onConfirmRaw={handleModalConfirmRaw}
      />

      {/* STOCK ZERO V1: PostConfirmDialog override removed — backend clamps silently */}
    </div>
  );
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PRODUCT FORM V3 — WIZARD MODAL (5 ÉTAPES)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 5 ÉTAPES:
 * 1. Identité
 * 2. Structure & Conditionnement (unité ref + équivalence + packaging)
 * 3. Facturation (invoice data + price display unit)
 * 4. Zone & Stock
 * 5. Résumé intelligent
 */

import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { FlaskConical, Loader2 } from "lucide-react";

import type { ProductV3InitialData } from "./types";
import { useWizardState } from "./useWizardState";
import { WizardStepIdentity } from "./WizardStepIdentity";
import { WizardStepStructure } from "./WizardStepStructure";
import { WizardStep3 } from "./WizardStep3";
import { WizardStep5Stock } from "./WizardStep5Stock";

import { WizardStep5 as WizardStepSummary } from "./WizardStep5";

import { calculateConditionnement, validateFullGraph } from "@/modules/conditionnementV2";
import { useProductV2Mutations } from "@/modules/produitsV2";
import type { ConditioningConfig } from "@/modules/produitsV2";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { logProductCreatedFromInvoice } from "@/modules/theBrain";
import { useQueryClient } from "@tanstack/react-query";
import { useSaveInputConfig } from "@/modules/inputConfig";
import type { ProductInputConfigRow } from "@/modules/inputConfig";
import { useUnitConversions } from "@/core/unitConversion";
import { useProductHasStock } from "@/hooks/useProductHasStock";
import {
  resolveEffectiveDeliveryUnitId,
  resolveEffectivePriceDisplayUnitId,
  resolveEffectiveStockHandlingUnitId,
  resolveEffectivePriceLevel,
  resolveCanonicalQuantity,
  parseLocalFloat,
} from "@/modules/produitsV2/pipeline/resolveProductDerived";
import {
  buildConditioningConfig as pipelineBuildConditioningConfig,
  buildConditioningResume as pipelineBuildConditioningResume,
} from "@/modules/produitsV2/pipeline/buildConditioningPayload";
import { createProductPipeline } from "@/modules/produitsV2/pipeline/createProductPipeline";
import type { SaveInputConfigFn } from "@/modules/produitsV2/pipeline/createProductPipeline";
import { upsertProductV2, checkProductV2Collision } from "@/modules/produitsV2/services/productsV2Service";
import { USE_PRODUCT_PIPELINE } from "@/config/featureFlags";

export type WizardMode = "creation" | "edit_conditioning" | "configure_only";

interface ProductFormV3ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialData: ProductV3InitialData | null;
  supplierName?: string | null;
  supplierId?: string | null;
  onValidated?: () => void;
  existingConditionnementConfig?: ConditioningConfig | null;
  mode?: WizardMode;
  productId?: string | null;
  onConditioningConfigured?: (config: {
    conditionnement_config: ConditioningConfig | null;
    conditionnement_resume: string;
    supplier_billing_unit_id: string | null;
    final_unit_price: number | null;
    final_unit_id: string | null;
    delivery_unit_id: string | null;
    price_display_unit_id: string | null;
    stock_handling_unit_id: string | null;
    kitchen_unit_id: string | null;
    // category: transitoire — retiré du callback C6,
    // conservé dans le type pour compatibilité consumer
    category?: string | null;
    category_id?: string | null;
    storage_zone_id?: string | null;
    min_stock_quantity_canonical?: number | null;
    min_stock_unit_id?: string | null;
  }) => void;
}

export function ProductFormV3Modal({
  open,
  onOpenChange,
  initialData,
  supplierName,
  supplierId,
  onValidated,
  existingConditionnementConfig,
  mode = "creation",
  productId,
  onConditioningConfigured,
}: ProductFormV3ModalProps) {
  const wizard = useWizardState(initialData);
  const { upsert } = useProductV2Mutations();
  const queryClient = useQueryClient();
  const { activeEstablishment } = useEstablishment();
  const { user } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showFamilyChangeWarning, setShowFamilyChangeWarning] = useState(false);
  const pendingSubmitRef = useRef<(() => Promise<void>) | null>(null);
  const hasInitializedRef = useRef(false);
  const { units: dbUnits, conversions: dbConversions } = useUnitConversions();
  const saveInputConfig = useSaveInputConfig();

  const isEditConditioning = mode === "edit_conditioning";
  const isConfigureOnly = mode === "configure_only";

  // ── Load existing input config for edit mode ──
  const establishmentId = activeEstablishment?.id;
  const { data: existingInputConfig } = useQuery({
    queryKey: ["product-input-config-wizard", productId, establishmentId],
    enabled: !!productId && !!establishmentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_input_config")
        .select("*")
        .eq("product_id", productId!)
        .eq("establishment_id", establishmentId!)
        .maybeSingle();
      if (error) throw error;
      return data as ProductInputConfigRow | null;
    },
  });
  const { hasStock: productHasStock } = useProductHasStock(isEditConditioning ? productId : null);

  useEffect(() => {
    if (open && initialData && !hasInitializedRef.current) {
      wizard.reset(initialData, existingConditionnementConfig, supplierId);
      hasInitializedRef.current = true;
    }
    if (!open) {
      hasInitializedRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialData, existingConditionnementConfig]);

  // ── Fix: resolve billing unit name from UUID when legacy text field is empty ──
  useEffect(() => {
    if (!open || !hasInitializedRef.current || dbUnits.length === 0) return;
    const { billedUnitId, billedUnit } = wizard.state;
    if (billedUnitId && !billedUnit) {
      const unit = dbUnits.find((u) => u.id === billedUnitId);
      if (unit) {
        wizard.setBilledUnit(unit.abbreviation || unit.name, billedUnitId);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, dbUnits, wizard.state.billedUnitId, wizard.state.billedUnit]);

  const effectivePriceLevel = resolveEffectivePriceLevel(wizard.autoDeducedPriceLevel, wizard.state.priceLevel);

  const calculationResult = useMemo(() => {
    return calculateConditionnement({
      finalUnit: wizard.state.finalUnit,
      finalUnitId: wizard.state.finalUnitId,
      packagingLevels: wizard.state.packagingLevels,
      invoiceData: {
        billedQuantity: wizard.state.billedQuantity
          ? parseLocalFloat(wizard.state.billedQuantity)
          : null,
        billedUnit: wizard.state.billedUnit,
        billedUnitId: wizard.state.billedUnitId,
        lineTotal: wizard.state.lineTotal ? parseLocalFloat(wizard.state.lineTotal) : null,
        unitPriceBilled: null,
      },
      priceLevel: effectivePriceLevel,
      equivalence: wizard.equivalenceObject,
      units: dbUnits,
      conversions: dbConversions,
    });
  }, [
    wizard.state.finalUnit,
    wizard.state.finalUnitId,
    wizard.state.packagingLevels,
    wizard.state.billedQuantity,
    wizard.state.billedUnit,
    wizard.state.billedUnitId,
    wizard.state.lineTotal,
    effectivePriceLevel,
    wizard.equivalenceObject,
    dbUnits,
    dbConversions,
  ]);

  const handleClose = () => {
    wizard.reset();
    onOpenChange(false);
  };

  const buildConditioningConfig = (): ConditioningConfig | null => {
    return pipelineBuildConditioningConfig({
      finalUnit: wizard.state.finalUnit,
      finalUnitId: wizard.state.finalUnitId,
      packagingLevels: wizard.state.packagingLevels,
      effectivePriceLevel,
      billedUnitId: wizard.state.billedUnitId,
      equivalenceObject: wizard.equivalenceObject,
    });
  };

  const buildConditioningResume = (): string => {
    return pipelineBuildConditioningResume({
      packagingLevels: wizard.state.packagingLevels,
      finalUnit: wizard.state.finalUnit,
    });
  };

  // Deduced delivery_unit_id — validates legacy values against current structure
  const effectiveDeliveryUnitId = useMemo((): string | null => {
    return resolveEffectiveDeliveryUnitId(
      {
        deliveryUnitId: wizard.state.deliveryUnitId,
        packagingLevels: wizard.state.packagingLevels,
        billedUnitId: wizard.state.billedUnitId,
        finalUnitId: wizard.state.finalUnitId,
      },
      dbUnits,
    );
  }, [
    wizard.state.deliveryUnitId,
    wizard.state.packagingLevels,
    wizard.state.billedUnitId,
    wizard.state.finalUnitId,
    dbUnits,
  ]);

  // Use wizard's explicit selection or fallback to finalUnitId for price display only
  const effectivePriceDisplayUnitId = resolveEffectivePriceDisplayUnitId(
    wizard.state.priceDisplayUnitId, wizard.state.finalUnitId
  );

  // ── AUTO CANONICAL: stock_handling_unit_id is 100% auto-calculated ──
  const autoCanonicalUnitId = useMemo((): string | null => {
    return resolveEffectiveStockHandlingUnitId(
      {
        finalUnitId: wizard.state.finalUnitId,
        billedUnitId: wizard.state.billedUnitId,
        packagingLevels: wizard.state.packagingLevels,
        equivalence: wizard.equivalenceObject ?? null,
        deliveryUnitId: effectiveDeliveryUnitId,
      },
      dbUnits,
      dbConversions,
    );
  }, [
    wizard.state.finalUnitId,
    wizard.state.billedUnitId,
    wizard.state.packagingLevels,
    wizard.equivalenceObject,
    effectiveDeliveryUnitId,
    dbUnits,
    dbConversions,
  ]);

  const effectiveStockHandlingUnitId = autoCanonicalUnitId;

  // Canonical family for article matching (derived from final unit)
  const canonicalFamily = useMemo((): string | null => {
    if (!wizard.state.finalUnitId || dbUnits.length === 0) return null;
    const unit = dbUnits.find((u) => u.id === wizard.state.finalUnitId);
    return unit?.family ?? null;
  }, [wizard.state.finalUnitId, dbUnits]);

  // ── Convert min_stock to canonical using pipeline resolveCanonicalQuantity ──
  const resolveCanonicalMinStock = (): { qty: number | null; unitId: string | null } => {
    const rawQty = wizard.state.minStockQuantity ? parseLocalFloat(wizard.state.minStockQuantity) : null;
    const selectedUnitId = wizard.state.minStockUnitId || null;
    const condConfig = buildConditioningConfig();
    return resolveCanonicalQuantity(
      {
        rawQty,
        selectedUnitId,
        stockHandlingUnitId: effectiveStockHandlingUnitId,
        deliveryUnitId: effectiveDeliveryUnitId,
        billedUnitId: wizard.state.billedUnitId,
        finalUnitId: wizard.state.finalUnitId,
        condConfig,
      },
      dbUnits,
      dbConversions,
    );
  };

  // ── Convert initial stock to canonical using same pipeline function ──
  const resolveCanonicalInitialStock = (): { qty: number | null; unitId: string | null } => {
    const rawQty = wizard.state.initialStockQuantity ? parseLocalFloat(wizard.state.initialStockQuantity) : null;
    const selectedUnitId = wizard.state.initialStockUnitId || null;
    const condConfig = buildConditioningConfig();
    return resolveCanonicalQuantity(
      {
        rawQty,
        selectedUnitId,
        stockHandlingUnitId: effectiveStockHandlingUnitId,
        deliveryUnitId: effectiveDeliveryUnitId,
        billedUnitId: wizard.state.billedUnitId,
        finalUnitId: wizard.state.finalUnitId,
        condConfig,
      },
      dbUnits,
      dbConversions,
    );
  };

  const performEditSave = useCallback(async () => {
    if (!productId) return;
    
    setIsSubmitting(true);
    try {
      const newZoneId = wizard.state.storageZoneId;
      const oldZoneId = initialData?.storage_zone_id;
      const zoneChanged = !!(newZoneId && oldZoneId && newZoneId !== oldZoneId);

      let estimatedQty = 0;
      let canonicalUnitId: string | null = null;
      let canonicalFamily: string | null = null;

      if (zoneChanged && activeEstablishment?.id) {
        const stockUnitId = effectiveStockHandlingUnitId;
        const stockFamily = stockUnitId
          ? dbUnits.find((u) => u.id === stockUnitId)?.family ?? null
          : null;

        const cachedStock = queryClient.getQueryData<Map<string, { ok: boolean; data?: { estimated_quantity: number; canonical_unit_id: string; canonical_family: string } }>>(["estimated-stock", activeEstablishment.id]);
        const productStock = cachedStock?.get(productId!);
        if (productStock?.ok && productStock.data) {
          estimatedQty = productStock.data.estimated_quantity;
          canonicalUnitId = productStock.data.canonical_unit_id;
          canonicalFamily = productStock.data.canonical_family;
        } else {
          canonicalUnitId = stockUnitId;
          canonicalFamily = stockFamily;
        }
      }

      const dlcDaysEdit = wizard.state.dlcWarningDays ? parseInt(wizard.state.dlcWarningDays, 10) : null;
      const dlcValueEdit = (!isNaN(dlcDaysEdit as number) && dlcDaysEdit !== null && dlcDaysEdit >= 0) ? dlcDaysEdit : null;
      const billedQtyNum = parseLocalFloat(wizard.state.billedQuantity);
      const lineTotalNum = parseLocalFloat(wizard.state.lineTotal);

      
      const { data: rpcResult, error: rpcErr } = await supabase.rpc("fn_save_product_wizard" as never, {
        p_product_id: productId,
        p_user_id: user?.id,
        p_nom_produit: wizard.state.productName.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase(),
        p_name_normalized: wizard.state.productName
          .trim()
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, ""),
        p_code_produit: wizard.state.productCode.trim() || null,
        p_conditionnement_config: buildConditioningConfig(),
        p_conditionnement_resume: buildConditioningResume() || null,
        p_supplier_billing_unit_id: wizard.state.billedUnitId,
        p_final_unit_price: calculationResult.unitPriceFinal ?? null,
        p_final_unit_id: wizard.state.finalUnitId,
        p_delivery_unit_id: effectiveDeliveryUnitId,
        p_price_display_unit_id: effectivePriceDisplayUnitId,
        p_stock_handling_unit_id: effectiveStockHandlingUnitId,
        p_kitchen_unit_id: null, // kitchen_unit_id removed from wizard
        p_min_stock_quantity_canonical: resolveCanonicalMinStock().qty,
        p_min_stock_unit_id: resolveCanonicalMinStock().unitId,
        p_category: null,
        p_category_id: wizard.state.categoryId || null,
        p_new_zone_id: newZoneId || null,
        p_old_zone_id: oldZoneId || null,
        p_estimated_qty: estimatedQty,
        p_canonical_unit_id: canonicalUnitId,
        p_canonical_family: canonicalFamily,
        p_context_hash: null,
        p_expected_updated_at: initialData?.updated_at ?? null,
        p_dlc_warning_days: dlcValueEdit,
        p_supplier_billing_quantity: billedQtyNum > 0 ? billedQtyNum : null,
        p_supplier_billing_line_total: lineTotalNum > 0 ? lineTotalNum : null,
        p_allow_unit_sale: wizard.state.allowUnitSale,
      } as never);
      

      if (rpcErr) {
        console.error("[V3 Wizard] Atomic save RPC error:", rpcErr);
        toast.error("Erreur lors de la sauvegarde. Aucune modification n'a été appliquée.");
        if (zoneChanged && oldZoneId) {
          wizard.setStorageZoneId(oldZoneId);
        }
        setIsSubmitting(false);
        return;
      }

      const result = rpcResult as Record<string, unknown> | null;
      if (result && !result.ok) {
        const errorCode = result.error as string;
        console.error("[V3 Wizard] Atomic save failed:", errorCode);
        
        if (errorCode?.includes("OPTIMISTIC_LOCK_CONFLICT")) {
          toast.error("Le produit a été modifié par un autre utilisateur. Veuillez rafraîchir et réessayer.");
        } else if (errorCode?.includes("STOCK_UNIT_LOCKED")) {
          toast.error("Impossible de modifier l'unité stock : le produit a encore du stock. Passez d'abord le stock à 0 via inventaire.");
        } else if (errorCode?.includes("ZONE_TRANSFER_FAILED")) {
          toast.error("Échec du transfert de zone. Aucune modification n'a été appliquée.");
        } else {
          toast.error("Erreur lors de la sauvegarde. Aucune modification n'a été appliquée.");
        }
        if (zoneChanged && oldZoneId) {
          wizard.setStorageZoneId(oldZoneId);
        }
        setIsSubmitting(false);
        return;
      }

      

      const newStockUnitId = effectiveStockHandlingUnitId;
      const oldStockUnitId = initialData?.stock_handling_unit_id;
      const unitChanged = newStockUnitId && oldStockUnitId && newStockUnitId !== oldStockUnitId;
      const unitFamilyChanged = unitChanged
        ? (dbUnits.find((u) => u.id === newStockUnitId)?.family !== dbUnits.find((u) => u.id === oldStockUnitId)?.family)
        : false;

      if (unitFamilyChanged && !zoneChanged && newZoneId && newStockUnitId && activeEstablishment?.id) {
        try {
          // INTENTIONAL: family change resets stock to 0.
          // p_initial_quantity defaults to 0 — correct behavior.
          // User is warned via confirmation dialog above.
          const { error } = await supabase.rpc("fn_initialize_product_stock", {
            p_product_id: productId!,
            p_user_id: user?.id ?? "",
          });
          if (error) console.error("[V3 Wizard] Re-init stock error:", error);
        } catch (err) {
          console.error("[V3 Wizard] Re-init stock error:", err);
        }
      }

      queryClient.invalidateQueries({ queryKey: ["product-v2", productId] });
      queryClient.invalidateQueries({ queryKey: ["products-v2"] });
      queryClient.invalidateQueries({ queryKey: ["desktop-stock"] });
      queryClient.invalidateQueries({ queryKey: ["inventory-lines"] });
      queryClient.invalidateQueries({ queryKey: ["estimated-stock"] });
      queryClient.invalidateQueries({ queryKey: ["stock-alerts"] });
      queryClient.invalidateQueries({ queryKey: ["dlc", "critique"] });

      const transferredQty = (result as Record<string, unknown>)?.transferred_qty as number;
      if ((result as Record<string, unknown>)?.zone_changed && transferredQty > 0) {
        toast.success(`Produit mis à jour — ${transferredQty} unités transférées`);
      } else {
        toast.success("Produit mis à jour");
      }
      
      // ── SAVE INPUT CONFIG in edit mode (BLOCKING) ──
      if (productId) {
        try {
          const editProductForResolution = {
            id: productId,
            nom_produit: wizard.state.productName ?? "",
            final_unit_id: wizard.state.finalUnitId,
            stock_handling_unit_id: effectiveStockHandlingUnitId,
            delivery_unit_id: effectiveDeliveryUnitId,
            supplier_billing_unit_id: wizard.state.billedUnitId,
            conditionnement_config: buildConditioningConfig(),
          };
          await saveInputConfig.mutateAsync({
            productIds: [productId],
            reception_mode: wizard.state.inputConfigReceptionMode,
            reception_preferred_unit_id: wizard.state.inputConfigReceptionUnitId,
            reception_unit_chain: wizard.state.inputConfigReceptionChain,
            internal_mode: wizard.state.inputConfigInternalMode,
            internal_preferred_unit_id: wizard.state.inputConfigInternalUnitId,
            internal_unit_chain: wizard.state.inputConfigInternalChain,
            validationContext: {
              products: [editProductForResolution],
              dbUnits,
              dbConversions,
            },
          });
        } catch (err) {
          if (import.meta.env.DEV) console.error("[V3 Wizard] Input config save error:", err);
          toast.error("Erreur lors de la sauvegarde de la configuration. Veuillez réessayer.");
          setIsSubmitting(false);
          return;
        }
      }
      
      wizard.reset();
      onOpenChange(false);
      if (onValidated) onValidated();
      
    } catch (error) {
      console.error("[V3 Wizard] Edit error:", error);
      toast.error("Erreur lors de la mise à jour");
    } finally {
      setIsSubmitting(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, wizard.state, calculationResult, effectiveDeliveryUnitId, effectivePriceDisplayUnitId, effectiveStockHandlingUnitId]);

  const handleValidate = async () => {
    
    // ── GLOBAL GRAPH VALIDATION GATE ──
    const graphResult = validateFullGraph({
      finalUnitId: wizard.state.finalUnitId,
      finalUnit: wizard.state.finalUnit,
      packagingLevels: wizard.state.packagingLevels,
      equivalence: wizard.equivalenceObject,
      billedUnitId: wizard.state.billedUnitId,
      deliveryUnitId: effectiveDeliveryUnitId,
      stockHandlingUnitId: effectiveStockHandlingUnitId,
      kitchenUnitId: null,
      priceDisplayUnitId: effectivePriceDisplayUnitId,
      dbUnits,
      dbConversions,
    });

    if (!graphResult.valid) {
      const firstError = graphResult.errors[0];
      toast.error(firstError.message, {
        description: firstError.fix,
        duration: 6000,
      });
      if (firstError.step) {
        wizard.goToStep(firstError.step as 1 | 2 | 3 | 4 | 5);
      }
      return;
    }

    // ── GUARD: stock_handling_unit_id must be explicitly set ──
    if (!effectiveStockHandlingUnitId && wizard.state.finalUnitId) {
      toast.error("Unité d'inventaire obligatoire. Vérifiez la structure du produit.");
      wizard.goToStep(2);
      return;
    }

    if (isConfigureOnly) {
      const config = {
        conditionnement_config: buildConditioningConfig(),
        conditionnement_resume: buildConditioningResume() || "",
        supplier_billing_unit_id: wizard.state.billedUnitId || null,
        final_unit_price: calculationResult.unitPriceFinal ?? null,
        final_unit_id: wizard.state.finalUnitId || null,
        delivery_unit_id: effectiveDeliveryUnitId,
        price_display_unit_id: effectivePriceDisplayUnitId,
        stock_handling_unit_id: effectiveStockHandlingUnitId,
        kitchen_unit_id: null, // kitchen_unit_id removed from wizard
        // category text legacy retiré (C6) — SSOT = category_id
        category_id: wizard.state.categoryId || null,
        storage_zone_id: wizard.state.storageZoneId || null,
        min_stock_quantity_canonical: resolveCanonicalMinStock().qty,
        min_stock_unit_id: resolveCanonicalMinStock().unitId,
      };
      toast.success("Conditionnement configuré");
      wizard.reset();
      onOpenChange(false);
      if (onConditioningConfigured) onConditioningConfigured(config);
      return;
    }

    if (isEditConditioning) {
      if (!productId) {
        toast.error("productId obligatoire en mode édition conditionnement");
        return;
      }

      const originalStockUnitId = initialData?.stock_handling_unit_id;
      const newStockUnitId = effectiveStockHandlingUnitId;
      if (originalStockUnitId && newStockUnitId && originalStockUnitId !== newStockUnitId) {
        const originalFamily = dbUnits.find((u) => u.id === originalStockUnitId)?.family;
        const newFamily = dbUnits.find((u) => u.id === newStockUnitId)?.family;
        if (originalFamily && newFamily && originalFamily !== newFamily) {
          pendingSubmitRef.current = performEditSave;
          setShowFamilyChangeWarning(true);
          return;
        }
      }

      await performEditSave();
      return;
    }

    // MODE CREATION
    if (!wizard.state.productName.trim()) {
      toast.error("Nom du produit manquant");
      return;
    }

    setIsSubmitting(true);

    // ══════════════════════════════════════════════════════════════════════════
    // PIPELINE PATH (PR-8) — Feature flag controlled
    // ══════════════════════════════════════════════════════════════════════════
    if (USE_PRODUCT_PIPELINE) {
      try {
        if (!wizard.state.identitySupplierId) {
          toast.error("Fournisseur obligatoire pour créer un produit. Sélectionnez un fournisseur.");
          setIsSubmitting(false);
          return;
        }

        // Build saveInputConfigFn wrapper (adapts hook to pure function signature)
        const saveInputConfigWrapper: SaveInputConfigFn = async (productId, payload, _estId) => {
          const createProductForResolution = {
            id: productId,
            nom_produit: wizard.state.productName ?? "",
            final_unit_id: wizard.state.finalUnitId,
            stock_handling_unit_id: effectiveStockHandlingUnitId,
            delivery_unit_id: effectiveDeliveryUnitId,
            supplier_billing_unit_id: wizard.state.billedUnitId,
            conditionnement_config: buildConditioningConfig(),
          };

          await saveInputConfig.mutateAsync({
            productIds: [productId],
            reception_mode: payload.reception_mode as import("@/modules/inputConfig").InputMode,
            reception_preferred_unit_id: payload.reception_preferred_unit_id,
            reception_unit_chain: payload.reception_unit_chain,
            internal_mode: payload.internal_mode as import("@/modules/inputConfig").InputMode,
            internal_preferred_unit_id: payload.internal_preferred_unit_id,
            internal_unit_chain: payload.internal_unit_chain,
            purchase_mode: payload.purchase_mode as import("@/modules/inputConfig").InputMode,
            purchase_preferred_unit_id: payload.purchase_preferred_unit_id,
            purchase_unit_chain: payload.purchase_unit_chain,
            validationContext: {
              products: [createProductForResolution],
              dbUnits,
              dbConversions,
            },
          });
        };

        const pipelineResult = await createProductPipeline({
          wizardState: wizard.state,
          establishmentId: activeEstablishment?.id ?? "",
          userId: user?.id ?? "",
          dbUnits,
          dbConversions,
          initialData,
          collisionChecker: checkProductV2Collision,
          saveInputConfigFn: saveInputConfigWrapper,
          upsertFn: upsertProductV2,
          calculationResult,
        });

        if (!pipelineResult.ok) {
          const fail = pipelineResult as Extract<typeof pipelineResult, { ok: false }>;
          toast.error(fail.message);
          // Don't close modal on error — user can retry
          setIsSubmitting(false);
          return;
        }

        // ── POST-SUCCESS (exact parity with old path) ──
        // 1. Cache invalidation (same as invalidateProducts() in useProductV2Mutations)
        queryClient.invalidateQueries({ queryKey: ["products-v2", activeEstablishment?.id] });
        queryClient.invalidateQueries({ queryKey: ["products-v2-categories", activeEstablishment?.id] });
        queryClient.invalidateQueries({ queryKey: ["products-v2-suppliers", activeEstablishment?.id] });
        queryClient.invalidateQueries({ queryKey: ["estimated-stock"], exact: false });
        queryClient.invalidateQueries({ queryKey: ["stock-alerts"], exact: false });
        queryClient.invalidateQueries({ queryKey: ["desktop-stock"], exact: false });

        // 2. Toast
        toast.success(pipelineResult.wasCreated ? "Produit enregistré" : "Produit mis à jour");

        // 3. Brain log (if created from invoice)
        if (pipelineResult.wasCreated && activeEstablishment?.id && initialData) {
          logProductCreatedFromInvoice({
            establishmentId: activeEstablishment.id,
            supplierId: supplierId ?? null,
            lineId: null,
            extracted: {
              code_produit: initialData.code_produit ?? null,
              nom_produit: initialData.nom_produit ?? null,
            },
            createdProductId: pipelineResult.productId,
          });
        }

        // 4. Reset + close + callback
        wizard.reset();
        onOpenChange(false);
        if (onValidated) {
          onValidated();
        }
      } catch (error) {
        if (import.meta.env.DEV) console.error("[V3 Wizard Pipeline] Unexpected error:", error);
        toast.error("Erreur inattendue lors de la création du produit.");
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    // ══════════════════════════════════════════════════════════════════════════
    // LEGACY PATH (ancien chemin inline — inchangé)
    // ══════════════════════════════════════════════════════════════════════════
    try {
      const effectiveSupplierId = wizard.state.identitySupplierId;
      if (!effectiveSupplierId) {
        toast.error("Fournisseur obligatoire pour créer un produit. Sélectionnez un fournisseur.");
        setIsSubmitting(false);
        return;
      }

      const dlcDays = wizard.state.dlcWarningDays ? parseInt(wizard.state.dlcWarningDays, 10) : null;
      const billedQtyNum = parseLocalFloat(wizard.state.billedQuantity);
      const lineTotalNum = parseLocalFloat(wizard.state.lineTotal);
      const payload = {
        nom_produit: wizard.state.productName.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase(),
        nom_produit_fr: undefined,
        code_produit: wizard.state.productCode.trim() || null,
        code_barres: wizard.state.barcode?.trim() || null,
        supplier_id: effectiveSupplierId,
        info_produit: initialData?.info_produit?.trim() || null,
        category_id: wizard.state.categoryId || null,
        supplier_billing_unit_id: wizard.state.billedUnitId,
        storage_zone_id: wizard.state.storageZoneId || null,
        conditionnement_config: buildConditioningConfig(),
        conditionnement_resume: buildConditioningResume() || null,
        final_unit_price: calculationResult.unitPriceFinal ?? null,
        final_unit_id: wizard.state.finalUnitId,
        delivery_unit_id: effectiveDeliveryUnitId,
        price_display_unit_id: effectivePriceDisplayUnitId,
        stock_handling_unit_id: effectiveStockHandlingUnitId,
        kitchen_unit_id: null as string | null, // kitchen_unit_id removed from wizard
        min_stock_quantity_canonical: resolveCanonicalMinStock().qty,
        min_stock_unit_id: resolveCanonicalMinStock().unitId,
        initial_stock_quantity: resolveCanonicalInitialStock().qty,
        initial_stock_unit_id: resolveCanonicalInitialStock().unitId,
        dlc_warning_days: (!isNaN(dlcDays as number) && dlcDays !== null && dlcDays >= 0) ? dlcDays : null,
        supplier_billing_quantity: billedQtyNum > 0 ? billedQtyNum : null,
        supplier_billing_line_total: lineTotalNum > 0 ? lineTotalNum : null,
        allow_unit_sale: wizard.state.allowUnitSale,
      };

      const result = await upsert.mutateAsync(payload);

      if (result.wasCreated && activeEstablishment?.id && initialData) {
        logProductCreatedFromInvoice({
          establishmentId: activeEstablishment.id,
          supplierId: supplierId ?? null,
          lineId: null,
          extracted: {
            code_produit: initialData.code_produit ?? null,
            nom_produit: initialData.nom_produit ?? null,
          },
          createdProductId: result.product.id,
        });
      }

      // ── SAVE INPUT CONFIG (BLOCKING) ──
      try {
        const createProductForResolution = {
          id: result.product.id,
          nom_produit: wizard.state.productName ?? "",
          final_unit_id: wizard.state.finalUnitId,
          stock_handling_unit_id: effectiveStockHandlingUnitId,
          delivery_unit_id: effectiveDeliveryUnitId,
          supplier_billing_unit_id: wizard.state.billedUnitId,
          conditionnement_config: buildConditioningConfig(),
        };
        await saveInputConfig.mutateAsync({
          productIds: [result.product.id],
          reception_mode: wizard.state.inputConfigReceptionMode,
          reception_preferred_unit_id: wizard.state.inputConfigReceptionUnitId,
          reception_unit_chain: wizard.state.inputConfigReceptionChain,
          internal_mode: wizard.state.inputConfigInternalMode,
          internal_preferred_unit_id: wizard.state.inputConfigInternalUnitId,
          internal_unit_chain: wizard.state.inputConfigInternalChain,
          validationContext: {
            products: [createProductForResolution],
            dbUnits,
            dbConversions,
          },
        });
      } catch (err) {
        if (import.meta.env.DEV) console.error("[V3 Wizard] Input config save error:", err);
        toast.error("Erreur lors de la sauvegarde de la configuration. Veuillez réessayer.");
        setIsSubmitting(false);
        return;
      }

      wizard.reset();
      onOpenChange(false);

      if (onValidated) {
        onValidated();
      }
    } catch (error) {
      if (import.meta.env.DEV) console.error("[V3 Wizard] Validation error:", error);
      // Defensive toast — mutation onError may already fire, but ensure user always sees feedback
      const msg = error instanceof Error ? error.message : "Erreur inconnue";
      if (msg.includes("Zone de stockage obligatoire")) {
        toast.error("Zone de stockage obligatoire. Configurez-la à l'étape 4.");
        wizard.goToStep(4);
      } else if (!msg.includes("idx_products_v2") && !msg.includes("STOCK_UNIT_LOCKED")) {
        // Only show generic toast if mutation onError didn't already show a specific one
        toast.error("Erreur lors de la création du produit. Veuillez réessayer.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleNextProduct = async () => {
    await handleValidate();
  };

  const progressPercent = (wizard.state.currentStep / 5) * 100;

  const stepLabels: Record<number, string> = {
    1: "Identité",
    2: "Structure",
    3: "Facturation",
    4: "Zone & Stock",
    5: "Résumé",
  };

  return (
    <>
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent overlayClassName="bg-transparent" className="sm:max-w-[700px] h-[90vh] max-h-[850px] p-0 flex flex-col overflow-hidden z-[75]">
        {/* Header */}
        <DialogHeader className="px-6 pt-6 pb-4 border-b flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0 pr-8">
            <FlaskConical className="h-5 w-5 text-cyan-500 dark:text-cyan-400 flex-shrink-0" />
            <DialogTitle className="text-lg truncate">
              {wizard.state.productName || initialData?.nom_produit || "Nouveau Produit"}
            </DialogTitle>
            {supplierName && (
              <span className="text-sm text-muted-foreground flex-shrink-0">— {supplierName}</span>
            )}
            <Badge
              variant="outline"
              className="bg-cyan-50 dark:bg-cyan-950/30 text-cyan-700 dark:text-cyan-300 border-cyan-300 dark:border-cyan-700 flex-shrink-0"
            >
              V3
            </Badge>
          </div>
          <DialogDescription className="text-cyan-600 dark:text-cyan-400 font-medium text-sm">
            Assistant de configuration produit
          </DialogDescription>

          {/* Step shortcuts */}
          <div className="mt-4 flex items-center gap-1 flex-wrap">
            {([1, 2, 3, 4, 5] as const).map((step) => {
              const isCurrent = wizard.state.currentStep === step;
              const isVisited = step < wizard.state.currentStep;
              return (
                <button
                  key={step}
                  type="button"
                  onClick={() => wizard.goToStep(step)}
                  className={cn(
                    "px-2.5 py-1 rounded-md text-xs font-medium transition-colors truncate max-w-[120px]",
                    isCurrent
                      ? "bg-primary text-primary-foreground"
                      : isVisited
                        ? "bg-muted text-foreground hover:bg-muted/80 cursor-pointer"
                        : "bg-muted/40 text-muted-foreground hover:bg-muted/60 cursor-pointer"
                  )}
                >
                  {step}. {stepLabels[step]}
                </button>
              );
            })}
          </div>
          <Progress value={progressPercent} className="h-1.5 mt-2" />
        </DialogHeader>

        {/* Content */}
        <div className="flex-1 overflow-hidden relative">
          {isSubmitting && (
            <div className="absolute inset-0 bg-background/80 flex items-center justify-center z-50">
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <span className="text-sm text-muted-foreground">Enregistrement...</span>
              </div>
            </div>
          )}

          {wizard.state.currentStep === 1 && (
            <WizardStepIdentity
              productName={wizard.state.productName}
              productCode={wizard.state.productCode}
              supplierId={wizard.state.identitySupplierId}
              supplierLocked={isConfigureOnly}
              onProductNameChange={wizard.setProductName}
              onProductCodeChange={wizard.setProductCode}
              onSupplierIdChange={wizard.setIdentitySupplierId}
              onNext={wizard.goNext}
              canProceed={wizard.canProceedIdentity}
            />
          )}

          {wizard.state.currentStep === 2 && (
            <WizardStepStructure
              finalUnit={wizard.state.finalUnit}
              finalUnitId={wizard.state.finalUnitId}
              onFinalUnitChange={wizard.setFinalUnit}
              hasPackaging={wizard.state.hasPackaging}
              packagingLevels={wizard.state.packagingLevels}
              onHasPackagingChange={wizard.setHasPackaging}
              onAddLevel={wizard.addPackagingLevel}
              onRemoveLevel={wizard.removePackagingLevel}
              onUpdateLevel={wizard.updatePackagingLevel}
              onNext={wizard.goNext}
              onBack={wizard.goBack}
              canProceed={wizard.canProceedStructure}
            />
          )}

          {wizard.state.currentStep === 3 && (
            <WizardStep3
              finalUnit={wizard.state.finalUnit}
              finalUnitId={wizard.state.finalUnitId}
              packagingLevels={wizard.state.packagingLevels}
              billedQuantity={wizard.state.billedQuantity}
              billedUnit={wizard.state.billedUnit}
              billedUnitId={wizard.state.billedUnitId}
              lineTotal={wizard.state.lineTotal}
              priceDisplayUnitId={wizard.state.priceDisplayUnitId}
              onBilledQuantityChange={wizard.setBilledQuantity}
              onBilledUnitChange={wizard.setBilledUnit}
              onLineTotalChange={wizard.setLineTotal}
              onPriceDisplayUnitChange={wizard.setPriceDisplayUnit}
              onNext={wizard.goNext}
              onBack={wizard.goBack}
              canProceed={wizard.canProceedStep3}
            />
          )}

          {wizard.state.currentStep === 4 && (
            <WizardStep5Stock
              category={wizard.state.category}
              categoryId={wizard.state.categoryId}
              storageZoneId={wizard.state.storageZoneId}
              minStockQuantity={wizard.state.minStockQuantity}
              minStockUnitId={wizard.state.minStockUnitId}
              initialStockQuantity={wizard.state.initialStockQuantity}
              initialStockUnitId={wizard.state.initialStockUnitId}
              barcode={wizard.state.barcode}
              dlcWarningDays={wizard.state.dlcWarningDays}
              finalUnitId={wizard.state.finalUnitId}
              packagingLevels={wizard.state.packagingLevels}
              onCategoryChange={wizard.setCategory}
              onStorageZoneIdChange={wizard.setStorageZoneId}
              onMinStockQuantityChange={wizard.setMinStockQuantity}
              onMinStockUnitIdChange={wizard.setMinStockUnitId}
              onInitialStockQuantityChange={wizard.setInitialStockQuantity}
              onInitialStockUnitIdChange={wizard.setInitialStockUnitId}
              onBarcodeChange={wizard.setBarcode}
              onDlcWarningDaysChange={wizard.setDlcWarningDays}
              canProceed={wizard.canProceedStep4}
              onNext={wizard.goNext}
              onBack={wizard.goBack}
              isEditMode={isEditConditioning}
              wizardState={wizard.state}
              effectiveStockHandlingUnitId={effectiveStockHandlingUnitId}
              effectiveDeliveryUnitId={effectiveDeliveryUnitId}
              equivalenceObject={wizard.equivalenceObject}
              conditioningConfig={buildConditioningConfig()}
              existingInputConfig={existingInputConfig ?? null}
              onInputConfigReceptionChange={wizard.setInputConfigReception}
              onInputConfigInternalChange={wizard.setInputConfigInternal}
              onAllowUnitSaleChange={wizard.setAllowUnitSale}
            />
          )}

          {wizard.state.currentStep === 5 && (
            <WizardStepSummary
              finalUnit={wizard.state.finalUnit}
              finalUnitId={wizard.state.finalUnitId}
              packagingLevels={wizard.state.packagingLevels}
              billedQuantity={wizard.state.billedQuantity}
              billedUnit={wizard.state.billedUnit}
              billedUnitId={wizard.state.billedUnitId}
              lineTotal={wizard.state.lineTotal}
              priceLevel={effectivePriceLevel}
              deliveryUnitId={effectiveDeliveryUnitId}
              stockHandlingUnitId={effectiveStockHandlingUnitId}
              priceDisplayUnitId={wizard.state.priceDisplayUnitId}
              calculationResult={calculationResult}
              category={wizard.state.category}
              categoryId={wizard.state.categoryId}
              onCategoryChange={wizard.setCategory}
              onDeliveryUnitChange={wizard.setDeliveryUnit}
              
              onPriceDisplayUnitChange={wizard.setPriceDisplayUnit}
              onBack={wizard.goBack}
              onGoToStep={wizard.goToStep}
              onValidate={handleValidate}
              onNextProduct={handleNextProduct}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>

    {/* ── PHASE D: Family change confirmation dialog ── */}
    <AlertDialog open={showFamilyChangeWarning} onOpenChange={setShowFamilyChangeWarning}>
      <AlertDialogContent className="z-[200]">
        <AlertDialogHeader>
          <AlertDialogTitle>Changement de famille d'unité</AlertDialogTitle>
          <AlertDialogDescription className="space-y-2">
            <p>
              Ce changement rend certains mouvements historiques incompatibles avec la nouvelle unité.
            </p>
             <p>
               Après validation, ces mouvements seront ignorés dans le calcul du stock.
               Le stock sera réinitialisé à 0 — utilisez « Modifier » pour ajuster.
             </p>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => {
            pendingSubmitRef.current = null;
          }}>
            Annuler
          </AlertDialogCancel>
          <AlertDialogAction onClick={async () => {
            setShowFamilyChangeWarning(false);
            if (pendingSubmitRef.current) {
              await pendingSubmitRef.current();
              pendingSubmitRef.current = null;
            }
          }}>
            Valider et appliquer
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}

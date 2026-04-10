/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PRODUCT FORM V3 — WIZARD STATE HOOK (Nizar B)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 5 étapes (après suppression Gestion):
 * 1. Identité
 * 2. Structure & Conditionnement (unité ref + packaging)
 * 3. Facturation (invoice data + price display unit)
 * 4. Zone & Stock
 * 5. Résumé intelligent
 *
 * NOTE: Equivalence (hasEquivalence, equivalenceQuantity, equivalenceUnit,
 * equivalenceUnitId) removed — wizard no longer supports equivalence input.
 * Existing products with equivalence in DB are unaffected (read-only).
 */

import { useState, useCallback, useMemo } from "react";
import type { WizardState, WizardStep, ProductV3InitialData, PriceLevelOption } from "./types";
import type { PackagingLevel, PriceLevel } from "@/modules/conditionnementV2";
import { generateLevelId } from "@/modules/conditionnementV2";
import { autoDeducePriceLevel, buildPriceLevelOptions } from "@/modules/produitsV2/pipeline/resolveProductDerived";

const INITIAL_STATE: WizardState = {
  currentStep: 1,
  productName: "",
  productCode: "",
  identitySupplierId: null,
  finalUnit: null,
  finalUnitId: null,
  hasPackaging: false,
  packagingLevels: [],
  billedQuantity: "",
  billedUnit: "",
  billedUnitId: null,
  lineTotal: "",
  priceLevel: null,
  deliveryUnitId: null,
  stockHandlingUnitId: null,
  priceDisplayUnitId: null,
  category: "",
  categoryId: null,
  storageZoneId: null,
  minStockQuantity: "",
  minStockUnitId: null,
  initialStockQuantity: "0",
  initialStockUnitId: null,
  barcode: "",
  dlcWarningDays: "",
  inputConfigReceptionMode: null,
  inputConfigReceptionUnitId: null,
  inputConfigReceptionChain: null,
  inputConfigReceptionPartial: false,
  inputConfigInternalMode: null,
  inputConfigInternalUnitId: null,
  inputConfigInternalChain: null,
  inputConfigInternalPartial: false,
  allowUnitSale: false,
};

export function useWizardState(initialData: ProductV3InitialData | null) {
  const [state, setState] = useState<WizardState>(() => {
    if (!initialData) return INITIAL_STATE;

    return {
      ...INITIAL_STATE,
      productName: initialData.nom_produit ?? "",
      productCode: initialData.code_produit ?? "",
      billedQuantity: initialData.quantite_commandee?.toString() ?? "",
      lineTotal: initialData.prix_total_ligne?.toString() ?? "",
      billedUnit: initialData.unite_facturee ?? "",
      billedUnitId: initialData.unite_facturee_id ?? null,
      category: initialData.vai_category ?? "",
      categoryId: initialData.vai_category_id ?? null,
      // ── Management units (prefill from supplier catalog) ──
      deliveryUnitId: initialData.delivery_unit_id ?? null,
      stockHandlingUnitId: initialData.stock_handling_unit_id ?? null,
      priceDisplayUnitId: initialData.price_display_unit_id ?? null,
      // ── Stock & classification ──
      storageZoneId: initialData.storage_zone_id ?? null,
      minStockQuantity: initialData.min_stock_quantity_canonical?.toString() ?? "",
      minStockUnitId: initialData.min_stock_unit_id ?? null,
      initialStockQuantity: "0",
      initialStockUnitId: null,
      barcode: initialData.barcode ?? "",
      dlcWarningDays: initialData.dlc_warning_days != null ? initialData.dlc_warning_days.toString() : "",
      allowUnitSale: initialData.allow_unit_sale ?? false,
    };
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // NAVIGATION
  // ═══════════════════════════════════════════════════════════════════════════

  const goToStep = useCallback((step: WizardStep) => {
    setState((prev) => ({ ...prev, currentStep: step }));
  }, []);

  const goNext = useCallback(() => {
    setState((prev) => {
      const nextStep = Math.min(prev.currentStep + 1, 5) as WizardStep;
      const updates: Partial<typeof prev> = { currentStep: nextStep };

      // Pre-fill billedUnit with finalUnit when entering step 3 (billing) if empty
      if (
        nextStep === 3 &&
        (!prev.billedUnit || !prev.billedUnitId) &&
        prev.finalUnit &&
        prev.finalUnitId
      ) {
        updates.billedUnit = prev.finalUnit;
        updates.billedUnitId = prev.finalUnitId;
      }

      return { ...prev, ...updates };
    });
  }, []);

  const goBack = useCallback(() => {
    setState((prev) => ({
      ...prev,
      currentStep: Math.max(prev.currentStep - 1, 1) as WizardStep,
    }));
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // ÉTAPE 1 — IDENTITÉ
  // ═══════════════════════════════════════════════════════════════════════════

  const setProductName = useCallback((value: string) => {
    setState((prev) => ({ ...prev, productName: value }));
  }, []);

  const setProductCode = useCallback((value: string) => {
    setState((prev) => ({ ...prev, productCode: value }));
  }, []);

  const setIdentitySupplierId = useCallback((value: string | null) => {
    setState((prev) => ({ ...prev, identitySupplierId: value }));
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // ÉTAPE 2 — STRUCTURE
  // ═══════════════════════════════════════════════════════════════════════════

  const setFinalUnit = useCallback((unit: string | null, unitId: string | null = null) => {
    setState((prev) => ({
      ...prev,
      finalUnit: unit,
      finalUnitId: unitId,
    }));
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // ÉTAPE 2 — CONDITIONNEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  const setHasPackaging = useCallback((value: boolean) => {
    setState((prev) => ({
      ...prev,
      hasPackaging: value,
      packagingLevels: value ? prev.packagingLevels : [],
    }));
  }, []);

  const addPackagingLevel = useCallback(() => {
    setState((prev) => {
      const previousLevel = prev.packagingLevels[prev.packagingLevels.length - 1];
      const autoType = previousLevel?.containsUnit || "";
      const autoTypeUnitId = previousLevel?.contains_unit_id || null;

      return {
        ...prev,
        packagingLevels: [
          ...prev.packagingLevels,
          {
            id: generateLevelId(),
            type: autoType,
            type_unit_id: autoTypeUnitId,
            containsQuantity: null,
            containsUnit: prev.finalUnit ?? "",
            contains_unit_id: prev.finalUnitId ?? null,
          },
        ],
      };
    });
  }, []);

  const removePackagingLevel = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      packagingLevels: prev.packagingLevels.filter((l) => l.id !== id),
      priceLevel: prev.priceLevel?.levelId === id ? null : prev.priceLevel,
    }));
  }, []);

  const updatePackagingLevel = useCallback((id: string, updates: Partial<PackagingLevel>) => {
    setState((prev) => {
      const levels = [...prev.packagingLevels];
      const idx = levels.findIndex((l) => l.id === id);
      if (idx === -1) return prev;

      levels[idx] = { ...levels[idx], ...updates };

      // Cascade: update next level's locked Type
      if (updates.containsUnit !== undefined || updates.contains_unit_id !== undefined) {
        const nextIdx = idx + 1;
        if (nextIdx < levels.length) {
          levels[nextIdx] = {
            ...levels[nextIdx],
            type: levels[idx].containsUnit || "",
            type_unit_id: levels[idx].contains_unit_id || null,
          };
        }
      }

      return { ...prev, packagingLevels: levels };
    });
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // ÉTAPE 3 — FACTURATION
  // ═══════════════════════════════════════════════════════════════════════════

  const setBilledQuantity = useCallback((value: string) => {
    setState((prev) => ({ ...prev, billedQuantity: value }));
  }, []);

  const setBilledUnit = useCallback((value: string, unitId: string | null = null) => {
    setState((prev) => ({ ...prev, billedUnit: value, billedUnitId: unitId }));
  }, []);

  const setLineTotal = useCallback((value: string) => {
    setState((prev) => ({ ...prev, lineTotal: value }));
  }, []);

  const setPriceLevel = useCallback((value: PriceLevel | null) => {
    setState((prev) => ({ ...prev, priceLevel: value }));
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // MANAGEMENT UNITS (delivery, stock, price display)
  // ═══════════════════════════════════════════════════════════════════════════

  const setDeliveryUnit = useCallback((unitId: string | null) => {
    setState((prev) => ({ ...prev, deliveryUnitId: unitId }));
  }, []);

  // setStockHandlingUnit removed (C7): value is 100% auto-calculated by pipeline resolvers

  const setPriceDisplayUnit = useCallback((unitId: string | null) => {
    setState((prev) => ({ ...prev, priceDisplayUnitId: unitId }));
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // AUTO-DEDUCED PRICE LEVEL
  // ═══════════════════════════════════════════════════════════════════════════

  const autoDeducedPriceLevel = useMemo((): PriceLevel | null => {
    return autoDeducePriceLevel({
      billedUnit: state.billedUnit,
      billedUnitId: state.billedUnitId,
      finalUnit: state.finalUnit,
      finalUnitId: state.finalUnitId,
      packagingLevels: state.packagingLevels,
    });
  }, [
    state.billedUnit,
    state.billedUnitId,
    state.packagingLevels,
    state.finalUnit,
    state.finalUnitId,
  ]);

  // ═══════════════════════════════════════════════════════════════════════════
  // PRICE LEVEL OPTIONS — delegated to pipeline (PR-6)
  // ═══════════════════════════════════════════════════════════════════════════

  const priceLevelOptions = useMemo((): PriceLevelOption[] => {
    return buildPriceLevelOptions({
      packagingLevels: state.packagingLevels,
      finalUnit: state.finalUnit,
      finalUnitId: state.finalUnitId,
      hasEquivalence: null,
      equivalenceQuantity: "",
      equivalenceUnit: "",
      autoDeduced: autoDeducedPriceLevel,
    });
  }, [
    state.packagingLevels,
    state.finalUnit,
    state.finalUnitId,
    autoDeducedPriceLevel,
  ]);

  // ═══════════════════════════════════════════════════════════════════════════
  // RESET
  // ═══════════════════════════════════════════════════════════════════════════

  const reset = useCallback(
    (
      newInitialData?: ProductV3InitialData | null,
      existingConfig?: import("@/modules/produitsV2/types").ConditioningConfig | null,
      initialSupplierId?: string | null
    ) => {
      if (newInitialData) {
        const baseState: WizardState = {
          ...INITIAL_STATE,
          // ── Step 1: Identity ──
          productName: newInitialData.nom_produit ?? "",
          productCode: newInitialData.code_produit ?? "",
          identitySupplierId: initialSupplierId ?? null,
          billedQuantity: newInitialData.quantite_commandee?.toString() ?? "",
          lineTotal: newInitialData.prix_total_ligne?.toString() ?? "",
          billedUnit: newInitialData.unite_facturee ?? "",
          billedUnitId: newInitialData.unite_facturee_id ?? null,
          category: newInitialData.vai_category ?? "",
          categoryId: newInitialData.vai_category_id ?? null,
          // ── Restore management units from product ──
          deliveryUnitId: newInitialData.delivery_unit_id ?? null,
          stockHandlingUnitId: newInitialData.stock_handling_unit_id ?? null,
          priceDisplayUnitId: newInitialData.price_display_unit_id ?? null,
          // ── Restore stock & classification from product ──
          storageZoneId: newInitialData.storage_zone_id ?? null,
          minStockQuantity:
            newInitialData.min_stock_quantity_canonical != null
              ? newInitialData.min_stock_quantity_canonical.toString()
              : "",
          minStockUnitId: newInitialData.min_stock_unit_id ?? null,
          initialStockQuantity: "0",
          initialStockUnitId: null,
          barcode: newInitialData.barcode ?? "",
          dlcWarningDays: newInitialData.dlc_warning_days != null ? newInitialData.dlc_warning_days.toString() : "",
          allowUnitSale: newInitialData.allow_unit_sale ?? false,
        };

        if (existingConfig) {
          if (existingConfig.finalUnit) {
            baseState.finalUnit = existingConfig.finalUnit;
            baseState.finalUnitId = existingConfig.final_unit_id ?? null;
          }

          if (existingConfig.packagingLevels && existingConfig.packagingLevels.length > 0) {
            baseState.hasPackaging = true;
            baseState.packagingLevels = existingConfig.packagingLevels;
          }

          // NOTE: equivalence from existingConfig is ignored — wizard no longer
          // supports equivalence input. Existing DB equivalence data is preserved
          // as-is (read-only).

          if (existingConfig.priceLevel) {
            baseState.priceLevel = existingConfig.priceLevel;
          }

          // ⚠️ RÈGLE UNIVERSELLE PRIX: ne JAMAIS pré-remplir lineTotal ou billedQuantity
          // avec des valeurs reconstruites/calculées. Seules les données brutes persistées
          // (supplier_billing_line_total / supplier_billing_quantity) sont autorisées.
          // Les produits legacy sans ces champs afficheront des champs vides → re-saisie obligatoire.
        }

        setState(baseState);
      } else {
        setState(INITIAL_STATE);
      }
    },
    []
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORY & ZONE & STOCK
  // ═══════════════════════════════════════════════════════════════════════════

  const setCategory = useCallback((value: string, id?: string | null) => {
    setState((prev) => ({ ...prev, category: value, categoryId: id ?? prev.categoryId }));
  }, []);

  const setStorageZoneId = useCallback((value: string | null) => {
    setState((prev) => ({ ...prev, storageZoneId: value }));
  }, []);

  const setMinStockQuantity = useCallback((value: string) => {
    setState((prev) => ({ ...prev, minStockQuantity: value }));
  }, []);

  const setMinStockUnitId = useCallback((value: string | null) => {
    setState((prev) => ({ ...prev, minStockUnitId: value }));
  }, []);

  const setInitialStockQuantity = useCallback((value: string) => {
    setState((prev) => ({ ...prev, initialStockQuantity: value }));
  }, []);

  const setInitialStockUnitId = useCallback((value: string | null) => {
    setState((prev) => ({ ...prev, initialStockUnitId: value }));
  }, []);

  const setBarcode = useCallback((value: string) => {
    setState((prev) => ({ ...prev, barcode: value }));
  }, []);

  const setDlcWarningDays = useCallback((value: string) => {
    setState((prev) => ({ ...prev, dlcWarningDays: value }));
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // INPUT CONFIG (saisie réception + interne)
  // ═══════════════════════════════════════════════════════════════════════════

  const setInputConfigReception = useCallback(
    (mode: import("@/modules/inputConfig").InputMode | null, unitId: string | null, chain: string[] | null, partial: boolean) => {
      setState((prev) => ({
        ...prev,
        inputConfigReceptionMode: mode,
        inputConfigReceptionUnitId: unitId,
        inputConfigReceptionChain: chain,
        inputConfigReceptionPartial: partial,
      }));
    },
    []
  );

  const setInputConfigInternal = useCallback(
    (mode: import("@/modules/inputConfig").InputMode | null, unitId: string | null, chain: string[] | null, partial: boolean) => {
      setState((prev) => ({
        ...prev,
        inputConfigInternalMode: mode,
        inputConfigInternalUnitId: unitId,
        inputConfigInternalChain: chain,
        inputConfigInternalPartial: partial,
      }));
    },
    []
  );




  // ═══════════════════════════════════════════════════════════════════════════
  // ALLOW UNIT SALE (Supplier Unit V1)
  // ═══════════════════════════════════════════════════════════════════════════

  const setAllowUnitSale = useCallback((value: boolean) => {
    setState((prev) => ({ ...prev, allowUnitSale: value }));
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // VALIDATION
  // ═══════════════════════════════════════════════════════════════════════════

  const canProceedIdentity = !!state.productName.trim() && !!state.identitySupplierId;

  // Step 2 — Structure & Conditionnement: finalUnitId + packaging
  const canProceedStructure =
    !!state.finalUnit &&
    !!state.finalUnitId &&
    (!state.hasPackaging ||
      (state.packagingLevels.length > 0 &&
        state.packagingLevels.every(
          (l) =>
            l.type &&
            l.type_unit_id &&
            l.containsQuantity !== null &&
            l.containsQuantity > 0 &&
            l.containsUnit &&
            l.contains_unit_id &&
            l.type_unit_id !== l.contains_unit_id
        ) &&
        new Set(state.packagingLevels.map((l) => l.type_unit_id)).size ===
          state.packagingLevels.length));

  const canProceedStep3 = !!state.billedQuantity && !!state.billedUnit && !!state.lineTotal;

  // Step 4: Zone & Stock — category + zone mandatory, min stock optional
  const minQtyParsed = parseFloat(state.minStockQuantity);
  const minStockValid =
    !state.minStockQuantity ||                          // empty = optional, OK
    (!!state.minStockQuantity && !isNaN(minQtyParsed) && minQtyParsed >= 0 &&
      (minQtyParsed === 0 || !!state.minStockUnitId));  // unit required only if qty > 0
  const canProceedStep4 =
    !!state.categoryId &&
    !!state.storageZoneId &&
    minStockValid;

  return {
    state,

    // Navigation
    goToStep,
    goNext,
    goBack,

    // Validation
    canProceedIdentity,
    canProceedStructure,
    canProceedStep3,
    canProceedStep4,

    // Identity (Step 1)
    setProductName,
    setProductCode,
    setIdentitySupplierId,

    // Structure (Step 2)
    setFinalUnit,

    // Packaging (Step 2)
    setHasPackaging,
    addPackagingLevel,
    removePackagingLevel,
    updatePackagingLevel,

    // Billing (Step 3)
    setBilledQuantity,
    setBilledUnit,
    setLineTotal,
    setPriceLevel,
    priceLevelOptions,

    // Management units
    setDeliveryUnit,
    setPriceDisplayUnit,

    // Zone & Stock (Step 4)
    setCategory,
    setStorageZoneId,
    setMinStockQuantity,
    setMinStockUnitId,
    setInitialStockQuantity,
    setInitialStockUnitId,
    setBarcode,
    setDlcWarningDays,

    // Input config (saisie)
    setInputConfigReception,
    setInputConfigInternal,


    // Supplier Unit V1
    setAllowUnitSale,

    // Engine — equivalenceObject always null (equivalence removed from wizard)
    equivalenceObject: null as import("@/modules/conditionnementV2").Equivalence | null,
    autoDeducedPriceLevel,

    // Reset
    reset,
  };
}

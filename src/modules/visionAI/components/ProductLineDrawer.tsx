/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PRODUCT LINE DRAWER — Fiche Produit V2 + Conditionnement V3 + Correction Facture (Session)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Drawer unifié ouvert au clic sur une ligne du tableau d'extraction.
 *
 * SECTION A: Fiche produit V2 (persistée DB via useProductV2Mutations)
 *   → Même chemin SSOT que la page Produits et le V3 Wizard
 *   → Pour produit reconnu: update via matchedProductId
 *   → Pour produit NON reconnu: upsert (création) via supplier_id
 *
 * SECTION B: Conditionnement — bouton "Assistant V3" (edit_conditioning)
 *   → Ouvre le Wizard V3 en mode edit_conditioning
 *   → productId obligatoire, aucune création
 *   → À la fermeture: refetch + recalcul statut/prix
 *
 * SECTION C: Données facture (session-only)
 *   → quantite_commandee + prix_total_ligne → lineCorrections
 *   → Jamais persisté en DB
 *
 * ROLLBACK: Supprimer ce fichier + handlers dans ExtractedProductsModal
 */

import { useState, useEffect, useCallback } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Save, Loader2, AlertCircle, Gift, Package, Plus, Wand2, MapPin } from "lucide-react";
import {
  useProductV2,
  useProductV2Mutations,
  useProductCategories,
  useStorageZones,
} from "@/modules/produitsV2";
import type { ProductV2FormData, ConditioningConfig } from "@/modules/produitsV2";
import { toast } from "sonner";
import { ProductFormV3Modal } from "./ProductFormV3/ProductFormV3Modal";
import { useUnits } from "@/hooks/useUnits";
import { useUnitConversions } from "@/core/unitConversion";

// ═══════════════════════════════════════════════════════════════════════════
// PROPS
// ═══════════════════════════════════════════════════════════════════════════

interface ProductLineDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** ID of the matched product in products_v2 (null = unmatched line) */
  matchedProductId: string | null;
  /** Extracted product name (for display when unmatched) */
  extractedName: string;
  /** Extracted product code (for pre-fill when unmatched) */
  extractedCode: string | null;
  /** Supplier ID from validated invoice header (required for creation) */
  supplierId: string | null;
  /** Supplier name for V3 wizard display */
  supplierName?: string | null;
  /** Current invoice quantity (raw or corrected) */
  currentQuantite: number | null;
  /** Current invoice total (raw or corrected) */
  currentMontant: number | null;
  /** Is line marked as free? */
  isFreeLine: boolean;
  /** Callback to apply invoice corrections (session-only) */
  onApplyInvoiceCorrection: (
    quantite: number | null,
    montant: number | null,
    isFreeLine: boolean
  ) => void;
  /** Callback after product V2 is saved (to trigger refetchStatuses + auto-link) */
  onProductSaved: (createdProductId?: string) => void;
  /** Callback to open suggestions panel (for unmatched products) */
  onOpenSuggestions?: () => void;
}

const EMPTY_FORM: ProductV2FormData = {
  code_produit: "",
  code_barres: "",
  nom_produit: "",
  nom_produit_fr: "",
  variant_format: "",
  category: "",
  category_id: "",
  supplier_id: "",
  supplier_billing_unit_id: "",
  storage_zone_id: "",
  conditionnement_config: null,
  conditionnement_resume: "",
  final_unit_price: "",
  final_unit_id: "",
  stock_handling_unit_id: "",
  kitchen_unit_id: "",
  delivery_unit_id: "",
  price_display_unit_id: "",
  info_produit: "",
};

/** Resolve unit label from UUID via measurement_units */
function resolveUnitLabel(
  unitId: string | null | undefined,
  units: Array<{ id: string; name: string; abbreviation: string }>
): string | null {
  if (!unitId) return null;
  const u = units.find((unit) => unit.id === unitId);
  return u ? u.name : null;
}

export function ProductLineDrawer({
  open,
  onOpenChange,
  matchedProductId,
  extractedName,
  extractedCode,
  supplierId,
  supplierName,
  currentQuantite,
  currentMontant,
  isFreeLine: initialIsFreeLine,
  onApplyInvoiceCorrection,
  onProductSaved,
  onOpenSuggestions,
}: ProductLineDrawerProps) {
  // ═══════════════════════════════════════════════════════════════════════════
  // PRODUCT V2 (persisted) — Same SSOT as Products page
  // ═══════════════════════════════════════════════════════════════════════════
  const {
    product,
    isLoading: isLoadingProduct,
    refetch: refetchProduct,
  } = useProductV2(matchedProductId);
  const { update, upsert } = useProductV2Mutations();
  const { categories, categoryNames: availableCategories } =
    useProductCategories();
  const { zones: storageZones } = useStorageZones();
  const { units: dbUnits } = useUnits();
  const { units: _convUnits, conversions: _dbConversions } = useUnitConversions();

  const isMatched = !!matchedProductId;
  const isExistingProduct = isMatched;
  const [formData, setFormData] = useState<ProductV2FormData>(EMPTY_FORM);
  const [isDirty, setIsDirty] = useState(false);

  // ═══════════════════════════════════════════════════════════════════════════
  // V3 WIZARD STATE — Mode edit_conditioning uniquement
  // ═══════════════════════════════════════════════════════════════════════════
  const [v3WizardOpen, setV3WizardOpen] = useState(false);
  // Min stock from wizard configure_only (not in ProductV2FormData)
  const [wizardMinStock, setWizardMinStock] = useState<{
    quantity: number | null;
    unitId: string | null;
  }>({ quantity: null, unitId: null });

  // ═══════════════════════════════════════════════════════════════════════════
  // INVOICE CORRECTIONS (session-only) — never persisted
  // ═══════════════════════════════════════════════════════════════════════════
  const [editedQuantite, setEditedQuantite] = useState("");
  const [editedMontant, setEditedMontant] = useState("");
  const [markedAsFree, setMarkedAsFree] = useState(false);
  const [invoiceDirty, setInvoiceDirty] = useState(false);

  // Populate product form when matched product loads
  useEffect(() => {
    if (product) {
      setFormData({
        code_produit: product.code_produit ?? "",
        code_barres: product.code_barres ?? "",
        nom_produit: product.nom_produit,
        nom_produit_fr: product.nom_produit_fr ?? "",
        variant_format: product.variant_format ?? "",
        category: product.category ?? "",
        category_id: product.category_id ?? "",
        supplier_id: product.supplier_id ?? "",
        supplier_billing_unit_id: product.supplier_billing_unit_id ?? "",
        storage_zone_id: product.storage_zone_id ?? "",
        conditionnement_config: product.conditionnement_config,
        conditionnement_resume: product.conditionnement_resume ?? "",
        final_unit_price: product.final_unit_price?.toString() ?? "",
        final_unit_id: product.final_unit_id ?? "",
        stock_handling_unit_id: product.stock_handling_unit_id ?? "",
        kitchen_unit_id: product.kitchen_unit_id ?? "",
        delivery_unit_id: product.delivery_unit_id ?? "",
        price_display_unit_id: product.price_display_unit_id ?? "",
        info_produit: product.info_produit ?? "",
      });
      setIsDirty(false);
    }
  }, [product]);

  // Pre-fill form for unmatched products from extracted data
  useEffect(() => {
    if (open && !isMatched) {
      setFormData({
        ...EMPTY_FORM,
        nom_produit: extractedName || "",
        code_produit: extractedCode || "",
        supplier_id: supplierId || "",
      });
      setIsDirty(false);
    }
  }, [open, isMatched, extractedName, extractedCode, supplierId]);

  // Populate invoice corrections ONLY when drawer opens (false→true transition)
  const [prevOpen, setPrevOpen] = useState(false);
  useEffect(() => {
    if (open && !prevOpen) {
      setEditedQuantite(currentQuantite?.toString() ?? "");
      setEditedMontant(currentMontant?.toString() ?? "");
      setMarkedAsFree(initialIsFreeLine);
      setInvoiceDirty(false);
    }
    setPrevOpen(open);
  }, [open, prevOpen, currentQuantite, currentMontant, initialIsFreeLine]);

  const handleChange = (field: keyof ProductV2FormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setIsDirty(true);
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // SAVE PRODUCT V2 — UPDATE (matched) or UPSERT/CREATE (unmatched)
  // Same mutations as Products page (SSOT)
  // ═══════════════════════════════════════════════════════════════════════════
  const handleSaveProduct = useCallback(async () => {
    if (!formData.nom_produit.trim()) return;
    if (!formData.supplier_id) {
      toast.error("Fournisseur obligatoire pour enregistrer le produit");
      return;
    }
    if (!formData.storage_zone_id?.trim()) {
      toast.error("Zone de stockage obligatoire");
      return;
    }

    try {
      if (isMatched && matchedProductId) {
        // UPDATE existing product
        await update.mutateAsync({ id: matchedProductId, formData });
        await refetchProduct();
        toast.success("Fiche produit mise à jour");
        setIsDirty(false);
        onProductSaved();
        onOpenChange(false);
      } else {
        // CREATE via upsert (same SSOT path as V3 Wizard)
        const result = await upsert.mutateAsync({
          nom_produit: formData.nom_produit.trim().toUpperCase(),
          code_produit: formData.code_produit.trim() || null,
          code_barres: formData.code_barres.trim() || null,
          nom_produit_fr: formData.nom_produit_fr.trim() || null,
          // category text intentionally omitted — SSOT is category_id via formData.category_id
          supplier_id: formData.supplier_id,
          // SSOT: UUID only — no text writes for supplier_billing_unit / final_unit
          supplier_billing_unit_id: formData.supplier_billing_unit_id || null,
          storage_zone_id: formData.storage_zone_id?.trim() || null,
          conditionnement_config: formData.conditionnement_config ?? null,
          conditionnement_resume: formData.conditionnement_resume?.trim() || null,
          final_unit_price: formData.final_unit_price
            ? parseFloat(formData.final_unit_price)
            : null,
          final_unit_id: formData.final_unit_id || null,
          info_produit: formData.info_produit.trim() || null,
          // PHASE 1 FIX: Propagate 4 missing structural unit fields
          stock_handling_unit_id: formData.stock_handling_unit_id || null,
          delivery_unit_id: formData.delivery_unit_id || null,
          kitchen_unit_id: formData.kitchen_unit_id || null,
          price_display_unit_id: formData.price_display_unit_id || null,
          min_stock_quantity_canonical: wizardMinStock.quantity,
          min_stock_unit_id: wizardMinStock.unitId,
        });
        setIsDirty(false);
        // Pass created product ID back so parent can auto-link via confirmedMatches
        onProductSaved(result.product.id);
        onOpenChange(false);
      }
    } catch {
      // Error handled by mutation onError
    }
  }, [
    matchedProductId,
    isMatched,
    formData,
    update,
    upsert,
    refetchProduct,
    onProductSaved,
    onOpenChange,
    wizardMinStock.quantity,
    wizardMinStock.unitId,
  ]);

  // ═══════════════════════════════════════════════════════════════════════════
  // V3 WIZARD — Callback après sauvegarde conditionnement
  // Matched: refetch + recalcul | Unmatched: store in formData
  // ═══════════════════════════════════════════════════════════════════════════
  const handleV3ConditioningSaved = useCallback(() => {
    setV3WizardOpen(false);
    refetchProduct();
    onProductSaved(); // No productId = update only, not creation
  }, [refetchProduct, onProductSaved]);

  const handleV3ConfigureOnly = useCallback(
    (config: {
      conditionnement_config: ConditioningConfig | null;
      conditionnement_resume: string;
      supplier_billing_unit_id: string | null;
      final_unit_price: number | null;
      final_unit_id: string | null;
      delivery_unit_id?: string | null;
      price_display_unit_id?: string | null;
      stock_handling_unit_id?: string | null;
      kitchen_unit_id?: string | null;
      category?: string | null;
      storage_zone_id?: string | null;
      min_stock_quantity_canonical?: number | null;
      min_stock_unit_id?: string | null;
    }) => {
      setV3WizardOpen(false);
      setFormData((prev) => ({
        ...prev,
        conditionnement_config: config.conditionnement_config,
        conditionnement_resume: config.conditionnement_resume,
        supplier_billing_unit_id: config.supplier_billing_unit_id ?? "",
        final_unit_price: config.final_unit_price?.toString() ?? "",
        final_unit_id: config.final_unit_id ?? "",
        // PHASE 1 FIX: Propagate 4 missing structural unit fields
        stock_handling_unit_id: config.stock_handling_unit_id ?? prev.stock_handling_unit_id,
        delivery_unit_id: config.delivery_unit_id ?? prev.delivery_unit_id,
        kitchen_unit_id: config.kitchen_unit_id ?? prev.kitchen_unit_id,
        price_display_unit_id: config.price_display_unit_id ?? prev.price_display_unit_id,
        // Step 5 synchro — category, zone, min stock
        category: config.category ?? prev.category,
        storage_zone_id: config.storage_zone_id ?? prev.storage_zone_id,
      }));
      // Store min stock separately (not in ProductV2FormData type)
      if (
        config.min_stock_quantity_canonical !== undefined ||
        config.min_stock_unit_id !== undefined
      ) {
        setWizardMinStock({
          quantity: config.min_stock_quantity_canonical ?? null,
          unitId: config.min_stock_unit_id ?? null,
        });
      }
      setIsDirty(true);
    },
    []
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // APPLY INVOICE CORRECTION — Session-only, never persisted
  // ═══════════════════════════════════════════════════════════════════════════
  const parseNumeric = (val: string): number | null => {
    const trimmed = val.trim();
    if (trimmed === "") return null;
    const parsed = parseFloat(trimmed.replace(",", "."));
    return isNaN(parsed) ? null : parsed;
  };

  const handleApplyInvoice = useCallback(() => {
    const parsedQte = parseNumeric(editedQuantite);
    const parsedMnt = markedAsFree ? 0 : parseNumeric(editedMontant);

    onApplyInvoiceCorrection(parsedQte, parsedMnt, markedAsFree);
    setInvoiceDirty(false);
    toast.success("Correction facture appliquée (session)");
  }, [editedQuantite, editedMontant, markedAsFree, onApplyInvoiceCorrection]);

  const isSaving = update.isPending || upsert.isPending;

  // ═══════════════════════════════════════════════════════════════════════════
  // SHARED PRODUCT FORM — Same fields for matched & unmatched
  // ═══════════════════════════════════════════════════════════════════════════
  const renderProductForm = () => (
    <div className="space-y-4 pb-4">
      <div className="flex items-center gap-2">
        <Package className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium">Fiche produit</span>
      </div>

      {/* Nom produit — EN PREMIER */}
      <div className="space-y-1.5">
        <Label htmlFor="drawer-name" className="text-xs">
          Nom produit *
        </Label>
        <Input
          id="drawer-name"
          value={formData.nom_produit}
          onChange={(e) => handleChange("nom_produit", e.target.value)}
          className="h-8 text-sm"
        />
      </div>

      {/* Zone de stockage */}
      <div className="space-y-1.5">
        <Label className="text-xs flex items-center gap-1.5">
          <MapPin className="h-3.5 w-3.5" />
          Zone de stockage
        </Label>
        {isExistingProduct || Boolean(formData.storage_zone_id) ? (
          <Select
            value={formData.storage_zone_id || "__empty__"}
            onValueChange={(value) =>
              handleChange("storage_zone_id", value === "__empty__" ? "" : value)
            }
          >
            <SelectTrigger className="h-8 text-sm">
              <SelectValue placeholder="Sélectionner une zone" />
            </SelectTrigger>
            <SelectContent className="bg-background z-[100]">
              <SelectItem value="__empty__">— Aucune —</SelectItem>
              {storageZones.map((zone) => (
                <SelectItem key={zone.id} value={zone.id}>
                  {zone.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <div className="h-8 flex items-center px-3 text-xs text-muted-foreground bg-muted rounded-md border">
            Après création
          </div>
        )}
      </div>

      {/* Code produit / Code-barres sur 2 colonnes */}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="drawer-code" className="text-xs">
            Code produit
          </Label>
          <Input
            id="drawer-code"
            value={formData.code_produit}
            onChange={(e) => handleChange("code_produit", e.target.value)}
            placeholder="PRD-001"
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="drawer-barcode" className="text-xs">
            Code-barres
          </Label>
          <Input
            id="drawer-barcode"
            value={formData.code_barres}
            onChange={(e) => handleChange("code_barres", e.target.value)}
            placeholder="EAN13"
            className="h-8 text-sm"
          />
        </div>
      </div>

      {/* Catégorie / Unité fournisseur / Seuil minimum — 3 colonnes */}
      <div className="grid grid-cols-3 gap-2">
        <div className="space-y-1.5">
          <Label className="text-xs">
            Catégorie {!isMatched && <span className="text-destructive">*</span>}
          </Label>
          {isExistingProduct || Boolean(formData.category_id) ? (
            <Select
              value={formData.category_id || "__empty__"}
              onValueChange={(value) => {
                if (value === "__empty__") {
                  handleChange("category", "");
                  handleChange("category_id", "");
                } else {
                  const cat = categories.find((c) => c.id === value);
                  if (cat) {
                    handleChange("category", cat.name);
                    handleChange("category_id", cat.id);
                  }
                }
              }}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="Aucune" />
              </SelectTrigger>
              <SelectContent className="bg-background z-[100]">
                <SelectItem value="__empty__">— Aucune —</SelectItem>
                {categories.map((cat) => (
                  <SelectItem key={cat.id} value={cat.id}>
                    {cat.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <div className="h-8 flex items-center px-3 text-xs text-muted-foreground bg-muted rounded-md border">
              Après création
            </div>
          )}
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Unité fournisseur</Label>
          {isExistingProduct || Boolean(formData.supplier_billing_unit_id) ? (
            <Select
              value={formData.supplier_billing_unit_id || "__empty__"}
              onValueChange={(value) => {
                const uid = value === "__empty__" ? "" : value;
                handleChange("supplier_billing_unit_id", uid);
              }}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="Aucune" />
              </SelectTrigger>
              <SelectContent className="bg-background z-[100]">
                <SelectItem value="__empty__">— Aucune —</SelectItem>
                {dbUnits.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <div className="h-8 flex items-center px-3 text-xs text-muted-foreground bg-muted rounded-md border">
              Après création
            </div>
          )}
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Seuil minimum</Label>
          {wizardMinStock.quantity != null && wizardMinStock.unitId ? (
            <div className="h-8 flex items-center px-3 text-xs text-muted-foreground bg-muted/50 rounded-md border">
              {wizardMinStock.quantity}{" "}
              {resolveUnitLabel(wizardMinStock.unitId, dbUnits) ?? wizardMinStock.unitId}
            </div>
          ) : isExistingProduct && product ? (
            (() => {
              const hasConditioning = !!product.conditionnement_config;
              const minQty = product.min_stock_quantity_canonical;
              const minUnitId = product.min_stock_unit_id;
              if (!hasConditioning) {
                return (
                  <div className="h-8 flex items-center px-3 text-xs text-muted-foreground bg-muted rounded-md border">
                    Config. requise
                  </div>
                );
              }
              if (minQty != null && minUnitId) {
                const unitLabel = resolveUnitLabel(minUnitId, dbUnits) ?? minUnitId;
                const rounded = Math.round(minQty * 10000) / 10000;
                return (
                  <div className="h-8 flex items-center px-3 text-xs text-foreground bg-muted/50 rounded-md border">
                    {rounded} {unitLabel}
                  </div>
                );
              }
              return (
                <div className="h-8 flex items-center px-3 text-xs text-muted-foreground bg-muted rounded-md border">
                  Non défini
                </div>
              );
            })()
          ) : (
            <div className="h-8 flex items-center px-3 text-xs text-muted-foreground bg-muted rounded-md border">
              Après création
            </div>
          )}
        </div>
      </div>

      {/* Prix unitaire */}
      <div className="space-y-1.5">
        <Label htmlFor="drawer-price" className="text-xs">
          Prix unitaire final (€)
        </Label>
        <Input
          id="drawer-price"
          type="number"
          step="0.01"
          value={formData.final_unit_price}
          onChange={(e) => handleChange("final_unit_price", e.target.value)}
          placeholder="0.00"
          className="h-8 text-sm"
        />
      </div>

      {/* Traduction FR */}
      <div className="space-y-1.5">
        <Label htmlFor="drawer-name-fr" className="text-xs">
          Traduction FR
        </Label>
        <Input
          id="drawer-name-fr"
          value={formData.nom_produit_fr}
          onChange={(e) => handleChange("nom_produit_fr", e.target.value)}
          className="h-8 text-sm"
        />
      </div>

      {/* Search existing product button (unmatched only) */}
      {!isMatched && onOpenSuggestions && (
        <Button
          variant="outline"
          className="w-full"
          size="sm"
          onClick={() => {
            onOpenSuggestions();
            onOpenChange(false);
          }}
        >
          <Package className="h-4 w-4 mr-2" />
          Chercher un produit existant
        </Button>
      )}
    </div>
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION B: CONDITIONNEMENT — Résumé + bouton Assistant V3
  // Visible pour tous les produits (matchés ET non matchés)
  // ═══════════════════════════════════════════════════════════════════════════
  const renderConditioningSection = () => {
    const condConfig = isMatched
      ? (product?.conditionnement_config as ConditioningConfig | null)
      : formData.conditionnement_config;
    const condResume = isMatched
      ? product?.conditionnement_resume
      : formData.conditionnement_resume;
    const hasConditioning = !!condConfig;

    const displayFinalUnitPrice = isMatched
      ? product?.final_unit_price
      : formData.final_unit_price
        ? parseFloat(formData.final_unit_price)
        : null;
    // SSOT: resolve unit labels from UUID, never from legacy text fields
    const finalUnitId = isMatched ? product?.final_unit_id : formData.final_unit_id;
    const billingUnitId = isMatched
      ? product?.supplier_billing_unit_id
      : formData.supplier_billing_unit_id;
    const displayFinalUnitLabel = resolveUnitLabel(finalUnitId, dbUnits);
    const displayBillingUnitLabel = resolveUnitLabel(billingUnitId, dbUnits);

    return (
      <div className="space-y-3 pt-2">
        <div className="flex items-center gap-2">
          <Wand2 className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">Conditionnement</span>
          {hasConditioning ? (
            <Badge variant="secondary" className="text-[10px]">
              Configuré
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px] text-warning border-warning">
              {isMatched ? "À compléter" : "Obligatoire"}
            </Badge>
          )}
        </div>

        {/* Conditioning summary */}
        {condResume && (
          <p className="text-xs text-muted-foreground bg-muted/50 rounded-md p-2">{condResume}</p>
        )}

        {displayFinalUnitPrice != null && (
          <div className="text-xs text-muted-foreground">
            Prix unitaire final :{" "}
            <span className="font-medium text-foreground">
              {displayFinalUnitPrice.toFixed(4)} € / {displayFinalUnitLabel ?? "?"}
            </span>
          </div>
        )}

        {displayBillingUnitLabel && (
          <div className="text-xs text-muted-foreground">
            Unité facturation :{" "}
            <span className="font-medium text-foreground">{displayBillingUnitLabel}</span>
          </div>
        )}

        {/* Assistant V3 button — SINGLE ENTRY POINT for conditioning edits */}
        <Button
          variant="outline"
          className="w-full border-primary/50 text-primary hover:bg-primary/10"
          size="sm"
          onClick={() => setV3WizardOpen(true)}
        >
          <Wand2 className="h-4 w-4 mr-2" />
          {hasConditioning
            ? "Modifier le conditionnement (Assistant V3)"
            : "Configurer le conditionnement (Assistant V3)"}
        </Button>
      </div>
    );
  };

  // Build V3 initial data from current product/extracted data
  // SSOT: resolve billing unit label from UUID for display in wizard
  const billingUnitLabel = resolveUnitLabel(product?.supplier_billing_unit_id, dbUnits);
  const v3InitialData = {
    nom_produit: product?.nom_produit ?? extractedName ?? "",
    quantite_commandee: currentQuantite,
    prix_total_ligne: currentMontant,
    unite_facturee: billingUnitLabel ?? null,
    code_produit: product?.code_produit ?? extractedCode ?? null,
    info_produit: product?.info_produit ?? null,
    vai_category: null, // SSOT: resolved from vai_category_id only
    vai_category_id: product?.category_id ?? null,
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto z-[70]" overlayClassName="z-[70]">
          <SheetHeader className="pb-4">
            <SheetTitle className="text-base">
              {isMatched ? "Fiche produit" : "Nouveau produit"}
            </SheetTitle>
            <SheetDescription>
              {isMatched
                ? "Modifier la fiche produit (persisté) et corriger les données facture (session)."
                : "Complétez la fiche pour créer ce produit dans l'onglet Produits."}
            </SheetDescription>
          </SheetHeader>

          {/* ═══════════════════════════════════════════════════════════════════
              SECTION A: FICHE PRODUIT V2 (persisted)
              Same form for matched AND unmatched — SSOT unique
              ═══════════════════════════════════════════════════════════════════ */}
          {isMatched ? (
            isLoadingProduct ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : product ? (
              renderProductForm()
            ) : (
              <p className="text-sm text-muted-foreground py-4">Produit introuvable.</p>
            )
          ) : (
            /* UNMATCHED — Same form, pre-filled with extracted data */
            renderProductForm()
          )}

          <Separator className="my-2" />

          {/* ═══════════════════════════════════════════════════════════════════
              SECTION B: CONDITIONNEMENT (via Assistant V3)
              Disponible pour les produits matchés
              ═══════════════════════════════════════════════════════════════════ */}
          {renderConditioningSection()}

          {/* ═══════════════════════════════════════════════════════════════════
              SAVE BUTTON — After conditioning, before invoice corrections
              ═══════════════════════════════════════════════════════════════════ */}
          <div className="pt-2">
            <Button
              onClick={handleSaveProduct}
              disabled={
                (!isDirty && isMatched) ||
                isSaving ||
                !formData.nom_produit.trim() ||
                !formData.supplier_id ||
                !formData.storage_zone_id?.trim() ||
                (!isMatched && (!formData.category?.trim() || !formData.conditionnement_config))
              }
              className="w-full"
              size="sm"
            >
              {isSaving ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : isMatched ? (
                <Save className="h-4 w-4 mr-2" />
              ) : (
                <Plus className="h-4 w-4 mr-2" />
              )}
              {isSaving
                ? "Enregistrement..."
                : isMatched
                  ? "Enregistrer la fiche produit"
                  : "Créer et enregistrer le produit"}
            </Button>
          </div>

          <Separator className="my-2" />

          {/* ═══════════════════════════════════════════════════════════════════
              SECTION C: DONNÉES FACTURE (session-only)
              ═══════════════════════════════════════════════════════════════════ */}
          <div className="space-y-4 pt-2">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Données facture (session)</span>
              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                Temporaire
              </Badge>
            </div>

            <p className="text-xs text-muted-foreground">
              Ces corrections ne sont pas enregistrées en base. Elles disparaissent à la fermeture
              du modal d'extraction.
            </p>

            {/* Toggle "Ligne offerte" */}
            <div className="flex items-center justify-between p-3 rounded-md bg-muted/50 border">
              <div className="flex items-center gap-2">
                <Gift className="h-4 w-4 text-muted-foreground" />
                <div>
                  <Label htmlFor="drawer-free" className="text-sm font-medium cursor-pointer">
                    Ligne offerte / gratuite
                  </Label>
                  <p className="text-xs text-muted-foreground">Prix = 0 €</p>
                </div>
              </div>
              <Switch
                id="drawer-free"
                checked={markedAsFree}
                onCheckedChange={(v) => {
                  setMarkedAsFree(v);
                  setInvoiceDirty(true);
                }}
              />
            </div>

            {/* Quantité & Montant */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="drawer-qte" className="text-xs">
                  Quantité
                </Label>
                <Input
                  id="drawer-qte"
                  value={editedQuantite}
                  onChange={(e) => {
                    setEditedQuantite(e.target.value);
                    setInvoiceDirty(true);
                  }}
                  placeholder="Ex: 5"
                  className="h-8 text-sm"
                  type="text"
                  inputMode="decimal"
                  disabled={markedAsFree}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="drawer-montant" className="text-xs">
                  Montant total (€)
                </Label>
                <Input
                  id="drawer-montant"
                  value={markedAsFree ? "0" : editedMontant}
                  onChange={(e) => {
                    setEditedMontant(e.target.value);
                    setInvoiceDirty(true);
                  }}
                  placeholder="Ex: 18.75"
                  className="h-8 text-sm"
                  type="text"
                  inputMode="decimal"
                  disabled={markedAsFree}
                />
              </div>
            </div>

            <Button
              onClick={handleApplyInvoice}
              disabled={!invoiceDirty}
              variant="outline"
              className="w-full"
              size="sm"
            >
              Appliquer à la facture (session)
            </Button>
          </div>

          <Separator className="my-2" />

          {/* ═══════════════════════════════════════════════════════════════════
              NOTES — Tout en bas du drawer
              ═══════════════════════════════════════════════════════════════════ */}
          <div className="space-y-1.5 pt-2 pb-4">
            <Label htmlFor="drawer-info" className="text-xs">
              Notes
            </Label>
            <Textarea
              id="drawer-info"
              value={formData.info_produit}
              onChange={(e) => handleChange("info_produit", e.target.value)}
              rows={2}
              className="text-sm resize-none"
            />
          </div>
        </SheetContent>
      </Sheet>

      {/* ═══════════════════════════════════════════════════════════════════
          V3 WIZARD — Matched: edit_conditioning | Unmatched: configure_only
          ═══════════════════════════════════════════════════════════════════ */}
      {isMatched && matchedProductId ? (
        <ProductFormV3Modal
          open={v3WizardOpen}
          onOpenChange={setV3WizardOpen}
          mode="edit_conditioning"
          productId={matchedProductId}
          initialData={v3InitialData}
          supplierName={supplierName}
          supplierId={supplierId}
          existingConditionnementConfig={
            product?.conditionnement_config as ConditioningConfig | null
          }
          onValidated={handleV3ConditioningSaved}
        />
      ) : (
        <ProductFormV3Modal
          open={v3WizardOpen}
          onOpenChange={setV3WizardOpen}
          mode="configure_only"
          initialData={v3InitialData}
          supplierName={supplierName}
          supplierId={supplierId}
          existingConditionnementConfig={formData.conditionnement_config}
          onConditioningConfigured={handleV3ConfigureOnly}
        />
      )}
    </>
  );
}

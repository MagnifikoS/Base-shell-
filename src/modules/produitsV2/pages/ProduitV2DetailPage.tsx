/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PRODUITS V2 — Detail Page (View/Edit)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * PHASE 3: Structural fields are READ-ONLY. Only modifiable via Wizard V3.
 * Non-structural fields (nom, code, notes, category, code_barres) remain editable.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useParams, useNavigate, useLocation } from "react-router-dom";
import { ResponsiveLayout } from "@/components/mobile/ResponsiveLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Save, Trash2, ChevronLeft, ChevronRight, Lock } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useProductV2 } from "../hooks/useProductV2";
import { useProductV2Mutations } from "../hooks/useProductV2Mutations";
import { useSuppliersList } from "../hooks/useSuppliersList";
import { useStorageZones } from "../hooks/useStorageZones";
import { useUnits } from "@/hooks/useUnits";
import { useUnitConversions } from "@/core/unitConversion";
import { ProductV2ConfigSummary } from "../components/ProductV2ConfigSummary";
import { MinStockCard } from "../components/MinStockCard";
import { displayProductName } from "@/utils/displayName";
import { ProductUnitsTable } from "../components/ProductUnitsTable";
import { EligibilityBanner } from "../components/EligibilityBanner";
import { resolveDisplayPrice, type PriceDisplayProduct } from "../services/priceDisplayResolver";
import { resolveProductUnitContext } from "@/core/unitConversion/resolveProductUnitContext";
import { useState, useEffect, useMemo } from "react";
import type { ProductV2FormData, UpdateProductV2Payload } from "../types";
import { useBlockingDialog } from "@/contexts/BlockingDialogContext";
import { updateProductV2 } from "../services/productsV2Service";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

/**
 * PHASE 3: NON-STRUCTURAL FIELDS — only these are saved from the detail page.
 * Everything else is Wizard-only.
 */
const _NON_STRUCTURAL_FIELDS = [
  "code_produit",
  "code_barres",
  "nom_produit",
  "nom_produit_fr",
  "variant_format",
  "category",
  "supplier_id",
  "info_produit",
] as const;

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

export default function ProduitV2DetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();

  // "/produits-v2/new" is no longer valid — redirect to list (Wizard opens there)
  const isNew = id === "new";
  useEffect(() => {
    if (isNew) {
      navigate("/produits-v2", { replace: true });
    }
  }, [isNew, navigate]);

  const {
    product,
    isLoading,
    error: productError,
    refetch: refetchProduct,
  } = useProductV2(isNew ? null : (id ?? null));
  const { products: filteredProducts } = useProductsV2Hook();
  const { archive } = useProductV2Mutations();
  const { categories } = useProductCategories();
  const { data: suppliers = [] } = useSuppliersList();
  const { zones: storageZones } = useStorageZones();
  const { units: dbUnits } = useUnits();
  const { conversions: dbConversions } = useUnitConversions();
  const { showBlockingDialog } = useBlockingDialog();

  const [formData, setFormData] = useState<ProductV2FormData>(EMPTY_FORM);
  const [isDirty, setIsDirty] = useState(false);

  // Navigation prev/next
  const currentSupplierId = product?.supplier_id ?? formData.supplier_id;
  const navigationList = useMemo(() => {
    if (!currentSupplierId) return filteredProducts;
    return filteredProducts.filter((p) => p.supplier_id === currentSupplierId);
  }, [filteredProducts, currentSupplierId]);
  const currentIndex = navigationList.findIndex((p) => p.id === id);
  const prevProduct = currentIndex > 0 ? navigationList[currentIndex - 1] : null;
  const nextProduct =
    currentIndex >= 0 && currentIndex < navigationList.length - 1
      ? navigationList[currentIndex + 1]
      : null;
  const positionDisplay =
    currentIndex >= 0
      ? `${currentIndex + 1} / ${navigationList.length}`
      : `— / ${navigationList.length}`;

  // Populate form when product loads
  useEffect(() => {
    if (!product) return;

    if (!isDirty) {
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
    } else {
      // Merge Wizard-driven fields only
      setFormData((prev) => ({
        ...prev,
        conditionnement_config: product.conditionnement_config,
        conditionnement_resume: product.conditionnement_resume ?? "",
        final_unit_id: product.final_unit_id ?? "",
        stock_handling_unit_id: product.stock_handling_unit_id ?? "",
        delivery_unit_id: product.delivery_unit_id ?? "",
        supplier_billing_unit_id: product.supplier_billing_unit_id ?? "",
        final_unit_price: product.final_unit_price?.toString() ?? "",
        storage_zone_id: product.storage_zone_id ?? "",
        kitchen_unit_id: product.kitchen_unit_id ?? "",
        price_display_unit_id: product.price_display_unit_id ?? "",
      }));
    }
  }, [product, isDirty]);

  const handleChange = (field: keyof ProductV2FormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setIsDirty(true);
  };

  /**
   * PHASE 3: handleSave only writes NON-STRUCTURAL fields.
   * Structural fields are stripped — only Wizard can write them.
   */
  const handleSave = async () => {
    if (!formData.nom_produit.trim()) return;

    if (isNew) {
      // New products are created via Wizard only — redirect
      navigate("/produits-v2", { replace: true });
      return;
    } else if (id) {
      // PHASE 3: Only update non-structural fields
      const safePayload: Record<string, unknown> = {
        nom_produit: formData.nom_produit.trim(),
        nom_produit_fr: formData.nom_produit_fr.trim() || null,
        name_normalized: formData.nom_produit
          .trim()
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, ""),
        code_produit: formData.code_produit.trim() || null,
        code_barres: formData.code_barres.trim() || null,
        variant_format: formData.variant_format.trim() || null,
        // category text intentionally omitted — SSOT is category_id
        category_id: formData.category_id || null,
        supplier_id: formData.supplier_id || null,
        info_produit: formData.info_produit.trim() || null,
        // F9: Optimistic lock — send the updated_at from the fetched product
        expected_updated_at: product?.updated_at ?? undefined,
      };

      try {
        await updateProductV2(id, safePayload as UpdateProductV2Payload);
        queryClient.invalidateQueries({ queryKey: ["product-v2", id] });
        queryClient.invalidateQueries({ queryKey: ["products-v2"] });
        queryClient.invalidateQueries({ queryKey: ["desktop-stock"] });
        toast.success("Produit mis à jour");
        setIsDirty(false);
      } catch (error: unknown) {
        if (error instanceof Error && error.message?.includes("OPTIMISTIC_LOCK_CONFLICT")) {
          toast.error("Ce produit a été modifié par un autre utilisateur. Veuillez rafraîchir la page.");
          refetchProduct();
        } else if (error instanceof Error && error.message?.includes("idx_products_v2")) {
          toast.error("Conflit: un produit similaire existe déjà");
        } else {
          toast.error("Erreur lors de la mise à jour");
        }
      }
    }
  };

  const handleArchive = async () => {
    if (id && !isNew) {
      await archive.mutateAsync(id);
      navigate("/produits-v2");
    }
  };

  if (isLoading && !isNew) {
    return (
      <ResponsiveLayout>
        <div className="container mx-auto py-6 px-4 max-w-4xl space-y-6">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-64 w-full" />
        </div>
      </ResponsiveLayout>
    );
  }

  if (!isNew && productError) {
    return (
      <ResponsiveLayout>
        <div className="container mx-auto py-6 px-4 max-w-4xl">
          <div className="flex flex-col items-center justify-center p-8 text-center">
            <p className="text-destructive font-medium">Une erreur est survenue</p>
            <p className="text-muted-foreground text-sm mt-1">
              Impossible de charger les donnees du produit. Veuillez reessayer.
            </p>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => refetchProduct()}>
              Reessayer
            </Button>
          </div>
        </div>
      </ResponsiveLayout>
    );
  }

  if (!isNew && !product && !isLoading) {
    return (
      <ResponsiveLayout>
        <div className="container mx-auto py-6 px-4 max-w-4xl">
          <p className="text-muted-foreground">Produit non trouvé.</p>
          <Button variant="link" onClick={() => navigate(-1)}>
            ← Retour
          </Button>
        </div>
      </ResponsiveLayout>
    );
  }

  return (
    <ResponsiveLayout>
      <div className="container mx-auto py-6 px-4 max-w-4xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-muted-foreground hover:text-foreground"
              onClick={() => navigate((location.state as { from?: string })?.from || "/produits-v2")}
            >
              <ArrowLeft className="h-4 w-4" />
              Retour
            </Button>

            {!isNew && navigationList.length > 0 && (
              <div className="flex items-center gap-1 border rounded-md px-1 py-0.5 bg-muted/30">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  disabled={!prevProduct}
                  onClick={() => prevProduct && navigate(`/produits-v2/${prevProduct.id}`)}
                  title={prevProduct?.nom_produit ?? "Aucun produit précédent"}
                  aria-label="Produit précédent"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-xs text-muted-foreground min-w-[3.5rem] text-center tabular-nums">
                  {positionDisplay}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  disabled={!nextProduct}
                  onClick={() => nextProduct && navigate(`/produits-v2/${nextProduct.id}`)}
                  title={nextProduct?.nom_produit ?? "Aucun produit suivant"}
                  aria-label="Produit suivant"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}

            <div className="border-l pl-3">
              <h1 className="text-2xl font-bold uppercase">
                {isNew ? "Nouveau produit" : displayProductName(formData.nom_produit || "Produit")}
              </h1>
              {!isNew && product && (
                <p className="text-muted-foreground text-xs">ID: {product.id}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!isNew && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" className="text-destructive">
                    <Trash2 className="h-4 w-4 mr-2" />
                    Archiver
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Archiver ce produit ?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Le produit sera masqué de la liste mais conservé en base de données.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Annuler</AlertDialogCancel>
                    <AlertDialogAction onClick={handleArchive}>Archiver</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
            <Button
              onClick={handleSave}
              disabled={!formData.nom_produit.trim()}
            >
              <Save className="h-4 w-4 mr-2" />
              Enregistrer
            </Button>
          </div>
        </div>

        {/* PHASE 2: Eligibility banner */}
        {!isNew &&
          product &&
          (() => {
            let unitCtx = null;
            try {
              unitCtx = resolveProductUnitContext(product, dbUnits, dbConversions);
            } catch {
              /* ignore */
            }
            return <EligibilityBanner product={product} unitContext={unitCtx} />;
          })()}

        {/* Form */}
        <div className="grid gap-6 md:grid-cols-2">
          {/* Identification */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Identification</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="code_produit">Code produit</Label>
                <Input
                  id="code_produit"
                  value={formData.code_produit}
                  onChange={(e) => handleChange("code_produit", e.target.value)}
                  placeholder="Ex: PRD-001"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="nom_produit">Nom produit *</Label>
                <Input
                  id="nom_produit"
                  value={formData.nom_produit}
                  onChange={(e) => handleChange("nom_produit", e.target.value)}
                  placeholder="Nom du produit"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="nom_produit_fr">Traduction FR</Label>
                <Input
                  id="nom_produit_fr"
                  value={formData.nom_produit_fr}
                  onChange={(e) => handleChange("nom_produit_fr", e.target.value)}
                  placeholder="Traduction française"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="variant_format">Variante / Format</Label>
                <Input
                  id="variant_format"
                  value={formData.variant_format}
                  onChange={(e) => handleChange("variant_format", e.target.value)}
                  placeholder="Ex: 500g, Bio, Sans sucre"
                />
              </div>
            </CardContent>
          </Card>

          {/* Classification & Supplier — structural fields READ-ONLY */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Classification</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="category">Catégorie</Label>
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
                  <SelectTrigger id="category">
                    <SelectValue placeholder="Sélectionner une catégorie" />
                  </SelectTrigger>
                  <SelectContent className="bg-background z-50">
                    <SelectItem value="__empty__">— Aucune —</SelectItem>
                    {categories.map((cat) => (
                      <SelectItem key={cat.id} value={cat.id}>
                        {cat.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="supplier_id">Fournisseur *</Label>
                <Select
                  value={formData.supplier_id || "__empty__"}
                  onValueChange={(value) =>
                    handleChange("supplier_id", value === "__empty__" ? "" : value)
                  }
                >
                  <SelectTrigger id="supplier_id">
                    <SelectValue placeholder="Sélectionner un fournisseur" />
                  </SelectTrigger>
                  <SelectContent className="bg-background z-50">
                    <SelectItem value="__empty__">— Aucun —</SelectItem>
                    {suppliers.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                        {s.trade_name ? ` (${s.trade_name})` : ""}
                      </SelectItem>
                    ))}
                    {formData.supplier_id &&
                      !suppliers.some((s) => s.id === formData.supplier_id) &&
                      formData.supplier_id !== "" && (
                        <SelectItem value={formData.supplier_id}>
                          {formData.supplier_id} (inconnu)
                        </SelectItem>
                      )}
                  </SelectContent>
                </Select>
              </div>

              {/* ═══════════════════════════════════════════════════════════════
                  PHASE 3: Unité fournisseur — READ-ONLY (Wizard only)
                  ═══════════════════════════════════════════════════════════════ */}
              <StructuralFieldReadOnly
                label="Unité fournisseur (facturation)"
                tooltip="Modifiable uniquement via le Wizard"
                value={(() => {
                  const u = dbUnits.find((u) => u.id === formData.supplier_billing_unit_id);
                  return u ? `${u.name} (${u.abbreviation})` : null;
                })()}
              />

              {/* PHASE 3: Zone de stockage — READ-ONLY (Wizard only) */}
              <StructuralFieldReadOnly
                label="Zone de stockage"
                tooltip="Modifiable uniquement via le Wizard"
                value={storageZones.find((z) => z.id === formData.storage_zone_id)?.name ?? null}
              />

              <div className="space-y-2">
                <Label htmlFor="code_barres">Code-barres</Label>
                <Input
                  id="code_barres"
                  value={formData.code_barres}
                  onChange={(e) => handleChange("code_barres", e.target.value)}
                  placeholder="EAN13 / UPC"
                />
              </div>
            </CardContent>
          </Card>

          {/* Prix — PHASE 3: READ-ONLY display (Wizard only) */}
          <PriceDisplayCard formData={formData} dbUnits={dbUnits} dbConversions={dbConversions} />

          {/* Conditionnement — opens Wizard V3 */}
          <ProductV2ConfigSummary
            config={formData.conditionnement_config}
            resume={formData.conditionnement_resume}
            product={!isNew ? product : undefined}
            formInitialData={
              isNew
                ? {
                    nom_produit: formData.nom_produit,
                    code_produit: formData.code_produit || null,
                    info_produit: formData.info_produit || null,
                    quantite_commandee: null,
                    prix_total_ligne: null,
                    unite_facturee: null, // SSOT: resolved via unite_facturee_id only
                    vai_category: null, // SSOT: resolved from vai_category_id only
                    vai_category_id: formData.category_id || null,
                  }
                : undefined
            }
            supplierName={suppliers.find((s) => s.id === formData.supplier_id)?.name ?? null}
            supplierId={formData.supplier_id || null}
            onWizardValidated={() => {
              if (isNew) {
                navigate("/produits-v2");
              }
            }}
            autoOpen={isNew}
          />
        </div>

        {/* 5 Units Table — full width, all read-only */}
        <ProductUnitsTable
          deliveryUnitId={formData.delivery_unit_id || null}
          supplierBillingUnitId={formData.supplier_billing_unit_id || null}
          stockHandlingUnitId={formData.stock_handling_unit_id || null}
          finalUnitId={formData.final_unit_id || null}
          kitchenUnitId={formData.kitchen_unit_id || null}
        />

        {/* Min Stock Card — PHASE 3: READ-ONLY (Wizard only) */}
        {!isNew && product && (
          <MinStockCard product={product} dbUnits={dbUnits} dbConversions={dbConversions} />
        )}

        {/* Info produit */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Informations complémentaires</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea
              value={formData.info_produit}
              onChange={(e) => handleChange("info_produit", e.target.value)}
              placeholder="Notes, origine, conditionnement détaillé..."
              rows={4}
            />
          </CardContent>
        </Card>
      </div>
    </ResponsiveLayout>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 3: Structural Field Read-Only Display
// ═══════════════════════════════════════════════════════════════════════════

function StructuralFieldReadOnly({
  label,
  tooltip,
  value,
}: {
  label: string;
  tooltip: string;
  value: string | null;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Label className="text-muted-foreground">{label}</Label>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Lock className="h-3.5 w-3.5 text-muted-foreground/50 cursor-help" />
            </TooltipTrigger>
            <TooltipContent side="right" className="max-w-xs">
              <p className="text-xs">{tooltip}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      <div className="h-10 flex items-center px-3 rounded-md border bg-muted/30 text-sm">
        {value ? (
          <span className="text-foreground">{value}</span>
        ) : (
          <span className="text-muted-foreground italic">Non configuré</span>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PRICE DISPLAY CARD — PHASE 3: Read-only (no editable fields)
// ═══════════════════════════════════════════════════════════════════════════

function PriceDisplayCard({
  formData,
  dbUnits,
  dbConversions,
}: {
  formData: ProductV2FormData;
  dbUnits: import("@/core/unitConversion/types").UnitWithFamily[];
  dbConversions: import("@/core/unitConversion/types").ConversionRule[];
}) {
  const priceProduct: PriceDisplayProduct = useMemo(
    () => ({
      final_unit_price: formData.final_unit_price ? parseFloat(formData.final_unit_price) : null,
      final_unit_id: formData.final_unit_id || null,
      supplier_billing_unit_id: formData.supplier_billing_unit_id || null,
      price_display_unit_id: formData.price_display_unit_id || null,
      conditionnement_config: formData.conditionnement_config ?? null,
    }),
    [
      formData.final_unit_price,
      formData.final_unit_id,
      formData.supplier_billing_unit_id,
      formData.price_display_unit_id,
      formData.conditionnement_config,
    ]
  );

  const display = useMemo(
    () => resolveDisplayPrice(priceProduct, dbUnits, dbConversions),
    [priceProduct, dbUnits, dbConversions]
  );

  const hasConversion =
    display.displayUnitId !== null &&
    display.displayUnitId !== display.baseUnitId &&
    display.convertedPrice !== null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          Prix
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Lock className="h-3.5 w-3.5 text-muted-foreground/50 cursor-help" />
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">Prix et unité d'affichage modifiables via le Wizard</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Base price — read-only */}
        <div className="space-y-2">
          <Label className="text-muted-foreground">
            Prix unitaire de référence (€)
            {display.baseUnitAbbr && <span className="font-normal"> / {display.baseUnitAbbr}</span>}
          </Label>
          <div className="h-10 flex items-center px-3 rounded-md border bg-muted/30 text-sm">
            {formData.final_unit_price ? (
              <span className="text-foreground font-mono">{formData.final_unit_price} €</span>
            ) : (
              <span className="text-muted-foreground italic">Non défini</span>
            )}
          </div>
        </div>

        {/* Converted price display */}
        {hasConversion && display.convertedPrice !== null && (
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground mb-1">Prix affiché</p>
            <p className="text-xl font-bold font-mono">
              {display.convertedPrice.toFixed(2)} €
              <span className="text-sm font-normal text-muted-foreground ml-1">
                / {display.displayUnitAbbr}
              </span>
            </p>
          </div>
        )}

        {!hasConversion && display.basePrice !== null && display.baseUnitAbbr && (
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground mb-1">Prix unitaire</p>
            <p className="text-xl font-bold font-mono">
              {display.basePrice.toFixed(2)} €
              <span className="text-sm font-normal text-muted-foreground ml-1">
                / {display.baseUnitAbbr}
              </span>
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Hooks re-exports for this file (avoid circular)
// ═══════════════════════════════════════════════════════════════════════════
import { useProductsV2 as useProductsV2Hook } from "../hooks/useProductsV2";
import { useProductCategories } from "../hooks/useProductCategories";

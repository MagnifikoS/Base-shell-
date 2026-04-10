/**
 * ═══════════════════════════════════════════════════════════════════════════
 * INVENTAIRE — Product Detail Modal
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Opens the product detail (fiche produit) in a modal overlay
 * without leaving the inventory page. Reuses the same mutation
 * paths as ProduitV2DetailPage — zero new DB writes.
 */

import { useState, useEffect, useMemo } from "react";
import { displayProductName } from "@/utils/displayName";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Save, Lock, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import {
  useProductV2,
  useSuppliersList,
  useStorageZones,
  useProductCategories,
  ProductV2ConfigSummary,
  MinStockCard,
  ProductUnitsTable,
  EligibilityBanner,
  resolveDisplayPrice,
  updateProductV2,
} from "@/modules/produitsV2";
import type {
  PriceDisplayProduct,
  ProductV2FormData,
  UpdateProductV2Payload,
} from "@/modules/produitsV2";
import { useUnits } from "@/hooks/useUnits";
import { useUnitConversions } from "@/core/unitConversion";
import { resolveProductUnitContext } from "@/core/unitConversion/resolveProductUnitContext";
import type { UnitWithFamily, ConversionRule } from "@/core/unitConversion/types";

interface ProductDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: string;
}

export function ProductDetailModal({ open, onOpenChange, productId }: ProductDetailModalProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { product, isLoading } = useProductV2(open ? productId : null);
  const { data: suppliers = [] } = useSuppliersList();
  const { zones: storageZones } = useStorageZones();
  const { categories } = useProductCategories();
  const { units: dbUnits } = useUnits();
  const { conversions: dbConversions } = useUnitConversions();

  const [formData, setFormData] = useState<Partial<ProductV2FormData>>({});
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Populate form
  useEffect(() => {
    if (product && open) {
      setFormData({
        code_produit: product.code_produit ?? "",
        code_barres: product.code_barres ?? "",
        nom_produit: product.nom_produit,
        nom_produit_fr: product.nom_produit_fr ?? "",
        variant_format: product.variant_format ?? "",
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
  }, [product, open]);

  const handleChange = (field: keyof ProductV2FormData, value: string) => {
    // Normalize product name on the fly
    const normalizedValue = field === "nom_produit"
      ? value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase()
      : value;
    setFormData((prev) => ({ ...prev, [field]: normalizedValue }));
    setIsDirty(true);
  };

  // PHASE 3: Only non-structural fields
  const handleSave = async () => {
    if (!formData.nom_produit?.trim()) return;
    setIsSaving(true);
    try {
      const safePayload: Record<string, unknown> = {
        nom_produit: formData.nom_produit!.trim(),
        nom_produit_fr: formData.nom_produit_fr?.trim() || null,
        name_normalized: formData
          .nom_produit!.trim()
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/\s+/g, " "),
        code_produit: formData.code_produit?.trim() || null,
        code_barres: formData.code_barres?.trim() || null,
        variant_format: formData.variant_format?.trim() || null,
        category_id: (formData as Record<string, unknown>).category_id as string || null,
        supplier_id: formData.supplier_id || null,
        info_produit: formData.info_produit?.trim() || null,
      };
      await updateProductV2(productId, safePayload as UpdateProductV2Payload);
      queryClient.invalidateQueries({ queryKey: ["product-v2", productId] });
      queryClient.invalidateQueries({ queryKey: ["products-v2"] });
      queryClient.invalidateQueries({ queryKey: ["desktop-stock"] });
      queryClient.invalidateQueries({ queryKey: ["inventory-lines"] });
      toast.success("Produit mis à jour");
      setIsDirty(false);
    } catch (error: unknown) {
      if (error instanceof Error && error.message?.includes("idx_products_v2")) {
        toast.error("Conflit: un produit similaire existe déjà");
      } else {
        toast.error("Erreur lors de la mise à jour");
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleClose = (newOpen: boolean) => {
    if (!newOpen) {
      // Invalidate on close to reflect any Wizard changes
      queryClient.invalidateQueries({ queryKey: ["product-v2", productId] });
      queryClient.invalidateQueries({ queryKey: ["products-v2"] });
      queryClient.invalidateQueries({ queryKey: ["desktop-stock"] });
      queryClient.invalidateQueries({ queryKey: ["inventory-lines"] });
    }
    onOpenChange(newOpen);
  };

  // Price display
  const priceDisplay = useMemo(() => {
    if (!formData.final_unit_price && !formData.final_unit_id) return null;
    const priceProduct: PriceDisplayProduct = {
      final_unit_price: formData.final_unit_price ? parseFloat(formData.final_unit_price) : null,
      final_unit_id: formData.final_unit_id || null,
      supplier_billing_unit_id: formData.supplier_billing_unit_id || null,
      price_display_unit_id: formData.price_display_unit_id || null,
      conditionnement_config: formData.conditionnement_config ?? null,
    };
    return resolveDisplayPrice(priceProduct, dbUnits, dbConversions);
  }, [formData, dbUnits, dbConversions]);

  // Unit context for eligibility banner
  const unitCtx = useMemo(() => {
    if (!product) return null;
    try {
      return resolveProductUnitContext(
        product,
        dbUnits as UnitWithFamily[],
        dbConversions as ConversionRule[]
      );
    } catch {
      return null;
    }
  }, [product, dbUnits, dbConversions]);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <DialogTitle className="text-xl font-bold uppercase truncate">
                {displayProductName(product?.nom_produit || "Produit")}
              </DialogTitle>
              <DialogDescription className="text-xs">
                {product?.code_produit && `Code: ${product.code_produit}`}
                {product?.id && ` · ID: ${product.id.slice(0, 8)}…`}
              </DialogDescription>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-muted-foreground hover:text-foreground shrink-0"
              onClick={() => {
                handleClose(false);
                navigate(`/produits-v2/${productId}`);
              }}
            >
              <ExternalLink className="h-4 w-4" />
              Plein écran
            </Button>
          </div>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-4 py-4">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : !product ? (
          <p className="text-muted-foreground py-8 text-center">Produit non trouvé.</p>
        ) : (
          <div className="space-y-6 pt-2">
            {/* Eligibility */}
            <EligibilityBanner product={product} unitContext={unitCtx} />

            {/* Form grid */}
            <div className="grid gap-6 md:grid-cols-2">
              {/* Identification */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Identification</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>Code produit</Label>
                    <Input
                      value={formData.code_produit ?? ""}
                      onChange={(e) => handleChange("code_produit", e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Nom produit *</Label>
                    <Input
                      value={formData.nom_produit ?? ""}
                      onChange={(e) => handleChange("nom_produit", e.target.value)}
                      className="uppercase"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Traduction FR</Label>
                    <Input
                      value={formData.nom_produit_fr ?? ""}
                      onChange={(e) => handleChange("nom_produit_fr", e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Variante / Format</Label>
                    <Input
                      value={formData.variant_format ?? ""}
                      onChange={(e) => handleChange("variant_format", e.target.value)}
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Classification */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Classification</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>Catégorie</Label>
                    <Select
                      value={(formData as Record<string, unknown>).category_id as string || "__empty__"}
                      onValueChange={(v) => {
                        if (v === "__empty__") {
                          setFormData((prev) => ({ ...prev, category_id: "" }));
                          setIsDirty(true);
                        } else {
                          const cat = categories.find((c) => c.id === v);
                          if (cat) {
                            setFormData((prev) => ({ ...prev, category_id: cat.id }));
                            setIsDirty(true);
                          }
                        }
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Catégorie" />
                      </SelectTrigger>
                      <SelectContent className="bg-background">
                        <SelectItem value="__empty__">— Aucune —</SelectItem>
                        {categories.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Fournisseur</Label>
                    <Select
                      value={formData.supplier_id || "__empty__"}
                      onValueChange={(v) => handleChange("supplier_id", v === "__empty__" ? "" : v)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Fournisseur" />
                      </SelectTrigger>
                      <SelectContent className="bg-background">
                        <SelectItem value="__empty__">— Aucun —</SelectItem>
                        {suppliers.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name}
                            {s.trade_name ? ` (${s.trade_name})` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <ReadOnlyField
                    label="Unité de facturation (fournisseur)"
                    value={(() => {
                      const u = dbUnits.find((u) => u.id === formData.supplier_billing_unit_id);
                      return u ? `${u.name} (${u.abbreviation})` : null;
                    })()}
                  />
                  <ReadOnlyField
                    label="Zone de stockage"
                    value={
                      storageZones.find((z) => z.id === formData.storage_zone_id)?.name ?? null
                    }
                  />
                  <div className="space-y-2">
                    <Label>Code-barres</Label>
                    <Input
                      value={formData.code_barres ?? ""}
                      onChange={(e) => handleChange("code_barres", e.target.value)}
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Price — read-only */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    Prix <Lock className="h-3.5 w-3.5 text-muted-foreground/50" />
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {priceDisplay?.basePrice != null ? (
                    <div className="rounded-lg border bg-muted/30 p-3">
                      <p className="text-xs text-muted-foreground mb-1">Prix unitaire</p>
                      <p className="text-xl font-bold font-mono">
                        {(priceDisplay.convertedPrice ?? priceDisplay.basePrice).toFixed(2)} €
                        <span className="text-sm font-normal text-muted-foreground ml-1">
                          / {priceDisplay.displayUnitAbbr ?? priceDisplay.baseUnitAbbr}
                        </span>
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground italic">Non défini</p>
                  )}
                </CardContent>
              </Card>

              {/* Conditionnement — Wizard */}
              <ProductV2ConfigSummary
                config={formData.conditionnement_config ?? null}
                resume={formData.conditionnement_resume ?? ""}
                product={product}
                supplierName={suppliers.find((s) => s.id === formData.supplier_id)?.name ?? null}
                supplierId={formData.supplier_id || null}
                onWizardValidated={() => {
                  // Refresh product after wizard changes
                  queryClient.invalidateQueries({ queryKey: ["product-v2", productId] });
                }}
              />
            </div>

            {/* Units table */}
            <ProductUnitsTable
              deliveryUnitId={formData.delivery_unit_id || null}
              supplierBillingUnitId={formData.supplier_billing_unit_id || null}
              stockHandlingUnitId={formData.stock_handling_unit_id || null}
              finalUnitId={formData.final_unit_id || null}
              kitchenUnitId={formData.kitchen_unit_id || null}
            />

            {/* Min stock */}
            <MinStockCard
              product={product}
              dbUnits={dbUnits as UnitWithFamily[]}
              dbConversions={dbConversions as ConversionRule[]}
            />

            {/* Notes */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Informations complémentaires</CardTitle>
              </CardHeader>
              <CardContent>
                <Textarea
                  value={formData.info_produit ?? ""}
                  onChange={(e) => handleChange("info_produit", e.target.value)}
                  placeholder="Notes, origine, conditionnement détaillé..."
                  rows={3}
                />
              </CardContent>
            </Card>

            {/* Save button */}
            {isDirty && (
              <div className="sticky bottom-0 bg-background/95 backdrop-blur border-t py-3 flex justify-end">
                <Button onClick={handleSave} disabled={isSaving || !formData.nom_produit?.trim()}>
                  <Save className="h-4 w-4 mr-2" />
                  {isSaving ? "Enregistrement..." : "Enregistrer"}
                </Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Label className="text-muted-foreground">{label}</Label>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Lock className="h-3.5 w-3.5 text-muted-foreground/50 cursor-help" />
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs">Modifiable via le Wizard</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      <div className="h-10 flex items-center px-3 rounded-md border bg-muted/30 text-sm">
        {value ? (
          <span>{value}</span>
        ) : (
          <span className="text-muted-foreground italic">Non configuré</span>
        )}
      </div>
    </div>
  );
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * RECEPTION VIEW — Desktop (Supplier → Flat product list, NO categories)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * FLOW:
 * 1. Select Supplier from dropdown
 * 2. Show flat product list + search (no categories)
 * 3. Add products → lines table
 * 4. Post → BL popup
 *
 * RULES:
 * - Zone resolved server-side
 * - ensureDraft() called once on supplier selection, never auto after POST
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useState, useMemo, useRef } from "react";
import {
  Package,
  Plus,
  Send,
  AlertTriangle,
  Loader2,
  MapPin,
  Search,
  Check,
  Settings2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSuppliersList, useStorageZones } from "@/modules/produitsV2";
import { useReceiptDraft } from "../hooks/useReceiptDraft";
import { usePostDocument, type PostResult } from "../hooks/usePostDocument";
import { useUnitConversions } from "@/core/unitConversion";
import { buildCanonicalLine } from "../engine/buildCanonicalLine";
import type { Json } from "@/integrations/supabase/types";
import { ReceptionLineTable } from "./ReceptionLineTable";
import { QuantityModalWithResolver as ReceptionQuantityModal } from "@/components/stock/QuantityModalWithResolver";
import { useProductCurrentStock } from "@/hooks/useProductCurrentStock";
import { PostConfirmDialog } from "./PostConfirmDialog";
import type { PostPopupComponent } from "@/modules/shared";
import { useAuth } from "@/contexts/AuthContext";
import { useEstablishment } from "@/contexts/EstablishmentContext";

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
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

interface ReceptionViewProps {
  /** Optional BL-APP popup component injected to avoid circular dependency */
  PostPopup?: PostPopupComponent;
}

export function ReceptionView({ PostPopup }: ReceptionViewProps = {}) {
  const { data: suppliers = [] } = useSuppliersList();
  const { zones } = useStorageZones();
  const { user } = useAuth();
  const { activeEstablishment } = useEstablishment();
  const estId = activeEstablishment?.id;
  const { units: dbUnits, conversions: dbConversions } = useUnitConversions();

  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const [productSearch, setProductSearch] = useState("");
  const [showPostConfirm, setShowPostConfirm] = useState(false);
  const [postError, setPostError] = useState<PostResult | null>(null);
  const [postGuard, setPostGuard] = useState(false);

  // Pre-POST zone warning state
  const [zoneWarningOpen, setZoneWarningOpen] = useState(false);
  const [productsWithoutZone, setProductsWithoutZone] = useState<string[]>([]);

  // Quantity modal
  const [modalProduct, setModalProduct] = useState<SupplierProduct | null>(null);
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const desktopReceptionStock = useProductCurrentStock(modalProduct?.id);

  // BL-APP popup state
  const [blAppPopupOpen, setBlAppPopupOpen] = useState(false);
  const [blAppStockDocId, setBlAppStockDocId] = useState<string | null>(null);
  const [blAppSupplierId, setBlAppSupplierId] = useState<string | null>(null);
  const [blAppSupplierName, setBlAppSupplierName] = useState<string | null>(null);

  const {
    document,
    lines,
    isLoading,
    isDraftCreating: _isDraftCreating,
    draftError: _draftError,
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

  const hasEnsuredDraft = useRef(false);

  // ═══ Load products for selected supplier ═══
  const { data: supplierProducts = [], isLoading: productsLoading, error: productsError, isError: productsHasError } = useQuery({
    queryKey: ["reception-supplier-products-desktop", estId, selectedSupplierId],
    queryFn: async () => {
      if (!estId || !selectedSupplierId) return [];
      const { data, error } = await supabase
        .from("products_v2")
        .select(
          "id, nom_produit, category, supplier_id, storage_zone_id, final_unit_id, stock_handling_unit_id, supplier_billing_unit_id, delivery_unit_id, conditionnement_config"
        )
        .eq("establishment_id", estId)
        .eq("supplier_id", selectedSupplierId)
        .is("archived_at", null)
        .order("nom_produit")
        .limit(5000);
      if (error) throw error;
      return data as SupplierProduct[];
    },
    enabled: !!estId && !!selectedSupplierId,
  });

  const filteredProducts = useMemo(() => {
    const term = normalize(productSearch);
    if (!term) return supplierProducts;
    return supplierProducts.filter((p) => normalize(p.nom_produit).includes(term));
  }, [supplierProducts, productSearch]);

  const addedProductIds = useMemo(() => new Set(lines.map((l) => l.product_id)), [lines]);

  // Zone name lookup
  const zoneNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const z of zones) map[z.id] = z.name;
    return map;
  }, [zones]);

  const handleSupplierChange = async (supplierId: string) => {
    if (supplierId === "none") {
      setSelectedSupplierId(null);
      return;
    }
    setSelectedSupplierId(supplierId);
    setProductSearch("");

    // Ensure draft on supplier selection (explicit user action)
    if (!hasEnsuredDraft.current) {
      hasEnsuredDraft.current = true;
      const result = await ensureDraft();
      if (result.ok && result.documentId) {
        updateSupplier.mutate({ documentId: result.documentId, supplierId });
      } else if (!result.ok) {
        // PER-ADM-017: Reset flag so user can retry on next supplier selection
        hasEnsuredDraft.current = false;
      }
    } else if (document) {
      updateSupplier.mutate({ documentId: document.id, supplierId });
    }
  };

  const handleProductClick = (product: SupplierProduct) => {
    const existingLine = lines.find((l) => l.product_id === product.id);
    if (existingLine) {
      setEditingLineId(existingLine.id);
    } else {
      setEditingLineId(null);
    }
    setModalProduct(product);
  };

  const handleModalConfirm = async (params: {
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

  // ═══ POST document ═══
  const handlePost = async () => {
    if (!document || postGuard) return;
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
        toast.success(
          result.idempotent
            ? "Document déjà posté (idempotent)"
            : `Réception postée — ${result.events_created} mouvement(s) enregistré(s)`
        );
        if (result.warnings && result.warnings.length > 0) {
          for (const w of result.warnings) {
            toast.warning(w, { duration: 8000 });
          }
        }
        setShowPostConfirm(false);
        // Reset draft flag so next supplier selection creates a fresh draft
        hasEnsuredDraft.current = false;
        // BL-APP popup after POST OK
        if (document && estId) {
          const supplier = suppliers.find((s) => s.id === document.supplier_id);
          setBlAppStockDocId(document.id);
          setBlAppSupplierId(document.supplier_id ?? null);
          setBlAppSupplierName(supplier?.name ?? null);
          setBlAppPopupOpen(true);
        }
      } else {
        setPostError(result);
        if (result.error === "LOCK_CONFLICT") {
          toast.error("Conflit : le document a été modifié. Rechargez la page.");
        } else if (
          result.error === "NO_ACTIVE_SNAPSHOT" ||
          result.error === "NO_ACTIVE_SNAPSHOT_FOR_PRODUCT_ZONE"
        ) {
          toast.error(
            "Aucun inventaire de référence pour la zone. Effectuez un inventaire d'abord."
          );
        } else if (result.error === "PRODUCT_NO_ZONE") {
          toast.error(
            "Un ou plusieurs produits n'ont pas de zone assignée. Configurez-les dans le Wizard."
          );
        } else if (result.error === "FAMILY_MISMATCH") {
          toast.error(
            "Incompatibilité d'unité détectée. Reconfigurez le produit et refaites l'inventaire."
          );
        } else {
          toast.error(`Erreur : ${result.error}`);
        }
      }
    } finally {
      setPostGuard(false);
    }
  };

  /**
   * Pre-POST zone check: warn if any draft lines reference products without storage_zone_id.
   * These products will cause PRODUCT_NO_ZONE in fn_post_stock_document.
   */
  const checkZonesAndShowConfirm = () => {
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

    setShowPostConfirm(true);
  };

  const editingLine = editingLineId ? lines.find((l) => l.id === editingLineId) : null;

  // ═══ GUARD: No zones exist at all ═══
  if (zoneMissing) {
    return (
      <div className="py-12 text-center space-y-4">
        <AlertTriangle className="h-12 w-12 text-amber-500 dark:text-amber-400 mx-auto" />
        <h2 className="text-lg font-semibold">Aucune zone de stockage</h2>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          Aucune zone de stockage n'est configurée pour cet établissement. Créez des zones dans les
          paramètres avant de réceptionner des produits.
        </p>
      </div>
    );
  }

  // ═══ GUARD: Zone needs manual selection (no default configured, multiple zones) ═══
  if (zoneNeedsSelection) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Package className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Réception (Bon de Livraison)</h2>
        </div>
        <Card>
          <CardContent className="pt-4 space-y-4">
            <p className="text-sm text-muted-foreground">
              Aucune zone de réception par défaut n'est configurée. Sélectionnez la zone dans
              laquelle vous souhaitez réceptionner les produits :
            </p>
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium text-muted-foreground whitespace-nowrap">
                Zone :
              </span>
              <Select onValueChange={(val) => setReceiptZoneId(val)}>
                <SelectTrigger className="w-full max-w-sm">
                  <SelectValue placeholder="Sélectionner une zone..." />
                </SelectTrigger>
                <SelectContent>
                  {availableZones.map((z) => (
                    <SelectItem key={z.id} value={z.id}>
                      {z.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ═══ Header ═══ */}
      <div className="flex items-center gap-3">
        <Package className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold">Réception (Bon de Livraison)</h2>
        {defaultZone && (
          <div className="flex items-center gap-2 ml-auto">
            <Badge variant="outline" className="gap-1.5">
              <MapPin className="h-3 w-3" />
              {defaultZone.zoneName}
            </Badge>
            {zoneIsManualSelection && availableZones.length > 1 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setReceiptZoneId(null)}
              >
                Changer
              </Button>
            )}
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-4">
          {/* Supplier selector */}
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-4">
                <span className="text-sm font-medium text-muted-foreground whitespace-nowrap">
                  Fournisseur :
                </span>
                <Select value={selectedSupplierId ?? "none"} onValueChange={handleSupplierChange}>
                  <SelectTrigger className="w-full max-w-sm">
                    <SelectValue placeholder="Sélectionner un fournisseur…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Aucun —</SelectItem>
                    {suppliers.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                        {s.trade_name ? ` (${s.trade_name})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {document && (
                  <Badge variant="outline" className="whitespace-nowrap">
                    v{document.lock_version}
                  </Badge>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Product list + search (only when supplier selected) */}
          {selectedSupplierId && (
            <Card>
              <CardContent className="pt-4 space-y-4">
                {/* Search bar */}
                <div className="relative max-w-md">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Rechercher un produit…"
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    className="pl-9"
                    aria-label="Rechercher un produit"
                  />
                </div>

                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    {filteredProducts.length} produit{filteredProducts.length > 1 ? "s" : ""}
                  </span>
                  {lines.length > 0 && (
                    <span className="text-primary font-medium">
                      {lines.length} ajouté{lines.length > 1 ? "s" : ""}
                    </span>
                  )}
                </div>

                {/* Product grid */}
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
                    {supplierProducts.length === 0
                      ? "Aucun produit pour ce fournisseur"
                      : "Aucun résultat"}
                  </p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                    {filteredProducts.map((p) => {
                      const isAdded = addedProductIds.has(p.id);
                      const addedLine = isAdded ? lines.find((l) => l.product_id === p.id) : null;
                      const isIneligible = !p.storage_zone_id || !p.stock_handling_unit_id;
                      return (
                        <button
                          key={p.id}
                          className={`text-left rounded-lg border p-3 flex items-center gap-3 transition-all ${
                            isIneligible
                              ? "border-border bg-muted/50 opacity-60 cursor-not-allowed"
                              : isAdded
                                ? "border-primary/20 bg-primary/5 hover:bg-primary/10"
                                : "border-border bg-card hover:border-primary/20 hover:bg-accent/50"
                          }`}
                          onClick={() => {
                            if (isIneligible) {
                              toast.error(
                                "Ce produit doit être configuré via le Wizard avant utilisation."
                              );
                              return;
                            }
                            handleProductClick(p);
                          }}
                          disabled={isIneligible}
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate uppercase">
                              {p.nom_produit}
                            </p>
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
                              {Math.abs(addedLine.delta_quantity_canonical)}{" "}
                              {addedLine.canonical_label ?? ""}
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
              </CardContent>
            </Card>
          )}

          {/* Lines table (recap) */}
          {lines.length > 0 && (
            <ReceptionLineTable
              lines={lines}
              onEditLine={(lineId) => {
                const line = lines.find((l) => l.id === lineId);
                if (!line) return;
                const product = supplierProducts.find((p) => p.id === line.product_id);
                if (product) {
                  setModalProduct(product);
                  setEditingLineId(lineId);
                }
              }}
              onRemove={(lineId) => removeLine.mutate(lineId)}
            />
          )}

          {/* Actions */}
          {selectedSupplierId && (
            <div className="flex items-center gap-3">
              <div className="flex-1" />


              <Button
                onClick={checkZonesAndShowConfirm}
                disabled={lines.length === 0 || isPosting || postGuard}
                className="min-w-[160px]"
              >
                {isPosting ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Send className="h-4 w-4 mr-2" />
                )}
                Poster la réception
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Quantity modal */}
      <ReceptionQuantityModal
        open={!!modalProduct}
        onClose={() => {
          setModalProduct(null);
          setEditingLineId(null);
        }}
        product={modalProduct}
        dbUnits={dbUnits}
        dbConversions={dbConversions}
        onConfirm={handleModalConfirm}
        existingQuantity={editingLine?.delta_quantity_canonical ?? null}
        contextLabel="Réception"
        contextType="reception"
        currentStockCanonical={desktopReceptionStock.currentStockCanonical}
        currentStockUnitLabel={desktopReceptionStock.currentStockUnitLabel}
        currentStockLoading={desktopReceptionStock.isLoading}
      />

      {/* Post confirmation dialog */}
      {document && (
        <PostConfirmDialog
          open={showPostConfirm}
          onClose={() => {
            setShowPostConfirm(false);
            setPostError(null);
          }}
          linesCount={lines.length}
          zoneName={defaultZone?.zoneName ?? ""}
          isPosting={isPosting}
          postError={postError}
          onConfirm={() => handlePost()}
        />
      )}

      {/* BL-APP popup after POST OK (injected via PostPopup prop) */}
      {PostPopup && blAppStockDocId && estId && user?.id && (
        <PostPopup
          open={blAppPopupOpen}
          onClose={() => {
            setBlAppPopupOpen(false);
            setBlAppStockDocId(null);
          }}
          stockDocumentId={blAppStockDocId}
          establishmentId={estId}
          supplierId={blAppSupplierId}
          supplierName={blAppSupplierName}
          userId={user.id}
        />
      )}

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
                setShowPostConfirm(true);
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

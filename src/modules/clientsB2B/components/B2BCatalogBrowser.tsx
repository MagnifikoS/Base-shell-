/**
 * B2B Catalogue Browser — Main component
 * Displays supplier products with eligibility status, selection, and import flow.
 * Blocked products are clickable → opens fix dialog → overrides applied at import.
 */

import { useState, useMemo, useCallback, Fragment } from "react";
import { normalizeSearch } from "@/utils/normalizeSearch";
import { useQuery } from "@tanstack/react-query";
import { useB2BCatalog } from "../hooks/useB2BCatalog";
import { getPartnerProfile } from "../services/b2bPartnershipService";
import { useB2BImport } from "../hooks/useB2BImport";
import { B2BZoneSelectDialog } from "./B2BZoneSelectDialog";
import { B2BImportReportDialog } from "./B2BImportReportDialog";
import { B2BProductFixDialog, type ProductOverride } from "./B2BProductFixDialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Loader2, Search, ArrowLeft, PackageCheck, Wrench, X } from "lucide-react";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { EnrichedCatalogProduct } from "../services/b2bTypes";

interface Props {
  partnershipId: string;
  partnerName: string;
  onBack: () => void;
  /** Hide the header (back + title) when rendered inside a tabbed wrapper */
  hideHeader?: boolean;
}

export function B2BCatalogBrowser({ partnershipId, partnerName: partnerNameProp, onBack, hideHeader }: Props) {
  const { products, localUnits, localCategories, isLoading, error, refetch, supplierEstablishmentId } =
    useB2BCatalog(partnershipId);
  const { runImport, importing, progress, results, clearResults } = useB2BImport();
  const { activeEstablishment } = useEstablishment();

  const { data: partnerProfile } = useQuery({
    queryKey: ["b2b-partner-profile", supplierEstablishmentId],
    queryFn: () => getPartnerProfile(supplierEstablishmentId!),
    enabled: !!supplierEstablishmentId && !partnerNameProp,
  });
  const partnerName = partnerNameProp || partnerProfile?.trade_name || partnerProfile?.name || "Fournisseur";

  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [zoneDialogOpen, setZoneDialogOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  // ── Override state: corrections applied by user via fix dialog ──
  const [overrides, setOverrides] = useState<Map<string, ProductOverride>>(new Map());
  const [fixDialogOpen, setFixDialogOpen] = useState(false);
  const [fixProduct, setFixProduct] = useState<EnrichedCatalogProduct | null>(null);

  // Apply overrides to products: a blocked product becomes ELIGIBLE if corrected
  const resolvedProducts = useMemo(() => {
    return products.map((p) => {
      const ov = overrides.get(p.id);
      if (!ov) return p;

      // Clone and apply override
      const resolved = { ...p };

      // Category override
      if (ov.categoryId && p.importStatus === "BLOCKED_CATEGORY") {
        resolved.categoryMapping = {
          ...p.categoryMapping,
          status: "MAPPED",
          localCategoryId: ov.categoryId,
          localCategoryName: ov.categoryName ?? null,
        };
      }

      // Unit overrides
      if (ov.unitOverrides && (
        p.importStatus === "BLOCKED_UNIT_UNKNOWN" ||
        p.importStatus === "BLOCKED_UNIT_AMBIGUOUS" ||
        p.importStatus === "BLOCKED_UNIT_FAMILY_MISMATCH"
      )) {
        resolved.unitMappings = p.unitMappings.map((m) => {
          const localId = ov.unitOverrides?.[m.sourceUnitId];
          if (localId && (m.status === "UNKNOWN" || m.status === "AMBIGUOUS")) {
            return { ...m, status: "MAPPED" as const, localUnitId: localId, candidates: [] };
          }
          return m;
        });
      }

      // Re-evaluate status after overrides
      const hasUnitBlock = resolved.unitMappings.some(
        (m) => m.status === "UNKNOWN" || m.status === "AMBIGUOUS"
      );
      const hasCatBlock = resolved.categoryMapping.status === "NOT_FOUND";

      if (!hasUnitBlock && !hasCatBlock) {
        resolved.importStatus = "ELIGIBLE";
        resolved.blockReason = undefined;
      }

      return resolved;
    });
  }, [products, overrides]);

  // Available categories (from supplier products)
  const availableCategories = useMemo(() => {
    const cats = new Set<string>();
    for (const p of resolvedProducts) {
      if (p.category_name) cats.add(p.category_name);
    }
    return [...cats].sort((a, b) => a.localeCompare(b, "fr"));
  }, [resolvedProducts]);

  // Filter by search + category
  const filtered = useMemo(() => {
    let list = resolvedProducts;
    if (selectedCategory) {
      list = list.filter((p) => p.category_name === selectedCategory);
    }
    if (search.trim()) {
      const q = normalizeSearch(search);
      list = list.filter((p) =>
        normalizeSearch(p.nom_produit).includes(q) ||
        (p.code_produit && normalizeSearch(p.code_produit).includes(q))
      );
    }
    // Sort alphabetically
    return [...list].sort((a, b) => a.nom_produit.localeCompare(b.nom_produit, "fr"));
  }, [resolvedProducts, search, selectedCategory]);

  const eligible = useMemo(() => filtered.filter((p) => p.importStatus === "ELIGIBLE"), [filtered]);

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelected(new Set(eligible.map((p) => p.id)));
  }, [eligible]);

  const handleImportClick = () => {
    if (selected.size === 0) {
      toast.error("Sélectionnez au moins un produit");
      return;
    }
    setZoneDialogOpen(true);
  };

  const handleZoneConfirm = async (zoneId: string) => {
    setZoneDialogOpen(false);
    if (!activeEstablishment?.id || !supplierEstablishmentId) return;

    const supplierId = await findOrCreateLocalSupplier(
      activeEstablishment.id,
      supplierEstablishmentId,
      partnerName
    );
    if (!supplierId) {
      toast.error("Impossible de créer le fournisseur local");
      return;
    }

    // Use resolved products (with overrides applied)
    const toImport = resolvedProducts.filter((p) => selected.has(p.id) && p.importStatus === "ELIGIBLE");
    const importResults = await runImport(toImport, supplierId, zoneId, supplierEstablishmentId, localUnits);

    if (importResults) {
      setReportOpen(true);
      setSelected(new Set());
      // Clear overrides for successfully imported products
      const importedIds = new Set(importResults.filter((r) => r.status === "IMPORTED").map((r) => r.sourceProductId));
      setOverrides((prev) => {
        const next = new Map(prev);
        for (const id of importedIds) next.delete(id);
        return next;
      });
      refetch();
    }
  };

  const handleReportClose = () => {
    setReportOpen(false);
    clearResults();
  };

  // ── Fix dialog handlers ──
  const openFixDialog = (product: EnrichedCatalogProduct) => {
    // Use the original (non-resolved) product for the dialog
    const original = products.find((p) => p.id === product.id) ?? product;
    setFixProduct(original);
    setFixDialogOpen(true);
  };

  const handleApplyOverride = (override: ProductOverride) => {
    setOverrides((prev) => {
      const next = new Map(prev);
      next.set(override.productId, override);
      return next;
    });
    toast.success("Correction appliquée — le produit est maintenant importable");
  };

  // ── Badge rendering ──
  const isBlocked = (status: string) =>
    status === "BLOCKED_CATEGORY" ||
    status === "BLOCKED_UNIT_UNKNOWN" ||
    status === "BLOCKED_UNIT_AMBIGUOUS" ||
    status === "BLOCKED_UNIT_FAMILY_MISMATCH";

  const statusBadge = (product: EnrichedCatalogProduct) => {
    const hasFix = overrides.has(product.id);

    switch (product.importStatus) {
      case "ELIGIBLE":
        if (hasFix) {
          return <Badge variant="outline" className="text-xs border-primary/40 text-primary">Corrigé ✓</Badge>;
        }
        return null;
      case "ALREADY_IMPORTED":
        return <Badge variant="secondary" className="text-xs">Déjà importé</Badge>;
      case "BLOCKED_UNIT_UNKNOWN":
      case "BLOCKED_UNIT_AMBIGUOUS":
      case "BLOCKED_UNIT_FAMILY_MISMATCH":
        return (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <Badge variant="destructive" className="text-xs cursor-pointer">Unité bloquée</Badge>
              </TooltipTrigger>
              <TooltipContent><p className="max-w-xs">{product.blockReason} — Cliquez pour corriger</p></TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      case "BLOCKED_CATEGORY":
        return (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <Badge variant="destructive" className="text-xs cursor-pointer">Catégorie bloquée</Badge>
              </TooltipTrigger>
              <TooltipContent><p className="max-w-xs">{product.blockReason} — Cliquez pour corriger</p></TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      default:
        return <Badge variant="outline" className="text-xs">{product.importStatus}</Badge>;
    }
  };

  if (error) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-2" />Retour</Button>
        <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-xl">
          <p className="text-sm text-destructive">{error.message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      {!hideHeader && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={onBack}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h2 className="text-xl font-bold">Catalogue B2B — {partnerName}</h2>
              <p className="text-sm text-muted-foreground">
                {resolvedProducts.length} produit{resolvedProducts.length > 1 ? "s" : ""} disponibles
                {overrides.size > 0 && (
                  <span className="ml-2 text-primary">· {overrides.size} corrigé{overrides.size > 1 ? "s" : ""}</span>
                )}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Search + Category filter + actions */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Rechercher un produit..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Category filter */}
        <select
          value={selectedCategory ?? ""}
          onChange={(e) => setSelectedCategory(e.target.value || null)}
          className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">Toutes les catégories</option>
          {availableCategories.map((cat) => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </select>

        {selectedCategory && (
          <Button
            variant="ghost"
            size="sm"
            className="h-9 px-2 text-muted-foreground"
            onClick={() => setSelectedCategory(null)}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}

        {selected.size > 0 ? (
          <Button variant="outline" size="sm" className="h-9" onClick={() => setSelected(new Set())}>
            Tout désélectionner ({selected.size})
          </Button>
        ) : (
          <Button variant="outline" size="sm" className="h-9" onClick={selectAll} disabled={eligible.length === 0}>
            Tout sélectionner ({eligible.length})
          </Button>
        )}
      </div>

      {/* Active category filter indicator */}
      {selectedCategory && (
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-xs">
            {selectedCategory} — {filtered.length} produit{filtered.length > 1 ? "s" : ""}
          </Badge>
        </div>
      )}

      {/* Product list — flat alphabetical */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          {search || selectedCategory ? "Aucun produit trouvé" : "Catalogue vide"}
        </div>
      ) : (
        <div className="space-y-1">
          {filtered.map((product) => {
            const isEligible = product.importStatus === "ELIGIBLE";
            const isBlockedProduct = isBlocked(product.importStatus);
            const isSelected = selected.has(product.id);
            const isClickable = isEligible || isBlockedProduct;

            return (
              <div
                key={product.id}
                className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                  isClickable ? "hover:bg-accent/50 cursor-pointer" : "opacity-60"
                } ${isSelected ? "bg-primary/5 border-primary/30" : ""} ${
                  isBlockedProduct ? "border-destructive/20 bg-destructive/5 hover:bg-destructive/10" : ""
                }`}
                onClick={() => {
                  if (isBlockedProduct) {
                    openFixDialog(product);
                  } else if (isEligible) {
                    toggleSelect(product.id);
                  }
                }}
              >
                <Checkbox
                  checked={isSelected}
                  disabled={!isEligible}
                  onCheckedChange={() => isEligible && toggleSelect(product.id)}
                  onClick={(e) => e.stopPropagation()}
                />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate uppercase">{product.nom_produit}</span>
                    {product.code_produit && (
                      <span className="text-xs text-muted-foreground">({product.code_produit})</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    {product.category_name && (
                      <span className="text-xs text-muted-foreground">{product.category_name}</span>
                    )}
                    {product.conditionnement_resume && (
                      <span className="text-xs text-muted-foreground">· {product.conditionnement_resume}</span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {product.final_unit_price != null && (
                    <span className="text-sm font-medium">{product.final_unit_price.toFixed(2)} €</span>
                  )}
                  {statusBadge(product)}
                  {isBlockedProduct && (
                    <Wrench className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Sticky bottom bar */}
      {selected.size > 0 && (
        <div className="sticky bottom-4 bg-background border rounded-xl p-4 shadow-lg flex items-center justify-between">
          <div className="flex items-center gap-2">
            <PackageCheck className="h-5 w-5 text-primary" />
            <span className="font-medium text-sm">
              {selected.size} produit{selected.size > 1 ? "s" : ""} sélectionné{selected.size > 1 ? "s" : ""}
            </span>
          </div>
          <Button onClick={handleImportClick} disabled={importing}>
            {importing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Import {progress.done}/{progress.total}
              </>
            ) : (
              <>Importer la sélection</>
            )}
          </Button>
        </div>
      )}

      {/* Zone select dialog */}
      <B2BZoneSelectDialog
        open={zoneDialogOpen}
        onOpenChange={setZoneDialogOpen}
        selectedCount={selected.size}
        onConfirm={handleZoneConfirm}
      />

      {/* Import report */}
      {results && (
        <B2BImportReportDialog
          open={reportOpen}
          onOpenChange={handleReportClose}
          results={results}
          onRetry={() => {
            setReportOpen(false);
            handleImportClick();
          }}
        />
      )}

      {/* Fix dialog for blocked products */}
      <B2BProductFixDialog
        open={fixDialogOpen}
        onOpenChange={setFixDialogOpen}
        product={fixProduct}
        localCategories={localCategories}
        localUnits={localUnits}
        onApply={handleApplyOverride}
      />
    </div>
  );
}

// ── Helper: find or create local supplier entry for B2B partner ──

async function findOrCreateLocalSupplier(
  clientEstablishmentId: string,
  supplierEstablishmentId: string,
  partnerName: string
): Promise<string | null> {
  const stableCode = `b2b:${supplierEstablishmentId}`;

  const { data: byCode } = await supabase
    .from("invoice_suppliers")
    .select("id")
    .eq("establishment_id", clientEstablishmentId)
    .eq("internal_code", stableCode)
    .is("archived_at", null)
    .maybeSingle();

  if (byCode) return byCode.id;

  const { data: byName } = await supabase
    .from("invoice_suppliers")
    .select("id")
    .eq("establishment_id", clientEstablishmentId)
    .eq("name", partnerName)
    .eq("supplier_type", "b2b_partner")
    .is("archived_at", null)
    .maybeSingle();

  if (byName) {
    await supabase
      .from("invoice_suppliers")
      .update({ internal_code: stableCode })
      .eq("id", byName.id);
    return byName.id;
  }

  const { data: est } = await supabase
    .from("establishments")
    .select("organization_id")
    .eq("id", clientEstablishmentId)
    .single();

  if (!est) return null;

  const { data: created, error } = await supabase
    .from("invoice_suppliers")
    .insert({
      establishment_id: clientEstablishmentId,
      organization_id: est.organization_id,
      name: partnerName,
      internal_code: stableCode,
      supplier_type: "b2b_partner",
    })
    .select("id")
    .single();

  if (error) {
    if (import.meta.env.DEV) console.error("Failed to create local supplier:", error);
    return null;
  }

  return created.id;
}

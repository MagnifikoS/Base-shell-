import { useState, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Settings2, Loader2, X, Zap } from "lucide-react";
import { toast } from "sonner";
import { useProductsForConfig, filterProducts } from "../hooks/useProductsForConfig";
import { InputConfigFiltersBar } from "../components/InputConfigFiltersBar";
import { InputConfigTable } from "../components/InputConfigTable";
import { BulkConfigDialog } from "../components/BulkConfigDialog";
import { SingleConfigDialog } from "../components/SingleConfigDialog";
import { useSaveInputConfig } from "../hooks/useSaveInputConfig";
import type { InputConfigFilters, ProductForConfig } from "../types";

export default function InputConfigPage() {
  const { data: products, isLoading, error } = useProductsForConfig();
  const saveMutation = useSaveInputConfig();

  const [filters, setFilters] = useState<InputConfigFilters>({
    search: "",
    unitFamily: "all",
    levelsCount: "all",
    status: "not_configured",
  });

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const [singleProduct, setSingleProduct] = useState<ProductForConfig | null>(null);

  const filtered = useMemo(
    () => (products ? filterProducts(products, filters) : []),
    [products, filters],
  );

  const selectedProducts = useMemo(
    () => filtered.filter((p) => selectedIds.has(p.id)),
    [filtered, selectedIds],
  );

  const allSelected = filtered.length > 0 && filtered.every((p) => selectedIds.has(p.id));

  const toggleOne = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((p) => p.id)));
    }
  }, [allSelected, filtered]);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  // ── Auto-config summary toast ──
  const showAutoConfigSummary = useCallback(
    (configured: number, failed: number, alreadyDone: number, multiUnits: number) => {
      const parts: string[] = [];
      if (configured > 0)
        parts.push(`${configured} produit${configured > 1 ? "s" : ""} configuré${configured > 1 ? "s" : ""} automatiquement`);
      if (failed > 0)
        parts.push(`${failed} en erreur`);
      if (alreadyDone > 0)
        parts.push(`${alreadyDone} ignoré${alreadyDone > 1 ? "s" : ""} (déjà configurés)`);
      if (multiUnits > 0)
        parts.push(`${multiUnits} ignoré${multiUnits > 1 ? "s" : ""} (plusieurs unités — config manuelle requise)`);

      if (failed > 0 && configured === 0) {
        toast.error("Échec de l'auto-configuration", { description: parts.join("\n") });
      } else if (failed > 0) {
        toast.warning("Auto-configuration partielle", { description: parts.join("\n") });
      } else {
        toast.success("Auto-configuration terminée", { description: parts.join("\n") });
      }
    },
    [],
  );

  // ── Auto-config bulk handler ──
  const handleAutoConfig = useCallback(() => {
    if (selectedProducts.length === 0) return;

    // Partition selected products into categories
    const eligible: ProductForConfig[] = [];
    const alreadyConfigured: ProductForConfig[] = [];
    const multiUnit: ProductForConfig[] = [];

    for (const p of selectedProducts) {
      if (p.status !== "not_configured") {
        alreadyConfigured.push(p);
      } else if (p.autoConfigPayload) {
        eligible.push(p);
      } else {
        multiUnit.push(p);
      }
    }

    if (eligible.length === 0) {
      const parts: string[] = [];
      if (alreadyConfigured.length > 0)
        parts.push(`${alreadyConfigured.length} déjà configuré${alreadyConfigured.length > 1 ? "s" : ""}`);
      if (multiUnit.length > 0)
        parts.push(`${multiUnit.length} avec plusieurs unités (config manuelle requise)`);
      toast.info("Aucun produit auto-configurable", {
        description: parts.join(" · "),
      });
      return;
    }

    // All eligible products are mono-unit, so they all share the same save shape
    // but each has its own unit IDs. We need to save per-product.
    // useSaveInputConfig supports bulk via productIds, but all get the same config.
    // For auto-config, each product may have a different unit → group by payload.

    // Group eligible products by identical payload
    const payloadGroups = new Map<string, { ids: string[]; payload: NonNullable<ProductForConfig["autoConfigPayload"]> }>();
    for (const p of eligible) {
      const pl = p.autoConfigPayload!;
      const key = `${pl.reception_mode}|${pl.reception_preferred_unit_id}|${pl.internal_mode}|${pl.internal_preferred_unit_id}`;
      const existing = payloadGroups.get(key);
      if (existing) {
        existing.ids.push(p.id);
      } else {
        payloadGroups.set(key, { ids: [p.id], payload: pl });
      }
    }

    // Execute saves for each group, track successes and failures
    const groups = Array.from(payloadGroups.values());
    let completedGroups = 0;
    let failedCount = 0;

    for (const group of groups) {
      saveMutation.mutate(
        {
          productIds: group.ids,
          reception_mode: group.payload.reception_mode,
          reception_preferred_unit_id: group.payload.reception_preferred_unit_id,
          reception_unit_chain: null,
          internal_mode: group.payload.internal_mode,
          internal_preferred_unit_id: group.payload.internal_preferred_unit_id,
          internal_unit_chain: null,
        },
        {
          onSuccess: () => {
            completedGroups++;
            if (completedGroups + failedCount === groups.length) {
              showAutoConfigSummary(eligible.length - failedCount, failedCount, alreadyConfigured.length, multiUnit.length);
              clearSelection();
            }
          },
          onError: () => {
            failedCount += group.ids.length;
            completedGroups++;
            if (completedGroups + failedCount === groups.length) {
              showAutoConfigSummary(eligible.length - failedCount, failedCount, alreadyConfigured.length, multiUnit.length);
              clearSelection();
            }
          },
        },
      );
    }
  }, [selectedProducts, saveMutation, clearSelection]);

  // Count eligible products for button state
  const eligibleCount = useMemo(
    () => selectedProducts.filter((p) => p.status === "not_configured" && p.autoConfigPayload).length,
    [selectedProducts],
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 text-center text-destructive">
        Erreur lors du chargement des produits
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 sm:p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Paramètres de saisie</h1>
      </div>

      {/* Filters */}
      <InputConfigFiltersBar
        filters={filters}
        onChange={setFilters}
        counts={{ total: products?.length ?? 0, filtered: filtered.length }}
      />

      {/* Bulk action bar — sticky at top when products are selected */}
      {selectedIds.size > 0 && (
        <div className="sticky top-0 z-10 flex items-center gap-3 rounded-lg border border-border bg-background p-3 shadow-md">
          <span className="text-sm font-medium">
            {selectedIds.size} sélectionné{selectedIds.size > 1 ? "s" : ""}
          </span>
          <Button variant="ghost" size="sm" onClick={clearSelection}>
            <X className="mr-1 h-3.5 w-3.5" />
            Effacer
          </Button>
          <div className="ml-auto flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handleAutoConfig}
              disabled={eligibleCount === 0 || saveMutation.isPending}
            >
              <Zap className="mr-1.5 h-4 w-4" />
              {saveMutation.isPending
                ? "En cours…"
                : `Auto-configurer${eligibleCount > 0 ? ` (${eligibleCount})` : ""}`}
            </Button>
            <Button size="sm" onClick={() => setBulkDialogOpen(true)}>
              <Settings2 className="mr-1.5 h-4 w-4" />
              Configurer
            </Button>
          </div>
        </div>
      )}

      {/* Table */}
      <InputConfigTable
        products={filtered}
        selectedIds={selectedIds}
        onToggle={toggleOne}
        onToggleAll={toggleAll}
        allSelected={allSelected}
        onProductClick={setSingleProduct}
      />

      {/* Bulk dialog */}
      <BulkConfigDialog
        open={bulkDialogOpen}
        onOpenChange={setBulkDialogOpen}
        products={selectedProducts}
      />

      {/* Single product dialog */}
      <SingleConfigDialog
        open={singleProduct !== null}
        onOpenChange={(open) => { if (!open) setSingleProduct(null); }}
        product={singleProduct}
      />
    </div>
  );
}

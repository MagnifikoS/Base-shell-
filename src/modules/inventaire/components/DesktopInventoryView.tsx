/**
 * ═══════════════════════════════════════════════════════════════════════════
 * INVENTAIRE V0 — Desktop View (Stock par fournisseur)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Sub-components extracted for file-size compliance:
 * - ProductStockTable — full stock table with headers and rows
 * - EstimatedStockCell — realtime estimated stock display
 * - StockBreakdownCell — snapshot stock breakdown display
 * - StockStatusBadge — Rupture / Sous seuil / OK badge
 * - MinStockTableCell — min stock threshold display
 * - inventoryDisplayUtils — formatQtyDisplay helper
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useCallback, useMemo, useState, Fragment } from "react";
import { normalizeSearch } from "@/utils/normalizeSearch";
import { Search, Settings, AlertTriangle, Truck, MapPin, LayoutGrid } from "lucide-react";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { Input } from "@/components/ui/input";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSuppliersList } from "@/modules/produitsV2";
import { useDesktopStock, type DesktopProductStock } from "../hooks/useDesktopStock";
import { useEstimatedStock } from "../hooks/useEstimatedStock";
import { useUnitConversions } from "@/core/unitConversion";
import { useProductInputConfigs } from "@/modules/inputConfig";

import { InventoryProductDrawer } from "./InventoryProductDrawer";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import {
  resolveProductUnitContext,
  type ProductUnitInput,
} from "@/core/unitConversion/resolveProductUnitContext";
import { InventoryGroupingGrid, GroupBackHeader, type GroupItem } from "./InventoryGroupingGrid";
import { getCategoryIcon } from "@/shared/categoryIcons";
import { generateInventoryStockPdf } from "../utils/inventoryStockPdf";
import { isProductInventoryEligible } from "@/modules/produitsV2";
import { ProduitsAConfigurer } from "./ProduitsAConfigurer";
import { ProductStockTable } from "./ProductStockTable";
import {
  useMutualisationEnabled,
  useMutualisationGroups,
  applyMutualisation,
} from "@/modules/inventaireMutualisation";



type StockDisplayMode = "realtime" | "snapshot" | "both";
type GroupByMode = "all" | "category" | "supplier" | "zone";

export function DesktopInventoryView() {
  const { activeEstablishment } = useEstablishment();
  const { data: suppliers = [] } = useSuppliersList();
  const {
    stock,
    isLoading,
    error: stockError,
    refetch: refetchStock,
    updateStock,
  } = useDesktopStock();
  const { estimatedStock, isLoading: _isEstLoading, isError: isEstimatedStockError } = useEstimatedStock();
  const inTransitStock = new Map<string, number>();
  const { units: dbUnits, conversions: dbConversions } = useUnitConversions();
  const inputConfigMap = useProductInputConfigs();
  const [searchTerm, setSearchTerm] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<DesktopProductStock | null>(null);
  const [displayMode, setDisplayMode] = useState<StockDisplayMode>("realtime");
  const [groupBy, setGroupBy] = useState<GroupByMode>("all");
  const [selectedGroupKey, setSelectedGroupKey] = useState<string | null>(null);
  const navigate = useNavigate();

  // ── Mutualisation (presentation-only layer) ──────────────────────────
  const { enabled: mutualisationOn } = useMutualisationEnabled();
  const { groups: mutualisationGroups } = useMutualisationGroups();

  // Unit display name map for PDF + UI
  const unitAbbrMap = useMemo(() => {
    const m = new Map<string, string>();
    dbUnits.forEach((u) => m.set(u.id, u.name || u.abbreviation));
    return m;
  }, [dbUnits]);

  // Supplier name map
  const supplierMap = useMemo(() => {
    const m = new Map<string, string>();
    suppliers.forEach((s) => m.set(s.id, s.name));
    return m;
  }, [suppliers]);

  const supplierLogoMap = useMemo(() => {
    const m = new Map<string, string | null>();
    suppliers.forEach((s) => m.set(s.id, s.logo_url ?? null));
    return m;
  }, [suppliers]);

  // Compute unitContext ONCE per product, then filter eligible
  const unitContextMap = useMemo(() => {
    const map = new Map<string, ReturnType<typeof resolveProductUnitContext> | null>();
    for (const item of stock) {
      const productInput: ProductUnitInput = {
        stock_handling_unit_id: item.stock_handling_unit_id,
        final_unit_id: item.final_unit_id,
        delivery_unit_id: item.delivery_unit_id,
        supplier_billing_unit_id: item.supplier_billing_unit_id,
        conditionnement_config: item.conditionnement_config,
      };
      try {
        map.set(item.product_id, resolveProductUnitContext(productInput, dbUnits, dbConversions));
      } catch {
        map.set(item.product_id, null);
      }
    }
    return map;
  }, [stock, dbUnits, dbConversions]);

  // Filter stock into eligible products only for main table
  const eligibleStock = useMemo(() => {
    return stock.filter((item) => {
      const unitContext = unitContextMap.get(item.product_id) ?? null;
      const result = isProductInventoryEligible(
        {
          storage_zone_id: item.storage_zone_id,
          stock_handling_unit_id: item.stock_handling_unit_id,
          archived_at: null,
        },
        unitContext
      );
      return result.eligible;
    });
  }, [stock, unitContextMap]);

  const noZoneCount = useMemo(() => stock.filter((s) => !s.storage_zone_id).length, [stock]);

  const filteredStock = useMemo(() => {
    if (!searchTerm) return eligibleStock;
    const term = normalizeSearch(searchTerm);
    return eligibleStock.filter((item) => normalizeSearch(item.nom_produit).includes(term));
  }, [eligibleStock, searchTerm]);

  const sortedStock = useMemo(() => {
    return [...filteredStock].sort((a, b) => {
      const estA = estimatedStock?.get(a.product_id);
      const estB = estimatedStock?.get(b.product_id);
      const qtyA = estA?.ok ? estA.data.estimated_quantity : Infinity;
      const qtyB = estB?.ok ? estB.data.estimated_quantity : Infinity;
      return qtyA - qtyB;
    });
  }, [filteredStock, estimatedStock]);

  // Build groups for grid modes
  const groups = useMemo<GroupItem[]>(() => {
    if (groupBy === "all") return [];
    const map = new Map<string, { label: string; count: number }>();
    for (const item of sortedStock) {
      let key: string;
      let label: string;
      switch (groupBy) {
        case "category":
          key = item.category_id ?? "__none__";
          label = item.category_name ?? "Sans catégorie";
          break;
        case "supplier":
          key = item.supplier_id ?? "__none__";
          label = supplierMap.get(item.supplier_id) ?? "Sans fournisseur";
          break;
        case "zone":
          key = item.storage_zone_id ?? "__none__";
          label = item.storage_zone_name ?? "Sans zone";
          break;
        default:
          continue;
      }
      const existing = map.get(key);
      if (existing) {
        existing.count++;
      } else {
        map.set(key, { label, count: 1 });
      }
    }
    return Array.from(map.entries())
      .map(([key, { label, count }]) => ({
        key,
        label,
        count,
        icon:
          groupBy === "category" ? getCategoryIcon(label) : groupBy === "supplier" ? Truck : MapPin,
        logoUrl: groupBy === "supplier" ? (supplierLogoMap.get(key) ?? null) : null,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [sortedStock, groupBy, supplierMap, supplierLogoMap]);

  const displayProducts = useMemo(() => {
    if (groupBy === "all" || !selectedGroupKey) return sortedStock;
    return sortedStock.filter((item) => {
      switch (groupBy) {
        case "category":
          return (item.category_id ?? "__none__") === selectedGroupKey;
        case "supplier":
          return (item.supplier_id ?? "__none__") === selectedGroupKey;
        case "zone":
          return (item.storage_zone_id ?? "__none__") === selectedGroupKey;
        default:
          return true;
      }
    });
  }, [sortedStock, groupBy, selectedGroupKey]);

  // Mutualisation display items (pure presentation transform)
  // Pass sortedStock as allProducts so groups aggregate ALL real members,
  // not just the ones visible after zone/category/supplier filtering.
  const mutualisationItems = useMemo(() => {
    if (!mutualisationOn || mutualisationGroups.length === 0) return null;
    return applyMutualisation(displayProducts, mutualisationGroups, sortedStock);
  }, [mutualisationOn, mutualisationGroups, displayProducts, sortedStock]);

  const hasAnyActiveSession = useMemo(
    () => displayProducts.some((item) => !!item.active_session_id),
    [displayProducts]
  );

  const handleUpdate = (
    product: DesktopProductStock,
    quantity: number,
    unitId: string | null,
    unitLabel?: string
  ) => {
    updateStock.mutate({
      lineId: product.last_line_id,
      quantity,
      unitId,
      productId: product.product_id,
      sessionId: product.latest_zone_session_id,
      unitLabel: unitLabel || "__NO_CHANGE__",
    });
  };

  const handleRowClick = (product: DesktopProductStock) => {
    setSelectedProduct(product);
    setDrawerOpen(true);
  };
  const handleGroupByChange = (value: GroupByMode) => {
    setGroupBy(value);
    setSelectedGroupKey(null);
  };

  const handleExportSupplierPdf = useCallback(
    (supplierKey: string) => {
      const supplierProducts = sortedStock.filter(
        (item) => (item.supplier_id ?? "__none__") === supplierKey
      );
      const name = supplierMap.get(supplierKey) ?? "Sans fournisseur";
      void generateInventoryStockPdf({
        supplierName: name,
        products: supplierProducts,
        estimatedStock,
        unitAbbreviations: unitAbbrMap,
      });
    },
    [sortedStock, supplierMap, estimatedStock, unitAbbrMap]
  );

  const selectedGroupLabel = useMemo(() => {
    if (!selectedGroupKey) return "";
    return groups.find((g) => g.key === selectedGroupKey)?.label ?? "";
  }, [selectedGroupKey, groups]);

  if (isLoading) {
    return <div className="p-8 text-center text-muted-foreground">Chargement du stock...</div>;
  }

  if (stockError && stock.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <AlertTriangle className="h-12 w-12 text-destructive" />
        <p className="text-lg font-medium text-destructive">Erreur de chargement</p>
        <p className="text-sm text-muted-foreground">
          {(stockError as Error).message || "Une erreur est survenue"}
        </p>
        <Button variant="outline" onClick={() => refetchStock()}>
          Réessayer
        </Button>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="container max-w-7xl py-8 space-y-6">
        {stockError && (
          <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-xl flex items-center justify-between">
            <p className="text-sm text-destructive">
              Erreur lors du chargement du stock : {(stockError as Error).message}
            </p>
            <Button variant="outline" size="sm" onClick={() => refetchStock()}>
              Réessayer
            </Button>
          </div>
        )}

        {isEstimatedStockError && !stockError && (
          <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-xl flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
            <p className="text-sm text-destructive">
              Le calcul du stock estimé a échoué. Les quantités affichées peuvent être incorrectes.
            </p>
          </div>
        )}

        {noZoneCount > 0 && (
          <div className="flex items-center gap-3 p-4 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700">
            <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                {noZoneCount} produit{noZoneCount > 1 ? "s" : ""} sans zone de stockage
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-300">
                Ces produits sont invisibles du stock r\u00e9el et ne peuvent pas \u00eatre
                r\u00e9ceptionn\u00e9s.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="border-amber-400 dark:border-amber-600 text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/40"
              onClick={() => navigate("/produits-v2?filter=no-zone")}
            >
              Corriger maintenant
            </Button>
          </div>
        )}

        {/* Page title */}
        <h1 className="text-xl font-bold text-foreground tracking-tight">Inventaire Produit</h1>

        {/* Toolbar row */}
        <div className="flex items-center gap-2.5 flex-wrap">
          <Select value={displayMode} onValueChange={(v) => setDisplayMode(v as StockDisplayMode)}>
            <SelectTrigger className="h-9 w-[150px] text-xs rounded-lg border-border/60 bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="realtime">Temps réel</SelectItem>
              <SelectItem value="snapshot">Snapshot</SelectItem>
              <SelectItem value="both">Les deux</SelectItem>
            </SelectContent>
          </Select>

          <Select value={groupBy} onValueChange={(v) => handleGroupByChange(v as GroupByMode)}>
            <SelectTrigger className="h-9 w-[165px] text-xs rounded-lg border-border/60 bg-background">
              <LayoutGrid className="h-3.5 w-3.5 mr-1.5 shrink-0 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les produits</SelectItem>
              <SelectItem value="category">Par catégorie</SelectItem>
              <SelectItem value="supplier">Par fournisseur</SelectItem>
              <SelectItem value="zone">Par zone</SelectItem>
            </SelectContent>
          </Select>

          <div className="relative flex-1 min-w-[180px] max-w-xs ml-auto">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Rechercher…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-9 pl-9 text-sm rounded-lg border-border/60 bg-background"
              aria-label="Rechercher un produit"
            />
          </div>

          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-2 text-muted-foreground hover:text-foreground border-border/60"
            onClick={() => navigate("/inventaire/parametres")}
          >
            <Settings className="h-4 w-4" />
            <span className="text-xs">Paramètres</span>
          </Button>
        </div>

        {/* Content */}
        {groupBy !== "all" && !selectedGroupKey ? (
          <InventoryGroupingGrid
            groups={groups}
            selectedGroup={selectedGroupKey}
            onSelectGroup={setSelectedGroupKey}
            onBack={() => setGroupBy("all")}
            mode={groupBy}
            onExportPdf={groupBy === "supplier" ? handleExportSupplierPdf : undefined}
          />
        ) : (
          <>
            {selectedGroupKey && (
              <GroupBackHeader
                label={selectedGroupLabel}
                onBack={() => setSelectedGroupKey(null)}
                onExportPdf={
                  groupBy === "supplier"
                    ? () => handleExportSupplierPdf(selectedGroupKey)
                    : undefined
                }
              />
            )}
            <div className="border rounded-lg bg-card">
              <ProductStockTable
                products={displayProducts}
                dbUnits={dbUnits}
                dbConversions={dbConversions}
                onRowClick={handleRowClick}
                showActiveColumn={hasAnyActiveSession}
                displayMode={displayMode}
                estimatedStock={estimatedStock}
                inTransitStock={inTransitStock}
                mutualisationItems={mutualisationItems}
                inputConfigMap={inputConfigMap}
              />
            </div>
          </>
        )}

        <ProduitsAConfigurer stock={stock} dbUnits={dbUnits} dbConversions={dbConversions} estimatedStock={estimatedStock} />

        <InventoryProductDrawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          stockItem={selectedProduct}
          onStockUpdate={handleUpdate}
          estimatedStock={estimatedStock}
        />
      </div>
    </TooltipProvider>
  );
}

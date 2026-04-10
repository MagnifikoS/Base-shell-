/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PRODUITS V2 — List Page
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Display modes matching Inventory Desktop pattern:
 * - Default: alphabetical A-Z flat list
 * - Group by: Category / Supplier / Zone (card grid → drill-down)
 *
 * CREATION: "+ Nouveau produit" opens Wizard V3 modal directly.
 * The detail page (/produits-v2/:id) is for EXISTING products only.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Truck, MapPin, Package, TrendingUp, Settings2, Loader2 as Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ResponsiveLayout } from "@/components/mobile/ResponsiveLayout";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { ProductV2Header, type ProductGroupByMode } from "../components/ProductV2Header";
import { ProductsV2Table } from "../components/ProductsV2Table";
import { StorageZonesSettings } from "../components/StorageZonesSettings";
import {
  GroupingGrid as InventoryGroupingGrid,
  GroupBackHeader,
  type GroupItem,
} from "@/components/shared/GroupingGrid";
import { getCategoryIcon } from "@/shared/categoryIcons";
import { useProductsV2 } from "../hooks/useProductsV2";
import { useProductCategories } from "../hooks/useProductCategories";
import { useStorageZones } from "../hooks/useStorageZones";
import { useSuppliersList } from "../hooks/useSuppliersList";
import { MobileProductsList } from "../components/MobileProductsList";
import { PriceAlertsList, PriceAlertSettingsPanel, usePriceAlertsEnabled } from "@/modules/priceAlerts";
import { DlcAlertSettingsPanel, DlcRequiredProductsPanel } from "@/modules/dlc";
import { ProductFormV3Modal } from "@/modules/shared/ProductFormV3";
import { lazy, Suspense } from "react";

const InputConfigPage = lazy(() => import("@/modules/inputConfig/pages/InputConfigPage"));

export default function ProduitsV2ListPage() {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { activeEstablishment } = useEstablishment();
  const estId = activeEstablishment?.id;
  const priceAlertsEnabled = usePriceAlertsEnabled(estId);
  const [activeMainTab, setActiveMainTab] = useState("produits");
  const [wizardOpen, setWizardOpen] = useState(false);
  const {
    products,
    isLoading,
    error: productsError,
    refetch: refetchProducts,
    filters,
    setFilters,
    suppliers,
    totalCount,
    filteredCount,
  } = useProductsV2();

  const { categoryNames: categories } = useProductCategories();
  const { zones: storageZones } = useStorageZones();
  const { data: supplierOptions = [] } = useSuppliersList();

  const supplierLogoMap = useMemo(() => {
    const m = new Map<string, string | null>();
    supplierOptions.forEach((s) => m.set(s.id, s.logo_url ?? null));
    return m;
  }, [supplierOptions]);

  // ── Hydrate groupBy / selectedGroupKey from URL query params ──
  const initialGroupBy = (searchParams.get("groupBy") as ProductGroupByMode) || "all";
  const initialGroup = searchParams.get("group") || null;

  const [groupBy, setGroupBy] = useState<ProductGroupByMode>(initialGroupBy);
  const [selectedGroupKey, setSelectedGroupKey] = useState<string | null>(initialGroup);

  // Sync state → URL (without adding history entries)
  const syncSearchParams = useCallback(
    (gb: ProductGroupByMode, gk: string | null) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (gb !== "all") {
          next.set("groupBy", gb);
        } else {
          next.delete("groupBy");
        }
        if (gk) {
          next.set("group", gk);
        } else {
          next.delete("group");
        }
        return next;
      }, { replace: true });
    },
    [setSearchParams],
  );

  // P0-5: Apply ?filter=no-zone from URL on mount
  useEffect(() => {
    if (searchParams.get("filter") === "no-zone") {
      setFilters((prev) => ({ ...prev, storageZone: "__no_zone__" }));
    }
  }, [searchParams, setFilters]);

  const handleCreateClick = () => {
    setWizardOpen(true);
  };

  const handleGroupByChange = (mode: ProductGroupByMode) => {
    setGroupBy(mode);
    setSelectedGroupKey(null);
    syncSearchParams(mode, null);
  };

  const handleSelectGroup = (key: string | null) => {
    setSelectedGroupKey(key);
    syncSearchParams(groupBy, key);
  };

  // Sort alphabetically
  const sortedProducts = useMemo(() => {
    return [...products].sort((a, b) => a.nom_produit.localeCompare(b.nom_produit, "fr"));
  }, [products]);

  // Build groups for grid modes
  const groups = useMemo<GroupItem[]>(() => {
    if (groupBy === "all") return [];

    const map = new Map<string, { label: string; count: number }>();

    for (const item of sortedProducts) {
      let key: string;
      let label: string;

      switch (groupBy) {
        case "category":
          key = item.category_id ?? "__none__";
          label = item.category_name ?? "Sans catégorie";
          break;
        case "supplier":
          key = item.supplier_id ?? "__none__";
          label = item.supplier_display_name ?? "Sans fournisseur";
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
      .sort((a, b) => a.label.localeCompare(b.label, "fr"));
  }, [sortedProducts, groupBy, supplierLogoMap]);

  // Products for current view
  const displayProducts = useMemo(() => {
    if (groupBy === "all" || !selectedGroupKey) return sortedProducts;

    return sortedProducts.filter((item) => {
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
  }, [sortedProducts, groupBy, selectedGroupKey]);

  const selectedGroupLabel = useMemo(() => {
    if (!selectedGroupKey) return "";
    return groups.find((g) => g.key === selectedGroupKey)?.label ?? "";
  }, [selectedGroupKey, groups]);

  if (productsError) {
    return (
      <ResponsiveLayout>
        <div className="container mx-auto py-6 px-4 max-w-7xl">
          <div className="flex flex-col items-center justify-center p-8 text-center">
            <p className="text-destructive font-medium">Une erreur est survenue</p>
            <p className="text-muted-foreground text-sm mt-1">
              Impossible de charger la liste des produits. Veuillez reessayer.
            </p>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => refetchProducts()}>
              Reessayer
            </Button>
          </div>
        </div>
      </ResponsiveLayout>
    );
  }

  return (
    <ResponsiveLayout>
      <div className={isMobile ? "py-3 px-3 space-y-3" : "container mx-auto py-6 px-4 max-w-7xl space-y-6"}>
        {/* Top-level tabs: Produits / Alertes Prix / Paramètres Alertes */}
        <Tabs value={activeMainTab} onValueChange={setActiveMainTab}>
          <TabsList>
            <TabsTrigger value="produits" className="gap-1.5">
              <Package className="h-3.5 w-3.5" />
              Produits
            </TabsTrigger>
            {priceAlertsEnabled && (
              <TabsTrigger value="alertes-prix" className="gap-1.5">
                <TrendingUp className="h-3.5 w-3.5" />
                Alertes Prix
              </TabsTrigger>
            )}
            <TabsTrigger value="parametres-alertes" className="gap-1.5">
              <Settings2 className="h-3.5 w-3.5" />
              Paramètres Alertes
            </TabsTrigger>
            <TabsTrigger value="parametres-saisie" className="gap-1.5">
              <Settings2 className="h-3.5 w-3.5" />
              Param. Saisie
            </TabsTrigger>
          </TabsList>

          <TabsContent value="produits" className="space-y-6 mt-4">
            <ProductV2Header
              filters={filters}
              onFiltersChange={setFilters}
              categories={categories}
              suppliers={suppliers}
              storageZones={storageZones}
              totalCount={totalCount}
              filteredCount={filteredCount}
              onCreateClick={handleCreateClick}
              groupBy={groupBy}
              onGroupByChange={handleGroupByChange}
              allProducts={sortedProducts}
              isMobile={isMobile}
            />
            {!isMobile && (
              <div className="flex justify-end">
                <StorageZonesSettings />
              </div>
            )}

            {groupBy !== "all" && !selectedGroupKey ? (
              <InventoryGroupingGrid
                groups={groups}
                selectedGroup={selectedGroupKey}
                onSelectGroup={handleSelectGroup}
                onBack={() => handleGroupByChange("all")}
                mode={groupBy}
              />
            ) : (
              <>
                {selectedGroupKey && (
                  <GroupBackHeader
                    label={selectedGroupLabel}
                    onBack={() => handleSelectGroup(null)}
                  />
                )}
                {isMobile ? (
                  <MobileProductsList products={displayProducts} isLoading={isLoading} />
                ) : (
                  <ProductsV2Table products={displayProducts} isLoading={isLoading} />
                )}
              </>
            )}
          </TabsContent>

          {priceAlertsEnabled && (
            <TabsContent value="alertes-prix" className="mt-4">
              {estId ? <PriceAlertsList establishmentId={estId} /> : null}
            </TabsContent>
          )}

          <TabsContent value="parametres-alertes" className="mt-4 space-y-6">
            {estId ? <PriceAlertSettingsPanel establishmentId={estId} /> : null}
            <DlcAlertSettingsPanel />
            <DlcRequiredProductsPanel />
          </TabsContent>

          <TabsContent value="parametres-saisie" className="mt-4">
            <Suspense fallback={<div className="flex items-center justify-center p-8"><Loader2Icon className="h-6 w-6 animate-spin text-muted-foreground" /></div>}>
              <InputConfigPage />
            </Suspense>
          </TabsContent>
        </Tabs>
      </div>

      {/* Wizard V3 — seul chemin de création produit */}
      <ProductFormV3Modal
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        initialData={null}
        mode="creation"
      />
    </ResponsiveLayout>
  );
}

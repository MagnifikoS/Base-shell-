/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PRODUITS V2 — ProductV2Header Component
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Clean toolbar matching Inventory Desktop pattern:
 * - Title + count + create button
 * - GroupBy selector (Tous / Catégorie / Fournisseur / Zone)
 * - Search bar
 */

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, X, Plus, LayoutGrid, FileDown } from "lucide-react";
import type { ProductV2Filters, SupplierInfo, ProductV2ListItem } from "../types";
import type { StorageZone } from "../hooks/useStorageZones";
import { generateAllProductsPdf } from "../utils/allProductsPdf";

export type ProductGroupByMode = "all" | "category" | "supplier" | "zone";

interface ProductV2HeaderProps {
  filters: ProductV2Filters;
  onFiltersChange: (
    filters: ProductV2Filters | ((prev: ProductV2Filters) => ProductV2Filters)
  ) => void;
  categories: string[];
  suppliers: SupplierInfo[];
  storageZones: StorageZone[];
  totalCount: number;
  filteredCount: number;
  onCreateClick: () => void;
  groupBy: ProductGroupByMode;
  onGroupByChange: (mode: ProductGroupByMode) => void;
  allProducts: ProductV2ListItem[];
  isMobile?: boolean;
}

export function ProductV2Header({
  filters,
  onFiltersChange,
  categories: _categories,
  suppliers: _suppliers,
  storageZones: _storageZones,
  totalCount,
  filteredCount,
  onCreateClick,
  groupBy,
  onGroupByChange,
  allProducts,
  isMobile = false,
}: ProductV2HeaderProps) {
  const hasActiveFilters =
    filters.search || filters.category || filters.supplier || filters.storageZone;

  const clearFilters = () => {
    onFiltersChange({ search: "", category: null, categoryId: null, supplier: null, storageZone: null });
  };

  if (isMobile) {
    return (
      <div className="space-y-3">
        {/* Title row */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold">Produits</h1>
            <p className="text-muted-foreground text-xs">
              {filteredCount === totalCount
                ? `${totalCount} produit${totalCount > 1 ? "s" : ""}`
                : `${filteredCount} / ${totalCount}`}
            </p>
          </div>
          <Button size="sm" onClick={onCreateClick}>
            <Plus className="h-4 w-4 mr-1" />
            Nouveau
          </Button>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Rechercher..."
            value={filters.search}
            onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
            className="h-9 pl-8 text-sm"
            aria-label="Rechercher un produit"
          />
        </div>

        {/* Group by + clear row */}
        <div className="flex items-center gap-2">
          <Select value={groupBy} onValueChange={(v) => onGroupByChange(v as ProductGroupByMode)}>
            <SelectTrigger className="h-8 text-xs flex-1">
              <LayoutGrid className="h-3 w-3 mr-1 shrink-0" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous</SelectItem>
              <SelectItem value="category">Catégorie</SelectItem>
              <SelectItem value="supplier">Fournisseur</SelectItem>
              <SelectItem value="zone">Zone</SelectItem>
            </SelectContent>
          </Select>
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={clearFilters}>
              <X className="h-3.5 w-3.5 mr-1" />
              Effacer
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Title + Create button */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Produits</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {filteredCount === totalCount
              ? `${totalCount} produit${totalCount > 1 ? "s" : ""}`
              : `${filteredCount} / ${totalCount} produit${totalCount > 1 ? "s" : ""}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void generateAllProductsPdf(allProducts)}
            disabled={allProducts.length === 0}
          >
            <FileDown className="h-4 w-4 mr-2" />
            PDF Catalogue
          </Button>
          <Button onClick={onCreateClick}>
            <Plus className="h-4 w-4 mr-2" />
            Nouveau produit
          </Button>
        </div>
      </div>

      {/* Toolbar row */}
      <div className="flex items-center gap-3 flex-wrap">
        <Select value={groupBy} onValueChange={(v) => onGroupByChange(v as ProductGroupByMode)}>
          <SelectTrigger className="h-9 w-[180px] text-xs">
            <LayoutGrid className="h-3.5 w-3.5 mr-1.5 shrink-0" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous les produits</SelectItem>
            <SelectItem value="category">Par catégorie</SelectItem>
            <SelectItem value="supplier">Par fournisseur</SelectItem>
            <SelectItem value="zone">Par zone</SelectItem>
          </SelectContent>
        </Select>

        <div className="relative flex-1 min-w-[200px] max-w-[400px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Rechercher (nom, code, code-barres)..."
            value={filters.search}
            onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
            className="h-9 pl-8 text-xs"
            aria-label="Rechercher un produit"
          />
        </div>

        {hasActiveFilters && (
          <Button variant="ghost" size="sm" className="h-9" onClick={clearFilters}>
            <X className="h-4 w-4 mr-1" />
            Effacer
          </Button>
        )}
      </div>
    </div>
  );
}

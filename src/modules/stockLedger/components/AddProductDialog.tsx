/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ADD PRODUCT DIALOG — Zone-filtered + global search
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * RULES:
 * - Default: products filtered by zone (inventory_zone_products)
 * - Toggle: "Chercher tous les produits" for global search
 * - Badge "Non assigné à cette zone" for out-of-zone products
 * - Computes context_hash + canonical unit at add time
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useState, useMemo } from "react";
import { normalizeSearch } from "@/utils/normalizeSearch";
import { Search, AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSuppliersList } from "@/modules/produitsV2";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { useUnitConversions } from "@/core/unitConversion";
import { buildCanonicalLine } from "../engine/buildCanonicalLine";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onClose: () => void;
  zoneId: string;
  documentId: string;
  existingProductIds: string[];
  onAdd: (params: {
    documentId: string;
    productId: string;
    deltaQuantity: number;
    canonicalUnitId: string;
    canonicalFamily: string;
    canonicalLabel: string | null;
    contextHash: string;
    inputPayload?: Record<string, unknown>;
  }) => Promise<void>;
}

interface ProductRow {
  id: string;
  nom_produit: string;
  storage_zone_id: string | null;
  supplier_id: string | null;
  final_unit_id: string | null;
  stock_handling_unit_id: string | null;
  supplier_billing_unit_id: string | null;
  delivery_unit_id: string | null;
  conditionnement_config: Record<string, unknown> | null;
}

export function AddProductDialog({
  open,
  onClose,
  zoneId,
  documentId,
  existingProductIds,
  onAdd,
}: Props) {
  const { activeEstablishment } = useEstablishment();
  const estId = activeEstablishment?.id;
  const { data: supplierList = [] } = useSuppliersList();
  const { units: dbUnits, conversions: _dbConversions } = useUnitConversions();
  const [search, setSearch] = useState("");
  const [globalSearch, setGlobalSearch] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);

  // ═══ Load products ═══
  const { data: products = [], isLoading } = useQuery({
    queryKey: ["stock-ledger-products", estId, zoneId, globalSearch],
    queryFn: async () => {
      if (!estId) return [];
      let query = supabase
        .from("products_v2")
        .select(
          "id, nom_produit, storage_zone_id, supplier_id, final_unit_id, stock_handling_unit_id, supplier_billing_unit_id, delivery_unit_id, conditionnement_config"
        )
        .eq("establishment_id", estId)
        .is("archived_at", null);

      if (!globalSearch) {
        query = query.eq("storage_zone_id", zoneId);
      }

      const { data, error } = await query.order("nom_produit").limit(200);
      if (error) throw error;
      return data as ProductRow[];
    },
    enabled: open && !!estId,
  });

  // ═══ Filter by search + exclude already added ═══
  const filtered = useMemo(() => {
    const term = normalizeSearch(search);
    return products.filter((p) => {
      if (existingProductIds.includes(p.id)) return false;
      if (!term) return true;
      return normalizeSearch(p.nom_produit).includes(term);
    });
  }, [products, search, existingProductIds]);

  // ═══ Add product ═══
  const handleAdd = async (product: ProductRow) => {
    setAdding(product.id);
    try {
      // Resolve canonical unit
      const canonicalUnitId = product.stock_handling_unit_id ?? product.final_unit_id;
      if (!canonicalUnitId) {
        toast.error(`Produit "${product.nom_produit}" : unité canonique non définie.`);
        return;
      }

      const canonical = buildCanonicalLine({
        canonicalUnitId,
        product: {
          supplier_billing_unit_id: product.supplier_billing_unit_id,
          conditionnement_config: product.conditionnement_config as unknown as import("@/integrations/supabase/types").Json,
        },
        units: dbUnits,
      });

      await onAdd({
        documentId,
        productId: product.id,
        deltaQuantity: 0, // User will edit quantity after adding
        canonicalUnitId: canonical.canonical_unit_id,
        canonicalFamily: canonical.canonical_family,
        canonicalLabel: canonical.canonical_label,
        contextHash: canonical.context_hash,
        inputPayload: {
          product_name: product.nom_produit,
          supplier_name: product.supplier_id ? (supplierList.find((s) => s.id === product.supplier_id)?.name ?? null) : null,
        },
      });
      onClose();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setAdding(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Ajouter un produit</DialogTitle>
        </DialogHeader>

        {/* Search + toggle */}
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Rechercher un produit..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
              aria-label="Rechercher un produit"
              autoFocus
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch id="global-search" checked={globalSearch} onCheckedChange={setGlobalSearch} />
            <Label htmlFor="global-search" className="text-sm text-muted-foreground">
              Chercher tous les produits
            </Label>
          </div>
        </div>

        {/* Product list */}
        <div className="flex-1 overflow-y-auto mt-2 space-y-1 min-h-0">
          {isLoading ? (
            <p className="text-center text-muted-foreground py-8">Chargement...</p>
          ) : filtered.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">Aucun produit trouvé</p>
          ) : (
            filtered.map((product) => (
              <button
                key={product.id}
                className="w-full text-left px-3 py-2 rounded-md hover:bg-accent transition-colors flex items-center gap-2 disabled:opacity-50"
                onClick={() => handleAdd(product)}
                disabled={adding === product.id}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate uppercase">{product.nom_produit}</p>
                  {product.supplier_id && supplierList.find((s) => s.id === product.supplier_id)?.name && (
                    <p className="text-xs text-muted-foreground truncate">
                      {supplierList.find((s) => s.id === product.supplier_id)?.name}
                    </p>
                  )}
                </div>
                {globalSearch && product.storage_zone_id !== zoneId && (
                  <Badge
                    variant="outline"
                    className="text-xs whitespace-nowrap flex items-center gap-1"
                  >
                    <AlertTriangle className="h-3 w-3" />
                    Hors zone
                  </Badge>
                )}
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

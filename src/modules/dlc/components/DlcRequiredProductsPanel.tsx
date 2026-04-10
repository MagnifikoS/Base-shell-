/**
 * DLC V1 — Panel to toggle "DLC required at reception" per product.
 * Reads/writes products_v2.dlc_required_at_reception.
 *
 * Layout: Category grid → full-page product list on tap.
 */

import { useState, useMemo } from "react";
import { normalizeSearch } from "@/utils/normalizeSearch";
import { ArrowLeft, ClipboardCheck, Search, Loader2, Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { useProductCategories } from "@/modules/produitsV2/hooks/useProductCategories";
import { getCategoryIcon } from "@/shared/categoryIcons";

interface ProductDlcRow {
  id: string;
  nom_produit: string;
  category_id: string | null;
  dlc_required_at_reception: boolean;
}

const QUERY_KEY = "dlc-required-products-settings";

export function DlcRequiredProductsPanel() {
  const { activeEstablishment } = useEstablishment();
  const estId = activeEstablishment?.id ?? null;
  const queryClient = useQueryClient();
  const { categories } = useProductCategories();

  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [categorySearch, setCategorySearch] = useState("");

  // Fetch all products with their DLC required flag
  const { data: products, isLoading } = useQuery({
    queryKey: [QUERY_KEY, estId],
    queryFn: async (): Promise<ProductDlcRow[]> => {
      if (!estId) return [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("products_v2")
        .select("id, nom_produit, category_id, dlc_required_at_reception")
        .eq("establishment_id", estId)
        .is("archived_at", null)
        .order("nom_produit");

      if (error) throw new Error(error.message);
      return (data ?? []) as ProductDlcRow[];
    },
    enabled: !!estId,
    staleTime: 30_000,
  });

  // Toggle mutation
  const toggleMutation = useMutation({
    mutationFn: async ({ productId, required }: { productId: string; required: boolean }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from("products_v2")
        .update({ dlc_required_at_reception: required })
        .eq("id", productId);

      if (error) throw new Error(error.message);
    },
    onMutate: async ({ productId, required }) => {
      await queryClient.cancelQueries({ queryKey: [QUERY_KEY, estId] });
      const previous = queryClient.getQueryData<ProductDlcRow[]>([QUERY_KEY, estId]);
      queryClient.setQueryData<ProductDlcRow[]>([QUERY_KEY, estId], (old) =>
        (old ?? []).map((p) => (p.id === productId ? { ...p, dlc_required_at_reception: required } : p))
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData([QUERY_KEY, estId], context.previous);
      }
      toast.error("Erreur lors de la mise à jour");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY, estId] });
    },
  });

  // Category map
  const categoryMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of categories) map.set(c.id, c.name);
    return map;
  }, [categories]);

  // Count enabled per category + total
  const categoryCounts = useMemo(() => {
    if (!products) return { total: 0, perCategory: new Map<string, { total: number; enabled: number }>() };
    const perCategory = new Map<string, { total: number; enabled: number }>();
    let total = 0;

    for (const p of products) {
      const catId = p.category_id ?? "__uncategorized__";
      const current = perCategory.get(catId) ?? { total: 0, enabled: 0 };
      current.total++;
      if (p.dlc_required_at_reception) {
        current.enabled++;
        total++;
      }
      perCategory.set(catId, current);
    }
    return { total, perCategory };
  }, [products]);

  // Category grid items
  const categoryGroups = useMemo(() => {
    const groups: Array<{ id: string; name: string; total: number; enabled: number }> = [];

    for (const cat of categories) {
      const counts = categoryCounts.perCategory.get(cat.id);
      if (!counts || counts.total === 0) continue;
      groups.push({ id: cat.id, name: cat.name, total: counts.total, enabled: counts.enabled });
    }

    // Uncategorized
    const uncatCounts = categoryCounts.perCategory.get("__uncategorized__");
    if (uncatCounts && uncatCounts.total > 0) {
      groups.push({ id: "__uncategorized__", name: "Divers", total: uncatCounts.total, enabled: uncatCounts.enabled });
    }

    // Filter by search
    if (categorySearch.trim()) {
      const term = categorySearch.toLowerCase();
      return groups.filter((g) => g.name.toLowerCase().includes(term));
    }

    return groups;
  }, [categories, categoryCounts, categorySearch]);

  // Products for selected category
  const categoryProducts = useMemo(() => {
    if (!selectedCategoryId || !products) return [];
    const filtered = products.filter((p) => {
      const catMatch =
        selectedCategoryId === "__uncategorized__"
          ? p.category_id === null
          : p.category_id === selectedCategoryId;
      const searchMatch = !searchTerm || normalizeSearch(p.nom_produit).includes(normalizeSearch(searchTerm));
      return catMatch && searchMatch;
    });
    return filtered;
  }, [selectedCategoryId, products, searchTerm]);

  const selectedCategoryName = useMemo(() => {
    if (!selectedCategoryId) return "";
    if (selectedCategoryId === "__uncategorized__") return "Divers";
    return categoryMap.get(selectedCategoryId) ?? "";
  }, [selectedCategoryId, categoryMap]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // FULL-PAGE: Product list for selected category
  // ═══════════════════════════════════════════════════════════════
  if (selectedCategoryId) {
    const selectedCounts = categoryCounts.perCategory.get(selectedCategoryId);
    const enabledInCat = selectedCounts?.enabled ?? 0;

    return (
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              setSelectedCategoryId(null);
              setSearchTerm("");
            }}
            className="p-2 -ml-2 rounded-xl hover:bg-muted/50 active:scale-95 transition-all"
            aria-label="Retour aux catégories"
          >
            <ArrowLeft className="h-5 w-5 text-foreground" />
          </button>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold tracking-tight">{selectedCategoryName}</h2>
            <p className="text-xs text-muted-foreground">
              {enabledInCat} / {categoryProducts.length + (searchTerm ? 0 : 0)} activé{enabledInCat > 1 ? "s" : ""}
            </p>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Rechercher un produit…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9 rounded-xl bg-muted/30 border-0 focus-visible:ring-1"
          />
        </div>

        {/* Product list */}
        <div className="space-y-1">
          {categoryProducts.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-12">
              Aucun produit trouvé
            </p>
          ) : (
            categoryProducts.map((product) => (
              <div
                key={product.id}
                className="flex items-center justify-between gap-3 px-3 py-3 rounded-xl hover:bg-muted/30 active:bg-muted/50 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium break-words uppercase">{product.nom_produit}</p>
                </div>
                <Switch
                  checked={product.dlc_required_at_reception}
                  onCheckedChange={(checked) => {
                    toggleMutation.mutate({ productId: product.id, required: checked });
                  }}
                />
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // MAIN VIEW: Category grid
  // ═══════════════════════════════════════════════════════════════
  return (
    <div className="space-y-5">
      {/* Title */}
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-xl bg-primary/10">
          <ClipboardCheck className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1">
          <h2 className="text-lg font-semibold tracking-tight">DLC obligatoire</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Activez les produits qui nécessitent une DLC à la réception.
          </p>
        </div>
        {categoryCounts.total > 0 && (
          <Badge variant="secondary" className="shrink-0 rounded-full">
            {categoryCounts.total}
          </Badge>
        )}
      </div>

      {/* Search categories */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Rechercher une catégorie…"
          value={categorySearch}
          onChange={(e) => setCategorySearch(e.target.value)}
          className="pl-9 rounded-xl bg-muted/30 border-0 focus-visible:ring-1"
        />
      </div>

      {/* Category grid */}
      {categoryGroups.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-12">
          Aucune catégorie trouvée
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {categoryGroups.map((group) => {
            const IconComp = getCategoryIcon(group.name);
            const hasEnabled = group.enabled > 0;

            return (
              <button
                key={group.id}
                onClick={() => {
                  setSelectedCategoryId(group.id);
                  setSearchTerm("");
                }}
                className="relative flex flex-col items-center gap-2 p-4 rounded-xl bg-card border border-border/50 hover:border-primary/30 hover:bg-accent/30 active:scale-95 transition-all text-center"
              >
                {/* Enabled indicator */}
                {hasEnabled && (
                  <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                    <Check className="h-3 w-3 text-primary-foreground" />
                  </div>
                )}

                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                  <IconComp className="h-6 w-6 text-primary" />
                </div>

                <div>
                  <p className="text-xs font-medium leading-tight break-words">{group.name}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {group.enabled > 0
                      ? `${group.enabled}/${group.total}`
                      : `${group.total} produit${group.total > 1 ? "s" : ""}`}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Info box */}
      <div className="rounded-xl bg-muted/20 p-3">
        <p className="text-xs text-muted-foreground">
          Quand un produit est activé, le client devra obligatoirement saisir une DLC
          au moment de valider la réception.
        </p>
      </div>
    </div>
  );
}

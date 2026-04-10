/**
 * ═══════════════════════════════════════════════════════════════════════════
 * RECEPTION TOLERANCE SETTINGS — §7 from Reception spec
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Per-product MIN, MAX, and UNIT for reception tolerance.
 * The unit comes from the product's conditioning (pièce, boîte, carton, etc.)
 */

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { useUnits } from "@/hooks/useUnits";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, Save, X } from "lucide-react";
import { toast } from "sonner";
import type { Json } from "@/integrations/supabase/types";

interface ToleranceProduct {
  id: string;
  nom_produit: string;
  reception_tolerance_min: number | null;
  reception_tolerance_max: number | null;
  reception_tolerance_unit_id: string | null;
  stock_handling_unit_id: string | null;
  conditionnement_config: Json | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

/** Extract available unit IDs from a product's conditioning config */
function getProductUnitIds(product: ToleranceProduct): string[] {
  const ids = new Set<string>();
  // Always include stock handling unit (canonical)
  if (product.stock_handling_unit_id) ids.add(product.stock_handling_unit_id);
  // Parse conditioning config for packaging levels
  const config = product.conditionnement_config as Record<string, unknown> | null;
  if (config) {
    // final_unit_id
    if (typeof config.final_unit_id === "string") ids.add(config.final_unit_id);
    // packaging levels
    const levels = (config.packagingLevels ?? config.packaging_levels) as
      | Array<{ type_unit_id?: string; contains_unit_id?: string }>
      | undefined;
    if (Array.isArray(levels)) {
      for (const lvl of levels) {
        if (lvl.type_unit_id) ids.add(lvl.type_unit_id);
        if (lvl.contains_unit_id) ids.add(lvl.contains_unit_id);
      }
    }
    // equivalence unit
    const eq = config.equivalence as { unit_id?: string } | null;
    if (eq?.unit_id) ids.add(eq.unit_id);
    // price level billed_unit_id
    const price = config.priceLevel as { billed_unit_id?: string } | null;
    if (price?.billed_unit_id) ids.add(price.billed_unit_id);
  }
  return Array.from(ids);
}

export function ReceptionToleranceSettings({ open, onClose }: Props) {
  const { activeEstablishment } = useEstablishment();
  const estId = activeEstablishment?.id;
  const queryClient = useQueryClient();
  const { units: allUnits } = useUnits();
  const [search, setSearch] = useState("");
  const [edits, setEdits] = useState<
    Record<string, { min?: string; max?: string; unitId?: string }>
  >({});

  const unitMap = useMemo(() => {
    const m: Record<string, { name: string; abbreviation: string }> = {};
    for (const u of allUnits) m[u.id] = { name: u.name, abbreviation: u.abbreviation };
    return m;
  }, [allUnits]);

  const { data: products = [], isLoading } = useQuery({
    queryKey: ["reception-tolerance", estId],
    queryFn: async (): Promise<ToleranceProduct[]> => {
      if (!estId) return [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).from("products_v2")
        .select(
          "id, nom_produit, reception_tolerance_min, reception_tolerance_max, reception_tolerance_unit_id, stock_handling_unit_id, conditionnement_config"
        )
        .eq("establishment_id", estId)
        .is("archived_at", null)
        .not("stock_handling_unit_id", "is", null)
        .order("nom_produit");
      if (error) throw error;
      return (data ?? []) as ToleranceProduct[];
    },
    enabled: !!estId && open,
  });

  const filtered = useMemo(() => {
    if (!search.trim()) return products;
    const term = search
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    return products.filter((p) =>
      p.nom_produit
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .includes(term)
    );
  }, [products, search]);

  const saveMutation = useMutation({
    mutationFn: async (p: {
      productId: string;
      min: number | null;
      max: number | null;
      unitId: string | null;
    }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).from("products_v2")
        .update({
          reception_tolerance_min: p.min,
          reception_tolerance_max: p.max,
          reception_tolerance_unit_id: p.unitId,
        })
        .eq("id", p.productId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reception-tolerance"] });
      queryClient.invalidateQueries({ queryKey: ["reception-tolerances"] });
      toast.success("Tolérance enregistrée");
    },
    onError: () => toast.error("Erreur lors de la sauvegarde"),
  });

  const parseVal = (v: string | undefined): number | null => {
    if (!v || v.trim() === "") return null;
    const n = parseFloat(v);
    return isNaN(n) || n < 0 ? null : n;
  };

  const handleSave = (p: ToleranceProduct) => {
    const e = edits[p.id] ?? {};
    const minV = parseVal(e.min !== undefined ? e.min : String(p.reception_tolerance_min ?? ""));
    const maxV = parseVal(e.max !== undefined ? e.max : String(p.reception_tolerance_max ?? ""));
    const unitId = e.unitId !== undefined ? e.unitId : p.reception_tolerance_unit_id;

    if (minV !== null && maxV !== null && minV > maxV) {
      toast.error("Le minimum ne peut pas être supérieur au maximum");
      return;
    }

    saveMutation.mutate({
      productId: p.id,
      min: minV,
      max: maxV,
      unitId: unitId || p.stock_handling_unit_id,
    });
    setEdits((prev) => {
      const next = { ...prev };
      delete next[p.id];
      return next;
    });
  };

  const isDirty = (p: ToleranceProduct) => {
    const e = edits[p.id];
    if (!e) return false;
    const origMin = p.reception_tolerance_min != null ? String(p.reception_tolerance_min) : "";
    const origMax = p.reception_tolerance_max != null ? String(p.reception_tolerance_max) : "";
    const origUnit = p.reception_tolerance_unit_id ?? "";
    return (
      (e.min !== undefined && e.min !== origMin) ||
      (e.max !== undefined && e.max !== origMax) ||
      (e.unitId !== undefined && e.unitId !== origUnit)
    );
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-2xl p-0 flex flex-col">
        <SheetHeader className="px-4 pt-4 pb-3 border-b">
          <SheetTitle>Paramètres de tolérance</SheetTitle>
          <SheetDescription>
            Définissez un minimum et maximum par produit avec l'unité. Un avertissement s'affiche si
            la quantité saisie est en dehors de cette plage.
          </SheetDescription>
          <div className="relative mt-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Rechercher un produit..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </SheetHeader>

        <div className="flex items-center gap-2 px-4 py-2 border-b bg-muted/30 text-xs font-medium text-muted-foreground uppercase tracking-wide">
          <span className="flex-1">Produit</span>
          <span className="w-16 text-center">Min</span>
          <span className="w-16 text-center">Max</span>
          <span className="w-24 text-center">Unité</span>
          <span className="w-14" />
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {isLoading ? (
            <p className="text-sm text-muted-foreground text-center py-8">Chargement...</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Aucun produit trouvé</p>
          ) : (
            <div className="space-y-1.5">
              {filtered.map((p) => {
                const e = edits[p.id] ?? {};
                const minD =
                  e.min !== undefined
                    ? e.min
                    : p.reception_tolerance_min != null
                      ? String(p.reception_tolerance_min)
                      : "";
                const maxD =
                  e.max !== undefined
                    ? e.max
                    : p.reception_tolerance_max != null
                      ? String(p.reception_tolerance_max)
                      : "";
                const unitD =
                  e.unitId !== undefined
                    ? e.unitId
                    : (p.reception_tolerance_unit_id ?? p.stock_handling_unit_id ?? "");
                const dirty = isDirty(p);
                const availableUnitIds = getProductUnitIds(p);

                return (
                  <div
                    key={p.id}
                    className={`flex items-center gap-2 py-2 px-3 rounded-lg border ${dirty ? "border-primary/30 bg-primary/5" : "border-border bg-card"}`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate uppercase">{p.nom_produit}</p>
                    </div>
                    <Input
                      type="number"
                      inputMode="decimal"
                      placeholder="—"
                      value={minD}
                      onChange={(ev) =>
                        setEdits((prev) => ({
                          ...prev,
                          [p.id]: { ...prev[p.id], min: ev.target.value },
                        }))
                      }
                      className="w-16 h-8 text-sm text-right"
                      min={0}
                      step="any"
                    />
                    <Input
                      type="number"
                      inputMode="decimal"
                      placeholder="—"
                      value={maxD}
                      onChange={(ev) =>
                        setEdits((prev) => ({
                          ...prev,
                          [p.id]: { ...prev[p.id], max: ev.target.value },
                        }))
                      }
                      className="w-16 h-8 text-sm text-right"
                      min={0}
                      step="any"
                    />
                    <Select
                      value={unitD}
                      onValueChange={(v) =>
                        setEdits((prev) => ({
                          ...prev,
                          [p.id]: { ...prev[p.id], unitId: v },
                        }))
                      }
                    >
                      <SelectTrigger className="w-24 h-8 text-xs">
                        <SelectValue placeholder="Unité" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableUnitIds.map((uid) => {
                          const u = unitMap[uid];
                          return u ? (
                            <SelectItem key={uid} value={uid} className="text-xs">
                              {u.abbreviation || u.name}
                            </SelectItem>
                          ) : null;
                        })}
                      </SelectContent>
                    </Select>
                    <div className="w-14 flex justify-end gap-0.5">
                      {dirty && (
                        <>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => handleSave(p)}
                          >
                            <Save className="h-3.5 w-3.5 text-primary" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() =>
                              setEdits((prev) => {
                                const next = { ...prev };
                                delete next[p.id];
                                return next;
                              })
                            }
                          >
                            <X className="h-3.5 w-3.5 text-muted-foreground" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

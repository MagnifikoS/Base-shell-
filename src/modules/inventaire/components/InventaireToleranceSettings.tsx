/**
 * ═══════════════════════════════════════════════════════════════════════════
 * INVENTAIRE — Paramètres de Tolérance (onglet dans Inventaire Settings)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Affiche TOUS les produits de l'établissement.
 * Les unités disponibles dans le select sont filtrées via resolveProductUnitContext (BFS).
 * Remplace ReceptionToleranceSettings (déplacé depuis Réception → Inventaire).
 *
 * SSOT: les données sont stockées sur products_v2 (reception_tolerance_min/max/unit_id).
 */

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { useUnitConversions } from "@/core/unitConversion";
import {
  resolveProductUnitContext,
  type ProductUnitInput,
} from "@/core/unitConversion/resolveProductUnitContext";
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
  final_unit_id: string | null;
  delivery_unit_id: string | null;
  supplier_billing_unit_id: string | null;
  conditionnement_config: Json | null;
}

export function InventaireToleranceSettings() {
  const { activeEstablishment } = useEstablishment();
  const estId = activeEstablishment?.id;
  const queryClient = useQueryClient();
  const { units: dbUnits, conversions: dbConversions } = useUnitConversions();
  const [search, setSearch] = useState("");
  const [edits, setEdits] = useState<
    Record<string, { min?: string; max?: string; unitId?: string }>
  >({});

  // ── Load ALL products (no filter on stock_handling_unit_id) ──
  const { data: products = [], isLoading } = useQuery({
    queryKey: ["inventaire-tolerance", estId],
    queryFn: async (): Promise<ToleranceProduct[]> => {
      if (!estId) return [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("products_v2")
        .select(
          "id, nom_produit, reception_tolerance_min, reception_tolerance_max, reception_tolerance_unit_id, stock_handling_unit_id, final_unit_id, delivery_unit_id, supplier_billing_unit_id, conditionnement_config"
        )
        .eq("establishment_id", estId)
        .is("archived_at", null)
        .order("nom_produit");
      if (error) throw error;
      return (data ?? []) as ToleranceProduct[];
    },
    enabled: !!estId,
  });

  // ── Filtered list ──
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

  // ── Get allowed units for a product via BFS (SSOT: resolveProductUnitContext) ──
  const getAllowedUnits = (p: ToleranceProduct) => {
    const input: ProductUnitInput = {
      stock_handling_unit_id: p.stock_handling_unit_id,
      final_unit_id: p.final_unit_id,
      delivery_unit_id: p.delivery_unit_id,
      supplier_billing_unit_id: p.supplier_billing_unit_id,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      conditionnement_config: p.conditionnement_config as any,
    };
    const ctx = resolveProductUnitContext(input, dbUnits, dbConversions);
    if (!ctx || ctx.needsConfiguration) return [];
    return ctx.allowedInventoryEntryUnits;
  };

  // ── Mutation ──
  const saveMutation = useMutation({
    mutationFn: async (p: {
      productId: string;
      min: number | null;
      max: number | null;
      unitId: string | null;
    }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from("products_v2")
        .update({
          reception_tolerance_min: p.min,
          reception_tolerance_max: p.max,
          reception_tolerance_unit_id: p.unitId,
        })
        .eq("id", p.productId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventaire-tolerance"] });
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
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-foreground">Tolérance de saisie</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Définissez un minimum et maximum par produit. Un avertissement s'affiche lors de la
          réception ou du retrait si la quantité saisie sort de cette plage.
        </p>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Rechercher un produit…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Column headers */}
      <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30 text-xs font-medium text-muted-foreground uppercase tracking-wide rounded-t-lg">
        <span className="flex-1">Produit</span>
        <span className="w-16 text-center">Min</span>
        <span className="w-16 text-center">Max</span>
        <span className="w-28 text-center">Unité</span>
        <span className="w-14" />
      </div>

      {/* Product list */}
      {isLoading ? (
        <p className="text-sm text-muted-foreground text-center py-8">Chargement…</p>
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
            const allowedUnits = getAllowedUnits(p);
            const hasUnits = allowedUnits.length > 0;

            return (
              <div
                key={p.id}
                className={`flex items-center gap-2 py-2 px-3 rounded-lg border ${dirty ? "border-primary/30 bg-primary/5" : "border-border bg-card"}`}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate uppercase">{p.nom_produit}</p>
                  {!hasUnits && (
                    <p className="text-[10px] text-muted-foreground">Non configuré</p>
                  )}
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
                  disabled={!hasUnits}
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
                  disabled={!hasUnits}
                />
                <Select
                  value={unitD}
                  onValueChange={(v) =>
                    setEdits((prev) => ({
                      ...prev,
                      [p.id]: { ...prev[p.id], unitId: v },
                    }))
                  }
                  disabled={!hasUnits}
                >
                  <SelectTrigger className="w-28 h-8 text-xs">
                    <SelectValue placeholder={hasUnits ? "Unité" : "—"} />
                  </SelectTrigger>
                  <SelectContent>
                    {allowedUnits.map((u) => (
                      <SelectItem key={u.id} value={u.id} className="text-xs">
                        {u.name}
                      </SelectItem>
                    ))}
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
                        disabled={saveMutation.isPending}
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
  );
}

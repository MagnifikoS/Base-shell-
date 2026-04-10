/**
 * ═══════════════════════════════════════════════════════════════════════════
 * INVENTAIRE V0 — Zone Selector (mobile-first grid, colorful)
 * ═══════════════════════════════════════════════════════════════════════════
 * HARDENING P1: Progress bar uses actual lines count (SSOT),
 *               NOT denormalized counted_products from sessions.
 */

import { Package, CheckCircle2, Clock, Circle, ChevronLeft, AlertTriangle } from "lucide-react";
import type { ZoneWithInventoryStatus } from "../types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { useMemo } from "react";

interface ZoneSelectorProps {
  zones: ZoneWithInventoryStatus[];
  onSelectZone: (zone: ZoneWithInventoryStatus) => void;
  onBack: () => void;
}

export function ZoneSelector({ zones, onSelectZone, onBack }: ZoneSelectorProps) {
  const completedCount = zones.filter((z) => z.inventoryStatus === "completed").length;
  const globalProgress = zones.length > 0 ? (completedCount / zones.length) * 100 : 0;
  const { activeEstablishment } = useEstablishment();
  const estId = activeEstablishment?.id;
  const navigate = useNavigate();

  // ── PATCH 1: Count unassigned products ──
  const { data: unassignedCount = 0 } = useQuery({
    queryKey: ["unassigned-products-count", estId],
    queryFn: async () => {
      if (!estId) return 0;
      const { count, error } = await supabase
        .from("products_v2")
        .select("id", { count: "exact", head: true })
        .eq("establishment_id", estId)
        .is("storage_zone_id", null)
        .is("archived_at", null);
      if (error) return 0;
      return count ?? 0;
    },
    enabled: !!estId,
  });

  // ── HARDENING P1: Fetch real lines stats for active sessions (SSOT) ──
  const activeSessionIds = useMemo(
    () =>
      zones
        .filter((z) => z.inventoryStatus === "in_progress" && z.activeSessionId)
        .map((z) => z.activeSessionId!),
    [zones]
  );

  const { data: lineStats = new Map<string, { total: number; counted: number }>() } = useQuery({
    queryKey: ["zone-lines-stats-batch", ...activeSessionIds],
    queryFn: async () => {
      if (activeSessionIds.length === 0)
        return new Map<string, { total: number; counted: number }>();
      const { data, error } = await supabase
        .from("inventory_lines")
        .select("session_id, counted_at")
        .in("session_id", activeSessionIds);
      if (error) return new Map();
      const map = new Map<string, { total: number; counted: number }>();
      for (const row of data ?? []) {
        const prev = map.get(row.session_id) ?? { total: 0, counted: 0 };
        prev.total++;
        if (row.counted_at !== null) prev.counted++;
        map.set(row.session_id, prev);
      }
      return map;
    },
    enabled: activeSessionIds.length > 0,
  });

  if (zones.length === 0) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1">
          <ChevronLeft className="h-4 w-4" /> Retour
        </Button>
        <div className="text-center py-12 text-muted-foreground">
          <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>Aucune zone de stockage configurée.</p>
          <p className="text-sm mt-1">Configurez vos zones dans Produits → Paramètres.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header with back + progress */}
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack} className="gap-1 -ml-2">
            <ChevronLeft className="h-4 w-4" /> Retour
          </Button>
          <h2 className="text-lg font-bold text-foreground flex-1">Zones de stockage</h2>
        </div>

        {/* PATCH 1: Unassigned products warning */}
        {unassignedCount > 0 && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 p-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                {unassignedCount} produit{unassignedCount > 1 ? "s" : ""} sans zone assignée
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
                Ils ne seront pas inclus dans les inventaires.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-2 h-7 text-xs border-amber-400 dark:border-amber-600 text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/40"
                onClick={() => navigate("/produits-v2?filter=no-zone")}
              >
                Assigner maintenant
              </Button>
            </div>
          </div>
        )}

        {/* Global progress */}
        <div className="bg-card border border-border rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Progression globale</span>
            <span className="font-semibold text-primary">
              {completedCount} / {zones.length} zones
            </span>
          </div>
          <Progress value={globalProgress} className="h-2.5" />
        </div>
      </div>

      {/* Zone grid */}
      <div className="grid grid-cols-2 gap-3">
        {zones.map((zone) => {
          // HARDENING P1: Use real lines stats for active sessions
          const stats = zone.activeSessionId ? lineStats.get(zone.activeSessionId) : null;
          const realCounted = stats?.counted ?? zone.countedProducts;
          const realTotal = stats?.total ?? zone.totalProducts;

          return (
            <button
              key={zone.id}
              onClick={() => onSelectZone(zone)}
              className={cn(
                "relative flex flex-col items-center gap-3 p-5 rounded-2xl border-2 transition-all",
                "hover:shadow-lg active:scale-[0.97]",
                zone.inventoryStatus === "completed" &&
                  "border-primary bg-gradient-to-br from-primary/15 to-primary/5 text-primary shadow-sm shadow-primary/10",
                zone.inventoryStatus === "in_progress" &&
                  "border-accent-foreground/30 bg-gradient-to-br from-accent to-accent/50 text-accent-foreground shadow-sm",
                zone.inventoryStatus === "not_started" &&
                  "border-border bg-card text-foreground hover:border-primary/30 hover:bg-primary/5"
              )}
            >
              {/* Status icon */}
              <div
                className={cn(
                  "flex items-center justify-center w-12 h-12 rounded-xl",
                  zone.inventoryStatus === "completed" && "bg-primary/15",
                  zone.inventoryStatus === "in_progress" && "bg-accent-foreground/10",
                  zone.inventoryStatus === "not_started" && "bg-muted"
                )}
              >
                {zone.inventoryStatus === "completed" && <CheckCircle2 className="h-6 w-6" />}
                {zone.inventoryStatus === "in_progress" && <Clock className="h-6 w-6" />}
                {zone.inventoryStatus === "not_started" && (
                  <Circle className="h-6 w-6 opacity-40" />
                )}
              </div>

              <span className="font-semibold text-sm text-center leading-tight">{zone.name}</span>

              {zone.inventoryStatus === "in_progress" && (
                <div className="w-full space-y-1">
                  <Progress
                    value={realTotal > 0 ? (realCounted / realTotal) * 100 : 0}
                    className="h-1.5"
                  />
                  <span className="text-[11px] text-muted-foreground">
                    {realCounted} / {realTotal}
                  </span>
                </div>
              )}
              {zone.inventoryStatus === "completed" && (
                <span className="text-xs font-medium bg-primary/10 px-2 py-0.5 rounded-full">
                  Terminé ✓
                </span>
              )}
              {zone.inventoryStatus === "not_started" && (
                <span className="text-xs text-muted-foreground">Non commencé</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

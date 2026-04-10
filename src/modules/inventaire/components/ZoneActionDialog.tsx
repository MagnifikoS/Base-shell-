/**
 * ═══════════════════════════════════════════════════════════════════════════
 * INVENTAIRE V0 — Zone Action Dialog
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * FIX B2: CTA buttons are based on actual inventory_lines (counted_at),
 *         NOT on inventory_sessions.counted_products
 *
 * Shows when user taps a zone:
 * - not_started → "Commencer"
 * - in_progress + uncounted remain → "Reprendre"
 * - in_progress + all counted → "Terminer"
 * - completed → "Voir résultats" / "Nouveau comptage"
 */

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Play, RotateCcw, Eye, AlertTriangle, Check, Loader2 } from "lucide-react";
import type { ZoneWithInventoryStatus } from "../types";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface ZoneActionDialogProps {
  zone: ZoneWithInventoryStatus | null;
  onClose: () => void;
  onStart: (zoneId: string) => void;
  onResume: (sessionId: string) => void;
  onRestart: (sessionId: string, zoneId: string) => void;
  onViewResults: (sessionId: string) => void;
  onComplete: (sessionId: string) => void;
}

export function ZoneActionDialog({
  zone,
  onClose,
  onStart,
  onResume,
  onRestart,
  onViewResults,
  onComplete,
}: ZoneActionDialogProps) {
  const { activeEstablishment } = useEstablishment();
  const estId = activeEstablishment?.id;

  // PATCH 1: Count unassigned products for display in dialog
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
    enabled: !!estId && !!zone,
  });

  // Count zone products
  const { data: zoneProductCount = 0 } = useQuery({
    queryKey: ["zone-product-count", estId, zone?.id],
    queryFn: async () => {
      if (!estId || !zone) return 0;
      const { count, error } = await supabase
        .from("products_v2")
        .select("id", { count: "exact", head: true })
        .eq("establishment_id", estId)
        .eq("storage_zone_id", zone.id)
        .is("archived_at", null);
      if (error) return 0;
      return count ?? 0;
    },
    enabled: !!estId && !!zone,
  });

  // FIX B2: Fetch ACTUAL lines count from inventory_lines for active session
  // This is the SSOT — NOT inventory_sessions.counted_products
  const { data: linesCount, isLoading: linesCountLoading } = useQuery({
    queryKey: ["zone-lines-count", zone?.activeSessionId],
    queryFn: async () => {
      if (!zone?.activeSessionId) return null;
      const { data, error } = await supabase
        .from("inventory_lines")
        .select("id, counted_at")
        .eq("session_id", zone.activeSessionId);
      if (error) return null;
      const total = data?.length ?? 0;
      const counted = data?.filter((l) => l.counted_at !== null).length ?? 0;
      return { total, counted };
    },
    enabled: !!zone?.activeSessionId,
  });

  if (!zone) return null;

  // Derive CTA state from lines SSOT (for active sessions)
  const hasActiveSession = zone.inventoryStatus === "in_progress" && !!zone.activeSessionId;
  const linesCounted = linesCount?.counted ?? 0;
  const linesTotal = linesCount?.total ?? 0;
  const allLinesCounted =
    hasActiveSession && !linesCountLoading && linesTotal > 0 && linesCounted === linesTotal;
  const _hasUncountedLines = hasActiveSession && !linesCountLoading && linesCounted < linesTotal;

  return (
    <AlertDialog open={!!zone} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{zone.name}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>
                {zone.inventoryStatus === "not_started" &&
                  `Cette zone contient ${zoneProductCount} produit${zoneProductCount > 1 ? "s" : ""}.`}
                {zone.inventoryStatus === "in_progress" &&
                  (linesCountLoading
                    ? "Chargement…"
                    : `Inventaire en cours — ${linesCounted} / ${linesTotal} produits comptés.`)}
                {zone.inventoryStatus === "completed" &&
                  `Inventaire terminé — ${zone.totalProducts} produits comptés.`}
              </p>
              {/* PATCH 1: Unassigned products info */}
              {unassignedCount > 0 && zone.inventoryStatus === "not_started" && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 p-2.5 mt-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    {unassignedCount} produit{unassignedCount > 1 ? "s" : ""} ne sont assignés à
                    aucune zone et ne seront pas inclus.
                  </p>
                </div>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col gap-2 sm:flex-col">
          {zone.inventoryStatus === "not_started" && (
            <Button onClick={() => onStart(zone.id)} className="w-full">
              <Play className="h-4 w-4 mr-2" /> Commencer l'inventaire
            </Button>
          )}

          {zone.inventoryStatus === "in_progress" && (
            <>
              {linesCountLoading ? (
                <Button disabled className="w-full">
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Chargement…
                </Button>
              ) : allLinesCounted ? (
                <Button
                  onClick={() => onComplete(zone.activeSessionId!)}
                  className="w-full"
                  variant="default"
                >
                  <Check className="h-4 w-4 mr-2" /> Terminer l'inventaire
                </Button>
              ) : (
                <Button onClick={() => onResume(zone.activeSessionId!)} className="w-full">
                  <Play className="h-4 w-4 mr-2" /> {linesCounted > 0 ? "Reprendre" : "Commencer"}
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => onRestart(zone.activeSessionId!, zone.id)}
                className="w-full"
              >
                <RotateCcw className="h-4 w-4 mr-2" /> Recommencer
              </Button>
            </>
          )}

          {zone.inventoryStatus === "completed" && (
            <>
              <Button
                onClick={() => {
                  onViewResults(zone.id);
                }}
                className="w-full"
              >
                <Eye className="h-4 w-4 mr-2" /> Voir les résultats
              </Button>
              <Button variant="outline" onClick={() => onStart(zone.id)} className="w-full">
                <RotateCcw className="h-4 w-4 mr-2" /> Nouveau comptage
              </Button>
            </>
          )}

          <AlertDialogCancel className="w-full">Annuler</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

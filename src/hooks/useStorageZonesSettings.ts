/**
 * ═══════════════════════════════════════════════════════════════════════════
 * STORAGE ZONES SETTINGS — Hook for the Settings UI
 * ═══════════════════════════════════════════════════════════════════════════
 * Extends the canonical useStorageZones with archive/restore + inactive toggle.
 * The original useStorageZones (produitsV2) stays untouched for product/stock usage.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface StorageZoneSettings {
  id: string;
  name: string;
  name_normalized: string;
  code: string | null;
  display_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

function normalizeZoneName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function useStorageZonesSettings(includeInactive = false) {
  const { activeEstablishment } = useEstablishment();
  const { user: _user } = useAuth();
  const queryClient = useQueryClient();
  const estId = activeEstablishment?.id;
  const orgId = activeEstablishment?.organization_id;

  const queryKey = ["storage-zones-settings", estId, includeInactive];

  const { data: zones = [], isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      if (!estId) return [];
      let query = supabase
        .from("storage_zones")
        .select("id, name, name_normalized, code, display_order, is_active, created_at, updated_at")
        .eq("establishment_id", estId)
        .order("display_order", { ascending: true })
        .order("name", { ascending: true });

      if (!includeInactive) {
        query = query.eq("is_active", true);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as StorageZoneSettings[];
    },
    enabled: !!estId,
    staleTime: 30_000,
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["storage-zones-settings", estId] });
    queryClient.invalidateQueries({ queryKey: ["storage-zones", estId] });
  };

  const createZone = useMutation({
    mutationFn: async ({ name, code }: { name: string; code?: string }) => {
      if (!estId || !orgId) throw new Error("Pas d'établissement");
      const normalized = normalizeZoneName(name);
      if (!normalized) throw new Error("Nom vide");
      const { error } = await supabase.from("storage_zones").insert({
        establishment_id: estId,
        organization_id: orgId,
        name: name.trim(),
        name_normalized: normalized,
        code: code?.trim() || null,
        display_order: zones.length,
      });
      if (error) {
        if (error.message.includes("uq_storage_zones_establishment_name")) {
          throw new Error("Cette zone existe déjà");
        }
        throw error;
      }
    },
    onSuccess: () => {
      invalidateAll();
      toast.success("Zone ajoutée");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateZone = useMutation({
    mutationFn: async ({ id, name, code }: { id: string; name: string; code?: string }) => {
      const normalized = normalizeZoneName(name);
      if (!normalized) throw new Error("Nom vide");
      const { error } = await supabase
        .from("storage_zones")
        .update({
          name: name.trim(),
          name_normalized: normalized,
          code: code?.trim() || null,
        })
        .eq("id", id);
      if (error) {
        if (error.message.includes("uq_storage_zones_establishment_name")) {
          throw new Error("Cette zone existe déjà");
        }
        throw error;
      }
    },
    onSuccess: () => {
      invalidateAll();
      toast.success("Zone modifiée");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const archiveZone = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("storage_zones")
        .update({ is_active: false })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateAll();
      toast.success("Zone archivée");
    },
    onError: () => toast.error("Erreur lors de l'archivage"),
  });

  const restoreZone = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("storage_zones")
        .update({ is_active: true })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateAll();
      toast.success("Zone réactivée");
    },
    onError: () => toast.error("Erreur lors de la réactivation"),
  });

  const activeZones = zones.filter((z) => z.is_active);
  const archivedZones = zones.filter((z) => !z.is_active);

  return {
    zones,
    activeZones,
    archivedZones,
    isLoading,
    createZone,
    updateZone,
    archiveZone,
    restoreZone,
  };
}

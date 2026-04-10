/**
 * ═══════════════════════════════════════════════════════════════════════════
 * STORAGE ZONES — Hook SSOT
 * ═══════════════════════════════════════════════════════════════════════════
 * Source unique : table storage_zones (scoped establishment_id)
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface StorageZone {
  id: string;
  name: string;
  name_normalized: string;
  display_order: number;
  is_active: boolean;
}

function normalizeZoneName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function useStorageZones() {
  const { activeEstablishment } = useEstablishment();
  const { user: _user } = useAuth();
  const queryClient = useQueryClient();
  const estId = activeEstablishment?.id;
  const orgId = activeEstablishment?.organization_id;

  const queryKey = ["storage-zones", estId];

  const { data: zones = [], isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      if (!estId) return [];
      const { data, error } = await supabase
        .from("storage_zones")
        .select("id, name, name_normalized, display_order, is_active")
        .eq("establishment_id", estId)
        .eq("is_active", true)
        .order("display_order", { ascending: true })
        .order("name", { ascending: true });
      if (error) throw error;
      return data as StorageZone[];
    },
    enabled: !!estId,
    staleTime: 30 * 60 * 1000, // Reference data — rarely changes
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey });

  const addZone = useMutation({
    mutationFn: async (name: string) => {
      if (!estId || !orgId) throw new Error("Pas d'établissement");
      const normalized = normalizeZoneName(name);
      if (!normalized) throw new Error("Nom vide");
      const { error } = await supabase.from("storage_zones").insert({
        establishment_id: estId,
        organization_id: orgId,
        name: name.trim(),
        name_normalized: normalized,
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
      invalidate();
      toast.success("Zone ajoutée");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateZone = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const normalized = normalizeZoneName(name);
      if (!normalized) throw new Error("Nom vide");
      const { error } = await supabase
        .from("storage_zones")
        .update({ name: name.trim(), name_normalized: normalized })
        .eq("id", id);
      if (error) {
        if (error.message.includes("uq_storage_zones_establishment_name")) {
          throw new Error("Cette zone existe déjà");
        }
        throw error;
      }
    },
    onSuccess: () => {
      invalidate();
      toast.success("Zone modifiée");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteZone = useMutation({
    mutationFn: async (id: string) => {
      // Guard: refuse deletion if active products use this zone
      const { count, error: countError } = await supabase
        .from("products_v2")
        .select("id", { count: "exact", head: true })
        .eq("storage_zone_id", id)
        .is("archived_at", null);
      if (countError) throw countError;
      if (count && count > 0) {
        throw new Error(
          `Impossible de supprimer cette zone : ${count} produit(s) actif(s) l'utilisent encore. Réassignez-les d'abord.`
        );
      }
      // Safe: no active products — soft delete
      const { error } = await supabase
        .from("storage_zones")
        .update({ is_active: false })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Zone supprimée");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return { zones, isLoading, addZone, updateZone, deleteZone };
}

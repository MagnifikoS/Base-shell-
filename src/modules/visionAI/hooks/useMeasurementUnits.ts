import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { toast } from "sonner";
import type { MeasurementUnit, MeasurementUnitFormData } from "../types";

export function useMeasurementUnits() {
  const { activeEstablishment } = useEstablishment();
  const queryClient = useQueryClient();

  const establishmentId = activeEstablishment?.id;
  const organizationId = activeEstablishment?.organization_id;

  const query = useQuery({
    queryKey: ["measurement-units", establishmentId],
    queryFn: async () => {
      if (!establishmentId) return [];
      const { data, error } = await supabase
        .from("measurement_units")
        .select(
          "id, name, abbreviation, aliases, category, is_active, is_system, display_order, created_at, updated_at, establishment_id, organization_id, usage_category, family, notes"
        )
        .eq("establishment_id", establishmentId)
        .order("display_order", { ascending: true })
        .order("name");
      if (error) throw error;
      return (data || []) as MeasurementUnit[];
    },
    enabled: !!establishmentId,
  });

  const createMutation = useMutation({
    mutationFn: async (formData: MeasurementUnitFormData) => {
      if (!establishmentId || !organizationId) throw new Error("Missing context");

      // Check for duplicate name (case-insensitive)
      const existing = query.data?.find(
        (u) => u.name.toLowerCase() === formData.name.toLowerCase()
      );
      if (existing) throw new Error("Une unité avec ce nom existe déjà");

      const aliases = formData.aliases
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean);

      const { error } = await supabase.from("measurement_units").insert({
        name: formData.name.trim(),
        abbreviation: formData.abbreviation.trim() || formData.name.trim(),
        aliases,
        is_active: formData.is_active,
        establishment_id: establishmentId,
        organization_id: organizationId,
        category: "custom",
        is_system: false,
        display_order: 100,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["measurement-units"] });
      queryClient.invalidateQueries({ queryKey: ["units"] });
      toast.success("Unité créée");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, formData }: { id: string; formData: MeasurementUnitFormData }) => {
      // Check for duplicate name (case-insensitive), excluding current
      const existing = query.data?.find(
        (u) => u.id !== id && u.name.toLowerCase() === formData.name.toLowerCase()
      );
      if (existing) throw new Error("Une unité avec ce nom existe déjà");

      const aliases = formData.aliases
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean);

      const { error } = await supabase
        .from("measurement_units")
        .update({
          name: formData.name.trim(),
          abbreviation: formData.abbreviation.trim() || formData.name.trim(),
          aliases,
          is_active: formData.is_active,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["measurement-units"] });
      queryClient.invalidateQueries({ queryKey: ["units"] });
      toast.success("Unité modifiée");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("measurement_units").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["measurement-units"] });
      queryClient.invalidateQueries({ queryKey: ["units"] });
      toast.success("Unité supprimée");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase
        .from("measurement_units")
        .update({ is_active, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["measurement-units"] });
      queryClient.invalidateQueries({ queryKey: ["units"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return {
    units: query.data || [],
    isLoading: query.isLoading,
    create: createMutation.mutateAsync,
    update: updateMutation.mutateAsync,
    remove: deleteMutation.mutateAsync,
    toggleActive: toggleActiveMutation.mutateAsync,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
  };
}

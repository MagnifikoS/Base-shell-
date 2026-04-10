import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { toast } from "sonner";
import type { PackagingFormat, PackagingFormatFormData } from "../types";

export function usePackagingFormats() {
  const { activeEstablishment } = useEstablishment();
  const queryClient = useQueryClient();

  const establishmentId = activeEstablishment?.id;
  const organizationId = activeEstablishment?.organization_id;

  const query = useQuery({
    queryKey: ["packaging-formats", establishmentId],
    queryFn: async () => {
      if (!establishmentId) return [];
      const { data, error } = await supabase
        .from("packaging_formats")
        .select(
          "id, label, unit_id, quantity, is_active, created_at, updated_at, establishment_id, organization_id"
        )
        .eq("establishment_id", establishmentId)
        .order("label");
      if (error) throw error;
      return (data || []) as PackagingFormat[];
    },
    enabled: !!establishmentId,
  });

  const createMutation = useMutation({
    mutationFn: async (formData: PackagingFormatFormData) => {
      if (!establishmentId || !organizationId) throw new Error("Missing context");

      // Check for duplicate label (case-insensitive)
      const existing = query.data?.find(
        (p) => p.label.toLowerCase() === formData.label.toLowerCase()
      );
      if (existing) throw new Error("Un conditionnement avec ce libellé existe déjà");

      const { error } = await supabase.from("packaging_formats").insert({
        label: formData.label.trim(),
        unit_id: formData.unit_id,
        quantity: formData.quantity,
        is_active: formData.is_active,
        establishment_id: establishmentId,
        organization_id: organizationId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["packaging-formats"] });
      toast.success("Conditionnement créé");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, formData }: { id: string; formData: PackagingFormatFormData }) => {
      // Check for duplicate label (case-insensitive), excluding current
      const existing = query.data?.find(
        (p) => p.id !== id && p.label.toLowerCase() === formData.label.toLowerCase()
      );
      if (existing) throw new Error("Un conditionnement avec ce libellé existe déjà");

      const { error } = await supabase
        .from("packaging_formats")
        .update({
          label: formData.label.trim(),
          unit_id: formData.unit_id,
          quantity: formData.quantity,
          is_active: formData.is_active,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["packaging-formats"] });
      toast.success("Conditionnement modifié");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      // SSOT: Check usage via UUID (unit_id) not text label
      // A packaging format's unit_id can be used as supplier_billing_unit_id in products
      const format = query.data?.find((f) => f.id === id);
      if (format) {
        // Check if the format's unit_id is used as supplier_billing_unit_id
        const { data: usedByBilling } = await supabase
          .from("products_v2")
          .select("id")
          .eq("establishment_id", establishmentId!)
          .is("archived_at", null)
          .eq("supplier_billing_unit_id", format.unit_id)
          .limit(1);

        if (usedByBilling && usedByBilling.length > 0) {
          throw new Error(
            "Impossible de supprimer : ce conditionnement est utilisé par des produits existants"
          );
        }
      }

      const { error } = await supabase.from("packaging_formats").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["packaging-formats"] });
      toast.success("Conditionnement supprimé");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase
        .from("packaging_formats")
        .update({ is_active, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["packaging-formats"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return {
    formats: query.data || [],
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

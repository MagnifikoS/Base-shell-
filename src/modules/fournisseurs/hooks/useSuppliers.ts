/**
 * Hook for fetching and managing suppliers
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { toast } from "sonner";
import {
  createSupplier,
  updateSupplier,
  archiveSupplier,
  deleteSupplierHard,
  getSupplierProductsCount,
  type SupplierInput,
  type Supplier,
} from "../services/supplierService";

interface UseSuppliers {
  suppliers: Supplier[];
  isLoading: boolean;
  error: Error | null;
  createSupplier: (input: SupplierInput) => Promise<Supplier | null>;
  updateSupplier: (id: string, updates: Partial<SupplierInput>) => Promise<boolean>;
  archiveSupplier: (id: string) => Promise<boolean>;
  deleteSupplierHard: (id: string) => Promise<boolean>;
  getProductsCount: (id: string) => Promise<number>;
  refetch: () => void;
}

export function useSuppliers(): UseSuppliers {
  const { activeEstablishment } = useEstablishment();
  const queryClient = useQueryClient();

  const queryKey = ["suppliers", activeEstablishment?.id];

  const {
    data: suppliers = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey,
    queryFn: async () => {
      if (!activeEstablishment?.id) return [];

      const { data, error } = await supabase
        .from("invoice_suppliers")
        .select(
          "id, name, name_normalized, trade_name, supplier_type, siret, vat_number, internal_code, contact_name, contact_email, contact_phone, notes, billing_address, address_line2, postal_code, city, country, payment_terms, payment_delay_days, payment_method, currency, tags, status, establishment_id, organization_id, created_at, updated_at, archived_at, logo_url"
        )
        .eq("establishment_id", activeEstablishment.id)
        .is("archived_at", null)
        .order("name", { ascending: true })
        .limit(500);

      if (error) throw error;
      return data as Supplier[];
    },
    enabled: !!activeEstablishment?.id,
  });

  const createMutation = useMutation({
    mutationFn: async (input: SupplierInput) => {
      if (!activeEstablishment) throw new Error("Aucun établissement sélectionné");

      const result = await createSupplier({
        ...input,
        establishment_id: activeEstablishment.id,
        organization_id: activeEstablishment.organization_id,
      });

      if (!result.success) throw new Error(result.error);
      return result.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast.success("Fournisseur créé avec succès");
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<SupplierInput> }) => {
      const result = await updateSupplier(id, updates);
      if (!result.success) throw new Error(result.error);
      return result.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast.success("Fournisseur mis à jour");
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const archiveMutation = useMutation({
    mutationFn: async (id: string) => {
      const result = await archiveSupplier(id);
      if (!result.success) throw new Error(result.error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      toast.success("Fournisseur et produits liés archivés");
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const hardDeleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const result = await deleteSupplierHard(id);
      if (!result.success) throw new Error(result.error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      toast.success("Fournisseur et produits supprimés définitivement");
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  return {
    suppliers,
    isLoading,
    error: error as Error | null,
    createSupplier: async (input) => {
      try {
        return await createMutation.mutateAsync(input);
      } catch {
        return null;
      }
    },
    updateSupplier: async (id, updates) => {
      try {
        await updateMutation.mutateAsync({ id, updates });
        return true;
      } catch {
        return false;
      }
    },
    archiveSupplier: async (id) => {
      try {
        await archiveMutation.mutateAsync(id);
        return true;
      } catch {
        return false;
      }
    },
    deleteSupplierHard: async (id) => {
      try {
        await hardDeleteMutation.mutateAsync(id);
        return true;
      } catch {
        return false;
      }
    },
    getProductsCount: async (id) => {
      const result = await getSupplierProductsCount(id);
      return result.success ? result.data! : 0;
    },
    refetch,
  };
}

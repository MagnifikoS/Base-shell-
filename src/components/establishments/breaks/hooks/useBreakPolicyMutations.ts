import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { AnalyzeResult, TestResult, BreakPolicyRecord, TimepointBreakPolicy } from "../types/breakPolicy.types";

export function useBreakPolicyMutations(establishmentId: string | null) {
  const queryClient = useQueryClient();

  const analyzeMutation = useMutation({
    mutationFn: async (inputText: string): Promise<AnalyzeResult> => {
      const response = await supabase.functions.invoke("establishment-breaks", {
        body: {
          action: "analyze",
          input_text: inputText,
        },
      });

      if (response.error) throw new Error(response.error.message);
      return response.data as AnalyzeResult;
    },
  });

  const testMutation = useMutation({
    mutationFn: async ({
      inputText,
      shiftMinutes,
    }: {
      inputText: string;
      shiftMinutes: number;
    }): Promise<TestResult> => {
      const response = await supabase.functions.invoke("establishment-breaks", {
        body: {
          action: "test",
          input_text: inputText,
          shift_minutes: shiftMinutes,
        },
      });

      if (response.error) throw new Error(response.error.message);
      if (response.data.error) throw new Error(response.data.error);
      return response.data as TestResult;
    },
  });

  const createMutation = useMutation({
    mutationFn: async ({ inputText, type }: { inputText: string; type: "DURATION" }): Promise<BreakPolicyRecord> => {
      if (!establishmentId) throw new Error("No establishment selected");

      const response = await supabase.functions.invoke("establishment-breaks", {
        body: {
          action: "create",
          establishment_id: establishmentId,
          input_text: inputText,
          policy_type: type,
        },
      });

      if (response.error) throw new Error(response.error.message);
      if (response.data.error) throw new Error(response.data.error);
      return response.data.policy;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["break-policies", establishmentId] });
      toast.success("Règle enregistrée (inactive)");
    },
    onError: (error: Error) => {
      toast.error(`Erreur: ${error.message}`);
    },
  });

  const createTimepointMutation = useMutation({
    mutationFn: async ({ policy, inputText }: { policy: TimepointBreakPolicy; inputText: string }): Promise<BreakPolicyRecord> => {
      if (!establishmentId) throw new Error("No establishment selected");

      const response = await supabase.functions.invoke("establishment-breaks", {
        body: {
          action: "create_timepoint",
          establishment_id: establishmentId,
          input_text: inputText,
          policy_json: policy,
        },
      });

      if (response.error) throw new Error(response.error.message);
      if (response.data.error) throw new Error(response.data.error);
      return response.data.policy;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["break-policies", establishmentId] });
      toast.success("Règle enregistrée (inactive)");
    },
    onError: (error: Error) => {
      toast.error(`Erreur: ${error.message}`);
    },
  });

  const activateMutation = useMutation({
    mutationFn: async (policyId: string): Promise<BreakPolicyRecord> => {
      const response = await supabase.functions.invoke("establishment-breaks", {
        body: {
          action: "activate",
          policy_id: policyId,
        },
      });

      if (response.error) throw new Error(response.error.message);
      if (response.data.error) throw new Error(response.data.error);
      return response.data.policy;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["break-policies", establishmentId] });
      toast.success("Règle activée");
    },
    onError: (error: Error) => {
      toast.error(`Erreur: ${error.message}`);
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: async (policyId: string): Promise<BreakPolicyRecord> => {
      const response = await supabase.functions.invoke("establishment-breaks", {
        body: {
          action: "deactivate",
          policy_id: policyId,
        },
      });

      if (response.error) throw new Error(response.error.message);
      if (response.data.error) throw new Error(response.data.error);
      return response.data.policy;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["break-policies", establishmentId] });
      toast.success("Règle désactivée");
    },
    onError: (error: Error) => {
      toast.error(`Erreur: ${error.message}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (policyId: string): Promise<void> => {
      const response = await supabase.functions.invoke("establishment-breaks", {
        body: {
          action: "delete",
          policy_id: policyId,
        },
      });

      if (response.error) throw new Error(response.error.message);
      if (response.data.error) throw new Error(response.data.error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["break-policies", establishmentId] });
      toast.success("Règle supprimée");
    },
    onError: (error: Error) => {
      toast.error(`Erreur: ${error.message}`);
    },
  });

  return {
    analyze: analyzeMutation,
    test: testMutation,
    create: createMutation,
    createTimepoint: createTimepointMutation,
    activate: activateMutation,
    deactivate: deactivateMutation,
    delete: deleteMutation,
  };
}

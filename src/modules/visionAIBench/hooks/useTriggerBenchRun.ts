import { useMutation, useQueryClient } from "@tanstack/react-query";
import { triggerBenchRun } from "../services/benchRunService";
import { BENCH_QUERY_KEYS } from "../constants";
import type { BenchRun } from "../types";

interface TriggerParams {
  benchPdfId: string;
  modelId: string;
  modelLabel?: string;
  promptVersion?: string;
}

export function useTriggerBenchRun() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: TriggerParams): Promise<BenchRun> => {
      const result = await triggerBenchRun(params);
      if (!result.success || !result.run) {
        throw new Error(result.error || "Extraction failed");
      }
      return result.run;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: BENCH_QUERY_KEYS.runs(variables.benchPdfId),
      });
    },
  });
}

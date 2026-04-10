import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { BENCH_QUERY_KEYS } from "../constants";
import type { BenchRun } from "../types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export function useBenchRuns(benchPdfId: string | null) {
  return useQuery({
    queryKey: BENCH_QUERY_KEYS.runs(benchPdfId || ""),
    queryFn: async (): Promise<BenchRun[]> => {
      if (!benchPdfId) return [];

      const { data, error } = await db
        .from("bench_runs")
        .select(
          "id, bench_pdf_id, model_id, model_label, prompt_version, source, duration_ms, tokens_input, tokens_output, cost_usd, result_invoice, result_items, result_insights, items_count, insights_count, raw_ai_content, status, error_message, created_at, created_by"
        )
        .eq("bench_pdf_id", benchPdfId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data || []) as BenchRun[];
    },
    enabled: !!benchPdfId,
    staleTime: 10_000,
  });
}

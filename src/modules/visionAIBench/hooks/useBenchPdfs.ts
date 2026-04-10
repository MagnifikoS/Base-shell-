import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { BENCH_QUERY_KEYS } from "../constants";
import type { BenchPdf } from "../types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export function useBenchPdfs(establishmentId: string | null) {
  return useQuery({
    queryKey: BENCH_QUERY_KEYS.pdfs(establishmentId || ""),
    queryFn: async (): Promise<BenchPdf[]> => {
      if (!establishmentId) return [];

      const { data, error } = await db
        .from("bench_pdfs")
        .select("*, bench_runs(id)")
        .eq("establishment_id", establishmentId)
        .order("captured_at", { ascending: false });

      if (error) throw error;

      return ((data || []) as Record<string, unknown>[]).map((row) => ({
        ...row,
        tags: row.tags || [],
        reference_run_id: row.reference_run_id || null,
        runs_count: Array.isArray(row.bench_runs) ? (row.bench_runs as unknown[]).length : 0,
        bench_runs: undefined,
      })) as unknown as BenchPdf[];
    },
    enabled: !!establishmentId,
    staleTime: 30_000,
  });
}

/**
 * Service for triggering benchmark extraction runs via the bench-extract edge function.
 */

import { supabase } from "@/integrations/supabase/client";
import type { BenchRun } from "../types";

interface TriggerRunParams {
  benchPdfId: string;
  modelId: string;
  modelLabel?: string;
  promptVersion?: string;
}

interface TriggerRunResult {
  success: boolean;
  run?: BenchRun;
  error?: string;
}

export async function triggerBenchRun(params: TriggerRunParams): Promise<TriggerRunResult> {
  const { benchPdfId, modelId, modelLabel, promptVersion } = params;

  const { data, error } = await supabase.functions.invoke("bench-extract", {
    body: {
      bench_pdf_id: benchPdfId,
      model_id: modelId,
      model_label: modelLabel,
      prompt_version: promptVersion,
    },
  });

  if (error) {
    return { success: false, error: error.message };
  }

  if (data?.error) {
    return { success: false, error: data.error };
  }

  return { success: true, run: data.run };
}

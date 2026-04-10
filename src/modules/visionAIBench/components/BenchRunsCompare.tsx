import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { BenchRunCard } from "./BenchRunCard";
import { BenchItemsDiff } from "./BenchItemsDiff";
import { BenchModelSelector } from "./BenchModelSelector";
import { useBenchRuns } from "../hooks/useBenchRuns";
import { useTriggerBenchRun } from "../hooks/useTriggerBenchRun";
import { BENCH_MODELS } from "../constants";
import { computeScore } from "../lib/scoring";
import type { BenchPdf, BenchScore } from "../types";
import { Loader2, Play, GitCompare, Star } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { BENCH_QUERY_KEYS } from "../constants";

interface BenchRunsCompareProps {
  pdf: BenchPdf;
  onPdfUpdate?: (pdf: BenchPdf) => void;
}

export function BenchRunsCompare({ pdf, onPdfUpdate }: BenchRunsCompareProps) {
  const { data: runs = [], isLoading } = useBenchRuns(pdf.id);
  const triggerMutation = useTriggerBenchRun();
  const queryClient = useQueryClient();
  const [selectedModel, setSelectedModel] = useState(BENCH_MODELS[0].id);
  const [diffRunIds, setDiffRunIds] = useState<[string, string] | null>(null);
  const [settingRef, setSettingRef] = useState(false);

  const successRuns = runs.filter((r) => r.status === "success");
  const referenceRunId = pdf.reference_run_id;
  const referenceRun = referenceRunId ? runs.find((r) => r.id === referenceRunId) : null;

  // Compute scores for all success runs against the reference
  const scores = useMemo(() => {
    if (!referenceRun) return new Map<string, BenchScore>();
    const map = new Map<string, BenchScore>();
    for (const run of successRuns) {
      if (run.id === referenceRun.id) continue;
      map.set(run.id, computeScore(run, referenceRun, runs));
    }
    return map;
  }, [referenceRun, successRuns, runs]);

  const handleTrigger = () => {
    const model = BENCH_MODELS.find((m) => m.id === selectedModel);
    triggerMutation.mutate(
      {
        benchPdfId: pdf.id,
        modelId: selectedModel,
        modelLabel: model?.label,
      },
      {
        onSuccess: () => {
          toast.success("Extraction terminée");
        },
        onError: (err) => {
          toast.error("Erreur extraction", {
            description: err instanceof Error ? err.message : "Erreur inconnue",
          });
        },
      }
    );
  };

  const handleSetReference = async (runId: string) => {
    setSettingRef(true);
    try {
      const newRefId = runId === referenceRunId ? null : runId;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = supabase as any;
      const { error } = await db
        .from("bench_pdfs")
        .update({ reference_run_id: newRefId })
        .eq("id", pdf.id);

      if (error) throw error;

      const updatedPdf = { ...pdf, reference_run_id: newRefId };
      onPdfUpdate?.(updatedPdf);
      queryClient.invalidateQueries({ queryKey: BENCH_QUERY_KEYS.pdfs(pdf.establishment_id) });
      toast.success(newRefId ? "Référence définie" : "Référence retirée");
    } catch (err) {
      toast.error("Erreur", {
        description: err instanceof Error ? err.message : "Impossible de définir la référence",
      });
    } finally {
      setSettingRef(false);
    }
  };

  const handleToggleDiff = (runId: string) => {
    if (!diffRunIds) {
      setDiffRunIds([runId, ""]);
      return;
    }
    if (diffRunIds[0] === runId) {
      setDiffRunIds(null);
      return;
    }
    if (diffRunIds[1] === runId) {
      setDiffRunIds([diffRunIds[0], ""]);
      return;
    }
    setDiffRunIds([diffRunIds[0], runId]);
  };

  const diffRunA = diffRunIds ? runs.find((r) => r.id === diffRunIds[0]) : null;
  const diffRunB = diffRunIds ? runs.find((r) => r.id === diffRunIds[1]) : null;

  return (
    <div className="space-y-6">
      {/* Header: PDF info + controls */}
      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1">
          <h3 className="text-lg font-semibold">{pdf.original_filename}</h3>
          <p className="text-sm text-muted-foreground">
            {pdf.supplier_name || "Fournisseur inconnu"} · {pdf.invoice_number || "—"} ·{" "}
            {pdf.file_size_bytes ? `${(pdf.file_size_bytes / 1024).toFixed(0)} Ko` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <BenchModelSelector
            value={selectedModel}
            onChange={setSelectedModel}
            disabled={triggerMutation.isPending}
          />
          <Button onClick={handleTrigger} disabled={triggerMutation.isPending} size="sm">
            {triggerMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : (
              <Play className="h-4 w-4 mr-1" />
            )}
            Lancer
          </Button>
        </div>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Chargement des runs...
        </div>
      )}

      {/* Runs grid */}
      {runs.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="text-sm font-medium">{runs.length} run(s)</h4>
            {!referenceRun && successRuns.length >= 2 && (
              <p className="text-xs text-muted-foreground">
                Définissez une référence pour activer le scoring
              </p>
            )}
            {successRuns.length >= 2 && (
              <p className="text-xs text-muted-foreground">
                Cliquez sur 2 runs pour comparer les items
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-4">
            {runs.map((run) => (
              <div key={run.id} className="relative">
                {/* Diff toggle button */}
                {successRuns.length >= 2 && run.status === "success" && (
                  <Button
                    variant={diffRunIds?.includes(run.id) ? "default" : "outline"}
                    size="sm"
                    className="absolute -top-2 -right-2 z-10 h-7 w-7 p-0 rounded-full"
                    onClick={() => handleToggleDiff(run.id)}
                  >
                    <GitCompare className="h-3 w-3" />
                  </Button>
                )}
                {/* Set reference button */}
                {run.status === "success" && (
                  <Button
                    variant={run.id === referenceRunId ? "default" : "outline"}
                    size="sm"
                    className="absolute -top-2 left-2 z-10 h-7 w-7 p-0 rounded-full"
                    onClick={() => handleSetReference(run.id)}
                    disabled={settingRef}
                    title={
                      run.id === referenceRunId ? "Retirer la référence" : "Définir comme référence"
                    }
                  >
                    <Star
                      className={`h-3 w-3 ${run.id === referenceRunId ? "fill-current" : ""}`}
                    />
                  </Button>
                )}
                <BenchRunCard
                  run={run}
                  score={scores.get(run.id) ?? null}
                  isReference={run.id === referenceRunId}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Diff view */}
      {diffRunA && diffRunB && diffRunA.result_items && diffRunB.result_items && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium flex items-center gap-2">
            <GitCompare className="h-4 w-4" />
            Comparaison items: {diffRunA.model_label} vs {diffRunB.model_label}
          </h4>
          <BenchItemsDiff
            itemsA={diffRunA.result_items}
            itemsB={diffRunB.result_items}
            labelA={diffRunA.model_label}
            labelB={diffRunB.model_label}
          />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && runs.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Aucun run pour ce PDF. Sélectionnez un modèle et cliquez sur "Lancer".
        </p>
      )}
    </div>
  );
}

import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { supabase } from "@/integrations/supabase/client";
import { useBenchPdfs } from "../hooks/useBenchPdfs";
import { computeScore, scoreRating } from "../lib/scoring";
import { BENCH_MODELS_MAP, BENCH_QUERY_KEYS } from "../constants";
import type { BenchPdf, BenchRun, BenchScore } from "../types";
import { BarChart3, TrendingUp, DollarSign, Loader2 } from "lucide-react";

interface ModelStats {
  modelId: string;
  label: string;
  provider: string;
  tier: "light" | "standard" | "premium";
  runs: number;
  avgScore: number | null;
  avgItems: number;
  avgDurationMs: number | null;
  avgCostUsd: number | null;
  costPerItem: number | null;
}

export function BenchDashboard() {
  const { activeEstablishment } = useEstablishment();
  const establishmentId = activeEstablishment?.id || null;
  const { data: pdfs = [], isLoading: pdfsLoading } = useBenchPdfs(establishmentId);

  // Fetch all runs for all PDFs using useQueries (hooks-safe)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const runsQueries = useQueries({
    queries: pdfs.map((pdf) => ({
      queryKey: BENCH_QUERY_KEYS.runs(pdf.id),
      queryFn: async (): Promise<BenchRun[]> => {
        const { data, error } = await db
          .from("bench_runs")
          .select(
            "id, bench_pdf_id, model_id, model_label, prompt_version, source, duration_ms, tokens_input, tokens_output, cost_usd, result_invoice, result_items, result_insights, items_count, insights_count, raw_ai_content, status, error_message, created_at, created_by"
          )
          .eq("bench_pdf_id", pdf.id)
          .order("created_at", { ascending: false });
        if (error) throw error;
        return (data || []) as BenchRun[];
      },
      staleTime: 10_000,
    })),
  });

  const isLoading = pdfsLoading || runsQueries.some((q) => q.isLoading);

  // Aggregate all runs and compute scores
  const { modelStats, totalRuns, scoredRuns } = useMemo(() => {
    const allRuns: Array<{ pdf: BenchPdf; run: BenchRun }> = [];
    for (let i = 0; i < pdfs.length; i++) {
      const runs = runsQueries[i]?.data || [];
      for (const run of runs) {
        allRuns.push({ pdf: pdfs[i], run });
      }
    }

    // Group runs by PDF for scoring
    const runsByPdf = new Map<string, { pdf: BenchPdf; runs: BenchRun[] }>();
    for (const { pdf, run } of allRuns) {
      const entry = runsByPdf.get(pdf.id) || { pdf, runs: [] };
      entry.runs.push(run);
      runsByPdf.set(pdf.id, entry);
    }

    // Compute scores for runs with references
    const runScores = new Map<string, BenchScore>();
    for (const { pdf, runs } of runsByPdf.values()) {
      if (!pdf.reference_run_id) continue;
      const refRun = runs.find((r) => r.id === pdf.reference_run_id);
      if (!refRun || refRun.status !== "success") continue;
      for (const run of runs) {
        if (run.id === refRun.id || run.status !== "success") continue;
        runScores.set(run.id, computeScore(run, refRun, runs));
      }
    }

    // Aggregate by model
    const statsMap = new Map<
      string,
      {
        runs: number;
        scores: number[];
        items: number[];
        durations: number[];
        costs: number[];
      }
    >();

    const successRuns = allRuns.filter(({ run }) => run.status === "success");
    for (const { run } of successRuns) {
      const entry = statsMap.get(run.model_id) || {
        runs: 0,
        scores: [],
        items: [],
        durations: [],
        costs: [],
      };
      entry.runs++;
      entry.items.push(run.items_count);
      if (run.duration_ms != null) entry.durations.push(run.duration_ms);
      if (run.cost_usd != null) entry.costs.push(run.cost_usd);
      const score = runScores.get(run.id);
      if (score) entry.scores.push(score.overall);
      statsMap.set(run.model_id, entry);
    }

    const modelStats: ModelStats[] = [];
    for (const [modelId, data] of statsMap) {
      const model = BENCH_MODELS_MAP.get(modelId);
      const avgItems = data.items.length > 0 ? avg(data.items) : 0;
      const avgCost = data.costs.length > 0 ? avg(data.costs) : null;

      modelStats.push({
        modelId,
        label: model?.label || modelId.split("/").pop() || modelId,
        provider: model?.provider || "—",
        tier: model?.tier || "standard",
        runs: data.runs,
        avgScore: data.scores.length > 0 ? Math.round(avg(data.scores)) : null,
        avgItems,
        avgDurationMs: data.durations.length > 0 ? avg(data.durations) : null,
        avgCostUsd: avgCost,
        costPerItem: avgCost != null && avgItems > 0 ? avgCost / avgItems : null,
      });
    }

    // Sort by avg score (nulls last), then by runs count
    modelStats.sort((a, b) => {
      if (a.avgScore != null && b.avgScore != null) return b.avgScore - a.avgScore;
      if (a.avgScore != null) return -1;
      if (b.avgScore != null) return 1;
      return b.runs - a.runs;
    });

    return {
      modelStats,
      totalRuns: successRuns.length,
      scoredRuns: runScores.size,
    };
  }, [pdfs, runsQueries]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground py-12 justify-center">
        <Loader2 className="h-4 w-4 animate-spin" />
        Chargement...
      </div>
    );
  }

  if (pdfs.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p className="text-sm">
          Aucun PDF dans le corpus. Importez des factures via Vision AI pour alimenter le bench.
        </p>
      </div>
    );
  }

  if (modelStats.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p className="text-sm">Aucun run réussi. Lancez des extractions depuis l'onglet Compare.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground font-normal">PDFs</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold tabular-nums">{pdfs.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground font-normal">
              Runs réussis
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold tabular-nums">{totalRuns}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground font-normal">
              Modèles testés
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold tabular-nums">{modelStats.length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Per-model table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            Résumé par modèle
          </CardTitle>
          {scoredRuns === 0 && (
            <p className="text-xs text-muted-foreground">
              Définissez des références sur vos PDFs pour activer le scoring
            </p>
          )}
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Modèle</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead className="text-right">Runs</TableHead>
                  <TableHead className="text-right">Score moyen</TableHead>
                  <TableHead className="text-right">Items moy.</TableHead>
                  <TableHead className="text-right">Durée moy.</TableHead>
                  <TableHead className="text-right">Coût moy.</TableHead>
                  <TableHead className="text-right">Coût/item</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {modelStats.map((m) => (
                  <TableRow key={m.modelId}>
                    <TableCell className="font-medium text-sm">{m.label}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{m.provider}</TableCell>
                    <TableCell>
                      <TierBadge tier={m.tier} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{m.runs}</TableCell>
                    <TableCell className="text-right">
                      {m.avgScore != null ? (
                        <span
                          className={`tabular-nums font-medium ${scoreRating(m.avgScore).className} px-1.5 py-0.5 rounded text-xs`}
                        >
                          {m.avgScore}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {m.avgItems.toFixed(1)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {m.avgDurationMs != null
                        ? m.avgDurationMs >= 1000
                          ? `${(m.avgDurationMs / 1000).toFixed(1)}s`
                          : `${Math.round(m.avgDurationMs)}ms`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {m.avgCostUsd != null
                        ? `$${m.avgCostUsd < 0.01 ? m.avgCostUsd.toFixed(4) : m.avgCostUsd.toFixed(3)}`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {m.costPerItem != null ? `$${m.costPerItem.toFixed(5)}` : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Cost vs Quality summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Coût vs Qualité
          </CardTitle>
        </CardHeader>
        <CardContent>
          <CostQualityChart stats={modelStats} />
        </CardContent>
      </Card>
    </div>
  );
}

function CostQualityChart({ stats }: { stats: ModelStats[] }) {
  const scored = stats.filter((m) => m.avgScore != null && m.avgCostUsd != null);

  if (scored.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-4">
        Définissez des références et lancez des extractions pour voir le rapport coût/qualité
      </p>
    );
  }

  const maxCost = Math.max(...scored.map((m) => m.avgCostUsd!));

  return (
    <div className="space-y-2">
      {scored
        .sort((a, b) => (b.avgScore ?? 0) - (a.avgScore ?? 0))
        .map((m) => {
          const costPct = maxCost > 0 ? ((m.avgCostUsd ?? 0) / maxCost) * 100 : 0;
          const rating = scoreRating(m.avgScore!);
          return (
            <div key={m.modelId} className="flex items-center gap-3 text-sm">
              <span className="w-40 truncate font-medium">{m.label}</span>
              <div className="flex-1 flex items-center gap-2">
                {/* Score bar */}
                <div className="flex-1 h-5 bg-muted rounded-full overflow-hidden relative">
                  <div
                    className={`h-full rounded-full ${rating.className}`}
                    style={{ width: `${m.avgScore}%` }}
                  />
                  <span className="absolute inset-0 flex items-center justify-center text-[10px] font-medium text-white mix-blend-difference">
                    Score {m.avgScore}
                  </span>
                </div>
                {/* Cost indicator */}
                <div className="w-24 flex items-center gap-1 text-xs text-muted-foreground">
                  <DollarSign className="h-3 w-3" />
                  <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-orange-400 dark:bg-orange-500 rounded-full"
                      style={{ width: `${costPct}%` }}
                    />
                  </div>
                </div>
              </div>
              <span className="w-16 text-right text-xs tabular-nums text-muted-foreground">
                $
                {(m.avgCostUsd ?? 0) < 0.01
                  ? (m.avgCostUsd ?? 0).toFixed(4)
                  : (m.avgCostUsd ?? 0).toFixed(3)}
              </span>
            </div>
          );
        })}
    </div>
  );
}

function TierBadge({ tier }: { tier: "light" | "standard" | "premium" }) {
  const classes = {
    light:
      "bg-green-100 text-green-700 dark:text-green-300 dark:bg-green-900/30 dark:text-green-400",
    standard: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    premium: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  };
  return (
    <Badge variant="outline" className={`text-[10px] ${classes[tier]}`}>
      {tier}
    </Badge>
  );
}

function avg(arr: number[]): number {
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

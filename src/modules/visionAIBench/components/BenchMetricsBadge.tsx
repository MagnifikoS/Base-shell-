import { Badge } from "@/components/ui/badge";
import { Clock, DollarSign, Package, Lightbulb } from "lucide-react";
import type { BenchRun } from "../types";

interface BenchMetricsBadgeProps {
  run: BenchRun;
}

export function BenchMetricsBadge({ run }: BenchMetricsBadgeProps) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {run.duration_ms != null && (
        <Badge variant="outline" className="gap-1 text-xs font-normal">
          <Clock className="h-3 w-3" />
          {run.duration_ms >= 1000
            ? `${(run.duration_ms / 1000).toFixed(1)}s`
            : `${run.duration_ms}ms`}
        </Badge>
      )}
      {run.cost_usd != null && (
        <Badge variant="outline" className="gap-1 text-xs font-normal">
          <DollarSign className="h-3 w-3" />$
          {run.cost_usd < 0.01 ? run.cost_usd.toFixed(4) : run.cost_usd.toFixed(3)}
        </Badge>
      )}
      <Badge variant="outline" className="gap-1 text-xs font-normal">
        <Package className="h-3 w-3" />
        {run.items_count} items
      </Badge>
      {run.insights_count > 0 && (
        <Badge variant="outline" className="gap-1 text-xs font-normal">
          <Lightbulb className="h-3 w-3" />
          {run.insights_count} insights
        </Badge>
      )}
    </div>
  );
}

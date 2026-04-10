/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE BRAIN — BrainHealthCards (Fondation v0)
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Cartes de santé globale : total events, sujets actifs, taux acceptation.
 */

import { Card, CardContent } from "@/components/ui/card";
import { Brain, Layers, TrendingUp } from "lucide-react";
import type { HealthSummary } from "../types";

interface BrainHealthCardsProps {
  summary: HealthSummary | null;
  isLoading: boolean;
}

export function BrainHealthCards({ summary, isLoading }: BrainHealthCardsProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <Card key={i} className="animate-pulse">
            <CardContent className="pt-6">
              <div className="h-16 bg-muted rounded" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const totalEvents = summary?.totalEvents ?? 0;
  const activeSubjects = summary?.activeSubjects ?? 0;
  const acceptanceRate = summary?.acceptanceRate ?? 0;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {/* Total apprentissages */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center">
              <Brain className="h-6 w-6 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Apprentissages</p>
              <p className="text-2xl font-semibold">{totalEvents}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Sujets actifs */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-warning/10 flex items-center justify-center">
              <Layers className="h-6 w-6 text-warning" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Sujets actifs</p>
              <p className="text-2xl font-semibold">{activeSubjects}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Taux d'acceptation */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center">
              <TrendingUp className="h-6 w-6 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Taux acceptation</p>
              <p className="text-2xl font-semibold">
                {totalEvents > 0 ? `${Math.round(acceptanceRate * 100)}%` : "—"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

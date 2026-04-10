/**
 * ═══════════════════════════════════════════════════════════════════════════
 * BRAIN SUMMARY HEADER — Synthèse textuelle (Isolé, supprimable)
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Génère une phrase de synthèse "humaine" basée sur des règles simples.
 * AUCUNE IA — règles déterministes uniquement.
 */

import { Brain } from "lucide-react";
import type { BrainSummaryData } from "../types";

interface BrainSummaryHeaderProps {
  data: BrainSummaryData;
}

export function BrainSummaryHeader({ data }: BrainSummaryHeaderProps) {
  const summaryText = generateSummaryText(data);

  return (
    <div className="flex items-start gap-4 p-4 bg-muted/50 rounded-lg border">
      <div className="p-2 rounded-lg bg-primary/10 shrink-0">
        <Brain className="h-6 w-6 text-primary" />
      </div>
      <div className="space-y-1">
        <h3 className="font-medium text-foreground">Synthèse du mois</h3>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {summaryText}
        </p>
      </div>
    </div>
  );
}

/**
 * Génère le texte de synthèse basé sur des règles simples
 */
function generateSummaryText(data: BrainSummaryData): string {
  const parts: string[] = [];

  // Partie 1: Catégorie dominante
  if (data.dominantCategory) {
    parts.push(`Ce mois-ci, vos achats sont dominés par la catégorie "${data.dominantCategory}".`);
  } else if (data.totalDistinctProducts > 0) {
    parts.push(`Ce mois-ci, vous avez acheté ${data.totalDistinctProducts} produit${data.totalDistinctProducts > 1 ? 's' : ''} différent${data.totalDistinctProducts > 1 ? 's' : ''}.`);
  } else {
    return "Aucune donnée d'achat disponible pour ce mois.";
  }

  // Partie 2: Variation vs mois précédent
  if (data.hasPreviousMonth && data.globalDeltaPercent !== null) {
    const absPercent = Math.abs(data.globalDeltaPercent).toFixed(0);
    
    if (data.globalDeltaPercent > 5) {
      parts.push(`Les volumes sont en hausse de ${absPercent}% par rapport au mois précédent.`);
    } else if (data.globalDeltaPercent < -5) {
      parts.push(`Les volumes sont en baisse de ${absPercent}% par rapport au mois précédent.`);
    } else {
      parts.push(`Les volumes sont stables par rapport au mois précédent.`);
    }
  }

  return parts.join(" ");
}

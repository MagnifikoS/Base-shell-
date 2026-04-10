/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ACHATS BRAIN SUMMARY PAGE — Page principale (Isolé, supprimable)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Affiche le résumé THE BRAIN des achats.
 * LECTURE SEULE — aucune mutation.
 *
 * ROLLBACK:
 * - Voir README.md
 */

import { useState, useEffect } from "react";
import { Brain, ArrowLeft, Loader2, AlertCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { ResponsiveLayout } from "@/components/mobile/ResponsiveLayout";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BrainSummaryHeader } from "../components/BrainSummaryHeader";
import { BrainSummaryCards } from "../components/BrainSummaryCards";
import { BrainSummaryTopLists } from "../components/BrainSummaryTopLists";
import { useAvailableMonths, useBrainSummary } from "../hooks/useAchatsBrainSummary";

export default function AchatsBrainSummaryPage() {
  // Mois sélectionné
  const [selectedMonth, setSelectedMonth] = useState<string>("");

  // Récupérer les mois disponibles
  const { data: availableMonths, isLoading: isLoadingMonths } = useAvailableMonths();

  // Définir le mois par défaut une fois les données chargées
  useEffect(() => {
    if (availableMonths && availableMonths.length > 0 && !selectedMonth) {
      setSelectedMonth(availableMonths[0].yearMonth);
    }
  }, [availableMonths, selectedMonth]);

  // Récupérer le résumé pour le mois sélectionné
  const {
    data: summaryData,
    isLoading: isLoadingSummary,
    isError,
    error,
  } = useBrainSummary(selectedMonth);

  const isLoading = isLoadingMonths || isLoadingSummary;

  return (
    <ResponsiveLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link to="/achat">
              <Button variant="ghost" size="icon" className="shrink-0" aria-label="Retour">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div className="p-2 rounded-lg bg-primary/10">
              <Brain className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-foreground">Évolution commande</h1>
              <p className="text-sm text-muted-foreground">Synthèse des achats du mois</p>
            </div>
          </div>

          {/* Sélecteur de mois */}
          <Select
            value={selectedMonth}
            onValueChange={setSelectedMonth}
            disabled={isLoadingMonths || !availableMonths?.length}
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Sélectionner un mois" />
            </SelectTrigger>
            <SelectContent>
              {availableMonths?.map((month) => (
                <SelectItem key={month.yearMonth} value={month.yearMonth}>
                  {month.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Loading state */}
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Error state */}
        {isError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Erreur lors du chargement: {error?.message ?? "Erreur inconnue"}
            </AlertDescription>
          </Alert>
        )}

        {/* Empty state */}
        {!isLoading && !isError && (!availableMonths || availableMonths.length === 0) && (
          <div className="text-center py-12">
            <Brain className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-medium text-foreground mb-2">Aucune donnée d'achat</h3>
            <p className="text-sm text-muted-foreground">
              Importez des factures via Vision AI pour voir les synthèses.
            </p>
          </div>
        )}

        {/* Content */}
        {!isLoading && !isError && summaryData && (
          <div className="space-y-6">
            {/* Synthèse textuelle */}
            <BrainSummaryHeader data={summaryData} />

            {/* Indicateurs */}
            <BrainSummaryCards data={summaryData} />

            {/* Top lists */}
            <BrainSummaryTopLists data={summaryData} />
          </div>
        )}
      </div>
    </ResponsiveLayout>
  );
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MODULE ACHAT — Page Principale (Isolé, supprimable)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Affiche le récap mensuel des achats par produit.
 * Lecture seule — aucun calcul métier.
 *
 * ROLLBACK:
 * - Supprimer src/modules/achat/
 * - Retirer l'entrée dans navRegistry.ts et sidebarSections.ts
 * - Retirer la route dans App.tsx
 * - DROP TABLE purchase_line_items;
 */

import { useState } from "react";
import { format } from "date-fns";
import { ShoppingCart, AlertCircle, Brain } from "lucide-react";
import { Link } from "react-router-dom";
import { ResponsiveLayout } from "@/components/mobile/ResponsiveLayout";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MonthSelector } from "./components/MonthSelector";
import { PurchaseSummaryGroupedBySupplier } from "./components/PurchaseSummaryGroupedBySupplier";
import { BrainPriceEvolutionModal } from "./components/BrainPriceEvolutionModal";
import { usePurchases } from "./hooks/usePurchases";
import { usePriceEvolutionEvents } from "./hooks/usePriceEvolutionEvents";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { THE_BRAIN_DISABLED } from "@/modules/theBrain";

export default function AchatPage() {
  // Mois courant par défaut
  const [yearMonth, setYearMonth] = useState(() => format(new Date(), "yyyy-MM"));
  const [brainModalOpen, setBrainModalOpen] = useState(false);

  const { activeEstablishment } = useEstablishment();
  const establishmentId = activeEstablishment?.id;

  const { data, isLoading, isError, error } = usePurchases({ yearMonth });
  const { data: priceEvolutionData } = usePriceEvolutionEvents(yearMonth);

  // L'icône 🧠 n'est visible que si THE_BRAIN est activé ET s'il y a des données
  const showBrainIcon = !THE_BRAIN_DISABLED && priceEvolutionData?.hasData;

  return (
    <ResponsiveLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <ShoppingCart className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-foreground">Achats</h1>
              <p className="text-sm text-muted-foreground">
                Récap mensuel des quantités achetées par produit
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Icône 🧠 — visible uniquement si données price_evolution */}
            {showBrainIcon && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setBrainModalOpen(true)}
                    aria-label="Voir l'évolution de prix"
                  >
                    <Brain className="h-4 w-4 text-primary" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Évolution de prix</p>
                </TooltipContent>
              </Tooltip>
            )}

            <Link to="/achat/the-brain-summary">
              <Button variant="outline" size="sm" className="gap-2">
                <Brain className="h-4 w-4" />
                <span className="hidden sm:inline">Évolution commande</span>
              </Button>
            </Link>
            <MonthSelector yearMonth={yearMonth} onChange={setYearMonth} />
          </div>
        </div>

        {/* Erreur */}
        {isError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Erreur lors du chargement des achats: {error?.message ?? "Erreur inconnue"}
            </AlertDescription>
          </Alert>
        )}

        {/* Tableau */}
        <PurchaseSummaryGroupedBySupplier
          data={data}
          isLoading={isLoading}
          establishmentId={establishmentId}
          yearMonth={yearMonth}
        />
      </div>

      {/* Modal THE BRAIN — Prix */}
      {priceEvolutionData && (
        <BrainPriceEvolutionModal
          open={brainModalOpen}
          onOpenChange={setBrainModalOpen}
          synthesis={priceEvolutionData}
          yearMonth={yearMonth}
        />
      )}
    </ResponsiveLayout>
  );
}

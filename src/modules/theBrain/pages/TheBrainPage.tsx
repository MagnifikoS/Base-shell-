/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE BRAIN — Page principale (Fondation v0)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Journal d'apprentissage observable.
 * Module isolé et supprimable.
 */

import { useState, useEffect } from "react";
import { Brain, RefreshCw, BarChart3, Activity, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ResponsiveLayout } from "@/components/mobile/ResponsiveLayout";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useBrainHealth } from "../hooks/useBrainHealth";
import { BrainHealthCards } from "../components/BrainHealthCards";
import { BrainSubjectsTable } from "../components/BrainSubjectsTable";
import { BrainEventsTable } from "../components/BrainEventsTable";
import { BrainNiveauTable } from "../components/BrainNiveauTable";
import { BrainSupplierNiveauTable } from "../components/BrainSupplierNiveauTable";
import { getProductMatchingRules } from "../services/theBrainService";
import { getSupplierMatchingRules } from "../services/supplierMatchingService";
import { THE_BRAIN_DISABLED } from "../constants";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { cn } from "@/lib/utils";
import type { DateRange, ProductMatchingRuleDisplay, SupplierMatchingRuleDisplay } from "../types";

type TabView = "overview" | "niveau";

export function TheBrainPage() {
  const [range, setRange] = useState<DateRange>("7d");
  const [activeTab, setActiveTab] = useState<TabView>("overview");
  const [niveauRules, setNiveauRules] = useState<ProductMatchingRuleDisplay[]>([]);
  const [supplierNiveauRules, setSupplierNiveauRules] = useState<SupplierMatchingRuleDisplay[]>([]);
  const [niveauLoading, setNiveauLoading] = useState(false);

  // Collapsible states for Vue générale
  const [subjectsOpen, setSubjectsOpen] = useState(true);
  const [eventsOpen, setEventsOpen] = useState(false);

  // Collapsible states for Niveau
  const [productMatchingOpen, setProductMatchingOpen] = useState(true);
  const [supplierMatchingOpen, setSupplierMatchingOpen] = useState(false);

  const { activeEstablishment } = useEstablishment();
  const establishmentId = activeEstablishment?.id;

  const { summary, subjects, recentEvents, isLoading, refetch } = useBrainHealth({
    range,
    enabled: true,
  });

  // Charger les règles Niveau (Product + Supplier) quand l'onglet est actif
  useEffect(() => {
    if (activeTab === "niveau" && establishmentId && !THE_BRAIN_DISABLED) {
      setNiveauLoading(true);
      Promise.all([
        getProductMatchingRules(establishmentId),
        getSupplierMatchingRules(establishmentId),
      ])
        .then(([productRules, supplierRules]) => {
          setNiveauRules(productRules);
          setSupplierNiveauRules(supplierRules);
        })
        .finally(() => setNiveauLoading(false));
    }
  }, [activeTab, establishmentId]);

  const handleRefresh = () => {
    refetch();
    if (activeTab === "niveau" && establishmentId) {
      setNiveauLoading(true);
      Promise.all([
        getProductMatchingRules(establishmentId),
        getSupplierMatchingRules(establishmentId),
      ])
        .then(([productRules, supplierRules]) => {
          setNiveauRules(productRules);
          setSupplierNiveauRules(supplierRules);
        })
        .finally(() => setNiveauLoading(false));
    }
  };

  return (
    <ResponsiveLayout>
      <div className="container mx-auto py-6 px-4 max-w-5xl space-y-6">
        {/* Header — fixed layout regardless of tab */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
              <Brain className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">THE BRAIN</h1>
              <p className="text-sm text-muted-foreground">
                Journal d'apprentissage observable (fondation)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Tab buttons — always visible and fixed position */}
            <div className="flex border border-border rounded-lg overflow-hidden">
              <button
                onClick={() => setActiveTab("overview")}
                className={`px-3 py-1.5 text-sm transition-colors flex items-center gap-1.5 ${
                  activeTab === "overview"
                    ? "bg-primary text-primary-foreground"
                    : "bg-background hover:bg-muted"
                }`}
              >
                <Activity className="h-3.5 w-3.5" />
                Vue générale
              </button>
              <button
                onClick={() => setActiveTab("niveau")}
                className={`px-3 py-1.5 text-sm transition-colors flex items-center gap-1.5 ${
                  activeTab === "niveau"
                    ? "bg-primary text-primary-foreground"
                    : "bg-background hover:bg-muted"
                }`}
                disabled={THE_BRAIN_DISABLED}
              >
                <BarChart3 className="h-3.5 w-3.5" />
                Niveau
              </button>
            </div>

            {/* Période toggle (only for overview) */}
            {activeTab === "overview" && (
              <div className="flex border border-border rounded-lg overflow-hidden">
                <button
                  onClick={() => setRange("7d")}
                  className={`px-3 py-1.5 text-sm transition-colors ${
                    range === "7d"
                      ? "bg-primary text-primary-foreground"
                      : "bg-background hover:bg-muted"
                  }`}
                >
                  7 jours
                </button>
                <button
                  onClick={() => setRange("30d")}
                  className={`px-3 py-1.5 text-sm transition-colors ${
                    range === "30d"
                      ? "bg-primary text-primary-foreground"
                      : "bg-background hover:bg-muted"
                  }`}
                >
                  30 jours
                </button>
              </div>
            )}

            {/* Refresh */}
            <Button
              variant="ghost"
              size="icon"
              onClick={handleRefresh}
              disabled={isLoading || niveauLoading}
              aria-label="Actualiser"
            >
              <RefreshCw
                className={`h-4 w-4 ${isLoading || niveauLoading ? "animate-spin" : ""}`}
              />
            </Button>
          </div>
        </div>

        {/* Content based on active tab */}
        {activeTab === "overview" ? (
          <div className="space-y-4">
            {/* Section 1: Santé globale — always visible */}
            <section>
              <h2 className="text-sm font-medium text-muted-foreground mb-3">Santé globale</h2>
              <BrainHealthCards summary={summary} isLoading={isLoading} />
            </section>

            {/* Section 2: Sujets — collapsible */}
            <Collapsible open={subjectsOpen} onOpenChange={setSubjectsOpen}>
              <CollapsibleTrigger asChild>
                <button className="flex items-center justify-between w-full p-4 bg-card border rounded-lg hover:bg-muted/50 transition-colors">
                  <span className="font-medium">Sujets</span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">
                      {subjects.length} sujet(s)
                    </span>
                    <ChevronDown
                      className={cn("h-4 w-4 transition-transform", subjectsOpen && "rotate-180")}
                    />
                  </div>
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2">
                <BrainSubjectsTable subjects={subjects} isLoading={isLoading} />
              </CollapsibleContent>
            </Collapsible>

            {/* Section 3: Événements récents — collapsible */}
            <Collapsible open={eventsOpen} onOpenChange={setEventsOpen}>
              <CollapsibleTrigger asChild>
                <button className="flex items-center justify-between w-full p-4 bg-card border rounded-lg hover:bg-muted/50 transition-colors">
                  <span className="font-medium">Événements récents</span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">
                      {recentEvents.length} événement(s)
                    </span>
                    <ChevronDown
                      className={cn("h-4 w-4 transition-transform", eventsOpen && "rotate-180")}
                    />
                  </div>
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2">
                <BrainEventsTable events={recentEvents} isLoading={isLoading} />
              </CollapsibleContent>
            </Collapsible>
          </div>
        ) : (
          /* Section Niveau — collapsible sub-sections */
          <div className="space-y-4">
            {THE_BRAIN_DISABLED ? (
              <div className="text-center py-12 text-muted-foreground">
                Analyse indisponible (THE BRAIN désactivé)
              </div>
            ) : (
              <>
                {/* Product Matching — collapsible */}
                <Collapsible open={productMatchingOpen} onOpenChange={setProductMatchingOpen}>
                  <CollapsibleTrigger asChild>
                    <button className="flex items-center justify-between w-full p-4 bg-card border rounded-lg hover:bg-muted/50 transition-colors">
                      <span className="font-medium">Product Matching</span>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">
                          {niveauRules.length} règle(s)
                        </span>
                        <ChevronDown
                          className={cn(
                            "h-4 w-4 transition-transform",
                            productMatchingOpen && "rotate-180"
                          )}
                        />
                      </div>
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-2">
                    <BrainNiveauTable rules={niveauRules} isLoading={niveauLoading} />
                  </CollapsibleContent>
                </Collapsible>

                {/* Supplier Matching — collapsible */}
                <Collapsible open={supplierMatchingOpen} onOpenChange={setSupplierMatchingOpen}>
                  <CollapsibleTrigger asChild>
                    <button className="flex items-center justify-between w-full p-4 bg-card border rounded-lg hover:bg-muted/50 transition-colors">
                      <span className="font-medium">Supplier Matching</span>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">
                          {supplierNiveauRules.length} règle(s)
                        </span>
                        <ChevronDown
                          className={cn(
                            "h-4 w-4 transition-transform",
                            supplierMatchingOpen && "rotate-180"
                          )}
                        />
                      </div>
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-2">
                    <BrainSupplierNiveauTable
                      rules={supplierNiveauRules}
                      isLoading={niveauLoading}
                    />
                  </CollapsibleContent>
                </Collapsible>
              </>
            )}
          </div>
        )}
      </div>
    </ResponsiveLayout>
  );
}

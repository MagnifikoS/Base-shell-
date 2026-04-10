/**
 * Gestion du Personnel page - Admin only
 * Phase 1: UI structure + move existing views from Badgeuse
 * Phase 2: Demandes tab for pending extra validation
 * Sub-tabs: Retards, Absences, Extras, Demandes
 */

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Clock, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ExtraTab } from "@/components/presence/ExtraTab";
import { RetardTab } from "@/components/presence/RetardTab";
import { DemandesTab } from "@/components/presence/DemandesTab";
import { ResponsiveLayout } from "@/components/mobile/ResponsiveLayout";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useExtraMonthlyData } from "@/hooks/presence/useExtraData";
import { useEstablishmentAccess } from "@/hooks/useEstablishmentAccess";

import { getCurrentParisMonth } from "@/lib/time/paris";

export default function GestionPersonnel() {
  const { activeEstablishmentId: selectedEstablishmentId } = useEstablishmentAccess();
  const isMobile = useIsMobile();

  // Single hook call for badge + DemandesTab (no duplicate fetch)
  const yearMonth = getCurrentParisMonth();
  const { summaries, isLoading, error, refetch } = useExtraMonthlyData(yearMonth, {
    establishmentId: selectedEstablishmentId,
  });
  const totalPending = summaries.reduce((acc, s) => acc + s.pendingCount, 0);

  return (
    <ResponsiveLayout>
      <div className={isMobile ? "px-3 py-3 space-y-3" : "space-y-6"}>
        <h1 className={isMobile ? "text-lg font-semibold text-foreground" : "text-2xl font-semibold text-foreground"}>
          Gestion du personnel
        </h1>

        {/* Error state */}
        {error && (
          <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-xl flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0" />
              <p className="text-sm text-destructive">
                {error.message || "Une erreur est survenue"}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Réessayer
            </Button>
          </div>
        )}

        <Tabs defaultValue="retards" className="w-full">
          {isMobile ? (
            <TabsList className="w-full grid grid-cols-3 h-12 mb-3">
              <TabsTrigger value="retards" className="flex flex-col items-center gap-0.5 text-[10px] py-1.5">
                <AlertTriangle className="h-4 w-4" />
                Retards
              </TabsTrigger>
              <TabsTrigger value="extras" className="flex flex-col items-center gap-0.5 text-[10px] py-1.5">
                <Clock className="h-4 w-4" />
                Extras
              </TabsTrigger>
              <TabsTrigger value="demandes" className="flex flex-col items-center gap-0.5 text-[10px] py-1.5 relative">
                <FileText className="h-4 w-4" />
                Demandes
                {totalPending > 0 && (
                  <Badge
                    variant="secondary"
                    className="absolute -top-1 -right-1 h-4 min-w-4 px-1 text-[9px] bg-amber-100 text-amber-700 dark:text-amber-300 dark:bg-amber-900/30"
                  >
                    {totalPending}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>
          ) : (
            <TabsList className="inline-flex h-10 items-center justify-start rounded-md bg-muted p-1 text-muted-foreground">
              <TabsTrigger value="retards" className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                Retards
              </TabsTrigger>
              <TabsTrigger value="extras" className="flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Extras
              </TabsTrigger>
              <TabsTrigger value="demandes" className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Demandes
                {totalPending > 0 && (
                  <Badge
                    variant="secondary"
                    className="ml-1 h-5 min-w-5 px-1.5 bg-amber-100 text-amber-700 dark:text-amber-300 dark:bg-amber-900/30"
                  >
                    {totalPending}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>
          )}

          {/* Retards Tab */}
          <TabsContent value="retards" className={isMobile ? "mt-3" : "mt-6"}>
            <RetardTab establishmentId={selectedEstablishmentId} />
          </TabsContent>

          {/* Extras Tab */}
          <TabsContent value="extras" className={isMobile ? "mt-3" : "mt-6"}>
            <ExtraTab establishmentId={selectedEstablishmentId} />
          </TabsContent>

          {/* Demandes Tab */}
          <TabsContent value="demandes" className={isMobile ? "mt-3" : "mt-6"}>
            <DemandesTab
              establishmentId={selectedEstablishmentId}
              summaries={summaries}
              isLoadingSummaries={isLoading}
              onRefresh={refetch}
            />
          </TabsContent>
        </Tabs>
      </div>
    </ResponsiveLayout>
  );
}

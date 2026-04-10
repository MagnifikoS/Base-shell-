/**
 * ═══════════════════════════════════════════════════════════════════════════
 * INVENTAIRE — Paramètres (Unités + Tolérance)
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useState } from "react";
import { ResponsiveLayout } from "@/components/mobile/ResponsiveLayout";
import { UnifiedUnitsSettings } from "@/components/settings/UnifiedUnitsSettings";
import { InventaireToleranceSettings } from "../components/InventaireToleranceSettings";
import { MutualisationToggle, GroupManagerPanel } from "@/modules/inventaireMutualisation";
import { useMutualisationEnabled } from "@/modules/inventaireMutualisation";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

function MutualisationGroupSection() {
  const { enabled } = useMutualisationEnabled();
  if (!enabled) return null;
  return <GroupManagerPanel />;
}

export default function InventaireSettingsPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<"units" | "tolerance" | "mutualisation">("units");

  return (
    <ResponsiveLayout>
      <div className="container max-w-5xl py-6 px-4 space-y-6">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/inventaire")}
            aria-label="Retour à l'inventaire"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Paramètres Inventaire</h1>
            <p className="text-sm text-muted-foreground">
              Gestion des unités de mesure et tolérances de saisie
            </p>
          </div>
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as "units" | "tolerance" | "mutualisation")}>
          <TabsList className="grid w-full grid-cols-3 max-w-md">
            <TabsTrigger value="units">Unités</TabsTrigger>
            <TabsTrigger value="tolerance">Tolérance</TabsTrigger>
            <TabsTrigger value="mutualisation">Mutualisation</TabsTrigger>
          </TabsList>

          <TabsContent value="units" className="mt-6">
            <UnifiedUnitsSettings />
          </TabsContent>

          <TabsContent value="tolerance" className="mt-6">
            <InventaireToleranceSettings />
          </TabsContent>

          <TabsContent value="mutualisation" className="mt-6 space-y-6">
            <MutualisationToggle />
            <MutualisationGroupSection />
          </TabsContent>
        </Tabs>
      </div>
    </ResponsiveLayout>
  );
}

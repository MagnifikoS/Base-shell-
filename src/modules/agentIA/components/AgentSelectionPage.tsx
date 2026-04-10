/**
 * Agent IA — Selection page.
 * Lists available AI agents. V1: only "Agent Produit".
 * Isolated — removing this file has zero impact on the app.
 */

import { useNavigate } from "react-router-dom";
import { Package } from "lucide-react";
import { ResponsiveLayout } from "@/components/mobile/ResponsiveLayout";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

const agents = [
  {
    id: "produit",
    label: "Agent Produit",
    description: "Extraction intelligente de produits depuis vos factures fournisseurs",
    icon: Package,
    route: "/agent-ia/produit",
  },
] as const;

export function AgentSelectionPage() {
  const navigate = useNavigate();

  return (
    <ResponsiveLayout>
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Agent IA</h1>
        <p className="text-muted-foreground mt-1">
          Sélectionnez un agent pour commencer.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {agents.map((agent) => (
          <Card
            key={agent.id}
            className="cursor-pointer hover:border-primary/50 transition-colors"
            onClick={() => navigate(agent.route)}
          >
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10 text-primary">
                  <agent.icon className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle className="text-base">{agent.label}</CardTitle>
                  <CardDescription className="text-sm">
                    {agent.description}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
          </Card>
        ))}
      </div>
    </div>
    </ResponsiveLayout>
  );
}

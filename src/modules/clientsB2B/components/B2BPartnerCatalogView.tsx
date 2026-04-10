/**
 * Vue tabulée du catalogue partenaire B2B.
 * Tab "Catalogue produits" = B2BCatalogBrowser existant (inchangé)
 * Tab "Catalogue recettes" = B2BRecipeCatalog dédié (nouveau)
 *
 * L'onglet recettes n'apparaît QUE si le fournisseur a ≥1 recette publiée.
 * Aucun composant existant n'est modifié.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { B2BCatalogBrowser } from "./B2BCatalogBrowser";
import { B2BRecipeCatalog } from "./B2BRecipeCatalog";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

interface Props {
  partnershipId: string;
  partnerName: string;
  onBack: () => void;
}

type CatalogTab = "products" | "recipes";

export function B2BPartnerCatalogView({ partnershipId, partnerName, onBack }: Props) {
  const [activeTab, setActiveTab] = useState<CatalogTab>("products");

  // Resolve supplier establishment id from partnership
  const { data: partnership } = useQuery({
    queryKey: ["b2b-partnership-detail", partnershipId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("b2b_partnerships")
        .select("supplier_establishment_id")
        .eq("id", partnershipId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!partnershipId,
  });

  const supplierEstId = partnership?.supplier_establishment_id;

  // Check if supplier has any published recipe listings
  const { data: recipeCount } = useQuery({
    queryKey: ["b2b-recipe-catalogue-count", supplierEstId],
    queryFn: async () => {
      if (!supplierEstId) return 0;
      const { count, error } = await supabase
        .from("b2b_recipe_listings")
        .select("id", { count: "exact", head: true })
        .eq("establishment_id", supplierEstId)
        .eq("is_published", true);
      if (error) return 0;
      return count ?? 0;
    },
    enabled: !!supplierEstId,
  });

  const hasRecipes = (recipeCount ?? 0) > 0;

  // If no recipe tab needed, render the product catalog directly (no wrapper overhead)
  if (!hasRecipes) {
    return (
      <B2BCatalogBrowser
        partnershipId={partnershipId}
        partnerName={partnerName}
        onBack={onBack}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h2 className="text-xl font-bold">Catalogue B2B — {partnerName}</h2>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border">
        <button
          type="button"
          onClick={() => setActiveTab("products")}
          className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
            activeTab === "products"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Catalogue produits
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("recipes")}
          className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
            activeTab === "recipes"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Catalogue recettes
        </button>
      </div>

      {/* Tab content */}
      {activeTab === "products" && (
        <B2BCatalogBrowser
          partnershipId={partnershipId}
          partnerName={partnerName}
          onBack={onBack}
          hideHeader
        />
      )}

      {activeTab === "recipes" && supplierEstId && (
        <B2BRecipeCatalog
          supplierEstablishmentId={supplierEstId}
          partnershipId={partnershipId}
        />
      )}
    </div>
  );
}

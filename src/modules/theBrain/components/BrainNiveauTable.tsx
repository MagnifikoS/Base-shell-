/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE BRAIN — Niveau Table (Lecture seule)
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Affiche les règles product_matching avec leur niveau de confiance.
 * Vue strictement observationnelle — aucune action utilisateur.
 * 
 * 2 sections collapsibles:
 * - "Avec fournisseur identifié" : rules avec supplier_id UUID
 * - "Sans fournisseur (legacy)" : rules avec supplier_id = "unknown"
 */

import { useState, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { TrendingUp, CheckCircle2, AlertCircle, Building2, Archive, ChevronDown } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { cn } from "@/lib/utils";
import type { ProductMatchingRuleDisplay, RuleConfidenceStatus } from "../types";

interface BrainNiveauTableProps {
  rules: ProductMatchingRuleDisplay[];
  isLoading: boolean;
}

function StatusBadge({ status }: { status: RuleConfidenceStatus }) {
  switch (status) {
    case "stable":
      return (
        <Badge variant="default" className="bg-primary/10 text-primary border-primary/20">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Stable
        </Badge>
      );
    case "probable":
      return (
        <Badge variant="secondary">
          <TrendingUp className="h-3 w-3 mr-1" />
          Probable
        </Badge>
      );
    case "weak":
      return (
        <Badge variant="outline" className="text-muted-foreground">
          <AlertCircle className="h-3 w-3 mr-1" />
          Faible
        </Badge>
      );
  }
}

function formatLastUsed(date: string | null): string {
  if (!date) return "—";
  try {
    return formatDistanceToNow(new Date(date), { addSuffix: true, locale: fr });
  } catch {
    return "—";
  }
}

function RulesTable({ rules }: { rules: ProductMatchingRuleDisplay[] }) {
  if (rules.length === 0) return null;
  
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            <th className="text-left py-2 font-medium text-muted-foreground">Produit</th>
            <th className="text-center py-2 font-medium text-muted-foreground">Confirmations</th>
            <th className="text-center py-2 font-medium text-muted-foreground">Corrections</th>
            <th className="text-left py-2 font-medium text-muted-foreground">Dernière utilisation</th>
            <th className="text-left py-2 font-medium text-muted-foreground">Statut</th>
          </tr>
        </thead>
        <tbody>
          {rules.map((rule) => (
            <tr key={rule.id} className="border-b last:border-0 hover:bg-muted/50">
              <td className="py-3 font-medium">{rule.productName}</td>
              <td className="py-3 text-center">
                <span className="text-primary font-medium">{rule.confirmationsCount}</span>
              </td>
              <td className="py-3 text-center">
                <span className={rule.correctionsCount > 0 ? "text-destructive font-medium" : "text-muted-foreground"}>
                  {rule.correctionsCount}
                </span>
              </td>
              <td className="py-3 text-muted-foreground">
                {formatLastUsed(rule.lastUsedAt)}
              </td>
              <td className="py-3">
                <StatusBadge status={rule.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function BrainNiveauTable({ rules, isLoading }: BrainNiveauTableProps) {
  const [withSupplierOpen, setWithSupplierOpen] = useState(true);
  const [legacyOpen, setLegacyOpen] = useState(false);

  // Séparer les règles avec fournisseur identifié et legacy
  const { withSupplier, legacy } = useMemo(() => {
    const withSupplier: ProductMatchingRuleDisplay[] = [];
    const legacy: ProductMatchingRuleDisplay[] = [];
    
    for (const rule of rules) {
      if (rule.isLegacy) {
        legacy.push(rule);
      } else {
        withSupplier.push(rule);
      }
    }
    
    return { withSupplier, legacy };
  }, [rules]);

  if (isLoading) {
    return (
      <div className="space-y-3 p-4 bg-card border rounded-lg">
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  const hasNoRules = withSupplier.length === 0 && legacy.length === 0;

  if (hasNoRules) {
    return (
      <div className="text-center py-8 text-muted-foreground text-sm bg-card border rounded-lg">
        Aucune règle product_matching enregistrée.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Section 1: Avec fournisseur identifié — collapsible */}
      <Collapsible open={withSupplierOpen} onOpenChange={setWithSupplierOpen}>
        <CollapsibleTrigger asChild>
          <button className="flex items-center justify-between w-full p-3 bg-muted/30 border rounded-lg hover:bg-muted/50 transition-colors">
            <span className="flex items-center gap-2 text-sm font-medium">
              <Building2 className="h-4 w-4 text-primary" />
              Avec fournisseur identifié
            </span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{withSupplier.length}</span>
              <ChevronDown className={cn("h-4 w-4 transition-transform", withSupplierOpen && "rotate-180")} />
            </div>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2 p-4 bg-card border rounded-lg">
          {withSupplier.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              Aucune règle avec fournisseur identifié.
            </p>
          ) : (
            <RulesTable rules={withSupplier} />
          )}
        </CollapsibleContent>
      </Collapsible>

      {/* Section 2: Sans fournisseur (legacy) — collapsible */}
      <Collapsible open={legacyOpen} onOpenChange={setLegacyOpen}>
        <CollapsibleTrigger asChild>
          <button className="flex items-center justify-between w-full p-3 bg-muted/30 border rounded-lg hover:bg-muted/50 transition-colors">
            <span className="flex items-center gap-2 text-sm font-medium">
              <Archive className="h-4 w-4 text-muted-foreground" />
              Sans fournisseur (legacy)
            </span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{legacy.length}</span>
              <ChevronDown className={cn("h-4 w-4 transition-transform", legacyOpen && "rotate-180")} />
            </div>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2 p-4 bg-card border rounded-lg">
          {legacy.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              Aucune règle legacy.
            </p>
          ) : (
            <RulesTable rules={legacy} />
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

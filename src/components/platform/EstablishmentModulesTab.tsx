/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ESTABLISHMENT MODULES TAB — Platform Super Admin
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Toggle ON/OFF modules per establishment.
 * Convention: 0 rows = all enabled (AMIR mode).
 * Dependency management: block disable of root modules with active dependents.
 * Bundle support: activate/deactivate entire domain bundles in one click.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Info, Lock, ShieldCheck, AlertTriangle, Package } from "lucide-react";
import {
  ROOT_MODULES,
  getDependents,
  getMissingDependencies,
  MODULE_DEPENDENCIES,
} from "@/lib/platform/moduleDependencies";
import { MODULE_BUNDLES, getActiveBundles } from "@/lib/platform/moduleBundles";

interface ModuleRow {
  key: string;
  name: string;
  display_order: number;
}

interface SelectionRow {
  id: string;
  module_key: string;
  enabled: boolean;
}

interface Props {
  establishmentId: string;
}

/** Module descriptions for UX clarity */
const MODULE_DESCRIPTIONS: Record<string, string> = {
  dashboard: "Vue d'ensemble et KPIs",
  planning: "Gestion des plannings d'équipe",
  salaries: "Gestion des fiches salariés",
  badgeuse: "Pointage des arrivées/départs",
  presence: "Suivi de présence et retards",
  caisse: "Rapports de caisse journaliers",
  rapports: "Statistiques et rapports",
  paie: "Calcul et suivi de la paie",
  gestion_personnel: "Gestion administrative du personnel",
  conges_absences: "Congés et absences",
  alertes: "Notifications badgeuse",
  notif_commande: "Notifications commandes",
  factures: "Gestion des factures fournisseurs",
  fournisseurs: "Gestion des fournisseurs",
  produits_v2: "Catalogue produits",
  commandes: "Commandes fournisseurs",
  inventaire: "Inventaire des stocks",
  pertes: "Pertes et casse",
  recettes: "Fiches recettes",
  food_cost: "Analyse food cost",
  plat_du_jour: "Gestion du plat du jour",
  contexte: "Contexte et événements",
  assistant: "Assistant IA",
  materiel: "Gestion du matériel",
  mise_en_place: "Mise en place cuisine",
  bl_app: "Bons de livraison",
  stock_ledger: "Journal de stock",
  stock_alerts: "Alertes de stock",
  vision_ai: "Scan factures fournisseur par IA",
  dlc_critique: "Alertes DLC critique",
};

export function EstablishmentModulesTab({ establishmentId }: Props) {
  const queryClient = useQueryClient();
  const [disableModal, setDisableModal] = useState<{
    moduleKey: string;
    moduleName: string;
    dependents: string[];
  } | null>(null);

  // Fetch all modules from DB
  const { data: allModules = [], isLoading: modulesLoading } = useQuery({
    queryKey: ["platform-all-modules"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modules")
        .select("key, name, display_order")
        .order("display_order");
      if (error) throw error;
      return (data ?? []) as ModuleRow[];
    },
  });

  // Fetch current selections for this establishment
  const { data: selections = [], isLoading: selectionsLoading } = useQuery({
    queryKey: ["establishment-modules", establishmentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("platform_establishment_module_selections")
        .select("id, module_key, enabled")
        .eq("establishment_id", establishmentId);
      if (error) throw error;
      return (data ?? []) as SelectionRow[];
    },
  });

  const hasExplicitConfig = selections.length > 0;

  // Build enabled set from selections
  const enabledModules = new Set<string>();
  if (hasExplicitConfig) {
    for (const s of selections) {
      if (s.enabled) enabledModules.add(s.module_key);
    }
  } else {
    // No config = all enabled (AMIR mode)
    for (const m of allModules) enabledModules.add(m.key);
  }

  // Upsert mutation
  const toggleMutation = useMutation({
    mutationFn: async ({
      moduleKey,
      enabled,
    }: {
      moduleKey: string;
      enabled: boolean;
    }) => {
      const { error } = await supabase
        .from("platform_establishment_module_selections")
        .upsert(
          {
            establishment_id: establishmentId,
            module_key: moduleKey,
            enabled,
          },
          { onConflict: "establishment_id,module_key" }
        );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["establishment-modules", establishmentId],
      });
    },
    onError: (err) => {
      toast.error(`Erreur : ${err instanceof Error ? err.message : "Inconnue"}`);
    },
  });

  // Initialize all modules (first toggle from AMIR mode)
  const initializeAllModules = async (exceptKey: string, exceptEnabled: boolean) => {
    // Insert all modules as enabled, except the toggled one
    const upserts = allModules.map((m) => ({
      establishment_id: establishmentId,
      module_key: m.key,
      enabled: m.key === exceptKey ? exceptEnabled : true,
    }));

    const { error } = await supabase
      .from("platform_establishment_module_selections")
      .upsert(upserts, { onConflict: "establishment_id,module_key" });

    if (error) throw error;

    queryClient.invalidateQueries({
      queryKey: ["establishment-modules", establishmentId],
    });
  };

  const handleToggle = async (moduleKey: string, moduleName: string, newEnabled: boolean) => {
    if (!newEnabled) {
      // Check if root module with active dependents
      const dependents = getDependents(moduleKey, enabledModules);
      if (dependents.length > 0) {
        const depNames = dependents.map(
          (d) => allModules.find((m) => m.key === d)?.name ?? d
        );
        setDisableModal({ moduleKey, moduleName, dependents: depNames });
        return;
      }
    }

    if (newEnabled) {
      // Check missing deps
      const missing = getMissingDependencies(moduleKey, enabledModules);
      if (missing.length > 0) {
        const missingNames = missing.map(
          (d) => allModules.find((m) => m.key === d)?.name ?? d
        );
        toast.error(
          `Impossible d'activer ${moduleName}. Activez d'abord : ${missingNames.join(", ")}`
        );
        return;
      }
    }

    try {
      if (!hasExplicitConfig) {
        // First toggle from AMIR mode → initialize all modules
        await initializeAllModules(moduleKey, newEnabled);
        toast.success(`${moduleName} ${newEnabled ? "activé" : "désactivé"}`);
      } else {
        await toggleMutation.mutateAsync({ moduleKey, enabled: newEnabled });
        toast.success(`${moduleName} ${newEnabled ? "activé" : "désactivé"}`);
      }
    } catch (err) {
      toast.error(`Erreur : ${err instanceof Error ? err.message : "Inconnue"}`);
    }
  };

  const isLoading = modulesLoading || selectionsLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
      </div>
    );
  }

  // Filter out hidden/internal modules
  const HIDDEN_MODULES = new Set(["produits", "users", "roles_permissions", "teams", "etablissements", "invitations", "parametres"]);
  const visibleModules = allModules.filter((m) => !HIDDEN_MODULES.has(m.key));

  // Bundle state
  const activeBundleIds = getActiveBundles(enabledModules);

  const handleBundleToggle = async (bundle: typeof MODULE_BUNDLES[0], newEnabled: boolean) => {
    try {
      const upserts = bundle.moduleKeys.map((key) => ({
        establishment_id: establishmentId,
        module_key: key,
        enabled: newEnabled,
      }));

      // If switching from AMIR mode, also initialize all other modules
      if (!hasExplicitConfig) {
        const bundleSet = new Set(bundle.moduleKeys);
        for (const m of allModules) {
          if (!bundleSet.has(m.key)) {
            upserts.push({
              establishment_id: establishmentId,
              module_key: m.key,
              enabled: true,
            });
          }
        }
      }

      const { error } = await supabase
        .from("platform_establishment_module_selections")
        .upsert(upserts, { onConflict: "establishment_id,module_key" });

      if (error) throw error;

      queryClient.invalidateQueries({
        queryKey: ["establishment-modules", establishmentId],
      });
      toast.success(
        `${bundle.label} ${newEnabled ? "activé" : "désactivé"} (${bundle.moduleKeys.length} modules)`
      );
    } catch (err) {
      toast.error(`Erreur : ${err instanceof Error ? err.message : "Inconnue"}`);
    }
  };

  // Build set of keys in any bundle for badge display
  const bundleKeySet = new Set(MODULE_BUNDLES.flatMap((b) => b.moduleKeys));

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="space-y-1">
        <h3 className="text-lg font-semibold text-foreground">
          Modules activés pour cet établissement
        </h3>
        <p className="text-sm text-muted-foreground">
          Sélectionnez les modules que cet établissement pourra utiliser.
          Les rôles et permissions dépendront des modules activés.
        </p>
      </div>

      {/* AMIR mode badge */}
      {!hasExplicitConfig && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-muted/50 border border-border">
          <ShieldCheck className="w-4 h-4 text-primary shrink-0" />
          <span className="text-sm text-muted-foreground">
            <strong className="text-foreground">Mode complet</strong> — Tous les modules sont activés par défaut.
            Désactivez un module pour personnaliser la configuration.
          </span>
        </div>
      )}

      {/* ═══ BUNDLES SECTION ═══ */}
      <div className="space-y-2">
        <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          Super modules
        </h4>
        <div className="grid gap-3 sm:grid-cols-2">
          {MODULE_BUNDLES.map((bundle) => {
            const isActive = activeBundleIds.includes(bundle.id);
            const activeCount = bundle.moduleKeys.filter((k) =>
              enabledModules.has(k)
            ).length;

            return (
              <Card
                key={bundle.id}
                className={`transition-colors ${
                  isActive
                    ? "border-primary/40 bg-primary/[0.05]"
                    : "border-border bg-card"
                }`}
              >
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{bundle.icon}</span>
                        <span className="font-semibold text-sm text-foreground">
                          {bundle.label}
                        </span>
                        <Badge
                          variant="outline"
                          className="text-[10px] gap-0.5 px-1.5 py-0 border-primary/40 text-primary"
                        >
                          <Package className="w-2.5 h-2.5" />
                          Bundle
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {bundle.description}
                      </p>
                    </div>
                    <Switch
                      checked={isActive}
                      onCheckedChange={(checked) =>
                        handleBundleToggle(bundle, checked)
                      }
                    />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div
                      className={`w-2 h-2 rounded-full ${
                        isActive ? "bg-primary" : "bg-muted-foreground/30"
                      }`}
                    />
                    <span className="text-xs text-muted-foreground">
                      {activeCount}/{bundle.moduleKeys.length} modules actifs
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Module cards grid */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visibleModules.map((mod) => {
          const isEnabled = enabledModules.has(mod.key);
          const isRoot = ROOT_MODULES.has(mod.key);
          const inBundle = bundleKeySet.has(mod.key);
          const deps = MODULE_DEPENDENCIES[mod.key];
          const missingDeps = deps
            ? getMissingDependencies(mod.key, enabledModules)
            : [];
          const hasMissingDeps = missingDeps.length > 0;
          const missingNames = missingDeps.map(
            (d) => allModules.find((m) => m.key === d)?.name ?? d
          );

          return (
            <Card
              key={mod.key}
              className={`transition-colors ${
                isEnabled
                  ? "border-primary/30 bg-primary/[0.03]"
                  : "border-border bg-card opacity-70"
              }`}
            >
              <CardContent className="p-4 space-y-3">
                {/* Top row: name + badges */}
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm text-foreground">
                        {mod.name}
                      </span>
                      {isRoot && (
                        <Badge
                          variant="outline"
                          className="text-[10px] gap-0.5 px-1.5 py-0 border-amber-300 text-amber-600 dark:border-amber-700 dark:text-amber-400"
                        >
                          <Lock className="w-2.5 h-2.5" />
                          Socle
                        </Badge>
                      )}
                      {inBundle && (
                        <Badge
                          variant="outline"
                          className="text-[10px] gap-0.5 px-1.5 py-0 border-primary/30 text-primary"
                        >
                          <Package className="w-2.5 h-2.5" />
                          Stock & Achat
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {MODULE_DESCRIPTIONS[mod.key] ?? "Module métier"}
                    </p>
                  </div>

                  {/* Toggle */}
                  <Switch
                    checked={isEnabled}
                    disabled={hasMissingDeps && !isEnabled}
                    onCheckedChange={(checked) =>
                      handleToggle(mod.key, mod.name, checked)
                    }
                  />
                </div>

                {/* Dependency warning */}
                {hasMissingDeps && !isEnabled && (
                  <div className="flex items-start gap-1.5 text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1.5">
                    <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0 mt-0.5" />
                    <span>
                      Nécessite : {missingNames.join(", ")}
                    </span>
                  </div>
                )}

                {/* Status badge */}
                <div className="flex items-center gap-1.5">
                  <div
                    className={`w-2 h-2 rounded-full ${
                      isEnabled ? "bg-emerald-500" : "bg-muted-foreground/30"
                    }`}
                  />
                  <span className="text-xs text-muted-foreground">
                    {isEnabled ? "Activé" : "Désactivé"}
                  </span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Blocking modal for root module disable */}
      <AlertDialog
        open={!!disableModal}
        onOpenChange={(open) => !open && setDisableModal(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              Impossible de désactiver
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p>
                Le module <strong>{disableModal?.moduleName}</strong> est requis par :
              </p>
              <ul className="list-disc pl-5 space-y-1">
                {disableModal?.dependents.map((d) => (
                  <li key={d} className="font-medium text-foreground">
                    {d}
                  </li>
                ))}
              </ul>
              <p>Désactivez d'abord ces modules.</p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setDisableModal(null)}>
              Compris
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

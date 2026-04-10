/**
 * Page d'entree Planning — Selection departement ou Planning general
 * Phase 1 : UI pure, aucun hook metier, aucune mutation
 */
import { ChefHat, UtensilsCrossed, Droplets, Pizza, LayoutGrid, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Departements affiches sur la page d'entree
// Mapped aux team_name existants en DB
const DEPARTMENTS = [
  {
    key: "Cuisine",
    label: "Cuisine",
    icon: ChefHat,
    color:
      "bg-orange-500/10 text-orange-600 dark:text-orange-400 hover:bg-orange-500 dark:hover:bg-orange-600/20",
  },
  {
    key: "Salle",
    label: "Salle",
    icon: UtensilsCrossed,
    color: "bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20",
  },
  {
    key: "Plonge",
    label: "Plonge",
    icon: Droplets,
    color: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 hover:bg-cyan-500/20",
  },
  {
    key: "Pizza",
    label: "Pizza",
    icon: Pizza,
    color: "bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500 dark:hover:bg-red-600/20",
  },
] as const;

export type DepartmentKey = (typeof DEPARTMENTS)[number]["key"];

interface PlanningEntryPageProps {
  /** Indique si les donnees sont en cours de chargement */
  isLoading?: boolean;
  /** Erreur de chargement des donnees */
  error?: Error | null;
  /** Callback pour reessayer le chargement */
  onRetry?: () => void;
  /** Callback quand on selectionne un departement */
  onSelectDepartment: (departmentKey: DepartmentKey) => void;
  /** Callback quand on clique sur Planning general */
  onSelectGeneral: () => void;
}

export function PlanningEntryPage({
  isLoading,
  error,
  onRetry,
  onSelectDepartment,
  onSelectGeneral,
}: PlanningEntryPageProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-8rem)] p-8 bg-background">
      <div className="max-w-2xl w-full space-y-8">
        {/* Titre */}
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-semibold text-foreground">Planning</h1>
          <p className="text-muted-foreground text-sm">
            Selectionnez un departement ou accedez au planning general
          </p>
          {isLoading && !error && (
            <p className="text-xs text-muted-foreground/70 animate-pulse">
              Chargement des donnees...
            </p>
          )}
        </div>

        {/* Erreur de chargement */}
        {error && (
          <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-xl flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0" />
              <p className="text-sm text-destructive">
                Erreur de chargement du planning. Verifiez votre connexion et reessayez.
              </p>
            </div>
            {onRetry && (
              <Button variant="outline" size="sm" onClick={onRetry} className="ml-4 flex-shrink-0">
                Reessayer
              </Button>
            )}
          </div>
        )}

        {/* Grille des 4 departements — toujours cliquables */}
        <div className="grid grid-cols-2 gap-4">
          {DEPARTMENTS.map((dept) => {
            const Icon = dept.icon;

            return (
              <button
                key={dept.key}
                onClick={() => onSelectDepartment(dept.key)}
                className={cn(
                  "flex flex-col items-center justify-center gap-3 p-8 rounded-2xl transition-all duration-200",
                  "border border-border/50",
                  dept.color,
                  "cursor-pointer shadow-sm hover:shadow-md hover:scale-[1.02]"
                )}
              >
                <Icon className="w-12 h-12" strokeWidth={1.5} />
                <span className="font-medium text-lg">{dept.label}</span>
              </button>
            );
          })}
        </div>

        {/* Bouton Planning general — toujours cliquable */}
        <div className="flex justify-center pt-4">
          <Button variant="outline" size="lg" onClick={onSelectGeneral} className="gap-2 px-8">
            <LayoutGrid className="w-5 h-5" />
            Planning general
          </Button>
        </div>
      </div>
    </div>
  );
}

export { DEPARTMENTS };

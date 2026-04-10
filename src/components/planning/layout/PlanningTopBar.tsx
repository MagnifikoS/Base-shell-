import { ChevronLeft, ChevronRight, Loader2, Check, Copy, Star } from "lucide-react";
import { PrintButton } from "@/components/ui/PrintButton";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { generateWeekOptions, getWeekDates } from "@/lib/planning-engine/format";
import { memo, useMemo } from "react";
import { useValidateWeek } from "@/components/planning/hooks/useValidatePlanning";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface PlanningTopBarProps {
  weekStart: string;
  onWeekChange: (weekStart: string) => void;
  establishmentName?: string;
  establishmentId?: string;
  isLoading?: boolean;
  weekValidated?: boolean;
  validatedDays?: Record<string, boolean>;
  /** True if auto-publish is currently active for this week */
  autoPublishActive?: boolean;
  /** Manager override: if non-null, week is HIDDEN regardless of auto-publish or weekValidated */
  weekInvalidatedAt?: string | null;
  /** If false, week navigation controls are hidden (read-only mode) */
  canNavigate?: boolean;
  /** Show "Copier la semaine précédente" button */
  showCopyWeekButton?: boolean;
  /** Callback when copy week button is clicked */
  onCopyWeekClick?: () => void;
  /** Show "Favori" button for applying saved favorites */
  showFavoriButton?: boolean;
  /** Callback when Favori button is clicked */
  onFavoriClick?: () => void;
}

export const PlanningTopBar = memo(function PlanningTopBar({
  weekStart,
  onWeekChange,
  establishmentName,
  establishmentId,
  isLoading = false,
  weekValidated = false,
  validatedDays: _validatedDays = {},
  autoPublishActive = false,
  weekInvalidatedAt = null,
  canNavigate = true,
  showCopyWeekButton = false,
  onCopyWeekClick,
  showFavoriButton = false,
  onFavoriClick,
}: PlanningTopBarProps) {
  const weekOptions = useMemo(() => generateWeekOptions(52, 52), []);
  const validateWeekMutation = useValidateWeek();

  // Calculer les dates depuis weekStart local (instantané, pas depuis data)
  const weekDatesLabel = useMemo(() => {
    const dates = getWeekDates(weekStart);
    const monday = new Date(dates[0] + "T00:00:00");
    const sunday = new Date(dates[6] + "T00:00:00");
    const formatDate = (d: Date) =>
      d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
    return `${formatDate(monday)} - ${formatDate(sunday)}`;
  }, [weekStart]);

  // Helper date-only (pas de toISOString pour éviter décalage TZ)
  const formatDateOnly = (d: Date): string => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };

  const handlePrevWeek = () => {
    const current = new Date(weekStart + "T00:00:00");
    current.setDate(current.getDate() - 7);
    onWeekChange(formatDateOnly(current));
  };

  const handleNextWeek = () => {
    const current = new Date(weekStart + "T00:00:00");
    current.setDate(current.getDate() + 7);
    onWeekChange(formatDateOnly(current));
  };

  // ══════════════════════════════════════════════════════════════════════════
  // LOGIQUE BOUTON (SSOT priorité stricte):
  // 1. weekInvalidatedAt non null → semaine invalidée (override) → bouton = "Valider"
  // 2. weekValidated === true → semaine validée manuellement → bouton = "Validée ✓"
  // 3. autoPublishActive === true → visible via auto-publish → bouton = "Validée ✓"
  // 4. Sinon → bouton = "Valider"
  // ══════════════════════════════════════════════════════════════════════════
  const isInvalidatedByManager = weekInvalidatedAt !== null && weekInvalidatedAt !== undefined;
  const isWeekAlreadyValidated =
    !isInvalidatedByManager && (weekValidated === true || autoPublishActive === true);
  const canToggle = !!establishmentId;

  const handleToggleWeekValidation = () => {
    if (!establishmentId) return;
    validateWeekMutation.mutate({
      establishmentId,
      weekStart,
      validated: !isWeekAlreadyValidated, // Toggle: if validated -> unvalidate, else validate
    });
  };

  // Tooltip pour expliquer l'état
  const getValidationButtonTooltip = (): string | null => {
    if (!establishmentId) return "Sélectionnez un établissement";
    if (isInvalidatedByManager) return "Semaine invalidée par le manager. Cliquer pour revalider.";
    if (isWeekAlreadyValidated) return "Cliquer pour invalider la semaine";
    return "Cliquer pour valider la semaine entière";
  };

  const tooltipContent = getValidationButtonTooltip();

  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3 border-b bg-card">
      {/* Gauche: nom établissement + dates semaine */}
      <div className="flex items-center gap-3 flex-shrink-0 min-w-0">
        {establishmentName && (
          <span className="text-sm font-medium text-muted-foreground truncate">
            {establishmentName}
          </span>
        )}
        <span className="text-sm text-muted-foreground/70">{weekDatesLabel}</span>
        {isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      {/* Centre: navigation semaine */}
      {canNavigate ? (
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={handlePrevWeek}
            className="h-8 w-8"
            aria-label="Semaine précédente"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>

          <Select value={weekStart} onValueChange={onWeekChange}>
            <SelectTrigger className="w-[260px] h-8 text-sm">
              <SelectValue placeholder="Sélectionner une semaine" />
            </SelectTrigger>
            <SelectContent className="max-h-[300px]">
              {weekOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            variant="outline"
            size="icon"
            onClick={handleNextWeek}
            className="h-8 w-8"
            aria-label="Semaine suivante"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <div className="flex items-center justify-center">
          <div className="text-center py-1 px-4 rounded-lg bg-muted">
            <span className="text-sm font-medium">{weekDatesLabel}</span>
          </div>
        </div>
      )}

      {/* Droite: imprimer + favori + copier + toggle valider/invalider */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <PrintButton />

        {/* Bouton Favori — appliquer les plannings favoris */}
        {showFavoriButton && onFavoriClick && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" onClick={onFavoriClick} className="gap-1.5">
                  <Star className="h-4 w-4 text-yellow-500" />
                  Favori
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Appliquer les plannings favoris enregistres</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}

        {/* Bouton Copier la semaine précédente */}
        {showCopyWeekButton && onCopyWeekClick && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onCopyWeekClick}
                  className="h-8 gap-1.5"
                >
                  <Copy className="h-4 w-4" />
                  Copier sem. préc.
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Copier la semaine précédente pour les salariés visibles</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}

        {/* Bouton toggle valider/invalider */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button
                  variant={isWeekAlreadyValidated ? "outline" : "default"}
                  size="sm"
                  disabled={!canToggle || validateWeekMutation.isPending}
                  onClick={handleToggleWeekValidation}
                  className={
                    isWeekAlreadyValidated
                      ? "h-8 border-green-500 text-green-600 dark:text-green-400 hover:bg-orange-50 dark:hover:bg-orange-950/30 hover:text-orange-600 dark:hover:text-orange-400 hover:border-orange-500"
                      : "h-8"
                  }
                >
                  {validateWeekMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : isWeekAlreadyValidated ? (
                    <Check className="mr-2 h-4 w-4" />
                  ) : null}
                  {isWeekAlreadyValidated ? "Semaine validée ✓" : "Valider le planning"}
                </Button>
              </span>
            </TooltipTrigger>
            {tooltipContent && (
              <TooltipContent>
                <p>{tooltipContent}</p>
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
});

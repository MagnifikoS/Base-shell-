import { memo, useMemo } from "react";
import { Check, CheckCircle, Trash2, Fingerprint } from "lucide-react";
import { getWeekDates, formatDayFull } from "@/lib/planning-engine/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface PlanningWeekHeaderProps {
  weekStart: string;
  validatedDays: Record<string, boolean>;
  weekValidated: boolean;
  canManagePlanning: boolean;
  onValidateDay?: (date: string) => void;
  isValidatingDay?: boolean;
  onDeleteWeek?: () => void;
  isDeletingWeek?: boolean;
  onBadgeDay?: (date: string) => void;
  badgingDayDate?: string | null; // Which day is currently being badged
  serviceDay?: string | null; // Service day from RPC (single source of truth)
}

export const PlanningWeekHeader = memo(function PlanningWeekHeader({
  weekStart,
  validatedDays,
  weekValidated,
  canManagePlanning,
  onValidateDay,
  isValidatingDay,
  onDeleteWeek,
  isDeletingWeek,
  onBadgeDay,
  badgingDayDate,
  serviceDay,
}: PlanningWeekHeaderProps) {
  const dates = useMemo(() => getWeekDates(weekStart), [weekStart]);
  // Use serviceDay from RPC if provided, fallback to empty string (no highlight)
  const todayStr = serviceDay ?? "";

  // Check if all days are validated
  const _allDaysValidated = dates.every((d) => validatedDays[d] === true);
  const hasAnyValidatedDay = dates.some((d) => validatedDays[d] === true);

  // Disable delete if week is validated
  const isDeleteDisabled = weekValidated || isDeletingWeek;

  return (
    <div className="flex border-b bg-muted/30">
      {/* Colonne sticky gauche: espace pour teams/employees + boutons globaux */}
      <div className="w-48 flex-shrink-0 px-3 py-2 border-r bg-muted/50 sticky left-0 z-10 flex items-center justify-between gap-1">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Équipe / Salarié
        </span>
        {canManagePlanning && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-destructive hover:bg-destructive/10"
                onClick={onDeleteWeek}
                disabled={isDeleteDisabled}
                aria-label="Supprimer les shifts de la semaine"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {weekValidated
                ? "Semaine validée - suppression interdite"
                : hasAnyValidatedDay
                  ? "Supprimer shifts (jours non validés seulement)"
                  : "Supprimer tous les shifts"}
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* Colonnes jours */}
      {dates.map((date) => {
        const isValidated = validatedDays[date] === true;
        const isWeekend =
          new Date(date + "T00:00:00").getDay() === 0 ||
          new Date(date + "T00:00:00").getDay() === 6;
        const isToday = date === todayStr;

        // Day toggle: if week is validated, cannot toggle day individually
        // If day is validated (and week not), can toggle to unvalidate
        const _canToggleDay = canManagePlanning && !weekValidated;

        return (
          <div
            key={date}
            className={cn(
              "w-[160px] flex-shrink-0 px-2 py-2 text-center border-r",
              isWeekend && !isToday && "bg-muted/20",
              isToday && "bg-accent"
            )}
          >
            <div className="flex items-center justify-center gap-1">
              <span
                className={cn(
                  "text-xs font-medium capitalize",
                  isToday ? "text-accent-foreground font-semibold" : "text-foreground"
                )}
              >
                {formatDayFull(date)}
              </span>
              {canManagePlanning ? (
                <>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className={cn(
                          "h-5 w-5 p-0",
                          weekValidated
                            ? "text-green-500 dark:text-green-400 cursor-not-allowed"
                            : isValidated
                              ? "text-green-500 dark:text-green-400 hover:text-orange-500 dark:hover:text-orange-400 hover:bg-orange-100 dark:hover:bg-orange-900/30"
                              : "text-muted-foreground/40 hover:text-green-500 dark:hover:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/30"
                        )}
                        onClick={() => onValidateDay?.(date)}
                        disabled={weekValidated || isValidatingDay}
                        aria-label={isValidated ? "Invalider ce jour" : "Valider ce jour"}
                      >
                        {weekValidated || isValidated ? (
                          <CheckCircle className="h-3.5 w-3.5" />
                        ) : (
                          <Check className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {weekValidated
                        ? "Semaine validée - invalider la semaine d'abord"
                        : isValidated
                          ? "Cliquer pour invalider ce jour"
                          : "Valider ce jour"}
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 p-0 text-primary/60 hover:text-primary hover:bg-primary/10"
                        onClick={() => onBadgeDay?.(date)}
                        disabled={badgingDayDate === date}
                        aria-label="Badger tous les employés du jour"
                      >
                        <Fingerprint
                          className={cn("h-3.5 w-3.5", badgingDayDate === date && "animate-pulse")}
                        />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Badger tous les employés du jour</TooltipContent>
                  </Tooltip>
                </>
              ) : (
                <Check
                  className={cn(
                    "h-3 w-3",
                    isValidated || weekValidated
                      ? "text-green-500 dark:text-green-400"
                      : "text-muted-foreground/30"
                  )}
                />
              )}
            </div>
          </div>
        );
      })}

      {/* Colonne Total sticky droite */}
      <div className="w-[72px] flex-shrink-0 px-1 py-2 text-center bg-muted/50 sticky right-0 z-10">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Total
        </span>
      </div>
    </div>
  );
});

/**
 * StatusBadge — Displays AUTO (green) or AMBIGU (orange) classification.
 * If AMBIGU, shows a tooltip with the list of missing fields.
 * Isolated — removing this file has zero impact on the app.
 */

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface StatusBadgeProps {
  classification: "AUTO" | "AMBIGU" | string;
  manquants: string[];
}

export function StatusBadge({ classification, manquants }: StatusBadgeProps) {
  const isAuto = classification === "AUTO";

  const badge = (
    <span
      className={
        isAuto
          ? "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
          : "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400"
      }
    >
      {isAuto ? "✅ Auto" : "⚠️ À compléter"}
    </span>
  );

  if (!isAuto && manquants.length > 0) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>{badge}</TooltipTrigger>
          <TooltipContent side="right" className="max-w-xs">
            <p className="text-xs whitespace-pre-line">
              {manquants.join("\n")}
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return badge;
}

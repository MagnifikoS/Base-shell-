/**
 * PasswordStrengthIndicator — Displays password complexity criteria with live feedback.
 *
 * Uses PASSWORD_CRITERIA from the shared Zod schemas (SSOT for password rules).
 * All text is in French.
 */

import { useMemo } from "react";
import { Check, X } from "lucide-react";
import { PASSWORD_CRITERIA } from "@/lib/schemas/common";
import { cn } from "@/lib/utils";

interface PasswordStrengthIndicatorProps {
  password: string;
  /** Only show the indicator when this is true (e.g., when the field is focused or has content) */
  show?: boolean;
}

export function PasswordStrengthIndicator({
  password,
  show = true,
}: PasswordStrengthIndicatorProps) {
  const results = useMemo(
    () =>
      PASSWORD_CRITERIA.map((criterion) => ({
        label: criterion.label,
        met: criterion.regex.test(password),
      })),
    [password]
  );

  const metCount = results.filter((r) => r.met).length;
  const total = results.length;
  const percent = Math.round((metCount / total) * 100);

  const strengthLabel = useMemo(() => {
    if (metCount === 0) return { text: "", color: "bg-muted" };
    if (metCount <= 2) return { text: "Faible", color: "bg-destructive" };
    if (metCount <= 4) return { text: "Moyen", color: "bg-amber-500 dark:bg-amber-600" };
    return { text: "Fort", color: "bg-green-500 dark:bg-green-600" };
  }, [metCount]);

  if (!show || password.length === 0) return null;

  return (
    <div className="space-y-2 mt-2" role="status" aria-label="Indicateur de force du mot de passe">
      {/* Strength bar */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all duration-300", strengthLabel.color)}
            style={{ width: `${percent}%` }}
          />
        </div>
        {strengthLabel.text && (
          <span
            className={cn(
              "text-xs font-medium",
              metCount <= 2 && "text-destructive",
              metCount > 2 && metCount <= 4 && "text-amber-600 dark:text-amber-400",
              metCount === total && "text-green-600 dark:text-green-400"
            )}
          >
            {strengthLabel.text}
          </span>
        )}
      </div>

      {/* Criteria checklist */}
      <ul className="space-y-1">
        {results.map((result) => (
          <li key={result.label} className="flex items-center gap-1.5 text-xs">
            {result.met ? (
              <Check
                className="h-3 w-3 text-green-600 dark:text-green-400 shrink-0"
                aria-hidden="true"
              />
            ) : (
              <X className="h-3 w-3 text-muted-foreground shrink-0" aria-hidden="true" />
            )}
            <span
              className={
                result.met ? "text-green-700 dark:text-green-400" : "text-muted-foreground"
              }
            >
              {result.label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

import { Badge } from "@/components/ui/badge";
import type { ConfigStatus } from "../types";

interface StatusBadgeProps {
  status: ConfigStatus;
}

export function ConfigStatusBadge({ status }: StatusBadgeProps) {
  if (status === "error") {
    return (
      <Badge variant="destructive" className="text-xs">
        ❌ Erreur config
      </Badge>
    );
  }

  if (status === "not_configured") {
    return (
      <Badge variant="outline" className="text-muted-foreground border-border font-normal text-xs">
        —
      </Badge>
    );
  }

  if (status === "needs_review") {
    return (
      <Badge variant="outline" className="border-yellow-400 bg-yellow-50 text-yellow-700 dark:border-yellow-600 dark:bg-yellow-900/20 dark:text-yellow-400 text-xs">
        ⚠️ À revoir
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className="border-green-400 bg-green-50 text-green-700 dark:border-green-600 dark:bg-green-900/20 dark:text-green-400 text-xs">
      ✓ Configuré
    </Badge>
  );
}

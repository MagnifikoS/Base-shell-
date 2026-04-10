/**
 * B2B Import Report Dialog — Step 3 of import flow
 * Displays results after import completes.
 * NEVER exposes SQL/technical details to the user.
 */

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, AlertTriangle, RotateCcw } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ImportProductResult } from "../services/b2bTypes";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  results: ImportProductResult[];
  onRetry?: () => void;
}

export function B2BImportReportDialog({ open, onOpenChange, results, onRetry }: Props) {
  const imported = results.filter((r) => r.status === "IMPORTED");
  const blocked = results.filter((r) => r.status !== "IMPORTED");
  const hasErrors = blocked.some((r) => r.status === "ERROR");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {hasErrors && imported.length === 0 ? "Import impossible" : "Rapport d'import"}
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-6 py-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            <span>{imported.length} importé{imported.length > 1 ? "s" : ""}</span>
          </div>
          {blocked.length > 0 && (
            <div className="flex items-center gap-2 text-sm font-medium">
              <XCircle className="h-5 w-5 text-destructive" />
              <span>{blocked.length} bloqué{blocked.length > 1 ? "s" : ""}</span>
            </div>
          )}
        </div>

        <ScrollArea className="max-h-80">
          <div className="space-y-2">
            {results.map((r) => (
              <div
                key={r.sourceProductId}
                className="flex items-start gap-3 p-3 rounded-lg border"
              >
                {r.status === "IMPORTED" ? (
                  <CheckCircle2 className="h-4 w-4 mt-0.5 text-green-600 shrink-0" />
                ) : r.status === "ERROR" ? (
                  <AlertTriangle className="h-4 w-4 mt-0.5 text-amber-500 shrink-0" />
                ) : (
                  <XCircle className="h-4 w-4 mt-0.5 text-destructive shrink-0" />
                )}
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate uppercase">{r.nom_produit}</p>
                  {r.reason && (
                    <p className="text-xs text-muted-foreground mt-0.5">{r.reason}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>

        <DialogFooter className="gap-2 sm:gap-0">
          {hasErrors && onRetry && (
            <Button variant="outline" onClick={onRetry}>
              <RotateCcw className="h-4 w-4 mr-2" />
              Réessayer
            </Button>
          )}
          <Button onClick={() => onOpenChange(false)}>Fermer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

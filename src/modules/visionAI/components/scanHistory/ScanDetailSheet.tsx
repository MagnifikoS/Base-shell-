import { useState, useCallback } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  FileText,
  Image,
  Trash2,
  RotateCw,
  GitCompare,
  Loader2,
  Calendar,
  HardDrive,
} from "lucide-react";
import { toast } from "sonner";
import { useScanRuns } from "../../hooks/useScanRuns";
import { deleteScan, getScanFileUrl } from "../../services/scanHistoryService";
import { ScanRunCard } from "./ScanRunCard";
import { ScanRunComparison } from "./ScanRunComparison";
import type { ScanDocument } from "../../types/scanHistory";

interface ScanDetailSheetProps {
  scan: ScanDocument | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatFileSize(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

function isImageType(fileType: string): boolean {
  return fileType.startsWith("image/");
}

export function ScanDetailSheet({ scan, open, onOpenChange, onDeleted }: ScanDetailSheetProps) {
  const { runs, isLoading: runsLoading } = useScanRuns(scan?.id ?? null);
  const [deleting, setDeleting] = useState(false);
  const [rescanning, setRescanning] = useState(false);
  const [comparisonMode, setComparisonMode] = useState(false);
  const [selectedRunIds, setSelectedRunIds] = useState<string[]>([]);

  const handleDelete = useCallback(async () => {
    if (!scan) return;
    setDeleting(true);
    const ok = await deleteScan(scan.id);
    setDeleting(false);
    if (ok) {
      toast.success("Document supprimé");
      onOpenChange(false);
      onDeleted?.();
    } else {
      toast.error("Erreur lors de la suppression");
    }
  }, [scan, onOpenChange, onDeleted]);

  const handleRescan = useCallback(async () => {
    if (!scan) return;
    setRescanning(true);
    try {
      const signedUrl = await getScanFileUrl(scan.storage_path);
      if (!signedUrl) {
        toast.error("Impossible de récupérer le fichier");
        return;
      }
      const response = await fetch(signedUrl);
      const blob = await response.blob();
      const file = new File([blob], scan.original_filename, {
        type: blob.type || scan.file_type,
      });

      const { recordScanRun } = await import("../../services/scanHistoryService");

      // Trigger extraction via the edge function
      const { supabase } = await import("@/integrations/supabase/client");
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;

      const formData = new FormData();
      formData.append("file", file);
      formData.append("precision_mode", "claude");

      const startMs = Date.now();
      const extractResponse = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/vision-ai-extract`,
        {
          method: "POST",
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: formData,
        }
      );

      const result = await extractResponse.json();
      const durationMs = Date.now() - startMs;

      if (result.success) {
        await recordScanRun({
          scanId: scan.id,
          precisionMode: "claude",
          invoice: result.invoice,
          items: result.items,
          insights: result.insights,
          durationMs,
        });
        toast.success("Re-scan terminé. Nouveaux résultats ajoutés.");
      } else {
        toast.error(result.error || "Erreur lors du re-scan");
      }
    } catch {
      toast.error("Erreur lors du re-scan");
    } finally {
      setRescanning(false);
    }
  }, [scan]);

  const handleToggleSelect = useCallback((runId: string) => {
    setSelectedRunIds((prev) => {
      if (prev.includes(runId)) {
        return prev.filter((id) => id !== runId);
      }
      if (prev.length >= 2) {
        return [prev[1], runId];
      }
      return [...prev, runId];
    });
  }, []);

  const selectedRuns = runs.filter((r) => selectedRunIds.includes(r.id));

  if (!scan) return null;

  const FileIcon = isImageType(scan.file_type) ? Image : FileText;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-hidden flex flex-col">
        <SheetHeader className="flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/5 flex items-center justify-center">
              <FileIcon className="h-5 w-5 text-primary/70" />
            </div>
            <div className="min-w-0 flex-1">
              <SheetTitle className="text-base truncate">{scan.original_filename}</SheetTitle>
              <SheetDescription className="text-xs">
                {scan.supplier_name && `${scan.supplier_name} — `}
                {scan.invoice_number && `${scan.invoice_number} — `}
                {scan.runs_count} extraction{scan.runs_count > 1 ? "s" : ""}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <ScrollArea className="flex-1 -mx-6 px-6">
          {/* Document info */}
          <div className="grid grid-cols-2 gap-3 py-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Calendar className="h-3.5 w-3.5" />
              <span>{formatDate(scan.created_at)}</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <HardDrive className="h-3.5 w-3.5" />
              <span>{formatFileSize(scan.file_size_bytes)}</span>
            </div>
          </div>

          <Separator />

          {/* Actions bar */}
          <div className="flex items-center gap-2 py-3">
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={handleRescan}
              disabled={rescanning}
            >
              {rescanning ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <RotateCw className="h-3.5 w-3.5 mr-1.5" />
              )}
              Re-scanner
            </Button>
            {runs.length >= 2 && (
              <Button
                variant={comparisonMode ? "default" : "outline"}
                size="sm"
                className="text-xs"
                onClick={() => {
                  setComparisonMode(!comparisonMode);
                  setSelectedRunIds([]);
                }}
              >
                <GitCompare className="h-3.5 w-3.5 mr-1.5" />
                Comparer
              </Button>
            )}
            <div className="flex-1" />
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-destructive hover:text-destructive"
                  disabled={deleting}
                >
                  {deleting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Supprimer ce document ?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Le fichier et toutes ses extractions seront supprimés définitivement. Cette
                    action est irréversible.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Annuler</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDelete}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Supprimer
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>

          <Separator />

          {/* Comparison view */}
          {comparisonMode && selectedRuns.length === 2 && (
            <div className="py-3">
              <ScanRunComparison runA={selectedRuns[0]} runB={selectedRuns[1]} />
            </div>
          )}

          {comparisonMode && selectedRuns.length < 2 && (
            <div className="py-3 text-center text-xs text-muted-foreground">
              Sélectionnez 2 extractions pour les comparer
            </div>
          )}

          {/* Runs list */}
          <div className="py-3">
            <h3 className="text-sm font-medium mb-3">Extractions ({runs.length})</h3>

            {runsLoading && (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}

            {!runsLoading && runs.length === 0 && (
              <div className="text-center text-sm text-muted-foreground py-6">
                Aucune extraction enregistrée
              </div>
            )}

            <div className="space-y-2">
              {runs.map((run, i) => (
                <ScanRunCard
                  key={run.id}
                  run={run}
                  index={runs.length - 1 - i}
                  comparisonMode={comparisonMode}
                  isSelected={selectedRunIds.includes(run.id)}
                  onToggleSelect={handleToggleSelect}
                />
              ))}
            </div>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

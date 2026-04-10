import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { BenchPdf } from "../types";
import { GitCompare, Trash2, Loader2, Download } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { BENCH_QUERY_KEYS } from "../constants";
import { deleteBenchPdf } from "../services/benchPdfService";
import { toast } from "sonner";
import { useState, useCallback, useEffect, useSyncExternalStore } from "react";
import { importInvoicesToBench } from "../services/benchImportService";
import { subscribe, getSnapshot, dismissResult } from "../services/benchImportStore";

interface BenchPdfListProps {
  pdfs: BenchPdf[];
  isLoading: boolean;
  establishmentId: string;
  onSelectPdf: (pdf: BenchPdf) => void;
  selectedPdfId?: string;
}

export function BenchPdfList({
  pdfs,
  isLoading,
  establishmentId,
  onSelectPdf,
  selectedPdfId,
}: BenchPdfListProps) {
  const queryClient = useQueryClient();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Subscribe to module-level import store (survives navigation)
  const importState = useSyncExternalStore(subscribe, getSnapshot);

  // When import finishes (user might have been on another page), show toast + refresh
  useEffect(() => {
    if (!importState.lastResult) return;
    const { imported, skipped, errors } = importState.lastResult;

    // Refresh the corpus list
    queryClient.invalidateQueries({ queryKey: BENCH_QUERY_KEYS.pdfs(establishmentId) });

    // Show result notification (only once per result)
    if (errors === -1) {
      // Error case from store.setError
      toast.error("Erreur lors de l'import");
    } else if (imported > 0) {
      toast.success(`${imported} facture(s) importée(s)`, {
        description: skipped > 0 ? `${skipped} déjà présente(s), ${errors} erreur(s)` : undefined,
      });
    } else if (skipped > 0) {
      toast.info("Toutes les factures sont déjà dans le corpus", {
        description: `${skipped} facture(s) ignorée(s)`,
      });
    } else {
      toast.info("Aucune facture trouvée à importer");
    }

    // Dismiss so we don't re-toast on next render
    dismissResult();
  }, [importState.lastResult, establishmentId, queryClient]);

  const handleDelete = async (pdf: BenchPdf) => {
    if (!confirm(`Supprimer ${pdf.original_filename} et tous ses runs ?`)) return;

    setDeletingId(pdf.id);
    try {
      await deleteBenchPdf(pdf.id, pdf.storage_path);
      queryClient.invalidateQueries({ queryKey: BENCH_QUERY_KEYS.pdfs(establishmentId) });
      toast.success("PDF supprimé");
    } catch (err) {
      toast.error("Erreur lors de la suppression");
      if (import.meta.env.DEV) console.error(err);
    } finally {
      setDeletingId(null);
    }
  };

  const handleImportInvoices = useCallback(async () => {
    if (!establishmentId || importState.isImporting) return;
    // Fire-and-forget: the import writes to the module-level store,
    // so progress survives even if user navigates away.
    importInvoicesToBench(establishmentId).catch(() => {
      // Error already handled in the store
    });
  }, [establishmentId, importState.isImporting]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
        <Loader2 className="h-4 w-4 animate-spin" />
        Chargement du corpus...
      </div>
    );
  }

  const progress = importState.progress;

  return (
    <div className="space-y-4">
      {/* Import button + progress */}
      <div className="flex items-center gap-3 flex-wrap">
        <Button
          variant="outline"
          size="sm"
          onClick={handleImportInvoices}
          disabled={importState.isImporting}
        >
          {importState.isImporting ? (
            <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
          ) : (
            <Download className="h-4 w-4 mr-1.5" />
          )}
          Importer les factures
        </Button>

        {importState.isImporting && progress && (
          <span className="text-xs text-muted-foreground">
            {progress.current}/{progress.total}
            {" — "}
            {progress.imported} importée(s)
            {progress.skipped > 0 && `, ${progress.skipped} ignorée(s)`}
            {progress.errors > 0 && `, ${progress.errors} erreur(s)`}
            {progress.currentFile && (
              <span className="ml-1 text-muted-foreground/60">({progress.currentFile})</span>
            )}
          </span>
        )}
      </div>

      {pdfs.length === 0 && !importState.isImporting ? (
        <div className="text-center py-12 text-muted-foreground">
          <p className="text-sm">Aucun PDF capturé.</p>
          <p className="text-xs mt-1">
            Cliquez sur "Importer les factures" pour ajouter vos factures existantes au corpus.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fichier</TableHead>
                <TableHead>Fournisseur</TableHead>
                <TableHead>N° Facture</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Taille</TableHead>
                <TableHead className="text-center">Runs</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pdfs.map((pdf) => (
                <TableRow
                  key={pdf.id}
                  className={
                    selectedPdfId === pdf.id ? "bg-accent" : "cursor-pointer hover:bg-accent/50"
                  }
                  onClick={() => onSelectPdf(pdf)}
                >
                  <TableCell className="font-medium text-sm max-w-[200px] truncate">
                    {pdf.original_filename}
                  </TableCell>
                  <TableCell className="text-sm">{pdf.supplier_name || "—"}</TableCell>
                  <TableCell className="text-sm">{pdf.invoice_number || "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(pdf.captured_at).toLocaleDateString("fr-FR")}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {pdf.file_size_bytes ? `${(pdf.file_size_bytes / 1024).toFixed(0)} Ko` : "—"}
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant="secondary" className="text-xs">
                      {pdf.runs_count ?? 0}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div
                      className="flex items-center gap-1 justify-end"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2"
                        onClick={() => onSelectPdf(pdf)}
                      >
                        <GitCompare className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-destructive hover:text-destructive"
                        onClick={() => handleDelete(pdf)}
                        disabled={deletingId === pdf.id}
                      >
                        {deletingId === pdf.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

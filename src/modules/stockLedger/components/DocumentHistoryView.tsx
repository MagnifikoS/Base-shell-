/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DOCUMENT HISTORY VIEW — List POSTED/VOID documents with filters
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useState, useMemo } from "react";
import { Loader2, FileText, XCircle, CheckCircle2, MapPin, CalendarDays } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { useDocumentsHistory, type HistoryDocument } from "../hooks/useDocumentsHistory";
import { useVoidDocument } from "../hooks/useVoidDocument";
import { VoidConfirmDialog } from "./VoidConfirmDialog";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { useSuppliersList } from "@/modules/produitsV2";
import { getTodayDateKeyParis, addDaysToDateKey } from "@/lib/time/dateKeyParis";

export function DocumentHistoryView() {
  const { activeEstablishment } = useEstablishment();
  const estId = activeEstablishment?.id;
  const { data: suppliers = [] } = useSuppliersList();

  // Default date range: last 30 days
  const defaultDates = useMemo(() => {
    const today = getTodayDateKeyParis();
    return { start: addDaysToDateKey(today, -30), end: today };
  }, []);

  const [filterZone, setFilterZone] = useState<string | null>(null);
  const [filterSupplier, setFilterSupplier] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<string | null>(null);
  const [filterStartDate, setFilterStartDate] = useState<string>(defaultDates.start);
  const [filterEndDate, setFilterEndDate] = useState<string>(defaultDates.end);

  const [voidDoc, setVoidDoc] = useState<HistoryDocument | null>(null);
  const { voidDocument, isVoiding } = useVoidDocument();

  // Fetch zones for filter
  const { data: zones = [] } = useQuery({
    queryKey: ["storage-zones-list", estId],
    queryFn: async () => {
      if (!estId) return [];
      const { data } = await supabase
        .from("storage_zones")
        .select("id, name")
        .eq("establishment_id", estId)
        .order("name");
      return data ?? [];
    },
    enabled: !!estId,
  });

  const {
    data: documents = [],
    isLoading,
    isError: documentsError,
    refetch: refetchDocuments,
  } = useDocumentsHistory({
    zoneId: filterZone,
    supplierId: filterSupplier,
    documentType: filterType,
    startDate: filterStartDate || null,
    endDate: filterEndDate || null,
  });

  const handleVoid = async (reason: string) => {
    if (!voidDoc) return;
    try {
      const result = await voidDocument({
        documentId: voidDoc.id,
        voidReason: reason,
      });
      if (result.ok) {
        toast.success(
          `Document annulé — ${result.void_events_created ?? 0} mouvement(s) inversé(s)`
        );
        setVoidDoc(null);
      } else {
        toast.error(`Erreur : ${result.error}`);
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <FileText className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold">Historique des mouvements</h2>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={filterType ?? "all"}
          onValueChange={(v) => setFilterType(v === "all" ? null : v)}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous types</SelectItem>
            <SelectItem value="RECEIPT">Réceptions</SelectItem>
            <SelectItem value="WITHDRAWAL">Retraits</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={filterZone ?? "all"}
          onValueChange={(v) => setFilterZone(v === "all" ? null : v)}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Zone" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toutes zones</SelectItem>
            {zones.map((z) => (
              <SelectItem key={z.id} value={z.id}>
                {z.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filterSupplier ?? "all"}
          onValueChange={(v) => setFilterSupplier(v === "all" ? null : v)}
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Fournisseur" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous fournisseurs</SelectItem>
            {suppliers.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex items-center gap-2">
          <Label
            htmlFor="filter-start-date"
            className="text-xs text-muted-foreground whitespace-nowrap"
          >
            Du
          </Label>
          <Input
            id="filter-start-date"
            type="date"
            className="w-[150px] h-9"
            value={filterStartDate}
            onChange={(e) => setFilterStartDate(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <Label
            htmlFor="filter-end-date"
            className="text-xs text-muted-foreground whitespace-nowrap"
          >
            Au
          </Label>
          <Input
            id="filter-end-date"
            type="date"
            className="w-[150px] h-9"
            value={filterEndDate}
            onChange={(e) => setFilterEndDate(e.target.value)}
          />
        </div>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : documentsError ? (
        <div className="flex flex-col items-center justify-center p-8 text-center">
          <p className="text-destructive font-medium">Une erreur est survenue</p>
          <p className="text-muted-foreground text-sm mt-1">
            Impossible de charger l'historique des documents. Veuillez reessayer.
          </p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => refetchDocuments()}>
            Reessayer
          </Button>
        </div>
      ) : documents.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <FileText className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p>Aucun document posté pour ces critères.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {documents.map((doc) => (
            <div key={doc.id} className="rounded-xl border bg-card p-4 flex items-center gap-4">
              {/* Status icon */}
              {doc.status === "POSTED" ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-500 dark:text-emerald-400 shrink-0" />
              ) : (
                <XCircle className="h-5 w-5 text-destructive shrink-0" />
              )}

              {/* Info */}
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge
                    variant={doc.status === "POSTED" ? "default" : "destructive"}
                    className="text-xs"
                  >
                    {doc.status}
                  </Badge>
                   <Badge variant="outline" className="text-xs">
                     {doc.type === "RECEIPT"
                       ? "Réception"
                       : doc.type === "WITHDRAWAL"
                         ? "Retrait"
                         : doc.type === "ADJUSTMENT"
                           ? "Ajustement"
                           : doc.type === "RECEIPT_CORRECTION"
                             ? "Correction réception"
                             : doc.type}
                   </Badge>
                   {doc.bl_number && (
                     <Badge variant="secondary" className="text-xs">
                       BL: {doc.bl_number}
                     </Badge>
                   )}
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                  {doc.posted_at && (
                    <span className="flex items-center gap-1">
                      <CalendarDays className="h-3 w-3" />
                      {format(new Date(doc.posted_at), "dd MMM yyyy HH:mm", { locale: fr })}
                    </span>
                  )}
                  {doc.zone_name && (
                    <span className="flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      {doc.zone_name}
                    </span>
                  )}
                  {doc.supplier_name && <span>{doc.supplier_name}</span>}
                  <span>
                    {doc.lines_count} ligne{doc.lines_count > 1 ? "s" : ""}
                  </span>
                </div>
              </div>

              {/* VOID button */}
              {doc.status === "POSTED" && (
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0 text-destructive border-destructive/30 hover:bg-destructive/10"
                  onClick={() => setVoidDoc(doc)}
                >
                  Annuler
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Void dialog */}
      {voidDoc && (
        <VoidConfirmDialog
          open={!!voidDoc}
          onClose={() => setVoidDoc(null)}
          documentType={voidDoc.type}
          linesCount={voidDoc.lines_count}
          isVoiding={isVoiding}
          onConfirm={handleVoid}
        />
      )}
    </div>
  );
}

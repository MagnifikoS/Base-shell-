import { useState, useMemo } from "react";
import { Search, ScanSearch, Loader2, AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useScanHistory } from "../../hooks/useScanHistory";
import { ScanHistoryList } from "./ScanHistoryList";
import { ScanDetailSheet } from "./ScanDetailSheet";
import type { ScanDocument } from "../../types/scanHistory";
import type { ScanDocType } from "../../types/scanHistory";

type DocTypeFilterValue = "all" | ScanDocType;

const DOC_TYPE_FILTER_OPTIONS: { value: DocTypeFilterValue; label: string }[] = [
  { value: "all", label: "Tous les types" },
  { value: "facture", label: "Factures" },
  { value: "bl", label: "Bons de livraison" },
  { value: "releve", label: "Relev\u00e9s" },
];

export function ScanHistoryTab() {
  const { scans, isLoading, error, refetch, invalidate } = useScanHistory();
  const [search, setSearch] = useState("");
  const [docTypeFilter, setDocTypeFilter] = useState<DocTypeFilterValue>("all");
  const [selectedScan, setSelectedScan] = useState<ScanDocument | null>(null);

  const filteredScans = useMemo(() => {
    let result = scans;

    // Filter by doc_type
    if (docTypeFilter !== "all") {
      result = result.filter((s) => (s.doc_type ?? "facture") === docTypeFilter);
    }

    // Filter by search text
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (s) =>
          s.original_filename.toLowerCase().includes(q) ||
          s.supplier_name?.toLowerCase().includes(q) ||
          s.invoice_number?.toLowerCase().includes(q) ||
          s.bl_number?.toLowerCase().includes(q)
      );
    }

    return result;
  }, [scans, search, docTypeFilter]);

  // Error state
  if (error && !isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="h-16 w-16 rounded-2xl bg-destructive/10 flex items-center justify-center mb-4">
          <AlertTriangle className="h-8 w-8 text-destructive/70" />
        </div>
        <h3 className="text-lg font-medium mb-1">Erreur lors du chargement de l'historique</h3>
        <p className="text-sm text-muted-foreground max-w-xs mb-4">
          Impossible de charger l'historique des scans. Veuillez réessayer.
        </p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          Réessayer
        </Button>
      </div>
    );
  }

  // Empty state
  if (!isLoading && scans.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="h-16 w-16 rounded-2xl bg-muted/50 flex items-center justify-center mb-4">
          <ScanSearch className="h-8 w-8 text-muted-foreground/50" />
        </div>
        <h3 className="text-lg font-medium mb-1">Aucun scan enregistr\u00e9</h3>
        <p className="text-sm text-muted-foreground max-w-xs">
          Vos documents scann\u00e9s et leurs r\u00e9sultats d'extraction appara\u00eetront ici
          automatiquement.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search bar + filter */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Rechercher par nom, fournisseur, num\u00e9ro ou BL..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            aria-label="Rechercher une facture"
          />
        </div>
        <Select
          value={docTypeFilter}
          onValueChange={(val) => setDocTypeFilter(val as DocTypeFilterValue)}
        >
          <SelectTrigger className="w-[180px] shrink-0">
            <SelectValue placeholder="Type de document" />
          </SelectTrigger>
          <SelectContent>
            {DOC_TYPE_FILTER_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Results count */}
      {!isLoading && (
        <p className="text-xs text-muted-foreground">
          {filteredScans.length} document{filteredScans.length !== 1 ? "s" : ""}
          {(search.trim() || docTypeFilter !== "all") && ` sur ${scans.length}`}
        </p>
      )}

      {/* List */}
      {!isLoading && filteredScans.length > 0 && (
        <ScanHistoryList scans={filteredScans} onScanClick={setSelectedScan} />
      )}

      {/* No results for search */}
      {!isLoading && filteredScans.length === 0 && scans.length > 0 && (
        <div className="text-center py-8 text-sm text-muted-foreground">
          Aucun r\u00e9sultat pour les filtres s\u00e9lectionn\u00e9s
        </div>
      )}

      {/* Detail sheet */}
      <ScanDetailSheet
        scan={selectedScan}
        open={!!selectedScan}
        onOpenChange={(open) => {
          if (!open) setSelectedScan(null);
        }}
        onDeleted={() => {
          setSelectedScan(null);
          invalidate();
        }}
      />
    </div>
  );
}

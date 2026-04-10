/**
 * BL Retrait — Document List (pro table with partner filter)
 */

import { useState, useMemo } from "react";
import { FileText, ArrowUpRight, ArrowDownLeft, Filter, X, Clock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { BlRetraitDocument } from "../types";

interface Props {
  documents: BlRetraitDocument[];
  onBack: () => void;
  onSelectDocument: (docId: string) => void;
}

type SortKey = "date" | "partner" | "total";
type SortDir = "asc" | "desc";

export function BlRetraitDocumentList({ documents, onBack, onSelectDocument }: Props) {
  const [partnerFilter, setPartnerFilter] = useState<string>("all");
  const [directionFilter, setDirectionFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Build unique partner list for filter
  const partnerOptions = useMemo(() => {
    const names = new Map<string, string>(); // id → name
    for (const d of documents) {
      if (d.direction === "sent" && d.destination_establishment_id) {
        names.set(d.destination_establishment_id, d.destination_name ?? d.destination_establishment_id);
      }
      if (d.direction === "received" && d.establishment_id) {
        names.set(d.establishment_id, d.source_name ?? d.establishment_id);
      }
    }
    return [...names.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [documents]);

  // Get the partner name for a document
  const getPartnerName = (d: BlRetraitDocument) =>
    d.direction === "sent"
      ? (d.destination_name ?? "—")
      : (d.source_name ?? "—");

  const getPartnerId = (d: BlRetraitDocument) =>
    d.direction === "sent"
      ? d.destination_establishment_id
      : d.establishment_id;

  // Filtered & sorted documents
  const filtered = useMemo(() => {
    let list = [...documents];

    if (directionFilter !== "all") {
      list = list.filter((d) => d.direction === directionFilter);
    }
    if (partnerFilter !== "all") {
      list = list.filter((d) => getPartnerId(d) === partnerFilter);
    }

    list.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "date":
          cmp = a.bl_date.localeCompare(b.bl_date);
          break;
        case "partner":
          cmp = getPartnerName(a).localeCompare(getPartnerName(b));
          break;
        case "total":
          cmp = a.total_eur - b.total_eur;
          break;
      }
      return sortDir === "desc" ? -cmp : cmp;
    });

    return list;
  }, [documents, directionFilter, partnerFilter, sortKey, sortDir]);

  const grandTotal = filtered.reduce((sum, d) => sum + d.total_eur, 0);
  const sentCount = filtered.filter((d) => d.direction === "sent").length;
  const receivedCount = filtered.filter((d) => d.direction === "received").length;
  const hasFilters = partnerFilter !== "all" || directionFilter !== "all";

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const sortIndicator = (key: SortKey) =>
    sortKey === key ? (sortDir === "desc" ? " ↓" : " ↑") : "";

  const clearFilters = () => {
    setPartnerFilter("all");
    setDirectionFilter("all");
  };

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="p-3 bg-muted rounded-lg">
          <p className="text-xs text-muted-foreground">Sorties de stock</p>
          <p className="text-xl font-bold">{filtered.length}</p>
          {(sentCount > 0 || receivedCount > 0) && (
            <p className="text-xs text-muted-foreground mt-1">
              {sentCount > 0 && <span>↗ {sentCount} envoyé{sentCount > 1 ? "s" : ""}</span>}
              {sentCount > 0 && receivedCount > 0 && " · "}
              {receivedCount > 0 && <span>↙ {receivedCount} reçu{receivedCount > 1 ? "s" : ""}</span>}
            </p>
          )}
        </div>
        <div className="p-3 bg-muted rounded-lg">
          <p className="text-xs text-muted-foreground">Total du mois</p>
          <p className="text-xl font-bold">{grandTotal.toFixed(2)} €</p>
        </div>
        <div className="p-3 bg-muted rounded-lg">
          <p className="text-xs text-muted-foreground">Clients</p>
          <p className="text-xl font-bold">{partnerOptions.length}</p>
        </div>
      </div>

      {/* Filters bar */}
      <div className="flex flex-wrap items-center gap-2">
        <Filter className="h-4 w-4 text-muted-foreground" />

        <Select value={directionFilter} onValueChange={setDirectionFilter}>
          <SelectTrigger className="w-[140px] h-8 text-xs">
            <SelectValue placeholder="Direction" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous</SelectItem>
            <SelectItem value="sent">↗ Envoyés</SelectItem>
            <SelectItem value="received">↙ Reçus</SelectItem>
          </SelectContent>
        </Select>

        {partnerOptions.length > 0 && (
          <Select value={partnerFilter} onValueChange={setPartnerFilter}>
            <SelectTrigger className="w-[180px] h-8 text-xs">
              <SelectValue placeholder="Partenaire" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les partenaires</SelectItem>
              {partnerOptions.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="h-8 px-2 text-xs gap-1">
            <X className="h-3 w-3" />
            Effacer
          </Button>
        )}
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>{hasFilters ? "Aucun résultat pour ces filtres" : "Aucune sortie de stock ce mois"}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 border-b">
                  <th className="text-left px-3 py-2 font-medium text-xs text-muted-foreground"></th>
                  <th
                    className="text-left px-3 py-2 font-medium text-xs text-muted-foreground cursor-pointer hover:text-foreground select-none"
                    onClick={() => toggleSort("date")}
                  >
                    N° / Date{sortIndicator("date")}
                  </th>
                  <th
                    className="text-left px-3 py-2 font-medium text-xs text-muted-foreground cursor-pointer hover:text-foreground select-none"
                    onClick={() => toggleSort("partner")}
                  >
                    Client{sortIndicator("partner")}
                  </th>
                  <th className="text-left px-3 py-2 font-medium text-xs text-muted-foreground">
                    Préparateur
                  </th>
                  <th
                    className="text-right px-3 py-2 font-medium text-xs text-muted-foreground cursor-pointer hover:text-foreground select-none"
                    onClick={() => toggleSort("total")}
                  >
                    Montant{sortIndicator("total")}
                  </th>
                  <th className="text-center px-3 py-2 font-medium text-xs text-muted-foreground">
                    Statut
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((doc) => {
                  const isSent = doc.direction === "sent";
                  const partnerName = getPartnerName(doc);
                  return (
                    <tr
                      key={doc.id}
                      className="border-b last:border-0 hover:bg-accent/50 cursor-pointer transition-colors"
                      onClick={() => onSelectDocument(doc.id)}
                    >
                      <td className="px-3 py-3 w-8">
                        {isSent ? (
                          <ArrowUpRight className="h-4 w-4 text-orange-500" />
                        ) : (
                          <ArrowDownLeft className="h-4 w-4 text-green-600" />
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <p className="font-medium text-sm">{doc.bl_number}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(doc.bl_date).toLocaleDateString("fr-FR", {
                            day: "numeric",
                            month: "short",
                          })}
                          {doc.created_at && (
                            <span className="ml-1">
                              à {new Date(doc.created_at).toLocaleTimeString("fr-FR", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                          )}
                        </p>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <Badge
                            variant="outline"
                            className={`text-xs ${
                              isSent
                                ? "border-orange-200 bg-orange-50 text-orange-700"
                                : "border-green-200 bg-green-50 text-green-700"
                            }`}
                          >
                            {isSent ? "→" : "←"}
                          </Badge>
                          <span className="font-medium text-sm truncate max-w-[200px]">
                            {partnerName}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <span className="text-sm text-muted-foreground truncate max-w-[150px] block">
                          {doc.created_by_name ?? "—"}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <span className="font-mono font-medium text-sm">
                          {doc.total_eur.toFixed(2)} €
                        </span>
                      </td>
                      <td className="px-3 py-3 text-center">
                        {doc.stock_status === "DRAFT" ? (
                          <Badge
                            variant="outline"
                            className="text-xs border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400 gap-1"
                          >
                            <Clock className="h-3 w-3" />
                            En transit
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="text-xs border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950/30 dark:text-green-400"
                          >
                            Validé
                          </Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-muted/30 border-t-2">
                  <td colSpan={5} className="px-3 py-2 text-sm font-semibold text-right">
                    Total ({filtered.length} bon{filtered.length > 1 ? "s" : ""} de sortie)
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-bold text-sm">
                    {grandTotal.toFixed(2)} €
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

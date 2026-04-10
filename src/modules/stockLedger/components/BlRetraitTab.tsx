/**
 * ═══════════════════════════════════════════════════════════════════════════
 * BL RETRAIT TAB — Tab content for BL Retraits in Factures page
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Month navigation → List of BL Retraits → Detail view.
 * DRAFT documents are shown with "En transit" badge and excluded from totals.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useState, useMemo } from "react";
import { FileText, Loader2, Clock } from "lucide-react";
import { MonthSelector } from "@/components/shared/MonthSelector";
import { getCurrentMonth, toYearMonthString, type MonthNavigation } from "@/modules/shared";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { useBlRetraits, type BlRetraitWithLines } from "../hooks/useBlRetraits";
import { BlRetraitDetail } from "./BlRetraitDetail";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

function formatDate(dateString: string): string {
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "short",
    });
  } catch {
    return dateString;
  }
}

function formatCurrency(amount: number | null): string {
  if (amount == null) return "-";
  return amount.toLocaleString("fr-FR", {
    style: "currency",
    currency: "EUR",
  });
}

export function BlRetraitTab() {
  const { activeEstablishment } = useEstablishment();
  const estId = activeEstablishment?.id ?? null;

  const [currentMonth, setCurrentMonth] = useState<MonthNavigation>(getCurrentMonth);
  const [selectedBlId, setSelectedBlId] = useState<string | null>(null);

  const yearMonth = toYearMonthString(currentMonth);
  const { data: blRetraits = [], isLoading, error } = useBlRetraits(estId, yearMonth);

  // Summary stats — exclude DRAFT (in transit) from totals
  const stats = useMemo(() => {
    let total = 0;
    let count = 0;
    for (const bl of blRetraits) {
      if (!bl.isDraft) {
        total += bl.total_amount ?? 0;
        count++;
      }
    }
    return { count, total, totalWithDraft: blRetraits.length };
  }, [blRetraits]);

  const handleMonthChange = (nav: MonthNavigation) => {
    setCurrentMonth(nav);
    setSelectedBlId(null);
  };

  const selectedBl: BlRetraitWithLines | null = selectedBlId
    ? (blRetraits.find((bl) => bl.id === selectedBlId) ?? null)
    : null;

  // Detail view
  if (selectedBlId && selectedBl) {
    return <BlRetraitDetail blRetrait={selectedBl} onBack={() => setSelectedBlId(null)} />;
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <FileText className="h-8 w-8 text-primary" />
          <h1 className="text-2xl font-bold">BL Retraits</h1>
        </div>
        <MonthSelector value={currentMonth} onChange={handleMonthChange} />
      </div>

      {/* Error state */}
      {error && (
        <div className="p-4 mb-6 bg-destructive/10 border border-destructive/20 rounded-xl">
          <p className="text-sm text-destructive">{(error as Error).message}</p>
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="p-4 bg-muted rounded-lg">
          <p className="text-sm text-muted-foreground">BL Retraits</p>
          <p className="text-2xl font-bold">{stats.count}</p>
        </div>
        <div className="p-4 bg-muted rounded-lg">
          <p className="text-sm text-muted-foreground">Total du mois</p>
          <p className="text-2xl font-bold">{formatCurrency(stats.total)}</p>
        </div>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">Chargement...</span>
        </div>
      ) : blRetraits.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>Aucun BL Retrait pour ce mois.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {blRetraits.map((bl) => (
            <Card
              key={bl.id}
              className="cursor-pointer hover:border-primary/30 transition-colors"
              onClick={() => setSelectedBlId(bl.id)}
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-sm">{bl.bl_number}</span>
                      <Badge variant="outline" className="text-xs">
                        {bl.lines.length} ligne
                        {bl.lines.length > 1 ? "s" : ""}
                      </Badge>
                      {bl.isDraft && (
                        <Badge variant="outline" className="text-xs border-orange-300 text-orange-600 gap-1">
                          <Clock className="h-3 w-3" />
                          En transit
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{formatDate(bl.created_at)}</span>
                      {bl.destination_name && (
                        <>
                          <span>·</span>
                          <span className="truncate">{bl.destination_name}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <span className="text-sm font-semibold ml-3 shrink-0">
                    {formatCurrency(bl.total_amount)}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MODULE BL-RETRAIT — Tab Component
 * Sub-tab in Factures: month → list → detail
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useState } from "react";
import { FileText } from "lucide-react";
import { MonthSelector } from "@/modules/factures/components/MonthSelector";
import type { MonthNavigation } from "@/modules/factures/types";
import { getCurrentMonth, toYearMonthString } from "@/modules/factures/types";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { useBlRetraitDocumentsByMonth } from "../hooks/useBlRetraitDocumentsByMonth";
import { BlRetraitDocumentList } from "./BlRetraitDocumentList";
import { BlRetraitDocumentDetail } from "./BlRetraitDocumentDetail";

export function BlRetraitTab() {
  const { activeEstablishment } = useEstablishment();
  const estId = activeEstablishment?.id ?? null;

  const [currentMonth, setCurrentMonth] = useState<MonthNavigation>(getCurrentMonth);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);

  const yearMonth = toYearMonthString(currentMonth);
  const { data: documents = [], isLoading } = useBlRetraitDocumentsByMonth(estId, yearMonth);

  const handleMonthChange = (nav: MonthNavigation) => {
    setCurrentMonth(nav);
    setSelectedDocId(null);
  };

  const selectedDoc = selectedDocId
    ? documents.find((d) => d.id === selectedDocId) ?? null
    : null;

  // Detail view
  if (selectedDocId && selectedDoc) {
    return (
      <BlRetraitDocumentDetail
        document={selectedDoc}
        onBack={() => setSelectedDocId(null)}
      />
    );
  }

  // List view
  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <FileText className="h-8 w-8 text-primary" />
          <h1 className="text-2xl font-bold">Sorties de stock</h1>
        </div>
        <MonthSelector value={currentMonth} onChange={handleMonthChange} />
      </div>

      <BlRetraitDocumentList
        documents={documents}
        onBack={() => {}}
        onSelectDocument={setSelectedDocId}
      />
    </div>
  );
}

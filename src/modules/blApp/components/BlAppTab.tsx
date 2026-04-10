/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MODULE BL-APP — Tab Component (V1)
 *
 * Main container for the BL-APP sub-tab in Factures.
 * Navigation: month → supplier list → document list → document detail
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useState, useMemo } from "react";
import { FileText } from "lucide-react";
import { MonthSelector } from "@/components/shared/MonthSelector";
import { getCurrentMonth, toYearMonthString, type MonthNavigation } from "@/modules/shared";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { useBlAppDocumentsByMonth } from "../hooks/useBlAppDocumentsByMonth";
import { BlAppSupplierList } from "./BlAppSupplierList";
import { BlAppDocumentList } from "./BlAppDocumentList";
import { BlAppDocumentDetail } from "./BlAppDocumentDetail";

interface SupplierGroup {
  supplier_id: string | null;
  supplier_name: string;
  count: number;
}

export function BlAppTab() {
  const { activeEstablishment } = useEstablishment();
  const estId = activeEstablishment?.id ?? null;

  const [currentMonth, setCurrentMonth] = useState<MonthNavigation>(getCurrentMonth);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const [supplierSelected, setSupplierSelected] = useState(false);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);

  const yearMonth = toYearMonthString(currentMonth);
  const { data: documents = [], isLoading, error } = useBlAppDocumentsByMonth(estId, yearMonth);

  // Group by supplier
  const supplierGroups = useMemo<SupplierGroup[]>(() => {
    const map = new Map<string, SupplierGroup>();
    for (const doc of documents) {
      const key = doc.supplier_id ?? "__unknown__";
      if (!map.has(key)) {
        map.set(key, {
          supplier_id: doc.supplier_id,
          supplier_name: doc.supplier_name_snapshot ?? "Fournisseur inconnu",
          count: 0,
        });
      }
      map.get(key)!.count++;
    }
    return Array.from(map.values()).sort((a, b) => a.supplier_name.localeCompare(b.supplier_name));
  }, [documents]);

  const handleMonthChange = (nav: MonthNavigation) => {
    setCurrentMonth(nav);
    setSelectedSupplierId(null);
    setSupplierSelected(false);
    setSelectedDocId(null);
  };

  const handleSelectSupplier = (supplierId: string | null) => {
    setSelectedSupplierId(supplierId);
    setSupplierSelected(true);
    setSelectedDocId(null);
  };

  const handleBackToSuppliers = () => {
    setSelectedSupplierId(null);
    setSupplierSelected(false);
    setSelectedDocId(null);
  };

  const handleSelectDoc = (docId: string) => {
    setSelectedDocId(docId);
  };

  const handleBackToList = () => {
    setSelectedDocId(null);
  };

  // Filter docs for selected supplier
  const supplierDocs = useMemo(() => {
    if (!supplierSelected) return [];
    return documents.filter((d) =>
      selectedSupplierId === null ? d.supplier_id === null : d.supplier_id === selectedSupplierId
    );
  }, [documents, selectedSupplierId, supplierSelected]);

  const selectedDoc = selectedDocId
    ? (documents.find((d) => d.id === selectedDocId) ?? null)
    : null;

  const supplierName = supplierSelected
    ? (supplierGroups.find((g) => g.supplier_id === selectedSupplierId)?.supplier_name ??
      "Fournisseur inconnu")
    : "";

  // Detail view
  if (selectedDocId && selectedDoc) {
    return <BlAppDocumentDetail document={selectedDoc} onBack={handleBackToList} />;
  }

  // Document list for supplier
  if (supplierSelected) {
    return (
      <BlAppDocumentList
        documents={supplierDocs}
        supplierName={supplierName}
        month={currentMonth}
        onBack={handleBackToSuppliers}
        onSelectDocument={handleSelectDoc}
      />
    );
  }

  // Supplier list
  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <FileText className="h-8 w-8 text-primary" />
          <h1 className="text-2xl font-bold">BL-APP</h1>
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
          <p className="text-sm text-muted-foreground">Bons de livraison</p>
          <p className="text-2xl font-bold">{documents.length}</p>
        </div>
        <div className="p-4 bg-muted rounded-lg">
          <p className="text-sm text-muted-foreground">Fournisseurs</p>
          <p className="text-2xl font-bold">{supplierGroups.length}</p>
        </div>
      </div>

      {/* Supplier list */}
      <BlAppSupplierList
        groups={supplierGroups}
        onSelectSupplier={handleSelectSupplier}
        isLoading={isLoading}
      />
    </div>
  );
}

/**
 * InvoiceSidebar — Liste verticale des factures analysées.
 * Desktop only, pas d'adaptation mobile.
 * Aucune logique métier — affichage pur.
 */

import { FileText } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

export interface AnalyzedInvoiceEntry {
  id: string;
  label: string;
  fileName: string;
  totalProduits: number;
  timestamp: number;
}

interface InvoiceSidebarProps {
  invoices: AnalyzedInvoiceEntry[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function InvoiceSidebar({ invoices, selectedId, onSelect }: InvoiceSidebarProps) {
  if (invoices.length === 0) return null;

  return (
    <div className="w-64 shrink-0 border-r bg-muted/30">
      <div className="px-3 py-3 border-b">
        <h3 className="text-sm font-semibold text-muted-foreground">
          Factures analysées ({invoices.length})
        </h3>
      </div>
      <ScrollArea className="h-[calc(100vh-12rem)]">
        <div className="p-2 space-y-1">
          {invoices.map((inv) => (
            <button
              key={inv.id}
              onClick={() => onSelect(inv.id)}
              className={cn(
                "w-full text-left rounded-md px-3 py-2 text-sm transition-colors",
                "hover:bg-muted",
                selectedId === inv.id
                  ? "bg-primary/10 text-primary font-medium border border-primary/20"
                  : "text-foreground"
              )}
            >
              <div className="flex items-center gap-2">
                <FileText className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{inv.label}</span>
              </div>
              <div className="text-xs text-muted-foreground mt-0.5 pl-5.5">
                {inv.totalProduits} produit{inv.totalProduits > 1 ? "s" : ""} · {inv.fileName}
              </div>
            </button>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

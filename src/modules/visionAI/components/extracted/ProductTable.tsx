/**
 * ProductTable — Scrollable table of extracted products with status summary.
 */

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Check, AlertTriangle } from "lucide-react";
import { ProductRow } from "./ProductRow";
import type { EditableProductLine, LineCorrection } from "./extractedTypes";
import type { LineStatusResult } from "@/modules/analyseFacture";

interface ProductTableProps {
  /** Corrected items (with corrections applied) */
  correctedItems: EditableProductLine[];
  /** Raw editable items (before corrections) */
  editableItems: EditableProductLine[];
  /** Status map by index */
  statuses: Map<number, LineStatusResult>;
  /** Whether statuses are loading */
  isLoadingStatuses: boolean;
  /** Resolved price decisions set (by item _id) */
  resolvedPriceDecisions: Set<string>;
  /** Line corrections map (by item _id) */
  lineCorrections: Record<string, LineCorrection>;
  /** Confirmed matches map (by item _id) */
  confirmedMatches: Record<string, { productId: string; confirmedAt: number }>;
  /** Status counts */
  counts: { validated: number; priceAlert: number; needsAction: number };
  /** Callbacks */
  onDelete: (e: React.MouseEvent, id: string) => void;
  onOpenDrawer: (itemId: string) => void;
  onOpenSuggestions: (item: EditableProductLine, skipCategory: boolean) => void;
  /** Render status cell with actions */
  renderStatusCell: (item: EditableProductLine, index: number) => React.ReactNode;
}

export function ProductTable({
  correctedItems,
  editableItems,
  statuses,
  isLoadingStatuses,
  resolvedPriceDecisions,
  lineCorrections,
  confirmedMatches,
  counts,
  onDelete,
  onOpenDrawer,
  onOpenSuggestions,
  renderStatusCell,
}: ProductTableProps) {
  return (
    <>
      {/* Status summary */}
      {!isLoadingStatuses && editableItems.length > 0 && (
        <div className="flex items-center gap-6 text-sm">
          <div className="flex items-center gap-2">
            <div className="h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center">
              <Check className="h-3 w-3 text-primary" />
            </div>
            <span className="text-muted-foreground">
              {counts.validated} valide{counts.validated > 1 ? "s" : ""}
            </span>
          </div>
          {counts.needsAction > 0 && (
            <div className="flex items-center gap-2">
              <div className="h-5 w-5 rounded-full bg-warning/10 flex items-center justify-center">
                <AlertTriangle className="h-3 w-3 text-warning" />
              </div>
              <span className="text-muted-foreground">{counts.needsAction} a completer</span>
            </div>
          )}
        </div>
      )}

      {/* Scrollable table container */}
      <div className="flex-1 overflow-auto border rounded-lg min-h-0">
        <Table>
          <TableHeader className="sticky top-0 bg-background z-10">
            <TableRow>
              <TableHead className="w-[80px]">Code</TableHead>
              <TableHead className="min-w-[250px]">Nom produit</TableHead>
              <TableHead className="w-[60px] text-right">Qte</TableHead>
              <TableHead className="w-[80px] text-right">Prix</TableHead>
              <TableHead className="w-[180px]">Statut</TableHead>
              <TableHead className="w-[90px] text-center">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {correctedItems.map((item, originalIndex) => {
              const rawItem = editableItems[originalIndex];
              const status = statuses.get(originalIndex);
              const isResolved = resolvedPriceDecisions.has(item._id);
              const correction = lineCorrections[item._id];

              return (
                <ProductRow
                  key={item._id}
                  item={item}
                  rawItem={rawItem}
                  index={originalIndex}
                  status={status}
                  isLoadingStatuses={isLoadingStatuses}
                  isResolved={isResolved}
                  correction={correction}
                  confirmedMatch={confirmedMatches[item._id]}
                  onDelete={onDelete}
                  onOpenDrawer={onOpenDrawer}
                  onOpenSuggestions={onOpenSuggestions}
                  renderStatusCell={renderStatusCell}
                />
              );
            })}
            {editableItems.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  Aucun produit a valider.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

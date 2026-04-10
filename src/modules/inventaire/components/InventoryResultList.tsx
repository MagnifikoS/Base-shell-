/**
 * ═══════════════════════════════════════════════════════════════════════════
 * INVENTAIRE V0 — Result List (post-completion view, edit via popup)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Phase 2: Inline input removed → edit triggers popup in parent.
 */

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { PaginationControls } from "@/components/ui/pagination-controls";
import { usePagination } from "@/hooks/usePagination";
import { Pencil, Package } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";
import type { InventoryLineWithProduct } from "../types";
import type { UnitWithFamily } from "@/core/unitConversion/types";

interface InventoryResultListProps {
  lines: InventoryLineWithProduct[];
  dbUnits: UnitWithFamily[];
  editable: boolean;
  /** Opens popup to edit the line's quantity */
  onEditLine: (lineId: string) => void;
}

export function InventoryResultList({
  lines,
  dbUnits: _dbUnits,
  editable,
  onEditLine,
}: InventoryResultListProps) {
  // Pagination (PERF-08)
  const {
    paginatedData: paginatedLines,
    currentPage,
    totalPages,
    totalItems,
    hasNextPage,
    hasPrevPage,
    nextPage,
    prevPage,
    goToPage,
  } = usePagination(lines, { pageSize: 25 });

  if (lines.length === 0) {
    return (
      <div className="border rounded-lg overflow-hidden p-4">
        <EmptyState
          icon={<Package className="h-12 w-12" />}
          title="Aucun produit inventorie"
          description="Lancez un comptage pour voir les resultats ici."
        />
      </div>
    );
  }

  return (
    <div className="border rounded-lg overflow-hidden">
      <Table aria-label="Résultats de l'inventaire">
        <TableHeader>
          <TableRow>
            <TableHead>Produit</TableHead>
            <TableHead className="w-[100px] text-right">Quantité</TableHead>
            <TableHead className="w-[120px]">Unité</TableHead>
            {editable && <TableHead className="w-[60px]" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {paginatedLines.map((line) => (
            <TableRow key={line.id}>
              <TableCell>
                <div>
                  <p className="font-medium uppercase text-sm">{line.product_name}</p>
                  {line.product_code && (
                    <p className="text-xs text-muted-foreground font-mono">{line.product_code}</p>
                  )}
                </div>
              </TableCell>
              <TableCell className="text-right">
                <span className="font-mono">{line.quantity ?? "—"}</span>
              </TableCell>
              <TableCell>
                <span className="text-sm text-muted-foreground">
                  {line.unit_abbreviation ?? "—"}
                </span>
              </TableCell>
              {editable && (
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => onEditLine(line.id)}
                    aria-label="Modifier la quantité"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {/* Pagination (PERF-08) */}
      <PaginationControls
        currentPage={currentPage}
        totalPages={totalPages}
        totalItems={totalItems}
        hasNextPage={hasNextPage}
        hasPrevPage={hasPrevPage}
        onNextPage={nextPage}
        onPrevPage={prevPage}
        onGoToPage={goToPage}
      />
    </div>
  );
}

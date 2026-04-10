/**
 * ═══════════════════════════════════════════════════════════════════════════
 * RECEPTION LINE TABLE — Display DRAFT lines (read-only qty, edit via popup)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Phase 2: Inline input removed → edit triggers popup in parent.
 */

import { Pencil, Trash2 } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import type { StockDocumentLine } from "../types";
import { getInputPayloadProductName } from "../types";

interface Props {
  lines: StockDocumentLine[];
  /** Opens popup to edit the line's quantity */
  onEditLine: (lineId: string) => void;
  onRemove: (lineId: string) => void;
}

export function ReceptionLineTable({ lines, onEditLine, onRemove }: Props) {
  if (lines.length === 0) {
    return (
      <div className="border border-dashed rounded-lg p-8 text-center text-muted-foreground">
        Aucun produit ajouté. Cliquez sur « Ajouter un produit » pour commencer.
      </div>
    );
  }

  return (
    <div className="border rounded-lg overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[40%]">Produit</TableHead>
            <TableHead className="w-[20%] text-right">Quantité</TableHead>
            <TableHead className="w-[20%]">Unité</TableHead>
            <TableHead className="w-[20%] text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((line) => {
            const productLabel =
              getInputPayloadProductName(line.input_payload) ?? line.product_id.slice(0, 8);
            return (
              <TableRow key={line.id}>
                <TableCell className="font-medium">{productLabel}</TableCell>
                <TableCell className="text-right font-mono">
                  {line.delta_quantity_canonical}
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {line.canonical_label ?? "—"}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onEditLine(line.id)}
                      aria-label="Modifier la quantité"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onRemove(line.id)}
                      className="text-destructive hover:text-destructive"
                      aria-label="Supprimer la ligne"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

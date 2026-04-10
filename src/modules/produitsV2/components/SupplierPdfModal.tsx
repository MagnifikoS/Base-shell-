/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PRODUITS V2 — Modal de configuration PDF par Fournisseur
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Permet à l'utilisateur de choisir les colonnes à inclure dans le PDF.
 */

import { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { FileText } from "lucide-react";
import { AVAILABLE_COLUMNS, generateSupplierProductsPdf } from "../utils/supplierProductsPdf";
import type { ProductV2ListItem } from "../types";

interface SupplierPdfModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  supplierName: string;
  products: ProductV2ListItem[];
}

export function SupplierPdfModal({
  open,
  onOpenChange,
  supplierName,
  products,
}: SupplierPdfModalProps) {
  // Initialize with default selections
  const [selectedColumns, setSelectedColumns] = useState<Set<string>>(() => {
    const defaults = new Set<string>();
    AVAILABLE_COLUMNS.forEach((col) => {
      if (col.defaultSelected) {
        defaults.add(col.key);
      }
    });
    return defaults;
  });

  const canGenerate = useMemo(() => selectedColumns.size > 0, [selectedColumns]);

  const toggleColumn = (key: string) => {
    setSelectedColumns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleGenerate = async () => {
    await generateSupplierProductsPdf({
      supplierName,
      products,
      selectedColumns: Array.from(selectedColumns),
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            Générer PDF
          </DialogTitle>
          <DialogDescription>
            Sélectionnez les colonnes à inclure pour <strong>{supplierName}</strong>
            <br />
            <span className="text-muted-foreground">
              ({products.length} produit{products.length > 1 ? "s" : ""})
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-4">
          {AVAILABLE_COLUMNS.map((col) => (
            <div key={col.key} className="flex items-center space-x-3">
              <Checkbox
                id={`col-${col.key}`}
                checked={selectedColumns.has(col.key)}
                onCheckedChange={() => toggleColumn(col.key)}
              />
              <Label htmlFor={`col-${col.key}`} className="text-sm font-normal cursor-pointer">
                {col.label}
              </Label>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button onClick={handleGenerate} disabled={!canGenerate}>
            <FileText className="h-4 w-4 mr-2" />
            Générer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

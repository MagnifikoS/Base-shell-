/**
 * OrderPrepTab — Main view for "À commander" tab
 * Shows supplier list → drill into supplier lines
 * Swipe right on a line to toggle check ✓
 */

import { useState, useMemo, useCallback, useRef } from "react";
import { useTapGuard } from "@/hooks/useTapGuard";
import { useOrderPrepLines } from "../hooks/useOrderPrepLines";
import { useToggleOrderPrepCheck, useValidateSupplierPrep, useDeleteOrderPrepLine, useUpsertOrderPrep } from "../hooks/useOrderPrepMutations";
import { useSuppliersList } from "@/modules/produitsV2/hooks/useSuppliersList";
import { useUnits } from "@/hooks/useUnits";
import { ArrowLeft, ChevronRight, Package, ShoppingCart, Check, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import type { OrderPrepLine, SupplierPrepSummary } from "../types";

/* ── Swipeable line component ── */
function SwipeableLine({
  line,
  onToggle,
  onEdit,
  onDelete,
  getUnitLabel,
}: {
  line: OrderPrepLine;
  onToggle: (line: OrderPrepLine) => void;
  onEdit: (line: OrderPrepLine) => void;
  onDelete: (id: string) => void;
  getUnitLabel: (id: string) => string;
}) {
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const swipedRef = useRef(false);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    startXRef.current = e.touches[0].clientX;
    startYRef.current = e.touches[0].clientY;
    swipedRef.current = false;
  }, []);

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const dx = e.changedTouches[0].clientX - startXRef.current;
      const dy = Math.abs(e.changedTouches[0].clientY - startYRef.current);
      // Swipe right: dx > 80px and mostly horizontal
      if (dx > 80 && dy < 50) {
        swipedRef.current = true;
        onToggle(line);
      }
    },
    [line, onToggle]
  );

  const handleClick = useCallback(() => {
    // Ignore click if we just swiped
    if (swipedRef.current) {
      swipedRef.current = false;
      return;
    }
    onEdit(line);
  }, [line, onEdit]);

  return (
    <div
      className="flex items-center gap-3 px-4 py-3 active:bg-muted/40 transition-colors touch-manipulation select-none"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Check button */}
      <button
        className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center border-2 transition-colors ${
          line.status === "checked"
            ? "bg-emerald-500 border-emerald-500 text-white"
            : "border-border/50 text-transparent hover:border-emerald-300"
        }`}
        onClick={(e) => { e.stopPropagation(); onToggle(line); }}
      >
        <Check className="h-3.5 w-3.5" />
      </button>

      {/* Product info — tap to edit */}
      <div
        className="flex-1 min-w-0 cursor-pointer"
        onClick={handleClick}
      >
        <p className={`text-[13px] font-medium leading-tight break-words ${
          line.status === "checked" ? "text-muted-foreground line-through" : "text-foreground"
        }`}>
          {line.product_name || "Produit"}
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          <p className="text-[11px] text-muted-foreground tabular-nums">
            {line.quantity} {getUnitLabel(line.unit_id)}
          </p>
          <span className="text-[9px] text-muted-foreground/40">← swipe ✓</span>
        </div>
      </div>

      {/* Delete */}
      <button
        className="shrink-0 p-1.5 text-muted-foreground/50 hover:text-destructive transition-colors"
        onClick={(e) => { e.stopPropagation(); onDelete(line.id); }}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function OrderPrepTab() {
  const { data: lines = [], isLoading } = useOrderPrepLines();
  const { data: suppliers = [] } = useSuppliersList();
  const { units: dbUnits } = useUnits();
  const toggleCheck = useToggleOrderPrepCheck();
  const validateSupplier = useValidateSupplierPrep();
  const deleteLine = useDeleteOrderPrepLine();
  const upsertLine = useUpsertOrderPrep();
  const { onTouchStart, onTouchMove, guardedClick } = useTapGuard();

  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const [editingLine, setEditingLine] = useState<OrderPrepLine | null>(null);
  const [editQty, setEditQty] = useState("");
  const [editUnitId, setEditUnitId] = useState("");

  // Build supplier summaries
  const supplierSummaries = useMemo<SupplierPrepSummary[]>(() => {
    const map = new Map<string, { lines: OrderPrepLine[] }>();
    for (const line of lines) {
      const entry = map.get(line.supplier_id) ?? { lines: [] };
      entry.lines.push(line);
      map.set(line.supplier_id, entry);
    }

    return Array.from(map.entries()).map(([supplierId, { lines: supplierLines }]) => {
      const supplier = suppliers.find((s) => s.id === supplierId);
      return {
        supplierId,
        supplierName: supplier?.trade_name || supplier?.name || "Fournisseur",
        lineCount: supplierLines.length,
        checkedCount: supplierLines.filter((l) => l.status === "checked").length,
        allChecked: supplierLines.every((l) => l.status === "checked"),
      };
    }).sort((a, b) => a.supplierName.localeCompare(b.supplierName));
  }, [lines, suppliers]);

  // Lines for selected supplier
  const supplierLines = useMemo(() => {
    if (!selectedSupplierId) return [];
    return lines.filter((l) => l.supplier_id === selectedSupplierId);
  }, [lines, selectedSupplierId]);

  const selectedSupplierName = supplierSummaries.find(
    (s) => s.supplierId === selectedSupplierId
  )?.supplierName ?? "";

  const allChecked = supplierLines.length > 0 && supplierLines.every((l) => l.status === "checked");

  const getUnitLabel = useCallback(
    (unitId: string) => {
      const u = dbUnits.find((u) => u.id === unitId);
      return u?.abbreviation || u?.name || "";
    },
    [dbUnits]
  );

  const handleToggle = useCallback(
    (line: OrderPrepLine) => {
      toggleCheck.mutate({ lineId: line.id, currentStatus: line.status });
    },
    [toggleCheck]
  );

  const handleValidate = useCallback(() => {
    if (!selectedSupplierId) return;
    validateSupplier.mutate(selectedSupplierId, {
      onSuccess: () => setSelectedSupplierId(null),
    });
  }, [selectedSupplierId, validateSupplier]);

  const handleDelete = useCallback(
    (lineId: string) => {
      deleteLine.mutate(lineId);
    },
    [deleteLine]
  );

  const openEditDialog = useCallback((line: OrderPrepLine) => {
    setEditingLine(line);
    setEditQty(String(line.quantity));
    setEditUnitId(line.unit_id);
  }, []);

  const handleEditSave = useCallback(() => {
    if (!editingLine) return;
    const qty = parseFloat(editQty);
    if (isNaN(qty) || qty <= 0) return;
    upsertLine.mutate(
      {
        productId: editingLine.product_id,
        productName: editingLine.product_name,
        supplierId: editingLine.supplier_id,
        quantity: qty,
        unitId: editUnitId || editingLine.unit_id,
      },
      { onSuccess: () => setEditingLine(null) }
    );
  }, [editingLine, editQty, editUnitId, upsertLine]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Chargement…</p>
      </div>
    );
  }

  // Supplier lines view
  if (selectedSupplierId) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setSelectedSupplierId(null)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h3 className="text-base font-semibold text-foreground truncate">{selectedSupplierName}</h3>
        </div>

        {supplierLines.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2">
            <Package className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">Aucun produit</p>
          </div>
        ) : (
          <div className="divide-y divide-border/50 rounded-xl border border-border/50 bg-card overflow-hidden">
            {supplierLines.map((line) => (
              <SwipeableLine
                key={line.id}
                line={line}
                onToggle={handleToggle}
                onEdit={openEditDialog}
                onDelete={handleDelete}
                getUnitLabel={getUnitLabel}
              />
            ))}
          </div>
        )}

        {/* Validate button — appears when ALL lines are checked */}
        {allChecked && supplierLines.length > 0 && (
          <Button
            onClick={handleValidate}
            disabled={validateSupplier.isPending}
            className="w-full h-12 rounded-xl text-sm font-semibold gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            <Check className="h-4 w-4" />
            Valider la liste
          </Button>
        )}

        {/* Edit quantity + unit dialog */}
        <Dialog open={!!editingLine} onOpenChange={(open) => !open && setEditingLine(null)}>
          <DialogContent className="max-w-[320px] rounded-2xl p-0 gap-0">
            <DialogHeader className="px-5 pt-5 pb-3">
              <DialogTitle className="text-[15px]">Modifier la ligne</DialogTitle>
            </DialogHeader>
            <Separator className="bg-border/20" />
            <div className="px-5 py-4 space-y-4">
              {/* Quantity */}
              <div className="space-y-1">
                <label className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-[0.12em]">
                  Quantité
                </label>
                <Input
                  type="number"
                  inputMode="decimal"
                  value={editQty}
                  onChange={(e) => setEditQty(e.target.value)}
                  className="h-11 rounded-lg text-center text-base font-semibold tabular-nums"
                  autoFocus
                />
              </div>
              {/* Unit selector */}
              <div className="space-y-1">
                <label className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-[0.12em]">
                  Unité
                </label>
                <Select value={editUnitId} onValueChange={setEditUnitId}>
                  <SelectTrigger className="h-11 rounded-lg text-[13px]">
                    <SelectValue placeholder={getUnitLabel(editingLine?.unit_id ?? "")} />
                  </SelectTrigger>
                  <SelectContent>
                    {dbUnits.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.abbreviation || u.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                onClick={handleEditSave}
                disabled={upsertLine.isPending}
                className="w-full h-10 rounded-lg"
              >
                Enregistrer
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // Supplier list view
  if (supplierSummaries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <ShoppingCart className="h-10 w-10 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground">Aucun produit à commander</p>
        <p className="text-xs text-muted-foreground/60 text-center max-w-[260px]">
          Ajoutez des produits depuis l'inventaire mobile (Stock → produit → À commander)
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="divide-y divide-border/50 rounded-xl border border-border/50 bg-card overflow-hidden">
        {supplierSummaries.map((summary) => (
          <div
            key={summary.supplierId}
            className="flex items-center gap-3 px-4 py-3.5 active:bg-muted/40 transition-colors cursor-pointer touch-manipulation"
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onClick={guardedClick(() => setSelectedSupplierId(summary.supplierId))}
          >
            <div className="flex-1 min-w-0">
              <p className="text-[14px] font-semibold text-foreground leading-tight">
                {summary.supplierName}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {summary.lineCount} produit{summary.lineCount > 1 ? "s" : ""}
                {summary.checkedCount > 0 && (
                  <span className="text-emerald-500 ml-1.5">
                    · {summary.checkedCount} coché{summary.checkedCount > 1 ? "s" : ""}
                  </span>
                )}
              </p>
            </div>

            {/* Status indicator */}
            {summary.allChecked ? (
              <span className="shrink-0 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 text-[10px] font-semibold">
                Prêt
              </span>
            ) : (
              <span className="shrink-0 px-2.5 py-1 rounded-full bg-muted/40 text-muted-foreground text-[10px] font-medium">
                {summary.checkedCount}/{summary.lineCount}
              </span>
            )}

            <ChevronRight className="h-4 w-4 text-muted-foreground/30 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PRODUITS V2 — ProductsV2Table Component
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useState, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Trash2, Archive, Download, Columns3, CheckCircle2 } from "lucide-react";
import { displayProductName } from "@/utils/displayName";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { useProductV2Mutations } from "../hooks/useProductV2Mutations";
import { useStorageZones } from "../hooks/useStorageZones";
import type { ProductV2ListItem } from "../types";
import { useProductListPrices } from "../hooks/useProductListPrices";
import { ZoneInlineEdit } from "./ZoneInlineEdit";

import { toast } from "sonner";

// ── Column definitions ──────────────────────────────────────────────────────

interface ColumnDef {
  key: string;
  label: string;
  csvLabel: string;
  defaultVisible: boolean;
}

const COLUMNS: ColumnDef[] = [
  { key: "nom_produit", label: "Nom produit", csvLabel: "Nom produit", defaultVisible: true },
  { key: "prix", label: "Prix unitaire", csvLabel: "Prix unitaire (€)", defaultVisible: true },
  { key: "categorie", label: "Catégorie", csvLabel: "Catégorie", defaultVisible: false },
  { key: "unite_inventaire", label: "Unité inventaire", csvLabel: "Unité inventaire", defaultVisible: true },
  
  { key: "zone_stockage", label: "Zone stockage", csvLabel: "Zone stockage", defaultVisible: true },
  { key: "code_produit", label: "Code produit", csvLabel: "Code produit", defaultVisible: true },
  { key: "code_barres", label: "Code-barres", csvLabel: "Code-barres", defaultVisible: true },
];

function getDefaultVisibility(): Record<string, boolean> {
  const v: Record<string, boolean> = {};
  for (const col of COLUMNS) v[col.key] = col.defaultVisible;
  return v;
}

function getCsvValue(product: ProductV2ListItem, key: string): string {
  switch (key) {
    case "nom_produit": return displayProductName(product.nom_produit);
    case "prix": return product.final_unit_price != null ? product.final_unit_price.toFixed(2) : "";
    case "categorie": return product.category_name ?? "";
    case "unite_inventaire": return product.stock_handling_unit_name ?? "";
    
    case "zone_stockage": return product.storage_zone_name ?? "";
    case "code_produit": return product.code_produit ?? "";
    case "code_barres": return product.code_barres ?? "";
    default: return "";
  }
}

// ── Component ───────────────────────────────────────────────────────────────

interface ProductsV2TableProps {
  products: ProductV2ListItem[];
  isLoading: boolean;
}

export function ProductsV2Table({ products, isLoading }: ProductsV2TableProps) {
  const navigate = useNavigate();
  const priceMap = useProductListPrices(products);
  const location = useLocation();
  const { archive, permanentDelete } = useProductV2Mutations();
  const { zones } = useStorageZones();
  const [archiveTarget, setArchiveTarget] = useState<ProductV2ListItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProductV2ListItem | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkArchiveOpen, setBulkArchiveOpen] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [columnVisibility, setColumnVisibility] = useState(getDefaultVisibility);

  const isVisible = (key: string) => columnVisibility[key] !== false;

  const toggleColumnVisibility = (key: string) => {
    setColumnVisibility((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleRowClick = (id: string) => {
    navigate(`/produits-v2/${id}`, { state: { from: location.pathname + location.search } });
  };

  const handleArchiveClick = (e: React.MouseEvent, product: ProductV2ListItem) => {
    e.stopPropagation();
    setArchiveTarget(product);
  };

  const handleDeleteClick = (e: React.MouseEvent, product: ProductV2ListItem) => {
    e.stopPropagation();
    setDeleteTarget(product);
  };

  const handleConfirmArchive = async () => {
    if (!archiveTarget) return;
    await archive.mutateAsync(archiveTarget.id);
    setArchiveTarget(null);
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    await permanentDelete.mutateAsync(deleteTarget.id);
    setDeleteTarget(null);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === products.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(products.map((p) => p.id)));
    }
  };

  const handleBulkArchive = async () => {
    const ids = Array.from(selectedIds);
    for (const id of ids) {
      await archive.mutateAsync(id);
    }
    setSelectedIds(new Set());
    setBulkArchiveOpen(false);
  };

  const handleBulkPermanentDelete = async () => {
    const ids = Array.from(selectedIds);
    let failures = 0;
    // Sequential to avoid race conditions on inventory counter updates
    for (const id of ids) {
      try {
        await permanentDelete.mutateAsync(id);
      } catch {
        failures++;
      }
    }
    if (failures > 0) {
      toast.error(`${failures} produit(s) n'ont pas pu être supprimés (référencés par des factures ou mouvements).`);
    }
    setSelectedIds(new Set());
    setBulkDeleteOpen(false);
  };

  const handleExportCsv = useCallback(() => {
    const selected = products.filter((p) => selectedIds.has(p.id));
    if (selected.length === 0) return;

    const visibleCols = COLUMNS.filter((c) => isVisible(c.key));
    const escape = (v: string) => {
      if (v.includes(",") || v.includes('"') || v.includes("\n")) {
        return `"${v.replace(/"/g, '""')}"`;
      }
      return v;
    };

    const header = visibleCols.map((c) => escape(c.csvLabel)).join(",");
    const rows = selected.map((p) =>
      visibleCols.map((c) => escape(getCsvValue(p, c.key))).join(",")
    );
    const csv = "\uFEFF" + [header, ...rows].join("\n"); // BOM for Excel FR

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `produits_export_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    toast.success(`${selected.length} produit(s) exporté(s)`);
  }, [products, selectedIds, columnVisibility]);

  // ── Loading skeleton ──────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40px]"></TableHead>
              <TableHead>Nom produit</TableHead>
              <TableHead className="w-[100px] text-right">Prix unitaire</TableHead>
              <TableHead className="w-[200px]">Unité inventaire</TableHead>
              <TableHead className="w-[140px] text-center">Zone stockage</TableHead>
              <TableHead className="w-[120px]">Code produit</TableHead>
              <TableHead className="w-[140px]">Code-barres</TableHead>
              <TableHead className="w-[80px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 8 }).map((_, i) => (
              <TableRow key={i}>
                <TableCell><Skeleton className="h-4 w-4" /></TableCell>
                <TableCell><Skeleton className="h-4 w-48" /></TableCell>
                <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                <TableCell><Skeleton className="h-4 w-36" /></TableCell>
                <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                <TableCell><Skeleton className="h-4 w-8" /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }

  // ── Empty state ───────────────────────────────────────────────────────────

  if (products.length === 0) {
    return (
      <div className="border rounded-lg p-12 text-center text-muted-foreground">
        Aucun produit trouvé. Créez votre premier produit.
      </div>
    );
  }

  const allSelected = selectedIds.size === products.length;
  const someSelected = selectedIds.size > 0;

  return (
    <TooltipProvider>
      {/* Bulk action bar */}
      {someSelected && (
        <div className="flex items-center gap-2 mb-2 p-2 rounded-lg bg-muted/60 border">
          <span className="text-sm font-medium">
            {selectedIds.size} produit{selectedIds.size > 1 ? "s" : ""} sélectionné
            {selectedIds.size > 1 ? "s" : ""}
          </span>

          <div className="flex items-center gap-1.5 ml-auto">
            {/* Column visibility toggle */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Columns3 className="h-4 w-4 mr-1" />
                  Colonnes
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                {COLUMNS.map((col) => (
                  <DropdownMenuCheckboxItem
                    key={col.key}
                    checked={isVisible(col.key)}
                    onCheckedChange={() => toggleColumnVisibility(col.key)}
                  >
                    {col.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* CSV export */}
            <Button variant="outline" size="sm" onClick={handleExportCsv}>
              <Download className="h-4 w-4 mr-1" />
              CSV ({selectedIds.size})
            </Button>

            <Button variant="outline" size="sm" onClick={() => setBulkArchiveOpen(true)}>
              <Archive className="h-4 w-4 mr-1" />
              Archiver ({selectedIds.size})
            </Button>
            <Button variant="destructive" size="sm" onClick={() => setBulkDeleteOpen(true)}>
              <Trash2 className="h-4 w-4 mr-1" />
              Supprimer ({selectedIds.size})
            </Button>
          </div>
        </div>
      )}

      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40px]">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={toggleSelectAll}
                  aria-label="Tout sélectionner"
                />
              </TableHead>
              {isVisible("nom_produit") && <TableHead>Nom produit</TableHead>}
              {isVisible("prix") && <TableHead className="w-[100px] text-right">Prix unitaire</TableHead>}
              {isVisible("categorie") && <TableHead className="w-[120px]">Catégorie</TableHead>}
              {isVisible("unite_inventaire") && <TableHead className="w-[200px]">Unité inventaire</TableHead>}
              
              {isVisible("zone_stockage") && <TableHead className="w-[140px] text-center">Zone stockage</TableHead>}
              {isVisible("code_produit") && <TableHead className="w-[120px]">Code produit</TableHead>}
              {isVisible("code_barres") && <TableHead className="w-[140px]">Code-barres</TableHead>}
              <TableHead className="w-[80px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.map((product) => (
              <TableRow
                key={product.id}
                className="cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => handleRowClick(product.id)}
                data-selected={selectedIds.has(product.id) || undefined}
              >
                <TableCell>
                  <Checkbox
                    checked={selectedIds.has(product.id)}
                    onCheckedChange={() => toggleSelect(product.id)}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`Sélectionner ${product.nom_produit}`}
                  />
                </TableCell>
                {isVisible("nom_produit") && (
                  <TableCell className="font-medium uppercase">
                    <div className="flex items-center gap-1.5">
                      {product.has_input_config && (
                        <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                      )}
                      {product.nom_produit_fr ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help border-b border-dashed border-muted-foreground/50">
                              {displayProductName(product.nom_produit)}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="text-sm">🇫🇷 {product.nom_produit_fr}</p>
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        displayProductName(product.nom_produit)
                      )}
                    </div>
                  </TableCell>
                )}
                {isVisible("prix") && (
                  <TableCell className="text-right">
                    {priceMap.get(product.id)?.label ?? "—"}
                  </TableCell>
                )}
                {isVisible("categorie") && (
                  <TableCell>
                    {product.category_name ?? <span className="text-muted-foreground">—</span>}
                  </TableCell>
                )}
                {isVisible("unite_inventaire") && (
                  <TableCell className="text-sm text-muted-foreground">
                    {product.stock_handling_unit_name ?? "—"}
                  </TableCell>
                )}
                {isVisible("zone_stockage") && (
                  <TableCell className="text-sm text-center" onClick={(e) => e.stopPropagation()}>
                    <ZoneInlineEdit
                      productId={product.id}
                      currentZoneId={product.storage_zone_id}
                      currentZoneName={product.storage_zone_name}
                      zones={zones}
                    />
                  </TableCell>
                )}
                {isVisible("code_produit") && (
                  <TableCell className="font-mono text-sm">
                    {product.code_produit ?? <span className="text-muted-foreground">—</span>}
                  </TableCell>
                )}
                {isVisible("code_barres") && (
                  <TableCell className="font-mono text-sm">
                    {product.code_barres ?? <span className="text-muted-foreground">—</span>}
                  </TableCell>
                )}
                <TableCell>
                  <div className="flex items-center gap-0.5">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-foreground"
                          onClick={(e) => handleArchiveClick(e, product)}
                          aria-label="Archiver le produit"
                        >
                          <Archive className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Archiver</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={(e) => handleDeleteClick(e, product)}
                          aria-label="Supprimer définitivement"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Supprimer définitivement</TooltipContent>
                    </Tooltip>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Archive confirmation */}
      <AlertDialog open={!!archiveTarget} onOpenChange={(open) => !open && setArchiveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archiver ce produit ?</AlertDialogTitle>
            <AlertDialogDescription>
              Le produit <strong className="uppercase">{archiveTarget?.nom_produit}</strong> sera archivé. Il ne sera plus
              visible dans la liste mais pourra être restauré ultérieurement.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmArchive}>
              Archiver
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Permanent delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive">
              Supprimer définitivement ce produit ?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Le produit <strong className="uppercase">{deleteTarget?.nom_produit}</strong> sera supprimé définitivement
              avec toutes ses données associées (historique de prix, conditionnements, alertes stock).
              <br /><br />
              <strong>Cette action est irréversible.</strong>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Supprimer définitivement
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk archive confirmation */}
      <AlertDialog open={bulkArchiveOpen} onOpenChange={setBulkArchiveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Archiver {selectedIds.size} produit{selectedIds.size > 1 ? "s" : ""} ?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Les produits sélectionnés seront archivés. Ils pourront être restaurés ultérieurement.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={handleBulkArchive}>
              Archiver {selectedIds.size} produit{selectedIds.size > 1 ? "s" : ""}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk permanent delete confirmation */}
      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive">
              Supprimer définitivement {selectedIds.size} produit{selectedIds.size > 1 ? "s" : ""} ?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Cette action est irréversible. Les produits seront supprimés définitivement avec
              toutes leurs données associées (historique de prix, conditionnements, alertes stock).
              <br /><br />
              Si un produit est référencé par des factures ou mouvements de stock, il ne pourra pas être supprimé.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBulkPermanentDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Supprimer définitivement
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TooltipProvider>
  );
}

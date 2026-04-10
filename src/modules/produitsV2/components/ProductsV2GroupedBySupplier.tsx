/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PRODUITS V2 — Grouped By Supplier View
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Displays products grouped under supplier headers with collapsible sections.
 * Keeps the same row interactions as the flat table.
 * Includes PDF export button per supplier.
 *
 * MIGRATION supplier_id (2026-02-09)
 * - Groupement par supplier_id (SSOT)
 * - Nom affiché via supplier_display_name (jointure)
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useState, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Trash2, ChevronDown, ChevronRight, Package, FileText } from "lucide-react";
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useProductV2Mutations } from "../hooks/useProductV2Mutations";
import { SupplierPdfModal } from "./SupplierPdfModal";
import type { ProductV2ListItem } from "../types";
import { truncateText } from "../utils/formatters";
import { useProductListPrices } from "../hooks/useProductListPrices";

interface ProductsV2GroupedBySupplierProps {
  products: ProductV2ListItem[];
  isLoading: boolean;
}

interface SupplierGroup {
  supplierId: string;
  supplierName: string;
  products: ProductV2ListItem[];
}

export function ProductsV2GroupedBySupplier({
  products,
  isLoading,
}: ProductsV2GroupedBySupplierProps) {
  const navigate = useNavigate();
  const priceMap = useProductListPrices(products);
  const location = useLocation();
  const { archive } = useProductV2Mutations();
  const [deleteTarget, setDeleteTarget] = useState<ProductV2ListItem | null>(null);
  // Accordion behavior: only one supplier open at a time (null = all closed by default)
  const [openSupplier, setOpenSupplier] = useState<string | null>(null);
  // PDF modal state
  const [pdfModalOpen, setPdfModalOpen] = useState(false);
  const [pdfSupplier, setPdfSupplier] = useState<SupplierGroup | null>(null);

  const handleOpenPdfModal = (e: React.MouseEvent, group: SupplierGroup) => {
    e.stopPropagation();
    setPdfSupplier(group);
    setPdfModalOpen(true);
  };

  // Group products by supplier_id (SSOT)
  const supplierGroups = useMemo(() => {
    const groups = new Map<string, { name: string; products: ProductV2ListItem[] }>();

    products.forEach((product) => {
      const supplierId = product.supplier_id;
      const supplierName = product.supplier_display_name ?? "— Sans fournisseur —";

      const existing = groups.get(supplierId);
      if (existing) {
        existing.products.push(product);
      } else {
        groups.set(supplierId, { name: supplierName, products: [product] });
      }
    });

    // Convert to array and sort by supplier name
    const result: SupplierGroup[] = [];
    const entries = Array.from(groups.entries());
    entries.sort((a, b) => {
      // Put "Sans fournisseur" / "Inconnu" at the end
      if (a[1].name.includes("Inconnu") || a[1].name.includes("Sans fournisseur")) return 1;
      if (b[1].name.includes("Inconnu") || b[1].name.includes("Sans fournisseur")) return -1;
      return a[1].name.localeCompare(b[1].name, "fr");
    });

    entries.forEach(([id, data]) => {
      result.push({
        supplierId: id,
        supplierName: data.name,
        products: data.products,
      });
    });

    return result;
  }, [products]);

  const handleRowClick = (id: string) => {
    navigate(`/produits-v2/${id}`, { state: { from: location.pathname + location.search } });
  };

  const handleDeleteClick = (e: React.MouseEvent, product: ProductV2ListItem) => {
    e.stopPropagation();
    setDeleteTarget(product);
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    await archive.mutateAsync(deleteTarget.id);
    setDeleteTarget(null);
  };

  // Accordion: toggle open supplier (clicking same one closes it)
  const toggleSupplier = (supplierId: string) => {
    setOpenSupplier((prev) => (prev === supplierId ? null : supplierId));
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="border rounded-lg overflow-hidden">
            <div className="bg-muted/50 px-4 py-3 flex items-center gap-3">
              <Skeleton className="h-5 w-5" />
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-4 w-16" />
            </div>
            <div className="p-4 space-y-2">
              {Array.from({ length: 3 }).map((_, j) => (
                <Skeleton key={j} className="h-12 w-full" />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="border rounded-lg p-12 text-center text-muted-foreground">
        Aucun produit trouvé. Créez votre premier produit.
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="space-y-4">
        {supplierGroups.map((group) => {
          const isOpen = openSupplier === group.supplierId;

          return (
            <Collapsible
              key={group.supplierId}
              open={isOpen}
              onOpenChange={() => toggleSupplier(group.supplierId)}
            >
              <div className="border rounded-lg overflow-hidden">
                {/* Supplier Header */}
                <div className="bg-muted/50 hover:bg-muted/70 transition-colors px-4 py-3 flex items-center gap-3">
                  <CollapsibleTrigger asChild>
                    <button className="flex items-center gap-3 text-left flex-1">
                      {!isOpen ? (
                        <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
                      ) : (
                        <ChevronDown className="h-5 w-5 text-muted-foreground shrink-0" />
                      )}
                      <Package className="h-5 w-5 text-primary shrink-0" />
                      <span className="font-semibold text-foreground">{group.supplierName}</span>
                      <span className="text-sm text-muted-foreground">
                        ({group.products.length} produit{group.products.length > 1 ? "s" : ""})
                      </span>
                    </button>
                  </CollapsibleTrigger>

                  {/* PDF Button */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 gap-1.5 text-muted-foreground hover:text-primary"
                        onClick={(e) => handleOpenPdfModal(e, group)}
                      >
                        <FileText className="h-4 w-4" />
                        <span className="hidden sm:inline">PDF</span>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Générer PDF</TooltipContent>
                  </Tooltip>
                </div>

                {/* Products Table */}
                <CollapsibleContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[120px]">Code produit</TableHead>
                        <TableHead>Nom produit</TableHead>
                        <TableHead className="w-[100px] text-right">Prix unitaire</TableHead>
                        <TableHead className="w-[120px]">Catégorie</TableHead>
                        <TableHead className="w-[140px]">Code-barres</TableHead>
                        <TableHead className="w-[200px]">Conditionnement</TableHead>
                        <TableHead className="w-[140px]">Zone stockage</TableHead>
                        <TableHead className="w-[60px]"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {group.products.map((product) => (
                        <TableRow
                          key={product.id}
                          className="cursor-pointer hover:bg-muted/50 transition-colors"
                          onClick={() => handleRowClick(product.id)}
                        >
                          <TableCell className="font-mono text-sm">
                            {product.code_produit ?? (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="font-medium uppercase">
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
                          </TableCell>
                          <TableCell className="text-right">
                            {priceMap.get(product.id)?.label ?? "—"}
                          </TableCell>
                          <TableCell>
                            {product.category_name ?? <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {product.code_barres ?? (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {truncateText(product.conditionnement_resume, 40)}
                          </TableCell>
                          <TableCell className="text-sm">
                            {product.storage_zone_name ?? (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                  onClick={(e) => handleDeleteClick(e, product)}
                                  aria-label="Supprimer le produit"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Supprimer</TooltipContent>
                            </Tooltip>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CollapsibleContent>
              </div>
            </Collapsible>
          );
        })}
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce produit ?</AlertDialogTitle>
            <AlertDialogDescription>
              Le produit <strong className="uppercase">{deleteTarget?.nom_produit}</strong> sera archivé. Cette action
              peut être annulée ultérieurement.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* PDF Modal */}
      {pdfSupplier && (
        <SupplierPdfModal
          open={pdfModalOpen}
          onOpenChange={setPdfModalOpen}
          supplierName={pdfSupplier.supplierName}
          products={pdfSupplier.products}
        />
      )}
    </TooltipProvider>
  );
}

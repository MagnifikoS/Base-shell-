/**
 * ═══════════════════════════════════════════════════════════════════════════
 * VISION AI — BLReviewModal
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Modal de révision BL — même système que ExtractedProductsModal (facture).
 *
 * ARCHITECTURE:
 * - Convertit BLItem → ExtractedProductLine (format unifié)
 * - Réutilise useProductStatusV2 (analyseFacture) — ZERO duplication moteur
 * - Table identique : Code | Nom produit | Qté | Unité | Statut | Actions
 * - Dialog centré (identique facture, pas Sheet)
 *
 * GUARDRAILS:
 * - Zéro write DB (toast + onValidated seulement)
 * - knownSupplierId filtre la liste produits (guard-rail fournisseur)
 * - Choix manuel immuable (user_modified guard)
 */

import { useState, useCallback, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Package,
  AlertTriangle,
  Check,
  Search,
  Pencil,
  Trash2,
  Loader2,
  CheckCircle2,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { useProductStatusV2 } from "@/modules/analyseFacture";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { useUnits } from "@/hooks/useUnits";
import type { ExtractedProductLine } from "@/modules/shared";
import type { ProductV2 } from "@/modules/produitsV2";
import type { BLExtractionResponse, BLItem } from "../types/blTypes";
import { SMART_MATCH_ENABLED } from "@/config/featureFlags";
import { SmartMatchDrawer, useSmartMatch, smartMatchLearn } from "@/modules/smartMatch";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface BLReviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  blResponse: BLExtractionResponse | null;
  onValidated: () => void;
  onCancel: () => void;
  /** Optional: supplier UUID already validated in context. Filters matching candidates. */
  knownSupplierId?: string | null;
}

/** Session-local editable BL line (enriched with match state) */
interface EditableBLLine {
  _id: string;
  // Originals from extraction (immutable)
  raw_label: string;
  product_code: string | null;
  product_name: string;
  qty_extracted: number | null;
  unit_extracted: string | null;
  notes: string | null;
  // Session-editable
  qty_final: number | null;
  unit_final: string | null;
  /** guard: if true, manual match is immuable — auto re-match blocked */
  user_modified: boolean;
  /** Manually confirmed product_id (overrides status engine) */
  confirmed_product_id: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function generateId(): string {
  return Math.random().toString(36).substring(2, 11);
}

/** Map BLItem → ExtractedProductLine (format unifié analyseFacture) */
function blItemToExtractedLine(item: BLItem): ExtractedProductLine {
  return {
    code_produit: item.product_code ?? null,
    nom_produit_complet: item.product_name,
    info_produit: item.notes ?? null,
    quantite_commandee: item.qty_delivered,
    prix_total_ligne: null, // BL n'a pas de prix
    contenu_facture: item.unit ?? null,
    price_missing: true, // pas de prix sur BL
  };
}

function getQualityColor(score: number): string {
  if (score > 0.8) return "bg-green-500";
  if (score >= 0.5) return "bg-yellow-500";
  return "bg-red-500";
}

function getQualityLabel(score: number): string {
  if (score > 0.8) return "Bonne";
  if (score >= 0.5) return "Moyenne";
  return "Faible";
}

// ═══════════════════════════════════════════════════════════════════════════
// PRODUCT SEARCH PICKER (loupe manuelle)
// ═══════════════════════════════════════════════════════════════════════════

function ProductSearchPicker({
  productsV2,
  currentMatchedId,
  onSelect,
}: {
  productsV2: ProductV2[];
  currentMatchedId: string | null;
  onSelect: (product: ProductV2) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          aria-label="Rechercher un produit"
        >
          <Search className={`h-3.5 w-3.5 ${currentMatchedId ? "text-primary" : ""}`} />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="end" side="left">
        <Command>
          <CommandInput placeholder="Rechercher un produit..." />
          <CommandList className="max-h-56">
            <CommandEmpty className="text-xs text-muted-foreground p-3">
              Aucun produit trouvé
            </CommandEmpty>
            <CommandGroup>
              {productsV2.map((p) => (
                <CommandItem
                  key={p.id}
                  value={`${p.nom_produit} ${p.code_produit ?? ""} ${p.name_normalized}`}
                  onSelect={() => {
                    onSelect(p);
                    setOpen(false);
                  }}
                  className="text-xs"
                >
                  <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                    <span className="font-medium truncate uppercase">{p.nom_produit}</span>
                    {p.code_produit && (
                      <span className="text-muted-foreground text-[10px]">
                        Code: {p.code_produit}
                      </span>
                    )}
                    {p.supplier_billing_unit_id && (
                      <span className="text-muted-foreground text-[10px]">
                        Unité fact.: {p.supplier_billing_unit_id.slice(0, 8)}
                      </span>
                    )}
                  </div>
                  {currentMatchedId === p.id && (
                    <Check className="ml-auto h-3.5 w-3.5 shrink-0 text-primary" />
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

export function BLReviewModal({
  open,
  onOpenChange,
  blResponse,
  onValidated,
  onCancel,
  knownSupplierId,
}: BLReviewModalProps) {
  const { activeEstablishment } = useEstablishment();
  const { units } = useUnits();
  const { drawerOpen, request: smartMatchRequest, openSmartMatch, closeSmartMatch, setDrawerOpen } = useSmartMatch();

  const needsReviewSupplier = !knownSupplierId;

  // ── Local editable lines (session-only) ──
  const [editableLines, setEditableLines] = useState<EditableBLLine[]>([]);
  const [confirmedMatches, setConfirmedMatches] = useState<
    Record<string, { productId: string; confirmedAt: number }>
  >({});

  // ── Initialize on new blResponse ──
  useEffect(() => {
    if (open && blResponse?.bl_items?.length) {
      setEditableLines(
        blResponse.bl_items.map((item) => ({
          _id: generateId(),
          raw_label: item.raw_label,
          product_code: item.product_code ?? null,
          product_name: item.product_name,
          qty_extracted: item.qty_delivered,
          unit_extracted: item.unit ?? null,
          notes: item.notes,
          qty_final: item.qty_delivered,
          unit_final: item.unit ?? null,
          user_modified: false,
          confirmed_product_id: null,
        }))
      );
      setConfirmedMatches({});
    }
    if (!open) {
      setEditableLines([]);
      setConfirmedMatches({});
    }
  }, [open, blResponse]);

  // ── Convert to ExtractedProductLine for the status engine ──
  // Uses SAME engine as facture (useProductStatusV2)
  // ⚠️ FIX: Inject _id so determineAllLineStatuses can match confirmedMatches by key
  const extractedLines = useMemo<ExtractedProductLine[]>(() => {
    if (!blResponse?.bl_items) return [];
    return blResponse.bl_items.map((item, i) => {
      const editable = editableLines[i];
      return {
        _id: editable?._id, // ← CRITICAL: required for confirmedMatches key lookup
        code_produit: editable?.product_code ?? item.product_code ?? null,
        nom_produit_complet: editable?.product_name ?? item.product_name,
        info_produit: item.notes ?? null,
        quantite_commandee: editable?.qty_final ?? item.qty_delivered,
        prix_total_ligne: null,
        contenu_facture: editable?.unit_final ?? item.unit ?? null,
        price_missing: true,
      };
    });
  }, [blResponse, editableLines]);

  // ── V2 STATUS ENGINE (same as facture) ──
  const {
    statuses,
    counts,
    isLoading: isLoadingStatuses,
    resolveItem,
    productsV2,
  } = useProductStatusV2({
    items: extractedLines,
    enabled: open && extractedLines.length > 0,
    confirmedMatches,
  });

  // Supplier filter guard-rail: if knownSupplierId, only show those products in the loupe
  const filteredProductsV2 = useMemo(() => {
    if (!knownSupplierId) return productsV2;
    return productsV2.filter((p) => p.supplier_id === knownSupplierId);
  }, [productsV2, knownSupplierId]);

  // ── HANDLERS ──

  const handleDeleteLine = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setEditableLines((prev) => prev.filter((l) => l._id !== id));
    setConfirmedMatches((prev) => {
      const { [id]: _, ...rest } = prev;
      return rest;
    });
  }, []);

  const handleQtyChange = useCallback((id: string, value: string) => {
    const parsed = parseFloat(value);
    setEditableLines((prev) =>
      prev.map((l) =>
        l._id === id ? { ...l, qty_final: isNaN(parsed) ? null : parsed } : l
      )
    );
  }, []);

  const handleUnitChange = useCallback((id: string, value: string) => {
    setEditableLines((prev) =>
      prev.map((l) => (l._id === id ? { ...l, unit_final: value || null } : l))
    );
  }, []);

  const handleManualSelect = useCallback(
    (lineId: string, index: number, product: ProductV2) => {
      setConfirmedMatches((prev) => ({
        ...prev,
        [lineId]: { productId: product.id, confirmedAt: Date.now() },
      }));
      setEditableLines((prev) =>
        prev.map((l) => {
          if (l._id !== lineId) return l;
          // ← After match: resolve unit label from supplier_billing_unit_id via units
          const billingUnitId = product.supplier_billing_unit_id;
          const resolvedUnitLabel = billingUnitId
            ? (units.find(u => u.id === billingUnitId)?.name ?? null)
            : null;
          return {
            ...l,
            confirmed_product_id: product.id,
            user_modified: true,
            unit_final: resolvedUnitLabel ?? l.unit_final,
          };
        })
      );
      resolveItem(index);
      toast.success(`Produit associé : ${product.nom_produit}`);
    },
    [resolveItem]
  );

  // ── SmartMatch: track which line triggered the drawer ──
  const [smartMatchLineRef, setSmartMatchLineRef] = useState<{ lineId: string; index: number } | null>(null);

  const handleOpenSmartMatch = useCallback(
    (line: EditableBLLine, index: number) => {
      if (!knownSupplierId || !activeEstablishment?.id) return;
      setSmartMatchLineRef({ lineId: line._id, index });
      openSmartMatch({
        establishment_id: activeEstablishment.id,
        supplier_id: knownSupplierId,
        raw_label: line.raw_label,
        code_produit: line.product_code,
      });
    },
    [knownSupplierId, activeEstablishment, openSmartMatch]
  );

  const handleSmartMatchSelect = useCallback(
    (productId: string, productName: string) => {
      if (!smartMatchLineRef) return;
      const product = filteredProductsV2.find((p) => p.id === productId);
      if (product) {
        handleManualSelect(smartMatchLineRef.lineId, smartMatchLineRef.index, product);
      } else {
        // Product not in filtered list — manual confirm
        setConfirmedMatches((prev) => ({
          ...prev,
          [smartMatchLineRef.lineId]: { productId, confirmedAt: Date.now() },
        }));
        resolveItem(smartMatchLineRef.index);
        toast.success(`Produit associé : ${productName}`);
      }
      setSmartMatchLineRef(null);
    },
    [smartMatchLineRef, filteredProductsV2, handleManualSelect, resolveItem]
  );

  /** Confirmation locale uniquement — aucun appel DB / blAppService */
  const handleValidateAll = useCallback(() => {
    toast.success("Lignes BL confirmées");
    onValidated();
    onOpenChange(false);
  }, [onValidated, onOpenChange]);

  const handleCancel = useCallback(() => {
    onCancel();
    onOpenChange(false);
  }, [onCancel, onOpenChange]);

  // ── COMPUTED ──

  const validatedCount = counts.validated + counts.priceAlert; // price_alert = offert sur BL = ok
  const needsActionCount = counts.needsAction;

  if (!blResponse) return null;

  const { bl, document_quality, warnings } = blResponse;
  const qualityPercent = Math.round(document_quality.score * 100);

  return (
    <TooltipProvider>
      <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) handleCancel(); }}>
        <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col gap-4">

          {/* ── HEADER ── */}
          <DialogHeader>
            <DialogTitle>
              Produits extraits ({editableLines.length} ligne{editableLines.length !== 1 ? "s" : ""})
            </DialogTitle>
            <DialogDescription>
              Vérifiez les produits et associez-les à votre catalogue.
              {bl.supplier_name && ` Fournisseur : ${bl.supplier_name}`}
              {bl.bl_number && ` — BL ${bl.bl_number}`}
              {bl.bl_date && ` — ${bl.bl_date}`}
            </DialogDescription>
          </DialogHeader>

          {/* ── BANNERS ── */}
          <div className="flex flex-col gap-2 flex-shrink-0">

            {/* Supplier scope warning */}
            {needsReviewSupplier && productsV2.length > 0 && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800">
                <AlertTriangle className="h-3.5 w-3.5 text-yellow-600 dark:text-yellow-400 shrink-0" />
                <p className="text-xs text-yellow-700 dark:text-yellow-400">
                  Fournisseur non identifié — matching sur tous les produits de l&apos;établissement
                </p>
              </div>
            )}

            {/* Document quality */}
            <div className="flex items-center gap-3 text-xs">
              <span className="text-muted-foreground shrink-0">Qualité du document</span>
              <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${getQualityColor(document_quality.score)}`}
                  style={{ width: `${qualityPercent}%` }}
                />
              </div>
              <span className="font-medium shrink-0">
                {qualityPercent}% — {getQualityLabel(document_quality.score)}
              </span>
              {document_quality.issues.length > 0 && (
                <span className="text-muted-foreground truncate hidden sm:inline">
                  {document_quality.issues.join(", ")}
                </span>
              )}
            </div>

            {/* Warnings */}
            {warnings.length > 0 && (
              <div className="px-3 py-2 rounded-lg bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800">
                <div className="flex items-center gap-2 mb-1">
                  <AlertTriangle className="h-3.5 w-3.5 text-yellow-600 dark:text-yellow-400" />
                  <span className="text-xs font-medium text-yellow-800 dark:text-yellow-300">
                    Avertissements
                  </span>
                </div>
                <ul className="text-xs text-yellow-700 dark:text-yellow-400 space-y-0.5 ml-5 list-disc">
                  {warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Status summary — same chip as facture */}
            {!isLoadingStatuses && editableLines.length > 0 && (
              <div className="flex items-center gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <div className="h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center">
                    <Check className="h-3 w-3 text-primary" />
                  </div>
                  <span className="text-muted-foreground">
                    {validatedCount} valide{validatedCount !== 1 ? "s" : ""}
                  </span>
                </div>
                {needsActionCount > 0 && (
                  <div className="flex items-center gap-2">
                    <div className="h-5 w-5 rounded-full bg-warning/10 flex items-center justify-center">
                      <AlertTriangle className="h-3 w-3 text-warning" />
                    </div>
                    <span className="text-muted-foreground">
                      {needsActionCount} à compléter
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── TABLE (identique facture) ── */}
          <div className="flex-1 overflow-auto border rounded-lg min-h-0">
            <Table>
              <TableHeader className="sticky top-0 bg-background z-10">
                <TableRow>
                  <TableHead className="w-[90px]">Code</TableHead>
                  <TableHead className="min-w-[220px]">Nom produit</TableHead>
                  <TableHead className="w-[60px] text-right">Qté</TableHead>
                  <TableHead className="w-[70px]">Unité</TableHead>
                  <TableHead className="w-[200px]">Statut</TableHead>
                  <TableHead className="w-[80px] text-center">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {editableLines.map((line, index) => {
                  const status = statuses.get(index);
                  const matchedProduct = status?.matchedProduct as {
                    id?: string;
                    code_produit?: string | null;
                    nom_produit?: string | null;
                    supplier_billing_unit_id?: string | null;
                  } | undefined;

                  // Code: official from matched product > extracted from BL
                  const officialCode = matchedProduct?.code_produit;
                  const displayCode = officialCode ?? line.product_code ?? "—";
                  const codeIsOfficial = !!officialCode;

                  // Name: official from matched product > extracted
                  const officialName = matchedProduct?.nom_produit;
                  const hasOfficialName = !!officialName;
                  const primaryName = hasOfficialName ? officialName! : line.product_name;
                  const nameDivergent =
                    hasOfficialName &&
                    officialName!.toLowerCase().trim() !== line.product_name.toLowerCase().trim();

                  // Row bg (same logic as ProductRow)
                  const isValidated = status?.status === "validated";
                  const rowBg = isValidated
                    ? "bg-primary/5"
                    : status?.status === "needs_action"
                      ? "bg-warning/5"
                      : "";

                  return (
                    <TableRow key={line._id} className={rowBg}>
                      {/* Code */}
                      <TableCell className="font-mono text-xs">
                        {codeIsOfficial ? (
                          <span
                            className="text-foreground font-medium"
                            title={
                              line.product_code && line.product_code !== officialCode
                                ? `Code BL: ${line.product_code}`
                                : "Code officiel produit"
                            }
                          >
                            {displayCode}
                            {line.product_code && line.product_code !== officialCode && (
                              <span className="text-[10px] ml-0.5 text-muted-foreground">✓</span>
                            )}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">{displayCode}</span>
                        )}
                      </TableCell>

                      {/* Nom produit */}
                      <TableCell>
                        {hasOfficialName ? (
                          <div>
                            <p className="text-sm font-medium line-clamp-2">{primaryName}</p>
                            {nameDivergent && (
                              <p
                                className="text-[10px] text-muted-foreground line-clamp-1 mt-0.5"
                                title={`Nom BL : ${line.product_name}`}
                              >
                                BL : {line.product_name}
                              </p>
                            )}
                          </div>
                        ) : (
                          <p className="text-sm font-medium line-clamp-2">{primaryName}</p>
                        )}
                      </TableCell>

                      {/* Qté — inline editable */}
                      <TableCell className="text-sm text-right tabular-nums">
                        <input
                          type="number"
                          min={0}
                          step="any"
                          value={line.qty_final ?? ""}
                          onChange={(e) => handleQtyChange(line._id, e.target.value)}
                          className="w-16 text-right bg-transparent border-b border-border/50 focus:border-primary outline-none text-sm tabular-nums"
                          aria-label="Quantité"
                        />
                      </TableCell>

                      {/* Unité — inline editable, prefilled from product conditioning after match */}
                      <TableCell className="text-sm text-muted-foreground">
                        <input
                          type="text"
                          value={line.unit_final ?? (matchedProduct?.supplier_billing_unit_id ? (units.find(u => u.id === matchedProduct.supplier_billing_unit_id)?.name ?? "") : "")}
                          onChange={(e) => handleUnitChange(line._id, e.target.value)}
                          placeholder="—"
                          className="w-16 bg-transparent border-b border-border/50 focus:border-primary outline-none text-sm"
                          aria-label="Unité"
                        />
                      </TableCell>

                      {/* Statut — same pattern as StatusActions */}
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <BLStatusCell
                          lineId={line._id}
                          index={index}
                          status={status}
                          isLoadingStatuses={isLoadingStatuses}
                          confirmedMatch={confirmedMatches[line._id]}
                          productsV2={filteredProductsV2}
                          onManualSelect={(product) =>
                            handleManualSelect(line._id, index, product)
                          }
                          onOpenSmartMatch={
                            SMART_MATCH_ENABLED && knownSupplierId
                              ? () => handleOpenSmartMatch(line, index)
                              : undefined
                          }
                        />
                      </TableCell>

                      {/* Actions */}
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-center">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={(e) => handleDeleteLine(e, line._id)}
                            title="Supprimer la ligne"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {editableLines.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      Aucune ligne extraite
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {/* ── FOOTER (same as ModalFooter facture) ── */}
          <DialogFooter className="flex gap-2 sm:gap-2 pt-0 flex-shrink-0">
            <Button variant="outline" onClick={handleCancel}>
              Annuler
            </Button>
            <Button onClick={handleValidateAll}>
              Confirmer les lignes ({editableLines.length})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* SmartMatch Drawer (feature-flagged, lazy) */}
      {SMART_MATCH_ENABLED && (
        <SmartMatchDrawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          request={smartMatchRequest}
          onSelectProduct={handleSmartMatchSelect}
        />
      )}
    </TooltipProvider>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// BL STATUS CELL — same pattern as StatusActions (facture)
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// BL STATUS CELL — same pattern as StatusActions (facture)
// ═══════════════════════════════════════════════════════════════════════════

interface BLStatusCellProps {
  lineId: string;
  index: number;
  status: { status: string; label: string; matchedProduct?: unknown } | undefined;
  isLoadingStatuses: boolean;
  confirmedMatch: { productId: string; confirmedAt: number } | undefined;
  productsV2: ProductV2[];
  onManualSelect: (product: ProductV2) => void;
  onOpenSmartMatch?: () => void;
}

function BLStatusCell({
  status,
  isLoadingStatuses,
  confirmedMatch,
  productsV2,
  onManualSelect,
  onOpenSmartMatch,
}: BLStatusCellProps) {
  const currentMatchedId =
    confirmedMatch?.productId ??
    (status?.matchedProduct as { id?: string } | undefined)?.id ??
    null;

  if (!status || isLoadingStatuses) {
    return (
      <span className="text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin inline mr-1" />
        Analyse...
      </span>
    );
  }

  const isValidated = status.status === "validated";

  return (
    <div className="flex items-center gap-1.5">
      {/* Status badge */}
      {isValidated ? (
        <Badge
          variant="outline"
          className="text-xs bg-primary/5 text-primary border-primary/30 shrink-0"
        >
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Reconnu
        </Badge>
      ) : (
        <Badge
          variant="outline"
          className="text-xs bg-warning/10 text-warning border-warning/30 shrink-0"
        >
          À identifier
        </Badge>
      )}

      {/* Pencil (edit / re-associate) if validated */}
      {isValidated && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <ProductSearchPicker
                productsV2={productsV2}
                currentMatchedId={currentMatchedId}
                onSelect={onManualSelect}
              />
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <p className="text-xs">Modifier le produit associé</p>
          </TooltipContent>
        </Tooltip>
      )}

      {/* Search if needs action */}
      {!isValidated && (
        <div className="flex items-center gap-1">
          {/* SmartMatch button (feature-flagged) */}
          {SMART_MATCH_ENABLED && onOpenSmartMatch && (
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-primary hover:text-primary/80 hover:bg-primary/10"
              onClick={onOpenSmartMatch}
              title="SmartMatch — Recherche intelligente"
              aria-label="SmartMatch"
            >
              <Zap className="h-3.5 w-3.5" />
            </Button>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <ProductSearchPicker
                  productsV2={productsV2}
                  currentMatchedId={currentMatchedId}
                  onSelect={onManualSelect}
                />
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs">Choisir un produit existant</p>
            </TooltipContent>
          </Tooltip>
        </div>
      )}
    </div>
  );
}

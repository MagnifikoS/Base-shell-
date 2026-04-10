/**
 * ProductRow — Single row in the extracted products table.
 * Handles code/name display logic, corrections, risk detection, and status rendering.
 */

import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";
import { Trash2, Info } from "lucide-react";
import {
  hasRiskFlags,
  getRiskFlagMessages,
  type GuardrailedLine,
} from "../../plugins/visionAiGuardrails";
import { ProductNameWithTranslation } from "../ProductNameWithTranslation";
import { detectLineRisks } from "../../utils/lineRiskDetector";
import type { EditableProductLine, LineCorrection } from "./extractedTypes";
import type { LineStatusResult } from "@/modules/analyseFacture";

interface ProductRowProps {
  /** The corrected item (with corrections applied) */
  item: EditableProductLine;
  /** The raw item before corrections (for comparison) */
  rawItem: EditableProductLine;
  /** Index in the original array */
  index: number;
  /** V2 status for this item */
  status: LineStatusResult | undefined;
  /** Whether statuses are still loading */
  isLoadingStatuses: boolean;
  /** Whether price decisions have been resolved for this item */
  isResolved: boolean;
  /** Line correction for this item */
  correction: LineCorrection | undefined;
  /** Confirmed match info */
  confirmedMatch: { productId: string; confirmedAt: number } | undefined;
  /** Callbacks */
  onDelete: (e: React.MouseEvent, id: string) => void;
  onOpenDrawer: (itemId: string) => void;
  onOpenSuggestions: (item: EditableProductLine, skipCategory: boolean) => void;
  /** Render the status cell with action buttons */
  renderStatusCell: (item: EditableProductLine, index: number) => React.ReactNode;
}

export function ProductRow({
  item,
  rawItem,
  index,
  status,
  isLoadingStatuses: _isLoadingStatuses,
  isResolved,
  correction,
  confirmedMatch: _confirmedMatch,
  onDelete,
  onOpenDrawer,
  onOpenSuggestions: _onOpenSuggestions,
  renderStatusCell,
}: ProductRowProps) {
  const matchedProduct = status?.matchedProduct;

  // Check corrections
  const hasCorrectedCode = correction && correction.code !== rawItem.code_produit;
  const hasCorrectedName = correction && correction.name !== rawItem.nom_produit_complet;
  const hasCorrectedQuantite =
    correction?.quantite !== undefined && correction.quantite !== rawItem.quantite_commandee;
  const hasCorrectedMontant =
    correction?.montant !== undefined && correction.montant !== rawItem.prix_total_ligne;
  const isFreeLine = correction?.isFreeLine ?? false;

  // Code display logic
  const extractedCode = correction?.code ?? item.code_produit;
  const officialCode = matchedProduct?.code_produit;
  const hasOfficialCode = !!matchedProduct && !!officialCode;
  const displayCode = hasOfficialCode ? officialCode : extractedCode;
  const codeSource = hasOfficialCode ? "official" : hasCorrectedCode ? "corrected" : "extracted";

  const displayName = correction?.name ?? item.nom_produit_complet;

  // Name display logic
  const officialName = matchedProduct?.nom_produit;
  const hasOfficialName = !!matchedProduct && !!officialName;
  const primaryName = hasOfficialName ? officialName : displayName;
  const invoiceName = displayName;
  const nameDivergent =
    hasOfficialName && officialName
      ? officialName.toLowerCase().trim() !== invoiceName.toLowerCase().trim()
      : false;

  // Risk detection
  const riskResult = detectLineRisks({
    nom_produit: rawItem.nom_produit_complet,
    info_produit: rawItem.info_produit,
    prix_total_ligne: item.prix_total_ligne,
    price_missing: item.price_missing,
  });

  return (
    <TableRow
      key={item._id}
      className={`
        cursor-pointer hover:bg-accent/50 transition-colors
        ${item._error ? "bg-destructive/5" : ""}
        ${item._validated || status?.status === "validated" || isResolved ? "bg-primary/5" : ""}
        ${status?.status === "needs_action" ? "bg-warning/5" : ""}
        ${isFreeLine ? "bg-muted/30" : ""}
        ${riskResult.hasRisk && !isFreeLine ? "border-l-2 border-l-warning" : ""}
      `}
      onClick={() => onOpenDrawer(item._id)}
    >
      <TableCell className="font-mono text-xs">
        {codeSource === "official" ? (
          <span
            className="text-foreground font-medium"
            title={extractedCode ? `Code facture: ${extractedCode}` : "Code officiel produit"}
          >
            {displayCode}
            {extractedCode && extractedCode !== officialCode && (
              <span className="text-[10px] ml-0.5 text-muted-foreground">&#10003;</span>
            )}
          </span>
        ) : codeSource === "corrected" ? (
          <span className="text-primary" title={`Original: ${item.code_produit ?? "—"}`}>
            {displayCode ?? "—"}
            <span className="text-[10px] ml-0.5">&#9998;</span>
          </span>
        ) : (
          <span className="text-muted-foreground">{displayCode ?? "—"}</span>
        )}
      </TableCell>
      <TableCell>
        {hasOfficialName ? (
          <div>
            <ProductNameWithTranslation
              name={primaryName}
              className="text-sm font-medium line-clamp-2"
            />
            {nameDivergent && (
              <div className="flex items-center gap-1 mt-0.5">
                <span
                  className="text-[10px] text-muted-foreground line-clamp-1"
                  title={`Nom facture : ${invoiceName}`}
                >
                  Facture : {invoiceName}
                </span>
                <span title="Verifier : extraction potentiellement decalee">
                  <Info className="h-3 w-3 text-warning flex-shrink-0" />
                </span>
              </div>
            )}
          </div>
        ) : hasCorrectedName ? (
          <div title={`Original: ${item.nom_produit_complet}`}>
            <ProductNameWithTranslation
              name={displayName}
              className="text-sm font-medium line-clamp-2 text-primary"
            />
            <span className="text-[10px] text-primary ml-0.5">&#9998;</span>
          </div>
        ) : (
          <ProductNameWithTranslation
            name={displayName}
            className="text-sm font-medium line-clamp-2"
          />
        )}
        {/* Risk badge */}
        {riskResult.hasRisk && !isFreeLine && (
          <span
            className="inline-flex items-center gap-1 text-[10px] text-warning mt-0.5"
            title={riskResult.primaryRisk?.message}
          >
            {riskResult.primaryRisk?.keyword ?? "risque"}
          </span>
        )}
        {item._error && <p className="text-xs text-destructive mt-1">{item._error}</p>}
      </TableCell>
      <TableCell className="text-sm text-right tabular-nums">
        <span className="inline-flex items-center gap-1">
          {hasCorrectedQuantite ? (
            <span className="text-primary" title={`Original: ${rawItem.quantite_commandee ?? "—"}`}>
              {item.quantite_commandee ?? "—"}
              <span className="text-[10px] ml-0.5">&#9998;</span>
            </span>
          ) : (
            (item.quantite_commandee ?? "—")
          )}
          {(rawItem as GuardrailedLine)._quantitySuspect && !hasCorrectedQuantite && (
            <span
              className="text-amber-500 dark:text-amber-400 cursor-help"
              title={getRiskFlagMessages(rawItem as GuardrailedLine).join(" | ")}
            >
              &#9888;&#65039;
            </span>
          )}
        </span>
      </TableCell>
      <TableCell className="text-sm text-right tabular-nums">
        {isFreeLine ? (
          <span
            className="text-xs text-muted-foreground italic"
            title="Ligne marquee comme offerte"
          >
            Offert
          </span>
        ) : hasCorrectedMontant ? (
          <span
            className="text-primary"
            title={`Original: ${rawItem.prix_total_ligne != null ? rawItem.prix_total_ligne.toFixed(2) + " EUR" : "—"}`}
          >
            {item.prix_total_ligne != null ? `${item.prix_total_ligne.toFixed(2)} \u20AC` : "—"}
            <span className="text-[10px] ml-0.5">&#9998;</span>
          </span>
        ) : item.price_missing === true ? (
          <span
            className="text-xs text-muted-foreground italic"
            title="Prix non visible sur cette ligne"
          >
            Offert
          </span>
        ) : item.prix_total_ligne != null ? (
          <span className="inline-flex items-center gap-1">
            {`${item.prix_total_ligne.toFixed(2)} \u20AC`}
            {hasRiskFlags(rawItem as GuardrailedLine) &&
              (rawItem as GuardrailedLine)._riskFlags?.some(
                (f) => f.type === "amount_suspect" || f.type === "free_line_ambiguous"
              ) && (
                <span
                  className="text-amber-500 dark:text-amber-400 cursor-help"
                  title={getRiskFlagMessages(rawItem as GuardrailedLine).join(" | ")}
                >
                  &#9888;&#65039;
                </span>
              )}
          </span>
        ) : (
          "—"
        )}
      </TableCell>
      <TableCell onClick={(e) => e.stopPropagation()}>{renderStatusCell(item, index)}</TableCell>
      <TableCell onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            onClick={(e) => onDelete(e, item._id)}
            disabled={false}
            title="Supprimer"
            aria-label="Supprimer le produit"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

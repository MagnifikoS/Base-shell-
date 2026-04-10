/**
 * DLC V0 — Hook to handle DLC refusal → product return creation.
 *
 * SSOT: The DLC module decides the return type (dlc_depassee vs dlc_trop_proche)
 * based on computeDlcStatus. The Retours module only receives the final call.
 *
 * ReceptionDialog just calls `handleDlcRefusals()` — zero DLC logic.
 */

import { useCallback } from "react";
import { toast } from "sonner";
import { useCreateReturn } from "@/modules/retours";
import { computeDlcStatus } from "../lib/dlcCompute";
import type { DlcLineDecision } from "../components/DlcReceptionSummaryDialog";

export interface DlcRefusalLine {
  id: string;
  product_id: string;
  product_name_snapshot: string;
  canonical_quantity: number;
  shipped_quantity: number | null;
  canonical_unit_id: string;
  unit_label_snapshot: string | null;
}

interface UseDlcRefusalToReturnParams {
  commandeId: string;
  clientEstablishmentId: string;
  supplierEstablishmentId: string;
}

export function useDlcRefusalToReturn({
  commandeId,
  clientEstablishmentId,
  supplierEstablishmentId,
}: UseDlcRefusalToReturnParams) {
  const createReturnMutation = useCreateReturn();

  /**
   * Process all DLC refusals: determine return type and create returns.
   * Non-blocking — failures produce warnings, never block reception.
   */
  const handleDlcRefusals = useCallback(
    async (params: {
      lines: DlcRefusalLine[];
      dlcDates: Record<string, string>;
      dlcDecisions: Record<string, DlcLineDecision>;
      productWarningDays: Record<string, number | null>;
      getReceivedQty: (lineId: string, fallback: number) => number;
    }) => {
      const { lines, dlcDates, dlcDecisions, productWarningDays, getReceivedQty } = params;

      const refusedLines = lines.filter(
        (l) => dlcDecisions[l.id] === "refused" && dlcDates[l.id]
      );

      if (refusedLines.length === 0) return;

      const returnPromises = refusedLines.map((line) => {
        const dlcDate = dlcDates[line.id];
        const dlcStatus = computeDlcStatus(dlcDate, productWarningDays[line.product_id] ?? null);
        const returnType = dlcStatus === "expired" ? "dlc_depassee" : "dlc_trop_proche";
        const shipped = line.shipped_quantity ?? line.canonical_quantity;

        return createReturnMutation.mutateAsync({
          commandeId,
          commandeLineId: line.id,
          productId: line.product_id,
          productNameSnapshot: line.product_name_snapshot,
          quantity: getReceivedQty(line.id, shipped),
          canonicalUnitId: line.canonical_unit_id,
          unitLabelSnapshot: line.unit_label_snapshot,
          returnType: returnType as "dlc_depassee" | "dlc_trop_proche",
          reasonComment: `DLC ${dlcStatus === "expired" ? "dépassée" : "trop proche"} : ${dlcDate}`,
          clientEstablishmentId,
          supplierEstablishmentId,
        });
      });

      try {
        await Promise.all(returnPromises);
        toast.info(
          `${refusedLines.length} retour${refusedLines.length > 1 ? "s" : ""} créé${refusedLines.length > 1 ? "s" : ""} pour DLC`
        );
      } catch {
        toast.warning("Certains retours DLC n'ont pas pu être créés");
      }
    },
    [createReturnMutation, commandeId, clientEstablishmentId, supplierEstablishmentId]
  );

  return { handleDlcRefusals };
}

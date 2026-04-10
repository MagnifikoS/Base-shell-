/**
 * DLC V0 — Mutations for upserting DLC records.
 * Non-blocking: failures produce warnings, never block reception.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { upsertDlc, batchUpsertDlc } from "../services/dlcService";
import type { DlcUpsertInput } from "../types";

export function useDlcUpsert() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (input: DlcUpsertInput) => upsertDlc(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dlc"] });
    },
  });
}

export function useDlcBatchUpsert() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (inputs: DlcUpsertInput[]) => batchUpsertDlc(inputs),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dlc"] });
    },
  });
}

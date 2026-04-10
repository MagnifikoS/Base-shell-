import { useMemo } from "react";
import type { BenchItem } from "../types";
import { matchItems, normalizeName } from "../lib/scoring";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface BenchItemsDiffProps {
  itemsA: BenchItem[];
  itemsB: BenchItem[];
  labelA: string;
  labelB: string;
}

interface DiffRow {
  itemA: BenchItem | null;
  itemB: BenchItem | null;
  status: "match" | "price-diff" | "name-diff" | "missed-a" | "missed-b";
}

/**
 * Side-by-side diff of two item arrays using fuzzy name matching.
 * Shows matched pairs first, then missed items from each side.
 */
export function BenchItemsDiff({ itemsA, itemsB, labelA, labelB }: BenchItemsDiffProps) {
  const rows = useMemo(() => buildDiffRows(itemsA, itemsB), [itemsA, itemsB]);

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">Aucun item à comparer</p>;
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8">#</TableHead>
            <TableHead>{labelA} — Produit</TableHead>
            <TableHead className="text-right">{labelA} — Prix</TableHead>
            <TableHead>{labelB} — Produit</TableHead>
            <TableHead className="text-right">{labelB} — Prix</TableHead>
            <TableHead>Match</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, i) => (
            <TableRow key={i} className={rowBgClass(row.status)}>
              <TableCell className="text-muted-foreground text-xs">{i + 1}</TableCell>
              <TableCell className={!row.itemA ? "text-muted-foreground italic" : ""}>
                {row.itemA?.nom_produit_complet || "—"}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {row.itemA?.prix_total_ligne != null
                  ? `${row.itemA.prix_total_ligne.toFixed(2)} €`
                  : "—"}
              </TableCell>
              <TableCell className={!row.itemB ? "text-muted-foreground italic" : ""}>
                {row.itemB?.nom_produit_complet || "—"}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {row.itemB?.prix_total_ligne != null
                  ? `${row.itemB.prix_total_ligne.toFixed(2)} €`
                  : "—"}
              </TableCell>
              <TableCell>
                <StatusLabel status={row.status} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function buildDiffRows(itemsA: BenchItem[], itemsB: BenchItem[]): DiffRow[] {
  const { matched, missedIndices: missedA, extraIndices: missedB } = matchItems(itemsA, itemsB);

  const rows: DiffRow[] = [];

  // Matched pairs first
  for (const m of matched) {
    const a = itemsA[m.refIndex];
    const b = itemsB[m.runIndex];
    const namesMatch =
      normalizeName(a.nom_produit_complet) === normalizeName(b.nom_produit_complet);
    const pricesMatch = a.prix_total_ligne === b.prix_total_ligne;

    rows.push({
      itemA: a,
      itemB: b,
      status: namesMatch && pricesMatch ? "match" : namesMatch ? "price-diff" : "name-diff",
    });
  }

  // Items only in A (missed by B)
  for (const idx of missedA) {
    rows.push({ itemA: itemsA[idx], itemB: null, status: "missed-b" });
  }

  // Items only in B (extra in B / missed by A)
  for (const idx of missedB) {
    rows.push({ itemA: null, itemB: itemsB[idx], status: "missed-a" });
  }

  return rows;
}

function rowBgClass(status: DiffRow["status"]): string {
  switch (status) {
    case "match":
      return "";
    case "price-diff":
      return "bg-yellow-50 dark:bg-yellow-950/30";
    case "name-diff":
      return "bg-orange-50 dark:bg-orange-950/30";
    case "missed-a":
      return "bg-orange-50 dark:bg-orange-950/30";
    case "missed-b":
      return "bg-red-50 dark:bg-red-950/20";
  }
}

function StatusLabel({ status }: { status: DiffRow["status"] }) {
  switch (status) {
    case "match":
      return <span className="text-green-600 dark:text-green-400 text-xs font-medium">OK</span>;
    case "price-diff":
      return (
        <span className="text-yellow-600 dark:text-yellow-400 text-xs font-medium">Prix diff</span>
      );
    case "name-diff":
      return (
        <span className="text-orange-600 dark:text-orange-400 text-xs font-medium">Nom diff</span>
      );
    case "missed-b":
      return <span className="text-red-600 dark:text-red-400 text-xs font-medium">Manquant B</span>;
    case "missed-a":
      return (
        <span className="text-orange-600 dark:text-orange-400 text-xs font-medium">Manquant A</span>
      );
  }
}

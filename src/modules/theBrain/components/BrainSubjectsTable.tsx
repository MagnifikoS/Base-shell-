/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE BRAIN — BrainSubjectsTable (Fondation v0)
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Table des sujets avec volume, confirmations, corrections, taux.
 * Rendu sans Card wrapper (géré par le parent collapsible).
 */

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { SUBJECT_LABELS } from "../constants";
import type { SubjectSummary } from "../types";

interface BrainSubjectsTableProps {
  subjects: SubjectSummary[];
  isLoading: boolean;
}

export function BrainSubjectsTable({ subjects, isLoading }: BrainSubjectsTableProps) {
  if (isLoading) {
    return (
      <div className="p-4 bg-card border rounded-lg">
        <div className="h-32 flex items-center justify-center text-muted-foreground">
          Chargement...
        </div>
      </div>
    );
  }

  if (subjects.length === 0) {
    return (
      <div className="p-4 bg-card border rounded-lg">
        <div className="h-32 flex items-center justify-center text-muted-foreground">
          Aucun sujet pour cette période
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 bg-card border rounded-lg">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Sujet</TableHead>
            <TableHead className="text-right">Volume</TableHead>
            <TableHead className="text-right">Confirmations</TableHead>
            <TableHead className="text-right">Corrections</TableHead>
            <TableHead className="text-right">Taux</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {subjects.map((subject) => (
            <TableRow key={subject.subject}>
              <TableCell className="font-medium">
                {SUBJECT_LABELS[subject.subject] ?? subject.subject}
              </TableCell>
              <TableCell className="text-right">
                <Badge variant="secondary">{subject.eventCount}</Badge>
              </TableCell>
              <TableCell className="text-right text-primary">
                {subject.confirmedCount}
              </TableCell>
              <TableCell className="text-right text-warning">
                {subject.correctedCount}
              </TableCell>
              <TableCell className="text-right">
                {subject.confirmedCount + subject.correctedCount > 0
                  ? `${Math.round(subject.acceptanceRate * 100)}%`
                  : "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

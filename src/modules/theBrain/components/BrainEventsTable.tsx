/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE BRAIN — BrainEventsTable (Fondation v0)
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Table des événements récents (limite 50).
 * Rendu sans Card wrapper (géré par le parent collapsible).
 */

import { format } from "date-fns";
import { fr } from "date-fns/locale";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { SUBJECT_LABELS, ACTION_LABELS, ACTION_COLORS } from "../constants";
import type { BrainEvent } from "../types";

interface BrainEventsTableProps {
  events: BrainEvent[];
  isLoading: boolean;
}

function formatContext(context: Record<string, unknown>): string {
  if (!context || Object.keys(context).length === 0) return "—";
  
  // Affichage compact : max 3 clés
  const entries = Object.entries(context).slice(0, 3);
  const formatted = entries
    .map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join(", ");
  
  if (Object.keys(context).length > 3) {
    return formatted + " ...";
  }
  return formatted;
}

export function BrainEventsTable({ events, isLoading }: BrainEventsTableProps) {
  if (isLoading) {
    return (
      <div className="p-4 bg-card border rounded-lg">
        <div className="h-32 flex items-center justify-center text-muted-foreground">
          Chargement...
        </div>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="p-4 bg-card border rounded-lg">
        <div className="h-32 flex items-center justify-center text-muted-foreground">
          Aucun apprentissage enregistré
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 bg-card border rounded-lg">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[140px]">Date</TableHead>
            <TableHead>Sujet</TableHead>
            <TableHead>Action</TableHead>
            <TableHead>Contexte</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {events.map((event) => (
            <TableRow key={event.id}>
              <TableCell className="text-sm text-muted-foreground">
                {format(new Date(event.created_at), "dd MMM HH:mm", { locale: fr })}
              </TableCell>
              <TableCell>
                <Badge variant="outline">
                  {SUBJECT_LABELS[event.subject] ?? event.subject}
                </Badge>
              </TableCell>
              <TableCell>
                <span className={ACTION_COLORS[event.action] ?? "text-foreground"}>
                  {ACTION_LABELS[event.action] ?? event.action}
                </span>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground max-w-[300px] truncate">
                {formatContext(event.context)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * Detail view of extra events for a specific employee
 * Shows: day-by-day list with session breakdown (same layout as RetardTab)
 * V3.5: Admin can toggle decision (approve ↔ reject) after initial validation
 * V3.6: Added time range display (de...à...) + "Modifier horaires" button
 */

import { useState, memo } from "react";
import { ChevronLeft, Check, X, Loader2, Clock, RotateCcw, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { minutesToXhYY, formatParisLocale, formatParisHHMM } from "@/lib/time/paris";
import { useExtraMutations } from "@/hooks/presence/useExtraMutations";
import { ExtraTimeEditModal } from "./ExtraTimeEditModal";
import type { ExtraEvent } from "@/hooks/presence/useExtraData";

interface ExtraEmployeeDetailProps {
  employeeName: string;
  events: ExtraEvent[];
  isLoading: boolean;
  onBack: () => void;
  /** Establishment ID for edit modal scope */
  establishmentId?: string | null;
  /** Show "Modifier horaires" button (for Demandes tab) */
  showEditButton?: boolean;
}

export const ExtraEmployeeDetail = memo(function ExtraEmployeeDetail({
  employeeName,
  events,
  isLoading,
  onBack,
  establishmentId,
  showEditButton = false,
}: ExtraEmployeeDetailProps) {
  const { validateExtra, isValidating } = useExtraMutations();

  // State for edit modal
  const [editingEvent, setEditingEvent] = useState<ExtraEvent | null>(null);

  const handleApprove = (extraEventId: string) => {
    validateExtra.mutate({ extraEventId, action: "approve" });
  };

  const handleReject = (extraEventId: string) => {
    validateExtra.mutate({ extraEventId, action: "reject" });
  };

  // Group events by day
  const eventsByDay = new Map<string, ExtraEvent[]>();
  for (const event of events) {
    const existing = eventsByDay.get(event.day_date) || [];
    existing.push(event);
    eventsByDay.set(event.day_date, existing);
  }

  // Sort days
  const sortedDays = Array.from(eventsByDay.keys()).sort();

  /**
   * Format time range for display
   * BUG 3 FIX: Show "de HH:MM à HH:MM" using extra_start_at/extra_end_at
   */
  const formatTimeRange = (event: ExtraEvent): string => {
    if (!event.extra_start_at && !event.extra_end_at) {
      return "—";
    }
    const start = event.extra_start_at ? formatParisHHMM(event.extra_start_at) : "—";
    const end = event.extra_end_at ? formatParisHHMM(event.extra_end_at) : "—";
    return `de ${start} à ${end}`;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "approved":
        return (
          <Badge className="bg-green-100 text-green-700 dark:text-green-300 dark:bg-green-900/30 dark:text-green-400">
            Approuvé
          </Badge>
        );
      case "rejected":
        return <Badge variant="destructive">Rejeté</Badge>;
      default:
        return (
          <Badge
            variant="secondary"
            className="bg-amber-100 text-amber-700 dark:text-amber-300 dark:bg-amber-900/30 dark:text-amber-400"
          >
            En attente
          </Badge>
        );
    }
  };

  const renderActionButtons = (event: ExtraEvent) => {
    // Pending: show both approve and reject
    if (event.status === "pending") {
      return (
        <div className="flex gap-2">
          <Button
            size="icon"
            variant="ghost"
            className="text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 hover:bg-green-100 dark:hover:bg-green-900/30"
            onClick={() => handleApprove(event.id)}
            disabled={isValidating}
            title="Approuver"
            aria-label="Approuver l'extra"
          >
            {isValidating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={() => handleReject(event.id)}
            disabled={isValidating}
            title="Rejeter"
            aria-label="Rejeter l'extra"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      );
    }

    // Approved: allow toggle to rejected
    if (event.status === "approved") {
      return (
        <Button
          size="sm"
          variant="outline"
          className="text-destructive border-destructive/30 hover:bg-destructive/10"
          onClick={() => handleReject(event.id)}
          disabled={isValidating}
        >
          {isValidating ? (
            <Loader2 className="h-4 w-4 animate-spin mr-1" />
          ) : (
            <RotateCcw className="h-3 w-3 mr-1" />
          )}
          Rejeter
        </Button>
      );
    }

    // Rejected: allow toggle to approved
    if (event.status === "rejected") {
      return (
        <Button
          size="sm"
          variant="outline"
          className="text-green-600 dark:text-green-400 border-green-600/30 hover:bg-green-100 dark:hover:bg-green-900/30"
          onClick={() => handleApprove(event.id)}
          disabled={isValidating}
        >
          {isValidating ? (
            <Loader2 className="h-4 w-4 animate-spin mr-1" />
          ) : (
            <RotateCcw className="h-3 w-3 mr-1" />
          )}
          Approuver
        </Button>
      );
    }

    return null;
  };

  return (
    <div className="space-y-4">
      {/* Header with back button (same as RetardTab) */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack} aria-label="Retour à la liste">
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <h3 className="font-medium">{employeeName}</h3>
      </div>

      {/* Events list grouped by day */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : sortedDays.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Clock className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <p className="text-muted-foreground">Aucun extra pour ce salarié</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sortedDays.map((dayDate) => {
            const dayEvents = eventsByDay.get(dayDate) || [];
            const totalDayExtra = dayEvents.reduce((acc, e) => acc + (e.extra_minutes || 0), 0);

            // Format date: "Sam. 17 Janv."
            const formattedDate = formatParisLocale(dayDate, {
              weekday: "short",
              day: "numeric",
              month: "short",
            });

            return (
              <div key={dayDate} className="p-4 bg-card border border-border rounded-xl">
                {/* Day header with total */}
                <div className="flex items-center justify-between">
                  <span className="font-medium capitalize">{formattedDate}</span>
                  <span className="text-primary font-semibold">
                    Extra: {minutesToXhYY(totalDayExtra)}
                  </span>
                </div>

                {/* Session details */}
                <div className="mt-3 space-y-3">
                  {dayEvents.map((event, idx) => (
                    <div key={event.id} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <span>
                            Session {idx + 1}: {minutesToXhYY(event.extra_minutes)}
                          </span>
                          {getStatusBadge(event.status)}
                        </div>
                        <div className="flex items-center gap-1">
                          {/* BUG 2 FIX: "Modifier horaires" button */}
                          {showEditButton && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-muted-foreground hover:text-primary"
                              onClick={() => setEditingEvent(event)}
                              title="Modifier horaires"
                              aria-label="Modifier les horaires"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          )}
                          {renderActionButtons(event)}
                        </div>
                      </div>
                      {/* BUG 3 FIX: Time range display */}
                      <p className="text-xs text-muted-foreground pl-0">{formatTimeRange(event)}</p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Edit Time Modal */}
      {editingEvent && (
        <ExtraTimeEditModal
          open={!!editingEvent}
          onOpenChange={(open) => !open && setEditingEvent(null)}
          badgeEventId={editingEvent.badge_event_id}
          dayDate={editingEvent.day_date}
          currentOccurredAt={editingEvent.extra_end_at}
          establishmentId={establishmentId || undefined}
          label="Heure de fin (extra)"
        />
      )}
    </div>
  );
});

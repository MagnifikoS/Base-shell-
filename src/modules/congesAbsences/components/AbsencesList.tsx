/**
 * Absences list component - shared between desktop and mobile
 * Displays absences grouped by consecutive days (UI only grouping)
 *
 * V2: Supports unified view (planned + detected absences)
 *
 * IMPORTANT: Grouping is purely visual
 * SSOT remains personnel_leaves with one row per day
 * Detected absences come from planning_shifts without badges
 */

import { memo } from "react";
import React from "react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import {
  Upload,
  Check,
  X,
  Loader2,
  Pencil,
  Trash2,
  Calendar,
  AlertCircle,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PaginationControls } from "@/components/ui/pagination-controls";
import { toast } from "sonner";
import type { UnifiedAbsenceRecord } from "../types";
import { groupUnifiedAbsences, type UnifiedAbsenceGroup } from "../utils/groupAbsences";
import { validateFileUpload } from "@/lib/schemas/upload";

/* ─────────────────────────────────────────────────────────────────────────────
 * Pure helper functions (hoisted outside components for reuse + memo compat)
 * ────────────────────────────────────────────────────────────────────────────*/

function formatAbsenceDateRange(group: UnifiedAbsenceGroup): string {
  try {
    const startDate = new Date(group.dateStart + "T12:00:00Z");

    if (group.dayCount === 1) {
      return format(startDate, "EEEE d MMMM yyyy", { locale: fr });
    }

    const endDate = new Date(group.dateEnd + "T12:00:00Z");
    const startStr = format(startDate, "d MMMM", { locale: fr });
    const endStr = format(endDate, "d MMMM yyyy", { locale: fr });

    return `${startStr} → ${endStr}`;
  } catch {
    return `${group.dateStart} → ${group.dateEnd}`;
  }
}

function formatShiftMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (mins === 0) return `${hours}h`;
  return `${hours}h${String(mins).padStart(2, "0")}`;
}

function getAbsenceLabel(group: UnifiedAbsenceGroup): string {
  if (group.source === "detected") {
    return "Absence détectée";
  }

  switch (group.leaveType) {
    case "cp":
      return "Congé payé";
    case "absence":
      return "Absence planifiée";
    case "repos":
      return "Repos";
    case "am":
      return "Arrêt maladie";
    default:
      return "Absence planifiée";
  }
}

function getAbsenceStyle(group: UnifiedAbsenceGroup) {
  if (group.source === "detected") {
    return {
      badge:
        "bg-amber-100 text-amber-800 dark:text-amber-200 dark:bg-amber-900/30 dark:text-amber-300 border-amber-200 dark:border-amber-800",
      iconType: "alert" as const,
      border: "border-amber-200 dark:border-amber-800",
    };
  }

  if (group.leaveType === "cp") {
    return {
      badge:
        "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 border-blue-200 dark:border-blue-800",
      iconType: "calendar" as const,
      border: "border-blue-200 dark:border-blue-800",
    };
  }

  return {
    badge: "bg-muted text-muted-foreground border-border",
    iconType: "calendar" as const,
    border: "border-border",
  };
}

/* ─────────────────────────────────────────────────────────────────────────────
 * AbsenceGroupRow — Memoized row for the absences list
 * ────────────────────────────────────────────────────────────────────────────*/

interface AbsenceGroupRowProps {
  group: UnifiedAbsenceGroup;
  canWrite: boolean;
  uploadingDate: string | null | undefined;
  onUploadFile?: (leaveDate: string, file: File) => void;
  onEdit?: (group: UnifiedAbsenceGroup) => void;
  onDelete?: (group: UnifiedAbsenceGroup) => void;
}

const AbsenceGroupRow = memo(function AbsenceGroupRow({
  group,
  canWrite,
  uploadingDate,
  onUploadFile,
  onEdit,
  onDelete,
}: AbsenceGroupRowProps) {
  const style = getAbsenceStyle(group);
  const isPlanned = group.source === "planned";
  const isUploading = group.days.some((d) => uploadingDate === d.leave_date);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>, leaveDate: string) => {
    const file = e.target.files?.[0];
    if (file && onUploadFile) {
      const validation = validateFileUpload(file);
      if (!validation.valid) {
        toast.error(validation.error);
        e.target.value = "";
        return;
      }
      onUploadFile(leaveDate, file);
    }
  };

  return (
    <div
      className={`flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-lg border bg-card gap-2 ${style.border}`}
    >
      <div className="space-y-1 flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-medium text-sm">{formatAbsenceDateRange(group)}</p>
          {group.dayCount > 1 && (
            <Badge variant="outline" className="text-xs">
              {group.dayCount} jours
            </Badge>
          )}
        </div>

        {/* Absence type label + reason inline */}
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className={`text-xs ${style.badge}`}>
            {style.iconType === "alert" ? (
              <AlertCircle className="w-3 h-3" />
            ) : (
              <Calendar className="w-3 h-3" />
            )}
            <span className="ml-1">{getAbsenceLabel(group)}</span>
          </Badge>

          {/* Shift duration for detected absences */}
          {group.source === "detected" && group.totalShiftMinutes && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {formatShiftMinutes(group.totalShiftMinutes)} prévues
            </span>
          )}

          {/* Reason inline (for planned absences) */}
          {isPlanned && group.reason && (
            <span className="text-xs text-muted-foreground">
              — {group.reason.toLowerCase() === "maladie" ? "Maladie" : `Motif : ${group.reason}`}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
        {/* Justificatif Status - only for planned absences */}
        {isPlanned && (
          <>
            {group.hasJustificatif ? (
              <Badge variant="secondary" className="text-xs">
                <Check className="w-3 h-3 mr-1" />
                Justifié
              </Badge>
            ) : (
              <>
                <Badge variant="destructive" className="text-xs">
                  <X className="w-3 h-3 mr-1" />
                  {group.hasMissingJustificatif && group.dayCount > 1
                    ? `${group.days.filter((d) => !d.has_justificatif).length}/${group.dayCount} non justifié`
                    : "Non justifié"}
                </Badge>
                {/* Upload button - only if canWrite and onUploadFile provided */}
                {canWrite && onUploadFile && (
                  <>
                    <input
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png"
                      className="hidden"
                      id={`upload-${group.id}`}
                      onChange={(e) => {
                        const unjustified = group.days.find((d) => !d.has_justificatif);
                        if (unjustified) {
                          handleFileSelect(e, unjustified.leave_date);
                        }
                      }}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        document.getElementById(`upload-${group.id}`)?.click();
                      }}
                      disabled={isUploading}
                      title="Envoyer un justificatif"
                      aria-label="Envoyer un justificatif"
                    >
                      {isUploading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Upload className="w-4 h-4" />
                      )}
                    </Button>
                  </>
                )}
              </>
            )}
          </>
        )}

        {/* Detected absence indicator */}
        {group.source === "detected" && (
          <Badge
            variant="outline"
            className="text-xs text-amber-600 dark:text-amber-400 border-amber-300 dark:border-amber-700"
          >
            <AlertCircle className="w-3 h-3 mr-1" />
            Badgeuse
          </Badge>
        )}

        {/* Write actions: Edit & Delete - only for planned absences with write permission */}
        {canWrite && isPlanned && onEdit && onDelete && (
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onEdit(group)}
              title="Modifier"
              aria-label="Modifier l'absence"
            >
              <Pencil className="w-4 h-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onDelete(group)}
              title="Supprimer"
              aria-label="Supprimer l'absence"
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
});

/* ─────────────────────────────────────────────────────────────────────────────
 * AbsencesList — Main component
 * ────────────────────────────────────────────────────────────────────────────*/

interface AbsencesListProps {
  absences: UnifiedAbsenceRecord[];
  isLoading: boolean;
  /**
   * Write access for modifications (only for planned absences, manager view)
   * Employee view is always read-only
   */
  canWrite?: boolean;
  uploadingDate?: string | null;
  onUploadFile?: (leaveDate: string, file: File) => void;
  onEdit?: (group: UnifiedAbsenceGroup) => void;
  onDelete?: (group: UnifiedAbsenceGroup) => void;
}

export function AbsencesList({
  absences,
  isLoading,
  canWrite = false,
  uploadingDate,
  onUploadFile,
  onEdit,
  onDelete,
}: AbsencesListProps) {
  // Group consecutive days into visual ranges
  const groups = groupUnifiedAbsences(absences);
  // Simple pagination state (no hook needed for small lists)
  const PAGE_SIZE = 20;
  const [currentPage, setCurrentPage] = React.useState(1);
  const totalItems = groups.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  const paginatedGroups = groups.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const hasNextPage = currentPage < totalPages;
  const hasPrevPage = currentPage > 1;
  const nextPage = () => setCurrentPage((p) => Math.min(p + 1, totalPages));
  const prevPage = () => setCurrentPage((p) => Math.max(p - 1, 1));
  const goToPage = (page: number) => setCurrentPage(Math.min(Math.max(1, page), totalPages));

  const _formatDateRange = (group: UnifiedAbsenceGroup) => {
    try {
      const startDate = new Date(group.dateStart + "T12:00:00Z");

      if (group.dayCount === 1) {
        return format(startDate, "EEEE d MMMM yyyy", { locale: fr });
      }

      const endDate = new Date(group.dateEnd + "T12:00:00Z");
      const startStr = format(startDate, "d MMMM", { locale: fr });
      const endStr = format(endDate, "d MMMM yyyy", { locale: fr });

      return `${startStr} → ${endStr}`;
    } catch {
      return `${group.dateStart} → ${group.dateEnd}`;
    }
  };

  const _formatShiftMinutes = (minutes: number) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (mins === 0) return `${hours}h`;
    return `${hours}h${String(mins).padStart(2, "0")}`;
  };

  const _handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>, leaveDate: string) => {
    const file = e.target.files?.[0];
    if (file && onUploadFile) {
      onUploadFile(leaveDate, file);
    }
  };

  // Check if any day in group is currently uploading
  const _isGroupUploading = (group: UnifiedAbsenceGroup) => {
    return group.days.some((d) => uploadingDate === d.leave_date);
  };

  // Get label for absence type
  const _getAbsenceLabel = (group: UnifiedAbsenceGroup) => {
    if (group.source === "detected") {
      return "Absence détectée";
    }

    switch (group.leaveType) {
      case "cp":
        return "Congé payé";
      case "absence":
        return "Absence planifiée";
      case "repos":
        return "Repos";
      case "am":
        return "Arrêt maladie";
      default:
        return "Absence planifiée";
    }
  };

  // Get styling for absence type
  const _getAbsenceStyle = (group: UnifiedAbsenceGroup) => {
    if (group.source === "detected") {
      return {
        badge:
          "bg-amber-100 text-amber-800 dark:text-amber-200 dark:bg-amber-900/30 dark:text-amber-300 border-amber-200 dark:border-amber-800",
        icon: <AlertCircle className="w-3 h-3" />,
        border: "border-amber-200 dark:border-amber-800",
      };
    }

    if (group.leaveType === "cp") {
      return {
        badge:
          "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 border-blue-200 dark:border-blue-800",
        icon: <Calendar className="w-3 h-3" />,
        border: "border-blue-200 dark:border-blue-800",
      };
    }

    return {
      badge: "bg-muted text-muted-foreground border-border",
      icon: <Calendar className="w-3 h-3" />,
      border: "border-border",
    };
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Calendar className="w-5 h-5" />
          Mes absences
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : groups.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">Aucune absence</p>
        ) : (
          <div className="space-y-3">
            {paginatedGroups.map((group) => (
              <AbsenceGroupRow
                key={group.id}
                group={group}
                canWrite={canWrite}
                uploadingDate={uploadingDate}
                onUploadFile={onUploadFile}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            ))}
            {/* Pagination (PERF-08) */}
            <PaginationControls
              currentPage={currentPage}
              totalPages={totalPages}
              totalItems={totalItems}
              hasNextPage={hasNextPage}
              hasPrevPage={hasPrevPage}
              onNextPage={nextPage}
              onPrevPage={prevPage}
              onGoToPage={goToPage}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

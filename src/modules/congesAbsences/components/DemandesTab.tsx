/**
 * DemandesTab - Leave requests workflow tab (MANAGER ONLY)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ THIS COMPONENT IS MANAGER-ONLY
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Employee view uses EmployeeAbsencesPortal instead (no request viewing).
 * This component shows pending requests grouped by consecutive dates for approval/rejection.
 *
 * Grouping rules (UI only):
 * - Same user_id + same leave_type + consecutive dates
 * - Groups display: "Du X au Y (N jours)" with checkbox to select all
 */

import { useState } from "react";
import { Loader2, FileCheck, CheckCircle2, AlertCircle, RefreshCw, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";

import { useLeaveRequestsManager, useReviewLeaveRequests } from "../hooks/useLeaveRequests";
import { useQueryClient } from "@tanstack/react-query";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import {
  groupRequestsByUserAndDates,
  formatDateRange,
  type RequestGroup,
} from "../utils/groupLeaveRequests";

// ═══════════════════════════════════════════════════════════════════════════
// LEAVE TYPE BADGE COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

function LeaveTypeBadge({ type }: { type: "absence" | "cp" | "am" }) {
  if (type === "cp") {
    return (
      <Badge
        variant="outline"
        className="text-blue-600 dark:text-blue-400 border-blue-300 dark:border-blue-700"
      >
        CP
      </Badge>
    );
  }
  if (type === "am") {
    return (
      <Badge
        variant="outline"
        className="text-red-600 dark:text-red-400 border-red-300 dark:border-red-700"
      >
        Arrêt maladie
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="text-orange-600 dark:text-orange-400 border-orange-300 dark:border-orange-700"
    >
      Absence
    </Badge>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MANAGER VIEW: Pending Requests (Grouped by consecutive dates)
// ═══════════════════════════════════════════════════════════════════════════

export function DemandesTab() {
  const queryClient = useQueryClient();
  const { activeEstablishment } = useEstablishment();
  const { data: requests, isLoading, error } = useLeaveRequestsManager();
  const reviewMutation = useReviewLeaveRequests();

  const [uiError, setUiError] = useState<string | null>(null);
  const [uiSuccess, setUiSuccess] = useState<string | null>(null);

  const clearFeedback = () => {
    setUiError(null);
    setUiSuccess(null);
  };

  const handleRefresh = () => {
    queryClient.invalidateQueries({
      queryKey: ["leave-requests", "manager", activeEstablishment?.id],
      exact: false,
    });
  };

  // Approve single request
  const handleApprove = async (requestId: string) => {
    clearFeedback();
    try {
      await reviewMutation.mutateAsync({
        review_action: "approve",
        request_ids: [requestId],
      });
      setUiSuccess("Demande validée");
    } catch (err) {
      setUiError(err instanceof Error ? err.message : "Erreur");
    }
  };

  // Reject single request
  const handleReject = async (requestId: string) => {
    clearFeedback();
    try {
      await reviewMutation.mutateAsync({
        review_action: "reject",
        request_ids: [requestId],
      });
      setUiSuccess("Demande refusée");
    } catch (err) {
      setUiError(err instanceof Error ? err.message : "Erreur");
    }
  };

  // Group by user AND consecutive dates
  const userGroups = groupRequestsByUserAndDates(requests || []);

  return (
    <div className="space-y-4">
      {/* Feedback */}
      {uiSuccess && (
        <Alert className="border-primary/30 bg-primary/10">
          <CheckCircle2 className="h-4 w-4 text-primary" />
          <AlertDescription className="text-primary-foreground">{uiSuccess}</AlertDescription>
        </Alert>
      )}
      {uiError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{uiError}</AlertDescription>
        </Alert>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {requests?.length || 0} demande{(requests?.length || 0) > 1 ? "s" : ""} en attente
        </span>
        <Button variant="ghost" size="icon" onClick={handleRefresh} aria-label="Actualiser">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* Requests List - Grouped by user, then by consecutive dates */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>Erreur lors du chargement</AlertDescription>
        </Alert>
      ) : userGroups.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <FileCheck className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <p className="text-muted-foreground">Aucune demande en attente</p>
        </div>
      ) : (
        <div className="space-y-4">
          {userGroups.map((userGroup) => (
            <Card key={userGroup.userId}>
              <CardHeader className="py-3">
                <CardTitle className="text-sm font-medium flex items-center justify-between">
                  <span>{userGroup.userName}</span>
                  <Badge variant="secondary" className="text-xs">
                    {userGroup.totalRequests} jour{userGroup.totalRequests > 1 ? "s" : ""}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="space-y-2">
                  {userGroup.groups.map((group, idx) => (
                    <GroupCard
                      key={`${group.userId}-${group.dateStart}-${idx}`}
                      group={group}
                      onApprove={() => {
                        // Approve all requests in the group
                        group.requestIds.forEach((id) => handleApprove(id));
                      }}
                      onReject={() => {
                        // Reject all requests in the group
                        group.requestIds.forEach((id) => handleReject(id));
                      }}
                      isPending={reviewMutation.isPending}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// GROUP CARD COMPONENT (Same layout as ExtraEmployeeDetail)
// ═══════════════════════════════════════════════════════════════════════════

interface GroupCardProps {
  group: RequestGroup;
  onApprove: () => void;
  onReject: () => void;
  isPending: boolean;
}

function GroupCard({ group, onApprove, onReject, isPending }: GroupCardProps) {
  return (
    <div className="p-4 bg-card border border-border rounded-xl">
      {/* Header: Date range */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <LeaveTypeBadge type={group.leaveType} />
          <span className="font-medium text-sm">
            {formatDateRange(group.dateStart, group.dateEnd)}
          </span>
          {group.dayCount > 1 && (
            <Badge variant="outline" className="text-xs">
              {group.dayCount} jours
            </Badge>
          )}
        </div>
      </div>

      {/* Details row with inline action buttons */}
      <div className="mt-2 flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {group.reasonLabel && <span>{group.reasonLabel}</span>}
        </div>

        {/* Inline approve/reject buttons (same style as ExtraEmployeeDetail) */}
        <div className="flex gap-2">
          <Button
            size="icon"
            variant="ghost"
            className="text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 hover:bg-green-100 dark:hover:bg-green-900/30"
            onClick={onApprove}
            disabled={isPending}
            title="Approuver"
            aria-label="Approuver la demande"
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={onReject}
            disabled={isPending}
            title="Rejeter"
            aria-label="Rejeter la demande"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

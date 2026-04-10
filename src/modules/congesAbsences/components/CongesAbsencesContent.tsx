/**
 * CongesAbsencesContent - Shared UI component for Desktop and Mobile
 * Contains tabs, declaration form, absences list, and write actions
 *
 * TWO MODES based on RBAC scope:
 * 1. Manager/Admin View (scope: establishment/team/org):
 *    - Uses existing AbsenceTab + CPTab from presence/ (same as GestionPersonnel)
 *    - Shows "Demandes" tab for pending request approval
 *
 * 2. Employee View (scope: self or read-only):
 *    - Shows "Absences" tab with 2-card portal (Faire une demande / Mes absences)
 *    - Shows "CP" tab (placeholder)
 *    - ❌ NO "Mes demandes" section (employee never sees requests)
 */

import { useState } from "react";
import { CalendarDays, AlertCircle, Users, Send } from "lucide-react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { usePermissions } from "@/hooks/usePermissions";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { CPPlaceholderTab } from "../mobile/CPPlaceholderTab";
import { DemandesTab } from "./DemandesTab";
import { EmployeeAbsencesPortal } from "./EmployeeAbsencesPortal";
import { useLeaveRequestsManager } from "../hooks/useLeaveRequests";

// Import existing admin tabs (same as GestionPersonnel)
import { AbsenceTab } from "@/components/presence/AbsenceTab";
import { CPTab } from "@/components/presence/CPTab";

export function CongesAbsencesContent() {
  const isMobile = useIsMobile();
  const { can, getScope } = usePermissions();
  const { activeEstablishment } = useEstablishment();
  const establishmentId = activeEstablishment?.id || null;

  const canRead = can("conges_absences", "read");

  // Determine if user has manager/admin view (scope > self)
  const scope = getScope("conges_absences");
  const isManagerView = scope === "establishment" || scope === "team" || scope === "org";

  // Pending requests count for badge (only in manager view)
  const { data: pendingRequests } = useLeaveRequestsManager();
  const pendingCount = isManagerView ? pendingRequests?.length || 0 : 0;

  // Tab state — CP first per user request
  const [activeTab, setActiveTab] = useState<"cp" | "absences" | "demandes">("cp");

  // ═══════════════════════════════════════════════════════════════════════════
  // MANAGER/ADMIN VIEW - uses existing AbsenceTab + CPTab (same as GestionPersonnel)
  // ═══════════════════════════════════════════════════════════════════════════
  if (isManagerView) {
    return (
      <div className="space-y-4">
        {/* Manager mode indicator */}
        <Alert className="border-primary/30 bg-primary/5">
          <Users className="h-4 w-4 text-primary" />
          <AlertDescription className="flex items-center gap-2">
            <Badge variant="secondary" className="bg-primary/10 text-primary">
              Vue équipe
            </Badge>
            <span className="text-sm">
              Vous visualisez les absences et CP de tous les salariés.
            </span>
          </AlertDescription>
        </Alert>

        {/* Tabs - uses same components as GestionPersonnel + Demandes */}
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as "cp" | "absences" | "demandes")}
        >
          {isMobile ? (
            <TabsList className="w-full grid grid-cols-3 h-12 mb-3">
              <TabsTrigger value="cp" className="flex flex-col items-center gap-0.5 text-[10px] py-1.5">
                <CalendarDays className="h-4 w-4" />
                CP
              </TabsTrigger>
              <TabsTrigger value="absences" className="flex flex-col items-center gap-0.5 text-[10px] py-1.5">
                <AlertCircle className="h-4 w-4" />
                Absences
              </TabsTrigger>
              <TabsTrigger value="demandes" className="flex flex-col items-center gap-0.5 text-[10px] py-1.5 relative">
                <Send className="h-4 w-4" />
                Demandes
                {pendingCount > 0 && (
                  <Badge
                    variant="secondary"
                    className="absolute -top-1 -right-1 h-4 min-w-4 px-1 text-[9px] bg-amber-100 text-amber-700 dark:text-amber-300 dark:bg-amber-900/30"
                  >
                    {pendingCount}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>
          ) : (
            <TabsList className="w-full grid grid-cols-3">
              <TabsTrigger value="cp" className="gap-2">
                <CalendarDays className="w-4 h-4" />
                CP
              </TabsTrigger>
              <TabsTrigger value="absences" className="gap-2">
                <AlertCircle className="w-4 h-4" />
                Absences
              </TabsTrigger>
              <TabsTrigger value="demandes" className="gap-2 relative">
                <Send className="w-4 h-4" />
                Demandes
                {pendingCount > 0 && (
                  <Badge
                    variant="secondary"
                    className="ml-1 h-5 min-w-5 px-1.5 bg-amber-100 text-amber-700 dark:text-amber-300 dark:bg-amber-900/30"
                  >
                    {pendingCount}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>
          )}

          <TabsContent value="cp" className={isMobile ? "mt-3" : "mt-4"}>
            <CPTab establishmentId={establishmentId} />
          </TabsContent>

          <TabsContent value="absences" className={isMobile ? "mt-3" : "mt-4"}>
            <AbsenceTab establishmentId={establishmentId} />
          </TabsContent>

          <TabsContent value="demandes" className={isMobile ? "mt-3" : "mt-4"}>
            <DemandesTab />
          </TabsContent>
        </Tabs>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EMPLOYEE VIEW - Simplified: 2 tabs only (Absences = Portal, CP)
  // ❌ NO "Mes demandes" section - employee only sees validated absences
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div className="space-y-4">
      {/* No access message */}
      {!canRead && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Vous n'avez pas accès à ce module. Contactez votre responsable.
          </AlertDescription>
        </Alert>
      )}

      {/* Tabs - Employee view: 2 tabs, CP first */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "cp" | "absences")}>
        {isMobile ? (
          <TabsList className="w-full grid grid-cols-2 h-12 mb-3">
            <TabsTrigger value="cp" className="flex flex-col items-center gap-0.5 text-[10px] py-1.5">
              <CalendarDays className="h-4 w-4" />
              CP
            </TabsTrigger>
            <TabsTrigger value="absences" className="flex flex-col items-center gap-0.5 text-[10px] py-1.5">
              <AlertCircle className="h-4 w-4" />
              Absences
            </TabsTrigger>
          </TabsList>
        ) : (
          <TabsList className="w-full grid grid-cols-2">
            <TabsTrigger value="cp" className="gap-2">
              <CalendarDays className="w-4 h-4" />
              CP
            </TabsTrigger>
            <TabsTrigger value="absences" className="gap-2">
              <AlertCircle className="w-4 h-4" />
              Absences
            </TabsTrigger>
          </TabsList>
        )}

        <TabsContent value="cp" className={isMobile ? "mt-3" : "mt-4"}>
          <CPPlaceholderTab />
        </TabsContent>

        <TabsContent value="absences" className={isMobile ? "mt-3" : "mt-4"}>
          <EmployeeAbsencesPortal />
        </TabsContent>
      </Tabs>
    </div>
  );
}

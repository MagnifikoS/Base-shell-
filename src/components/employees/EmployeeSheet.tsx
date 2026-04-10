import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { toast } from "sonner";

// Hooks
import { useEmployee } from "./hooks/useEmployee";
import { useEmployeeForm } from "./hooks/useEmployeeForm";
import { useEmployeeMutations } from "./hooks/useEmployeeMutations";
import { useEstablishmentAccess } from "@/hooks/useEstablishmentAccess";

// Tabs
import { EmployeeInfoTab } from "./tabs/EmployeeInfoTab";
import { EmployeeContractTab } from "./tabs/EmployeeContractTab";
import { EmployeeDocumentsTab } from "./tabs/EmployeeDocumentsTab";

// Sections
import { EmployeeHeader } from "./sections/EmployeeHeader";
import { EmployeeLoadingState } from "./sections/EmployeeLoadingState";
import { EmployeeErrorState } from "./sections/EmployeeErrorState";
import { SuspendDialog } from "./sections/SuspendDialog";
import { ReactivateDialog } from "./sections/ReactivateDialog";

interface EmployeeSheetProps {
  userId: string | null;
  onClose: () => void;
  isOwnProfile?: boolean;
}

export function EmployeeSheet({ userId, onClose, isOwnProfile = false }: EmployeeSheetProps) {
  const [activeTab, setActiveTab] = useState("informations");
  const [showSuspendDialog, setShowSuspendDialog] = useState(false);
  const [showReactivateDialog, setShowReactivateDialog] = useState(false);

  // SSOT: establishment from context for cache invalidation
  const { activeEstablishmentId } = useEstablishmentAccess();

  // Fetch employee data (single source hook)
  const {
    data: employee,
    isLoading,
    isError,
    error: fetchError,
  } = useEmployee({
    userId,
  });

  // Form state (derived from employee)
  const employeeForm = useEmployeeForm({ employee });

  // Mutations
  const { saveMutation, suspendMutation, reactivateMutation } = useEmployeeMutations({
    userId,
    establishmentId: activeEstablishmentId,
    onSaveSuccess: employeeForm.onSaveSuccess,
    onSuspendSuccess: () => setShowSuspendDialog(false),
    onReactivateSuccess: () => setShowReactivateDialog(false),
  });

  const isSuspended = employee?.status === "disabled";

  const handleSave = () => {
    // Validate form before saving
    const isValid = employeeForm.validateForm();
    if (!isValid) {
      toast.error("Veuillez corriger les erreurs du formulaire avant d'enregistrer");
      return;
    }
    saveMutation.mutate(employeeForm.formData);
  };

  const handleSuspend = (endDate: string) => {
    suspendMutation.mutate(endDate);
  };

  const handleReactivate = (mode: "mistake" | "rehire", rehireDate?: string) => {
    reactivateMutation.mutate({ mode, rehire_start_date: rehireDate });
  };

  // Tabs content (shared between Sheet and Card modes)
  const renderTabsContent = () => {
    if (!employee) return null;

    return (
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3 mb-6">
          <TabsTrigger value="informations">Informations</TabsTrigger>
          <TabsTrigger value="contrat">Contrat</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
        </TabsList>

        <TabsContent value="informations">
          <EmployeeInfoTab
            employee={employee}
            formData={employeeForm.formData}
            isOwnProfile={isOwnProfile}
            hasChanges={employeeForm.hasChanges}
            isSaving={saveMutation.isPending}
            onUpdateField={employeeForm.updateField}
            onUpdateSensitiveField={employeeForm.updateSensitiveField}
            onSave={handleSave}
            showIban={employeeForm.showIban}
            setShowIban={employeeForm.setShowIban}
            showSsn={employeeForm.showSsn}
            setShowSsn={employeeForm.setShowSsn}
            ibanLast4={employeeForm.ibanLast4}
            ssnLast2={employeeForm.ssnLast2}
            ibanEdited={employeeForm.ibanEdited}
            ssnEdited={employeeForm.ssnEdited}
            hasFullIban={employeeForm.hasFullIban}
            hasFullSsn={employeeForm.hasFullSsn}
            fieldErrors={employeeForm.fieldErrors}
            onClearFieldError={employeeForm.clearFieldError}
          />
        </TabsContent>

        <TabsContent value="contrat">
          <EmployeeContractTab
            formData={employeeForm.formData}
            isSuspended={isSuspended}
            hasChanges={employeeForm.hasChanges}
            isSaving={saveMutation.isPending}
            isSuspending={suspendMutation.isPending}
            isReactivating={reactivateMutation.isPending}
            onUpdateField={employeeForm.updateField}
            onSave={handleSave}
            onSuspendClick={() => setShowSuspendDialog(true)}
            onReactivateClick={() => setShowReactivateDialog(true)}
            fieldErrors={employeeForm.fieldErrors}
            onClearFieldError={employeeForm.clearFieldError}
          />
        </TabsContent>

        <TabsContent
          value="documents"
          forceMount
          className={activeTab !== "documents" ? "hidden" : ""}
        >
          <EmployeeDocumentsTab
            userId={employee.user_id}
            establishmentId={activeEstablishmentId}
            isOwnProfile={isOwnProfile}
          />
        </TabsContent>
      </Tabs>
    );
  };

  // For own profile mode: render inline Card
  if (isOwnProfile) {
    return (
      <Card>
        <CardHeader>
          {!isLoading && !isError && (
            <EmployeeHeader employee={employee} isSuspended={isSuspended} />
          )}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <EmployeeLoadingState />
          ) : isError ? (
            <EmployeeErrorState message={fetchError?.message} />
          ) : (
            renderTabsContent()
          )}
        </CardContent>
      </Card>
    );
  }

  // For admin mode: render Sheet
  return (
    <>
      <Sheet open={!!userId} onOpenChange={(open) => !open && onClose()}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto" aria-label="Fiche employé">
          <SheetHeader className="mb-6">
            <div className="flex items-center gap-3">
              <SheetTitle>{employee?.full_name || "Chargement..."}</SheetTitle>
              {employee && (
                <Badge variant={isSuspended ? "secondary" : "default"}>
                  {isSuspended ? "Suspendu" : "Actif"}
                </Badge>
              )}
            </div>
            {employee && <p className="text-sm text-muted-foreground">{employee.email}</p>}
          </SheetHeader>

          {isLoading ? (
            <EmployeeLoadingState />
          ) : isError ? (
            <EmployeeErrorState message={fetchError?.message} />
          ) : (
            renderTabsContent()
          )}
        </SheetContent>
      </Sheet>

      {/* Suspend confirmation dialog */}
      <SuspendDialog
        open={showSuspendDialog}
        onOpenChange={setShowSuspendDialog}
        isPending={suspendMutation.isPending}
        onConfirm={handleSuspend}
      />

      {/* Reactivate dialog */}
      <ReactivateDialog
        open={showReactivateDialog}
        onOpenChange={setShowReactivateDialog}
        isPending={reactivateMutation.isPending}
        onConfirm={handleReactivate}
      />
    </>
  );
}

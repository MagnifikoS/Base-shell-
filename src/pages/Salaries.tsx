import { useState } from "react";
import { ResponsiveLayout } from "@/components/mobile/ResponsiveLayout";
import { EmployeesList } from "@/components/employees/EmployeesList";
import { ArchivedEmployeesList } from "@/components/employees/ArchivedEmployeesList";
import { EmployeeSheet } from "@/components/employees/EmployeeSheet";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { Loader2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isSelfScope } from "@/lib/rbac/scope";


export default function Salaries() {
  const { user } = useAuth();
  const { isAdmin, isLoading: permLoading, getScope } = usePermissions();
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"actifs" | "archives">("actifs");

  // Loading state while checking permissions
  if (permLoading) {
    return (
      <ResponsiveLayout>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </ResponsiveLayout>
    );
  }

  const salariesScope = getScope("salaries");

  // Self scope: show only own employee sheet, no list
  if (!isAdmin && isSelfScope(salariesScope)) {
    return (
      <ResponsiveLayout>
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-semibold text-foreground">Ma fiche salarié</h1>
          </div>

          {/* Directly show own employee sheet */}

          {/* Directly show own employee sheet */}
          <EmployeeSheet
            userId={user?.id || null}
            onClose={() => {}}
            isOwnProfile={true}
          />
        </div>
      </ResponsiveLayout>
    );
  }

  // Admin or team/establishment scope: show list + sheet
  return (
    <ResponsiveLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-foreground">Salariés</h1>
        </div>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "actifs" | "archives")}>
          <TabsList>
            <TabsTrigger value="actifs">Actifs</TabsTrigger>
            <TabsTrigger value="archives">Archives</TabsTrigger>
          </TabsList>

          <TabsContent value="actifs" className="mt-4">
            <EmployeesList onSelectEmployee={setSelectedEmployeeId} />
          </TabsContent>

          <TabsContent value="archives" className="mt-4">
            <ArchivedEmployeesList onSelectEmployee={setSelectedEmployeeId} />
          </TabsContent>
        </Tabs>

        <EmployeeSheet
          userId={selectedEmployeeId}
          onClose={() => setSelectedEmployeeId(null)}
        />
      </div>
    </ResponsiveLayout>
  );
}

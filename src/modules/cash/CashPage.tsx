/**
 * Main Cash Page Component
 * Renders the unified CashMainView based on user permissions.
 */

import { Loader2, AlertCircle } from "lucide-react";
import { ResponsiveLayout } from "@/components/mobile/ResponsiveLayout";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { useCashPermissions } from "./hooks/useCashPermissions";
import { CashMainView } from "./components/CashMainView";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function CashPage() {
  const { activeEstablishment } = useEstablishment();
  const {
    canWrite,
    canRead,
    canAccessMonth,
    isLoading,
  } = useCashPermissions();

  const establishmentId = activeEstablishment?.id ?? null;

  if (isLoading) {
    return (
      <ResponsiveLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </ResponsiveLayout>
    );
  }

  if (!canRead) {
    return (
      <ResponsiveLayout>
        <div className="p-4">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Accès refusé</AlertTitle>
            <AlertDescription>
              Vous n'avez pas les permissions nécessaires pour accéder au module Caisse.
            </AlertDescription>
          </Alert>
        </div>
      </ResponsiveLayout>
    );
  }

  if (!establishmentId) {
    return (
      <ResponsiveLayout>
        <div className="p-4">
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Aucun établissement</AlertTitle>
            <AlertDescription>Vous n'êtes assigné à aucun établissement actif.</AlertDescription>
          </Alert>
        </div>
      </ResponsiveLayout>
    );
  }

  return (
    <ResponsiveLayout>
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-foreground">Caisse</h1>
          {activeEstablishment && (
            <span className="text-sm text-muted-foreground">{activeEstablishment.name}</span>
          )}
        </div>

        <CashMainView
          establishmentId={establishmentId}
          canWrite={canWrite}
          canAccessMonth={canAccessMonth}
        />
      </div>
    </ResponsiveLayout>
  );
}

export default CashPage;

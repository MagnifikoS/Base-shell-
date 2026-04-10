/**
 * PAYROLL PREP BUTTON — Bouton d'accès à l'état préparatoire
 * 
 * Visible uniquement si can("paie", "read")
 */

import { useState } from "react";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePermissions } from "@/hooks/usePermissions";
import { PayrollPrepModal } from "./PayrollPrepModal";

interface PayrollPrepButtonProps {
  yearMonth: string;
  establishmentId: string | null;
}

export function PayrollPrepButton({ yearMonth, establishmentId }: PayrollPrepButtonProps) {
  const [open, setOpen] = useState(false);
  const { can } = usePermissions();

  // RBAC: visible uniquement si can("paie", "read")
  if (!can("paie", "read")) {
    return null;
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="gap-2"
      >
        <FileText className="h-4 w-4" />
        État préparatoire
      </Button>

      <PayrollPrepModal
        open={open}
        onOpenChange={setOpen}
        yearMonth={yearMonth}
        establishmentId={establishmentId}
      />
    </>
  );
}

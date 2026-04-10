/**
 * Mobile employee profile view
 */

import { useState } from "react";
import { ChevronLeft, ChevronDown, ChevronUp, User, FileText, Briefcase } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { usePermissions } from "@/hooks/usePermissions";
import type { MobileEmployeeData } from "./MobileEmployeeCard";

interface EmployeeDetails {
  phone?: string | null;
  address?: string | null;
  position?: string | null;
  contract_type?: string | null;
  contract_start_date?: string | null;
  contract_end_date?: string | null;
  contract_hours?: number | null;
}

interface MobileEmployeeProfileProps {
  employee: MobileEmployeeData & { details?: EmployeeDetails | null };
  onBack: () => void;
}

interface AccordionSectionProps {
  title: string;
  icon: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

function AccordionSection({ title, icon, defaultOpen = false, children }: AccordionSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-4 bg-card hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          {icon}
          <span className="font-medium">{title}</span>
        </div>
        {isOpen ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>
      {isOpen && <div className="p-4 border-t border-border bg-background">{children}</div>}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex justify-between py-2 border-b border-border last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right">{value}</span>
    </div>
  );
}

export function MobileEmployeeProfile({ employee, onBack }: MobileEmployeeProfileProps) {
  const { can } = usePermissions();
  const canViewContract = can("salaries", "write"); // Contract details for managers only

  const initials =
    employee.full_name
      ?.split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) || "?";

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-primary/5 p-4 pb-8">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ChevronLeft className="h-4 w-4" />
          Retour
        </button>

        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-lg">
            {initials}
          </div>
          <div>
            <h1 className="text-xl font-semibold">{employee.full_name || "Sans nom"}</h1>
            <p className="text-muted-foreground">{employee.email}</p>
            <div className="mt-1">
              <Badge
                variant={employee.status === "active" ? "default" : "secondary"}
                className={employee.status === "active" ? "bg-green-500 dark:bg-green-600" : ""}
              >
                {employee.status === "active" ? "Actif" : employee.status}
              </Badge>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 space-y-3 -mt-4">
        {/* Informations générales */}
        <AccordionSection
          title="Informations"
          icon={<User className="h-5 w-5 text-primary" />}
          defaultOpen={true}
        >
          <div className="space-y-1">
            <InfoRow label="Email" value={employee.email} />
            <InfoRow label="Téléphone" value={employee.details?.phone} />
            <InfoRow label="Adresse" value={employee.details?.address} />
            <InfoRow label="Poste" value={employee.details?.position || employee.position} />
            {employee.establishments.length > 0 && (
              <div className="py-2 border-b border-border">
                <span className="text-muted-foreground">Établissements</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {employee.establishments.map((est) => (
                    <Badge key={est.id} variant="outline" className="text-xs">
                      {est.name}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {employee.teams.length > 0 && (
              <div className="py-2">
                <span className="text-muted-foreground">Équipes</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {employee.teams.map((team) => (
                    <Badge key={team.id} variant="outline" className="text-xs">
                      {team.name}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        </AccordionSection>

        {/* Contrat (if authorized) */}
        {canViewContract && employee.details && (
          <AccordionSection title="Contrat" icon={<Briefcase className="h-5 w-5 text-primary" />}>
            <div className="space-y-1">
              <InfoRow label="Type" value={employee.details.contract_type} />
              <InfoRow label="Date début" value={employee.details.contract_start_date} />
              <InfoRow label="Date fin" value={employee.details.contract_end_date} />
              <InfoRow label="Heures/semaine" value={employee.details.contract_hours?.toString()} />
            </div>
          </AccordionSection>
        )}

        {/* Documents placeholder */}
        <AccordionSection title="Documents" icon={<FileText className="h-5 w-5 text-primary" />}>
          <p className="text-muted-foreground text-sm">Aucun document disponible.</p>
        </AccordionSection>
      </div>
    </div>
  );
}

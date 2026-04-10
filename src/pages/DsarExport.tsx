import { useState, useCallback } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { MobileLayout } from "@/components/mobile/MobileLayout";
import { usePermissions } from "@/hooks/usePermissions";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ShieldX,
  Loader2,
  Download,
  FileText,
  Clock,
  Calendar,
  Wallet,
  Users,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";

/**
 * Helper to query tables not in auto-generated Supabase types.
 * Returns a REST API response directly as JSON.
 * Remove once `supabase gen types` includes employees, leave_requests, payroll_lines.
 */
async function queryUntyped<T = Record<string, unknown>>(
  table: string,
  select: string,
  filters: Record<string, string> = {},
  orderBy?: { column: string; ascending?: boolean }
): Promise<{ data: T[] | null; error: { message: string } | null }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase as any).from(table).select(select);
  for (const [key, value] of Object.entries(filters)) {
    query = query.eq(key, value);
  }
  if (orderBy) {
    query = query.order(orderBy.column, { ascending: orderBy.ascending ?? true });
  }
  const result = await query;
  return result as unknown as { data: T[] | null; error: { message: string } | null };
}

/** Employee record shape for DSAR queries */
interface DsarEmployeeRecord {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
}

/**
 * DSAR Export Page — RGPD-02 / I-012
 *
 * Permet aux administrateurs d'exporter toutes les donnees personnelles
 * d'un employe conformement au droit d'acces (Art. 15 RGPD) et au
 * droit a la portabilite (Art. 20 RGPD).
 *
 * Donnees exportees :
 * - Informations de l'employe (profil)
 * - Evenements de pointage (badge_events)
 * - Demandes de conges/absences
 * - Donnees de paie
 * - Plannings
 */

/** Categories de donnees exportables */
const DATA_CATEGORIES = [
  {
    id: "profile",
    label: "Profil employe",
    description: "Nom, prenom, email, telephone, role, contrat",
    icon: Users,
    table: "employees",
  },
  {
    id: "badge_events",
    label: "Pointages",
    description: "Historique complet des pointages (entrees/sorties)",
    icon: Clock,
    table: "badge_events",
  },
  {
    id: "leave_requests",
    label: "Conges et absences",
    description: "Demandes de conges, absences, justificatifs",
    icon: Calendar,
    table: "leave_requests",
  },
  {
    id: "payroll",
    label: "Donnees de paie",
    description: "Salaires, heures supplementaires, primes, cotisations",
    icon: Wallet,
    table: "payroll_lines",
  },
  {
    id: "planning",
    label: "Plannings",
    description: "Horaires planifies et affectations",
    icon: FileText,
    table: "planning_shifts",
  },
] as const;

type DataCategoryId = (typeof DATA_CATEGORIES)[number]["id"];

interface DsarExportData {
  exportDate: string;
  employeeId: string;
  employeeName: string;
  establishmentId: string;
  categories: Record<string, unknown[]>;
}

export default function DsarExport() {
  const { isAdmin, isLoading: permLoading } = usePermissions();
  const isMobile = useIsMobile();
  const { activeEstablishment } = useEstablishment();

  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>("");
  const [selectedCategories, setSelectedCategories] = useState<Set<DataCategoryId>>(
    new Set(DATA_CATEGORIES.map((c) => c.id))
  );
  const [isExporting, setIsExporting] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [exportResult, setExportResult] = useState<DsarExportData | null>(null);

  const Layout = isMobile ? MobileLayout : AppLayout;

  // Fetch employees list for selection
  const {
    data: employees,
    isLoading: employeesLoading,
    isError: employeesError,
    refetch: refetchEmployees,
  } = useQuery({
    queryKey: ["employees", activeEstablishment?.id],
    queryFn: async () => {
      if (!activeEstablishment) return [];
      const { data, error } = await queryUntyped<DsarEmployeeRecord>(
        "employees",
        "id, first_name, last_name, email",
        { establishment_id: activeEstablishment.id },
        { column: "last_name", ascending: true }
      );
      if (error) throw new Error(error.message);
      return data || [];
    },
    enabled: !!activeEstablishment && isAdmin,
  });

  const toggleCategory = useCallback((categoryId: DataCategoryId) => {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }
      return next;
    });
  }, []);

  const selectAllCategories = useCallback(() => {
    setSelectedCategories(new Set(DATA_CATEGORIES.map((c) => c.id)));
  }, []);

  const handleExportClick = useCallback(() => {
    if (!selectedEmployeeId) {
      toast.error("Veuillez selectionner un employe");
      return;
    }
    if (selectedCategories.size === 0) {
      toast.error("Veuillez selectionner au moins une categorie de donnees");
      return;
    }
    setShowConfirmDialog(true);
  }, [selectedEmployeeId, selectedCategories]);

  const handleExportConfirm = useCallback(async () => {
    setShowConfirmDialog(false);
    if (!activeEstablishment || !selectedEmployeeId) return;

    setIsExporting(true);
    setExportResult(null);

    try {
      const employee = employees?.find((e) => e.id === selectedEmployeeId);
      if (!employee) throw new Error("Employe non trouve");

      const result: DsarExportData = {
        exportDate: new Date().toISOString(),
        employeeId: selectedEmployeeId,
        employeeName: `${employee.first_name} ${employee.last_name}`,
        establishmentId: activeEstablishment.id,
        categories: {},
      };

      // Export each selected category
      for (const categoryId of selectedCategories) {
        try {
          switch (categoryId) {
            case "profile": {
              const { data } = await queryUntyped(
                "employees",
                "id, first_name, last_name, email, phone, role, contract_type, hire_date, created_at",
                { id: selectedEmployeeId }
              );
              result.categories.profile = data || [];
              break;
            }
            case "badge_events": {
              const { data } = await queryUntyped(
                "badge_events",
                "id, event_type, occurred_at, effective_at, day_date, selfie_captured, created_at",
                { employee_id: selectedEmployeeId, establishment_id: activeEstablishment.id },
                { column: "occurred_at", ascending: false }
              );
              result.categories.badge_events = data || [];
              break;
            }
            case "leave_requests": {
              const { data } = await queryUntyped(
                "leave_requests",
                "id, leave_type, start_date, end_date, status, reason, created_at",
                { employee_id: selectedEmployeeId },
                { column: "created_at", ascending: false }
              );
              result.categories.leave_requests = data || [];
              break;
            }
            case "payroll": {
              const { data } = await queryUntyped(
                "payroll_lines",
                "id, month, gross_salary, net_salary, hours_worked, overtime_hours, created_at",
                { employee_id: selectedEmployeeId },
                { column: "month", ascending: false }
              );
              result.categories.payroll = data || [];
              break;
            }
            case "planning": {
              const { data } = await queryUntyped(
                "planning_shifts",
                "id, day_date, start_time, end_time, position, created_at",
                { employee_id: selectedEmployeeId, establishment_id: activeEstablishment.id },
                { column: "day_date", ascending: false }
              );
              result.categories.planning = data || [];
              break;
            }
          }
        } catch (err) {
          // Si une table n'existe pas encore ou erreur de permission, on continue
          if (import.meta.env.DEV) {
            console.warn(`DSAR export: erreur pour ${categoryId}:`, err);
          }
          result.categories[categoryId] = [];
        }
      }

      setExportResult(result);

      // Telecharger en JSON
      const blob = new Blob([JSON.stringify(result, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `dsar-export-${employee.last_name}-${employee.first_name}-${new Date().toISOString().split("T")[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success("Export DSAR termine");
    } catch (err) {
      if (import.meta.env.DEV) console.error("DSAR export error:", err);
      toast.error("Erreur lors de l'export des donnees");
    } finally {
      setIsExporting(false);
    }
  }, [activeEstablishment, selectedEmployeeId, selectedCategories, employees]);

  if (permLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </Layout>
    );
  }

  if (!isAdmin) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center py-16 space-y-4">
          <ShieldX className="h-12 w-12 text-destructive" />
          <h1 className="text-xl font-semibold text-foreground">Acces refuse</h1>
          <p className="text-muted-foreground text-center px-4">
            Seuls les administrateurs peuvent effectuer des exports DSAR.
          </p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className={isMobile ? "p-4 space-y-4" : "space-y-6 max-w-3xl"}>
        {/* Header */}
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Export DSAR</h1>
          <p className="text-muted-foreground mt-1">
            Demande d'acces aux donnees personnelles (Art. 15 RGPD)
          </p>
        </div>

        {/* Info card */}
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-start gap-3">
              <ShieldCheck className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
              <div className="text-sm text-muted-foreground space-y-1">
                <p>
                  Cet outil permet d'exporter toutes les donnees personnelles d'un employe
                  conformement au <strong>droit d'acces (Art. 15 RGPD)</strong> et au{" "}
                  <strong>droit a la portabilite (Art. 20 RGPD)</strong>.
                </p>
                <p>
                  L'export est genere au format JSON, lisible par machine. Vous devez repondre dans
                  un delai de 30 jours a compter de la demande du salarie.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Employee selection */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Selectionner l'employe
            </CardTitle>
            <CardDescription>
              Choisissez l'employe pour lequel generer l'export DSAR
            </CardDescription>
          </CardHeader>
          <CardContent>
            {employeesLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Chargement des employes...
              </div>
            ) : employeesError ? (
              <div className="flex flex-col items-center justify-center p-8 text-center">
                <p className="text-destructive font-medium">Une erreur est survenue</p>
                <p className="text-muted-foreground text-sm mt-1">
                  Impossible de charger la liste des employes. Veuillez reessayer.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4"
                  onClick={() => refetchEmployees()}
                >
                  Reessayer
                </Button>
              </div>
            ) : !employees || employees.length === 0 ? (
              <p className="text-muted-foreground">Aucun employe trouve pour cet etablissement.</p>
            ) : (
              <Select value={selectedEmployeeId} onValueChange={setSelectedEmployeeId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choisir un employe..." />
                </SelectTrigger>
                <SelectContent>
                  {employees.map((emp) => (
                    <SelectItem key={emp.id} value={emp.id}>
                      {emp.last_name} {emp.first_name} — {emp.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </CardContent>
        </Card>

        {/* Data categories */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  Donnees a exporter
                </CardTitle>
                <CardDescription>
                  Selectionnez les categories de donnees a inclure dans l'export
                </CardDescription>
              </div>
              <Button variant="ghost" size="sm" onClick={selectAllCategories} className="text-xs">
                Tout selectionner
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {DATA_CATEGORIES.map((category) => {
              const isSelected = selectedCategories.has(category.id);
              const Icon = category.icon;
              return (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => toggleCategory(category.id)}
                  className={`w-full flex items-start gap-3 p-3 rounded-lg border text-left transition-colors ${
                    isSelected ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
                  }`}
                >
                  <div
                    className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                      isSelected ? "bg-primary/10" : "bg-muted"
                    }`}
                  >
                    <Icon
                      className={`h-4 w-4 ${isSelected ? "text-primary" : "text-muted-foreground"}`}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p
                      className={`font-medium text-sm ${
                        isSelected ? "text-foreground" : "text-muted-foreground"
                      }`}
                    >
                      {category.label}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">{category.description}</p>
                  </div>
                  {isSelected && <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0" />}
                </button>
              );
            })}
          </CardContent>
        </Card>

        {/* Export result summary */}
        {exportResult && (
          <Card className="border-green-500/30 bg-green-500 dark:bg-green-600/5">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
                <div className="text-sm space-y-1">
                  <p className="font-medium text-foreground">
                    Export termine pour {exportResult.employeeName}
                  </p>
                  <p className="text-muted-foreground">
                    Date : {new Date(exportResult.exportDate).toLocaleString("fr-FR")}
                  </p>
                  <ul className="text-muted-foreground mt-2 space-y-0.5">
                    {Object.entries(exportResult.categories).map(([key, records]) => (
                      <li key={key}>
                        {DATA_CATEGORIES.find((c) => c.id === key)?.label || key} :{" "}
                        <strong>{(records as unknown[]).length}</strong> enregistrement(s)
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Export button */}
        <div className="flex justify-end">
          <Button
            onClick={handleExportClick}
            disabled={isExporting || !selectedEmployeeId || selectedCategories.size === 0}
            size="lg"
          >
            {isExporting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Export en cours...
              </>
            ) : (
              <>
                <Download className="mr-2 h-4 w-4" />
                Generer l'export DSAR
              </>
            )}
          </Button>
        </div>

        {/* Warning */}
        <div className="flex items-start gap-2 text-xs text-muted-foreground">
          <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
          <p>
            Attention : cet export peut contenir des donnees sensibles. Transmettez-le de maniere
            securisee a la personne concernee. Conformement a l'Art. 12.3 RGPD, vous disposez de 30
            jours pour repondre a une demande d'acces.
          </p>
        </div>
      </div>

      {/* Confirmation dialog */}
      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmer l'export DSAR</AlertDialogTitle>
            <AlertDialogDescription>
              Vous allez exporter toutes les donnees personnelles de l'employe selectionne (
              {selectedCategories.size} categorie(s)). Un fichier JSON sera telecharge.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={handleExportConfirm}>Confirmer l'export</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}

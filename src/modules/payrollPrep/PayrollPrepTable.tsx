/**
 * PAYROLL PREP TABLE — Tableau récapitulatif mensuel
 *
 * Affichage + édition UI-only (aucun calcul métier)
 * Timezone: Europe/Paris pour tout affichage de date
 *
 * Structure colonnes :
 * - Salarié | Poste | H.Hebdo | H.Mens. | Début contrat | Fin contrat
 * - CP: Début | Fin
 * - Absences: Début | Fin
 * - AM: Début | Fin
 * - Navigo | Divers € | Divers Nature | Remarque
 */

import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Check, X, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PayrollPrepEmployee } from "./hooks/usePayrollPrepData";
import type { EmployeeLocalEdits } from "./types";
import type { PayrollPrepColumnKey } from "./columnDefs";
import { PAYROLL_PREP_COLUMNS } from "./columnDefs";

interface PayrollPrepTableProps {
  employees: PayrollPrepEmployee[];
  isLoading: boolean;
  error: Error | null;
  localEdits: Record<string, EmployeeLocalEdits>;
  onUpdateEdit: (
    userId: string,
    field: keyof EmployeeLocalEdits,
    value: string | number | null
  ) => void;
  hiddenEmployees: Set<string>;
  onToggleHidden: (userId: string) => void;
  hiddenColumns: Set<PayrollPrepColumnKey>;
  onToggleColumn: (col: PayrollPrepColumnKey) => void;
}

/**
 * Formate une date ISO (YYYY-MM-DD) en format français avec timezone Paris
 */
function formatDateParis(dateStr: string | null): string {
  if (!dateStr) return "–";
  const [year, month, day] = dateStr.split("-").map(Number);
  return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
}

/**
 * Regroupe des dates en périodes consécutives (détecte les trous > 1 jour)
 */
function getDateRanges(dates: string[]): Array<{ debut: string; fin: string }> {
  if (dates.length === 0) {
    return [{ debut: "–", fin: "–" }];
  }
  const sorted = [...dates].sort();
  const periods: Array<{ debut: string; fin: string }> = [];
  let periodStart = sorted[0];
  let periodEnd = sorted[0];

  for (let i = 1; i < sorted.length; i++) {
    const prevDate = new Date(periodEnd + "T12:00:00");
    const currDate = new Date(sorted[i] + "T12:00:00");
    const diffDays = (currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24);

    if (diffDays <= 1) {
      periodEnd = sorted[i];
    } else {
      periods.push({ debut: formatDateParis(periodStart), fin: formatDateParis(periodEnd) });
      periodStart = sorted[i];
      periodEnd = sorted[i];
    }
  }
  periods.push({ debut: formatDateParis(periodStart), fin: formatDateParis(periodEnd) });
  return periods;
}

/** Helper: check if a column is visible */
function isVisible(hiddenColumns: Set<PayrollPrepColumnKey>, key: PayrollPrepColumnKey): boolean {
  return !hiddenColumns.has(key);
}

/** Count visible columns in a group for colSpan */
function visibleCount(hiddenColumns: Set<PayrollPrepColumnKey>, keys: PayrollPrepColumnKey[]): number {
  return keys.filter((k) => !hiddenColumns.has(k)).length;
}

export function PayrollPrepTable({
  employees,
  isLoading,
  error,
  localEdits,
  onUpdateEdit,
  hiddenEmployees,
  onToggleHidden,
  hiddenColumns,
  onToggleColumn,
}: PayrollPrepTableProps) {
  if (error) {
    return <div className="p-8 text-center text-destructive">Erreur : {error.message}</div>;
  }

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (employees.length === 0) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        Aucun salarié trouvé pour ce mois.
      </div>
    );
  }

  const v = (key: PayrollPrepColumnKey) => isVisible(hiddenColumns, key);

  // Group spans
  const cpCount = visibleCount(hiddenColumns, ["cpDebut", "cpFin"]);
  const absCount = visibleCount(hiddenColumns, ["absDebut", "absFin"]);
  const amCount = visibleCount(hiddenColumns, ["amDebut", "amFin"]);
  const baseCount = visibleCount(hiddenColumns, ["poste", "hHebdo", "hMens", "debutContrat", "finContrat"]);
  const otherCount = visibleCount(hiddenColumns, ["navigo", "diversAmount", "diversNature", "remarque"]);

  return (
    <div className="overflow-x-auto">
      {/* Hide number input spinners */}
      <style>{`
        input[type="number"]::-webkit-inner-spin-button,
        input[type="number"]::-webkit-outer-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
        input[type="number"] {
          -moz-appearance: textfield;
        }
      `}</style>

      {/* Column visibility toggles */}
      <div className="flex flex-wrap gap-1 mb-2 px-1">
        <span className="text-xs text-muted-foreground self-center mr-1">Colonnes :</span>
        {PAYROLL_PREP_COLUMNS.map((col) => {
          const hidden = hiddenColumns.has(col.key);
          return (
            <Button
              key={col.key}
              variant={hidden ? "outline" : "secondary"}
              size="sm"
              className={cn("h-6 px-2 text-xs gap-1", hidden && "opacity-50")}
              onClick={() => onToggleColumn(col.key)}
              title={hidden ? `Afficher ${col.label}` : `Masquer ${col.label}`}
            >
              {hidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              {col.label}
            </Button>
          );
        })}
      </div>

      <Table className="border-collapse">
        <TableHeader>
          {/* Ligne de groupement */}
          <TableRow className="border-b-0">
            <TableHead className="w-[40px]" /> {/* Colonne visibilité */}
            {/* Salarié always visible */}
            <TableHead className="border-r" />
            {baseCount > 0 && (
              <TableHead colSpan={baseCount} className="border-r" />
            )}
            {cpCount > 0 && (
              <TableHead colSpan={cpCount} className="text-center border-r font-semibold italic">
                Congés Payés
              </TableHead>
            )}
            {absCount > 0 && (
              <TableHead colSpan={absCount} className="text-center border-r font-semibold italic">
                Absences
              </TableHead>
            )}
            {amCount > 0 && (
              <TableHead colSpan={amCount} className="text-center border-r font-semibold italic">
                Arrêt Maladie
              </TableHead>
            )}
            {otherCount > 0 && <TableHead colSpan={otherCount} />}
          </TableRow>
          {/* Ligne des colonnes */}
          <TableRow>
            <TableHead className="w-[40px] text-center border-r">PDF</TableHead>
            <TableHead className="w-[180px] sticky left-[40px] bg-background z-10 border-r">
              Salarié
            </TableHead>
            {v("poste") && <TableHead className="w-[140px] border-r">Poste</TableHead>}
            {v("hHebdo") && <TableHead className="w-[80px] text-center border-r">H. Hebdo</TableHead>}
            {v("hMens") && <TableHead className="w-[80px] text-center border-r">H. Mens.</TableHead>}
            {v("debutContrat") && <TableHead className="w-[85px] border-r">Début contrat</TableHead>}
            {v("finContrat") && <TableHead className="w-[85px] border-r">Fin contrat</TableHead>}
            {v("cpDebut") && <TableHead className="w-[75px] border-r">Début</TableHead>}
            {v("cpFin") && <TableHead className="w-[75px] border-r">Fin</TableHead>}
            {v("absDebut") && <TableHead className="w-[75px] border-r">Début</TableHead>}
            {v("absFin") && <TableHead className="w-[75px] border-r">Fin</TableHead>}
            {v("amDebut") && <TableHead className="w-[75px] border-r">Début</TableHead>}
            {v("amFin") && <TableHead className="w-[75px] border-r">Fin</TableHead>}
            {v("navigo") && <TableHead className="w-[55px] text-center border-r">Navigo</TableHead>}
            {v("diversAmount") && <TableHead className="w-[70px] border-r">Divers €</TableHead>}
            {v("diversNature") && <TableHead className="w-[100px] border-r">Divers Nature</TableHead>}
            {v("remarque") && <TableHead className="w-[110px]">Remarque</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {employees.map((emp) => {
            const edits = localEdits[emp.userId];
            const cpRanges = getDateRanges(emp.cpDates);
            const absRanges = getDateRanges(emp.absenceDates);
            const amRanges = getDateRanges(emp.amDates);
            const isHidden = hiddenEmployees.has(emp.userId);
            const maxRows = Math.max(cpRanges.length, absRanges.length, amRanges.length);

            return Array.from({ length: maxRows }).map((_, rowIdx) => (
              <TableRow key={`${emp.userId}-${rowIdx}`} className={cn(isHidden && "opacity-40", rowIdx > 0 && "border-t-0")}>
                {rowIdx === 0 ? (
                  <>
                    <TableCell className="p-1 text-center border-r" rowSpan={maxRows}>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => onToggleHidden(emp.userId)}
                        title={isHidden ? "Inclure dans le PDF" : "Exclure du PDF"}
                        aria-label={isHidden ? "Inclure dans le PDF" : "Exclure du PDF"}
                      >
                        {isHidden ? (
                          <EyeOff className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <Eye className="h-4 w-4 text-primary" />
                        )}
                      </Button>
                    </TableCell>
                    <TableCell className="font-medium sticky left-[40px] bg-background z-10 whitespace-nowrap border-r" rowSpan={maxRows}>
                      {emp.fullName}
                    </TableCell>
                    {v("poste") && (
                      <TableCell className="text-sm border-r whitespace-nowrap" rowSpan={maxRows}>
                        {emp.position || "–"}
                      </TableCell>
                    )}
                    {v("hHebdo") && (
                      <TableCell className="p-1 border-r" rowSpan={maxRows}>
                        <Input
                          type="number"
                          step="0.5"
                          className="h-8 w-[70px] text-center text-sm"
                          value={edits?.hoursWeekly ?? ""}
                          aria-label={`Heures hebdomadaires de ${emp.fullName}`}
                          onChange={(e) =>
                            onUpdateEdit(emp.userId, "hoursWeekly", e.target.value ? parseFloat(e.target.value) : null)
                          }
                        />
                      </TableCell>
                    )}
                    {v("hMens") && (
                      <TableCell className="p-1 border-r" rowSpan={maxRows}>
                        <Input
                          type="number"
                          step="0.01"
                          className="h-8 w-[70px] text-center text-sm"
                          value={edits?.hoursMonthly ?? ""}
                          aria-label={`Heures mensuelles de ${emp.fullName}`}
                          onChange={(e) =>
                            onUpdateEdit(emp.userId, "hoursMonthly", e.target.value ? parseFloat(e.target.value) : null)
                          }
                        />
                      </TableCell>
                    )}
                    {v("debutContrat") && (
                      <TableCell className="text-sm border-r" rowSpan={maxRows}>
                        {formatDateParis(emp.contractStartDate)}
                      </TableCell>
                    )}
                    {v("finContrat") && (
                      <TableCell className="text-sm border-r" rowSpan={maxRows}>
                        {formatDateParis(emp.contractEndDate)}
                      </TableCell>
                    )}
                  </>
                ) : null}

                {/* CP */}
                {v("cpDebut") && <TableCell className="text-sm border-r">{cpRanges[rowIdx]?.debut ?? ""}</TableCell>}
                {v("cpFin") && <TableCell className="text-sm border-r">{cpRanges[rowIdx]?.fin ?? ""}</TableCell>}

                {/* Absences */}
                {v("absDebut") && <TableCell className="text-sm border-r">{absRanges[rowIdx]?.debut ?? ""}</TableCell>}
                {v("absFin") && <TableCell className="text-sm border-r">{absRanges[rowIdx]?.fin ?? ""}</TableCell>}

                {/* AM */}
                {v("amDebut") && <TableCell className="text-sm border-r">{amRanges[rowIdx]?.debut ?? ""}</TableCell>}
                {v("amFin") && <TableCell className="text-sm border-r">{amRanges[rowIdx]?.fin ?? ""}</TableCell>}

                {rowIdx === 0 ? (
                  <>
                    {v("navigo") && (
                      <TableCell className="text-center border-r" rowSpan={maxRows}>
                        {emp.hasNavigoPass ? (
                          <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400 mx-auto" />
                        ) : (
                          <X className="h-4 w-4 text-muted-foreground mx-auto" />
                        )}
                      </TableCell>
                    )}
                    {v("diversAmount") && (
                      <TableCell className="p-1 border-r" rowSpan={maxRows}>
                        <Input
                          type="text"
                          className="h-8 w-16 text-sm"
                          placeholder="€"
                          value={edits?.diversAmount ?? ""}
                          onChange={(e) => onUpdateEdit(emp.userId, "diversAmount", e.target.value)}
                          aria-label={`Montant divers de ${emp.fullName}`}
                        />
                      </TableCell>
                    )}
                    {v("diversNature") && (
                      <TableCell className="p-1 border-r" rowSpan={maxRows}>
                        <Input
                          type="text"
                          className="h-8 text-sm"
                          placeholder="..."
                          value={edits?.diversNature ?? ""}
                          onChange={(e) => onUpdateEdit(emp.userId, "diversNature", e.target.value)}
                          aria-label={`Nature divers de ${emp.fullName}`}
                        />
                      </TableCell>
                    )}
                    {v("remarque") && (
                      <TableCell className="p-1" rowSpan={maxRows}>
                        <Input
                          type="text"
                          className="h-8 text-sm"
                          placeholder="..."
                          value={edits?.remark ?? ""}
                          onChange={(e) => onUpdateEdit(emp.userId, "remark", e.target.value)}
                          aria-label={`Remarque pour ${emp.fullName}`}
                        />
                      </TableCell>
                    )}
                  </>
                ) : null}
              </TableRow>
            ));
          })}
        </TableBody>
      </Table>
    </div>
  );
}

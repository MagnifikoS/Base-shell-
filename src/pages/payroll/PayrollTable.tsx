/**
 * PayrollTable -- Employee payroll details table with payment status badges.
 *
 * Improvements:
 * - Payment status dot per row (green=fully paid, amber=partial, red=unpaid)
 * - PaymentBadgeWithPopover: click to open popover for partial payment
 * - Alternating row backgrounds for readability
 * - Sticky footer with remaining amounts (partial-payment-aware)
 * - Better typography: medium employee names, tabular-nums for amounts
 */

import { memo, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { HelpTooltip } from "@/components/ui/HelpTooltip";
import { cn } from "@/lib/utils";
import { formatMinutesToHHMM, type PayrollValidationFlags } from "@/lib/payroll/payroll.compute";
import { formatDueMinutesToHHMM } from "@/lib/payroll/due.compute";
import type { PayrollEmployeeData } from "@/hooks/payroll/usePayrollMonthData";
import { formatEuros } from "./payrollHelpers";
import { PaymentBadgeWithPopover } from "./PaymentPopover";
import { getPaymentStatus, computeRemainingForChannel } from "./payrollPaymentUtils";

type PaymentStatus = "paid" | "partial" | "unpaid";

function PaymentStatusDot({ status }: { status: PaymentStatus }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-block h-2.5 w-2.5 rounded-full shrink-0",
            status === "paid" && "bg-emerald-500",
            status === "partial" && "bg-amber-500",
            status === "unpaid" && "bg-red-400"
          )}
        />
      </TooltipTrigger>
      <TooltipContent>
        {status === "paid" && "Entierement paye"}
        {status === "partial" && "Partiellement paye"}
        {status === "unpaid" && "Non paye"}
      </TooltipContent>
    </Tooltip>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
 * PayrollRow -- Memoized row component for PayrollTable.
 * ────────────────────────────────────────────────────────────────────────────*/

interface PayrollRowProps {
  employee: PayrollEmployeeData;
  validationFlags: PayrollValidationFlags | undefined;
  canWrite: boolean;
  onSelectEmployee: (emp: PayrollEmployeeData) => void;
  onPaymentChange: (
    userId: string,
    field: "net" | "cash",
    paid: boolean,
    amountPaid: number | null
  ) => void;
  /** Virtualizer positioning style (omit for non-virtualized usage) */
  style?: React.CSSProperties;
  /** Virtualizer row index */
  dataIndex?: number;
  /** Virtualizer measure ref */
  measureRef?: (node: HTMLTableRowElement | null) => void;
  /** Even/odd for striped rows */
  isEven?: boolean;
}

const PayrollRow = memo(function PayrollRow({
  employee,
  validationFlags,
  canWrite,
  onSelectEmployee,
  onPaymentChange,
  style,
  dataIndex,
  measureRef,
  isEven,
}: PayrollRowProps) {
  const totalDeductMinutes = employee.line.timeDeductionMinutes;
  const isDeductApplied = validationFlags?.includeDeductions === true;
  const hasCash = employee.line.cashAmountComputed > 0;
  const paymentStatus = getPaymentStatus(
    validationFlags,
    hasCash,
    employee.line.net_salary,
    employee.line.cashAmountComputed
  );

  return (
    <TableRow
      ref={measureRef}
      data-index={dataIndex}
      className={cn(
        "cursor-pointer transition-colors",
        isEven ? "bg-muted/20 hover:bg-muted/40" : "hover:bg-muted/30"
      )}
      onClick={() => onSelectEmployee(employee)}
      style={style}
    >
      {/* Payment status dot + Name */}
      <TableCell className="min-w-[180px]">
        <div className="flex items-center gap-2.5">
          <PaymentStatusDot status={paymentStatus} />
          <span className="font-medium truncate max-w-[180px]">{employee.fullName}</span>
        </div>
      </TableCell>
      {/* Net salary */}
      <TableCell className="min-w-[100px] text-right tabular-nums font-medium">
        {formatEuros(employee.line.net_salary)}
      </TableCell>
      {/* Cash */}
      <TableCell className="min-w-[90px] text-right tabular-nums text-amber-600 dark:text-amber-400">
        {hasCash ? formatEuros(employee.line.cashAmountComputed) : "-"}
      </TableCell>
      {/* Extras */}
      <TableCell className="min-w-[80px] text-right tabular-nums">
        {employee.line.totalExtraMinutesMonth > 0 ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="cursor-help text-emerald-600 dark:text-emerald-400">
                {formatMinutesToHHMM(employee.line.totalExtraMinutesMonth)}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <span>+{formatEuros(employee.line.totalExtraAmount)}</span>
            </TooltipContent>
          </Tooltip>
        ) : (
          <span className="text-muted-foreground">-</span>
        )}
      </TableCell>
      {/* CP */}
      <TableCell className="min-w-[50px] text-right tabular-nums text-sky-600 dark:text-sky-400">
        {employee.line.cpDays > 0 ? `${employee.line.cpDays}j` : "-"}
      </TableCell>
      {/* Absences */}
      <TableCell className="min-w-[50px] text-right tabular-nums text-destructive">
        {employee.line.absenceDaysTotal > 0 ? `${employee.line.absenceDaysTotal}j` : "-"}
      </TableCell>
      {/* Deductions */}
      <TableCell className="min-w-[90px] text-right tabular-nums text-amber-600 dark:text-amber-400 font-mono">
        {isDeductApplied
          ? "-"
          : totalDeductMinutes > 0
            ? formatDueMinutesToHHMM(totalDeductMinutes)
            : "-"}
      </TableCell>
      {/* Virement badge with popover */}
      <TableCell className="min-w-[110px] text-center" onClick={(e) => e.stopPropagation()}>
        <PaymentBadgeWithPopover
          type="net"
          employeeName={employee.fullName}
          totalAmount={employee.line.net_salary}
          currentPaid={validationFlags?.netPaid ?? false}
          currentAmountPaid={validationFlags?.netAmountPaid ?? null}
          onSave={(paid, amountPaid) => onPaymentChange(employee.userId, "net", paid, amountPaid)}
          canWrite={canWrite}
        />
      </TableCell>
      {/* Especes badge with popover */}
      <TableCell className="min-w-[110px] text-center" onClick={(e) => e.stopPropagation()}>
        {hasCash ? (
          <PaymentBadgeWithPopover
            type="cash"
            employeeName={employee.fullName}
            totalAmount={employee.line.cashAmountComputed}
            currentPaid={validationFlags?.cashPaid ?? false}
            currentAmountPaid={validationFlags?.cashAmountPaid ?? null}
            onSave={(paid, amountPaid) =>
              onPaymentChange(employee.userId, "cash", paid, amountPaid)
            }
            canWrite={canWrite}
          />
        ) : (
          <span className="text-muted-foreground text-sm">-</span>
        )}
      </TableCell>
    </TableRow>
  );
});

/* ─────────────────────────────────────────────────────────────────────────────
 * PayrollTable
 * ────────────────────────────────────────────────────────────────────────────*/

interface PayrollTableProps {
  employees: PayrollEmployeeData[];
  onSelectEmployee: (emp: PayrollEmployeeData) => void;
  validationByUserId: Map<string, PayrollValidationFlags>;
  onPaymentChange: (
    userId: string,
    field: "net" | "cash",
    paid: boolean,
    amountPaid: number | null
  ) => void;
  canWrite: boolean;
}

export function PayrollTable({
  employees,
  onSelectEmployee,
  validationByUserId,
  onPaymentChange,
  canWrite,
}: PayrollTableProps) {
  // Compute remaining payment totals (partial-payment aware)
  const remainingTotals = useMemo(() => {
    let remainingTransfer = 0;
    let remainingCash = 0;
    let paidTransfer = 0;
    let paidCash = 0;

    for (const emp of employees) {
      const flags = validationByUserId.get(emp.userId);
      const isNetPaid = flags?.netPaid ?? false;
      const isCashPaid = flags?.cashPaid ?? false;

      const netResult = computeRemainingForChannel(
        isNetPaid,
        flags?.netAmountPaid ?? null,
        emp.line.net_salary
      );
      remainingTransfer += netResult.remaining;
      paidTransfer += netResult.paidAmount;

      if (emp.line.cashAmountComputed > 0) {
        const cashResult = computeRemainingForChannel(
          isCashPaid,
          flags?.cashAmountPaid ?? null,
          emp.line.cashAmountComputed
        );
        remainingCash += cashResult.remaining;
        paidCash += cashResult.paidAmount;
      }
    }

    return { remainingTransfer, remainingCash, paidTransfer, paidCash };
  }, [employees, validationByUserId]);

  // Count payment statuses
  const paymentCounts = useMemo(() => {
    let paid = 0;
    let partial = 0;
    let unpaid = 0;

    for (const emp of employees) {
      const flags = validationByUserId.get(emp.userId);
      const hasCash = emp.line.cashAmountComputed > 0;
      const status = getPaymentStatus(
        flags,
        hasCash,
        emp.line.net_salary,
        emp.line.cashAmountComputed
      );
      if (status === "paid") paid++;
      else if (status === "partial") partial++;
      else unpaid++;
    }

    return { paid, partial, unpaid };
  }, [employees, validationByUserId]);

  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: employees.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 52,
    overscan: 5,
  });

  if (employees.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <Users className="h-12 w-12 text-muted-foreground mb-4" />
          <p className="text-muted-foreground">Aucun salarie avec contrat renseigne</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      {/* Header */}
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <CardTitle className="text-lg flex items-center gap-2">
          <Users className="h-5 w-5" />
          Detail par salarie ({employees.length})
        </CardTitle>
        <div className="flex items-center gap-4">
          {/* Payment status summary */}
          <div className="flex items-center gap-3 text-xs">
            {paymentCounts.paid > 0 && (
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                <span className="text-muted-foreground">{paymentCounts.paid} payes</span>
              </span>
            )}
            {paymentCounts.partial > 0 && (
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-amber-500" />
                <span className="text-muted-foreground">{paymentCounts.partial} partiels</span>
              </span>
            )}
            {paymentCounts.unpaid > 0 && (
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-red-400" />
                <span className="text-muted-foreground">{paymentCounts.unpaid} non payes</span>
              </span>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {/* Scrollable table area */}
        <div ref={parentRef} className="max-h-[65vh] overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 z-20 bg-background shadow-[0_1px_0_0] shadow-border">
              <TableRow className="hover:bg-background">
                <TableHead className="min-w-[180px]">Salarie</TableHead>
                <TableHead className="text-right min-w-[100px]">Net</TableHead>
                <TableHead className="text-right min-w-[90px]">Especes</TableHead>
                <TableHead className="text-right min-w-[80px]">
                  Extras{" "}
                  <HelpTooltip text="Heures supplementaires planifiees au-dela de 35h/semaine" />
                </TableHead>
                <TableHead className="text-right min-w-[50px]">
                  CP <HelpTooltip text="Conges payes" />
                </TableHead>
                <TableHead className="text-right min-w-[50px]">Abs.</TableHead>
                <TableHead className="text-right min-w-[90px]">Deductions</TableHead>
                <TableHead className="text-center min-w-[110px]">Virement</TableHead>
                <TableHead className="text-center min-w-[110px]">Especes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* Padding-based virtualization: top spacer */}
              {virtualizer.getVirtualItems().length > 0 && (
                <tr>
                  <td
                    colSpan={9}
                    style={{
                      height: virtualizer.getVirtualItems()[0]?.start ?? 0,
                      padding: 0,
                      border: 0,
                    }}
                  />
                </tr>
              )}
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const emp = employees[virtualRow.index];
                return (
                  <PayrollRow
                    key={virtualRow.key}
                    employee={emp}
                    validationFlags={validationByUserId.get(emp.userId)}
                    canWrite={canWrite}
                    onSelectEmployee={onSelectEmployee}
                    onPaymentChange={onPaymentChange}
                    dataIndex={virtualRow.index}
                    measureRef={virtualizer.measureElement}
                    isEven={virtualRow.index % 2 === 0}
                  />
                );
              })}
              {/* Padding-based virtualization: bottom spacer */}
              {virtualizer.getVirtualItems().length > 0 && (
                <tr>
                  <td
                    colSpan={9}
                    style={{
                      height:
                        virtualizer.getTotalSize() -
                        (virtualizer.getVirtualItems()[virtualizer.getVirtualItems().length - 1]
                          ?.end ?? 0),
                      padding: 0,
                      border: 0,
                    }}
                  />
                </tr>
              )}
            </TableBody>
          </Table>
        </div>

        {/* Sticky footer with remaining amounts */}
        <div
          className={cn(
            "border-t px-6 py-4",
            remainingTotals.remainingTransfer > 0 || remainingTotals.remainingCash > 0
              ? "bg-amber-50 dark:bg-amber-950/20"
              : "bg-emerald-50 dark:bg-emerald-950/20"
          )}
        >
          <div className="flex items-center justify-between flex-wrap gap-4">
            {/* Remaining to pay */}
            <div className="flex items-center gap-6">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-1">
                  Reste virement
                </p>
                <p
                  className={cn(
                    "text-lg font-bold tabular-nums",
                    remainingTotals.remainingTransfer > 0
                      ? "text-amber-700 dark:text-amber-400"
                      : "text-emerald-600 dark:text-emerald-400"
                  )}
                >
                  {formatEuros(remainingTotals.remainingTransfer)}
                </p>
              </div>
              {(remainingTotals.remainingCash > 0 || remainingTotals.paidCash > 0) && (
                <div className="border-l pl-6">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-1">
                    Reste especes
                  </p>
                  <p
                    className={cn(
                      "text-lg font-bold tabular-nums",
                      remainingTotals.remainingCash > 0
                        ? "text-amber-700 dark:text-amber-400"
                        : "text-emerald-600 dark:text-emerald-400"
                    )}
                  >
                    {formatEuros(remainingTotals.remainingCash)}
                  </p>
                </div>
              )}
            </div>

            {/* Already paid summary */}
            <div className="flex items-center gap-6 text-sm text-muted-foreground">
              <div className="text-right">
                <p className="text-xs uppercase tracking-wide font-medium mb-0.5">Virement paye</p>
                <p className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                  {formatEuros(remainingTotals.paidTransfer)}
                </p>
              </div>
              {remainingTotals.paidCash > 0 && (
                <div className="text-right border-l pl-6">
                  <p className="text-xs uppercase tracking-wide font-medium mb-0.5">Especes paye</p>
                  <p className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                    {formatEuros(remainingTotals.paidCash)}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

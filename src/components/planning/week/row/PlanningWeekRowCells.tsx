import { formatMinutesToHours } from "@/lib/planning-engine/format";

interface _PlanningWeekRowHeaderProps {
  employeeName: string;
  totalMinutes: number;
}

/**
 * Sticky left column showing employee name and sticky right column for total hours
 * Note: This is a presentational helper - actual rendering is done inline for layout reasons
 */
export function renderEmployeeNameCell(employeeName: string) {
  return (
    <div className="w-48 flex-shrink-0 px-3 py-2 border-r bg-background sticky left-0 z-10 flex items-center">
      <span className="text-sm font-medium text-foreground truncate">
        {employeeName || "Sans nom"}
      </span>
    </div>
  );
}

export function renderTotalHoursCell(totalMinutes: number) {
  return (
    <div className="w-[72px] flex-shrink-0 px-1 py-2 text-center bg-background sticky right-0 z-10 flex items-center justify-center border-l">
      <span className="text-sm font-semibold text-foreground">
        {formatMinutesToHours(totalMinutes)}
      </span>
    </div>
  );
}

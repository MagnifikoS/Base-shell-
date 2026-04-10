import { formatMinutesToHours } from "@/lib/planning-engine/format";

interface MobileWeekSummaryProps {
  totalMinutes: number;
}

export function MobileWeekSummary({ totalMinutes }: MobileWeekSummaryProps) {
  return (
    <span className="inline-flex items-center px-3 py-1.5 rounded-lg bg-primary/10 text-primary font-medium text-sm">
      {formatMinutesToHours(totalMinutes)}
    </span>
  );
}

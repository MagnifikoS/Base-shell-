/**
 * RevenueChartInner — Lazy-loaded chart component.
 *
 * This file is code-split from DashboardWidgets to keep recharts (~102 KB gzip)
 * out of the main Dashboard chunk. It's loaded on-demand when the revenue chart
 * is visible.
 */

import { memo, useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { formatDayShort } from "@/lib/planning-engine/format";
import type { DailyRevenue } from "@/hooks/dashboard/useEstablishmentKPIs";

const EUR = "€";

export const RevenueChartInner = memo(function RevenueChartInner({
  data,
}: {
  data: DailyRevenue[];
}) {
  const chartData = useMemo(
    () =>
      data.map((d) => ({
        label: formatDayShort(d.day_date),
        date: d.day_date.slice(5),
        total: d.total_eur,
      })),
    [data]
  );

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={chartData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis dataKey="label" tick={{ fontSize: 12 }} className="text-muted-foreground" />
        <YAxis
          tick={{ fontSize: 11 }}
          tickFormatter={(v: number) => `${v.toLocaleString("fr-FR")} ${EUR}`}
          width={80}
          className="text-muted-foreground"
        />
        <Tooltip
          formatter={(value: number) => [
            `${value.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} ${EUR}`,
            "CA",
          ]}
          labelFormatter={(label: string) => label}
        />
        <Bar dataKey="total" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} maxBarSize={40} />
      </BarChart>
    </ResponsiveContainer>
  );
});

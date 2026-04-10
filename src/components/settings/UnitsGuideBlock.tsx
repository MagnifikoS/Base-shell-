/**
 * Clickable guide chips — filter units by clicking a category
 */

import { Truck, Warehouse, ChefHat, Ruler } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMeasurementUnits, type MeasurementUnit } from "@/modules/visionAI";

const CATS = [
  {
    icon: Truck,
    label: "Fournisseur",
    usage: "supplier",
    bg: "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800",
    bgActive:
      "bg-blue-100 dark:bg-blue-900/40 border-blue-400 dark:border-blue-600 ring-2 ring-blue-300 dark:ring-blue-700",
    text: "text-blue-700 dark:text-blue-300",
  },
  {
    icon: Warehouse,
    label: "Stock",
    usage: "stock",
    bg: "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800",
    bgActive:
      "bg-amber-100 dark:bg-amber-900/30 border-amber-400 dark:border-amber-600 ring-2 ring-amber-300 dark:ring-amber-700",
    text: "text-amber-700 dark:text-amber-300",
  },
  {
    icon: ChefHat,
    label: "Cuisine",
    usage: "recipe",
    bg: "bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800",
    bgActive:
      "bg-green-100 dark:bg-green-900/30 border-green-400 dark:border-green-600 ring-2 ring-green-300 dark:ring-green-700",
    text: "text-green-700 dark:text-green-300",
  },
  {
    icon: Ruler,
    label: "Référence",
    usage: "reference",
    bg: "bg-purple-50 dark:bg-purple-950/30 border-purple-200 dark:border-purple-800",
    bgActive:
      "bg-purple-100 dark:bg-purple-900/40 border-purple-400 dark:border-purple-600 ring-2 ring-purple-300 dark:ring-purple-700",
    text: "text-purple-700 dark:text-purple-300",
  },
] as const;

interface Props {
  activeFilter: string | null;
  onFilterChange: (usage: string | null) => void;
}

export function UnitsGuideBlock({ activeFilter, onFilterChange }: Props) {
  const { units } = useMeasurementUnits();
  const count = (u: string) =>
    units.filter((x: MeasurementUnit) => x.is_active && (x.usage_category || "supplier") === u)
      .length;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
      {CATS.map((c) => {
        const isActive = activeFilter === c.usage;
        return (
          <button
            key={c.usage}
            type="button"
            onClick={() => onFilterChange(isActive ? null : c.usage)}
            className={cn(
              "flex items-center gap-2 px-3 py-2 rounded-lg border transition-all cursor-pointer",
              isActive ? c.bgActive : c.bg,
              "hover:shadow-sm"
            )}
          >
            <c.icon className={cn("h-4 w-4", c.text)} />
            <span className="text-xs font-medium flex-1 text-left">{c.label}</span>
            <span className={cn("text-sm font-bold", c.text)}>{count(c.usage)}</span>
          </button>
        );
      })}
    </div>
  );
}

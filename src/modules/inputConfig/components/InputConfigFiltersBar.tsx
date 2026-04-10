import { useCallback } from "react";
import { SearchInput } from "@/components/ui/SearchInput";
import {
  Weight,
  Hash,
  Layers,
  Layers2,
  Layers3,
  CircleDashed,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { InputConfigFilters } from "../types";

interface Props {
  filters: InputConfigFilters;
  onChange: (filters: InputConfigFilters) => void;
  counts: { total: number; filtered: number };
}

interface ChipOption<T extends string> {
  value: T;
  label: string;
  icon: React.ReactNode;
}

function FilterChip<T extends string>({
  option,
  active,
  onToggle,
}: {
  option: ChipOption<T>;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap",
        "border",
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-border bg-background text-muted-foreground hover:bg-muted/50 hover:text-foreground"
      )}
    >
      {option.icon}
      {option.label}
    </button>
  );
}

const NATURE_OPTIONS: ChipOption<InputConfigFilters["unitFamily"]>[] = [
  { value: "continuous", label: "Poids", icon: <Weight className="h-3.5 w-3.5" /> },
  { value: "discrete", label: "Unité", icon: <Hash className="h-3.5 w-3.5" /> },
];

const LEVELS_OPTIONS: ChipOption<InputConfigFilters["levelsCount"]>[] = [
  { value: "0", label: "0 niv.", icon: <Layers className="h-3.5 w-3.5" /> },
  { value: "1", label: "1 niv.", icon: <Layers2 className="h-3.5 w-3.5" /> },
  { value: "2+", label: "2+", icon: <Layers3 className="h-3.5 w-3.5" /> },
];

const STATUS_OPTIONS: ChipOption<InputConfigFilters["status"]>[] = [
  { value: "not_configured", label: "À faire", icon: <CircleDashed className="h-3.5 w-3.5" /> },
  { value: "configured", label: "OK", icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
  { value: "needs_review", label: "À revoir", icon: <AlertTriangle className="h-3.5 w-3.5" /> },
];

export function InputConfigFiltersBar({ filters, onChange, counts }: Props) {
  const update = useCallback(
    (patch: Partial<InputConfigFilters>) => onChange({ ...filters, ...patch }),
    [filters, onChange],
  );

  const toggleFilter = useCallback(
    <K extends keyof InputConfigFilters>(key: K, value: InputConfigFilters[K]) => {
      update({ [key]: filters[key] === value ? "all" : value } as Partial<InputConfigFilters>);
    },
    [filters, update],
  );

  return (
    <div className="space-y-3">
      {/* Search */}
      <SearchInput
        value={filters.search}
        onChange={(v) => update({ search: v })}
        placeholder="Rechercher un produit…"
      />

      {/* Chip filters — single horizontal scrollable row */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
        {NATURE_OPTIONS.map((opt) => (
          <FilterChip
            key={opt.value}
            option={opt}
            active={filters.unitFamily === opt.value}
            onToggle={() => toggleFilter("unitFamily", opt.value)}
          />
        ))}

        <div className="w-px h-5 bg-border mx-1 shrink-0" />

        {LEVELS_OPTIONS.map((opt) => (
          <FilterChip
            key={opt.value}
            option={opt}
            active={filters.levelsCount === opt.value}
            onToggle={() => toggleFilter("levelsCount", opt.value)}
          />
        ))}

        <div className="w-px h-5 bg-border mx-1 shrink-0" />

        {STATUS_OPTIONS.map((opt) => (
          <FilterChip
            key={opt.value}
            option={opt}
            active={filters.status === opt.value}
            onToggle={() => toggleFilter("status", opt.value)}
          />
        ))}

        {/* Count */}
        <span className="text-[11px] text-muted-foreground whitespace-nowrap ml-auto pl-2">
          {counts.filtered}/{counts.total}
        </span>
      </div>
    </div>
  );
}

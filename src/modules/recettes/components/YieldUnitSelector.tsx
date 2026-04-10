/**
 * ═══════════════════════════════════════════════════════════════
 * MODULE RECETTES — YieldUnitSelector
 * ═══════════════════════════════════════════════════════════════
 *
 * Compact selector for yield units (g, kg, ml, L, pièce).
 * Used in wizard step 1 for preparations.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const YIELD_UNIT_ABBREVS = ["g", "kg", "ml", "l", "cl"];

interface YieldUnitSelectorProps {
  value: string | null;
  onChange: (unitId: string) => void;
}

export function YieldUnitSelector({ value, onChange }: YieldUnitSelectorProps) {
  const { data: units = [] } = useQuery({
    queryKey: ["yield-units"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("measurement_units")
        .select("id, name, abbreviation")
        .or(
          YIELD_UNIT_ABBREVS.map((a) => `abbreviation.ilike.${a}`).join(",") +
          ",name.ilike.pièce,name.ilike.piece"
        )
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 30 * 60 * 1000,
  });

  return (
    <Select value={value ?? ""} onValueChange={onChange}>
      <SelectTrigger className="h-10">
        <SelectValue placeholder="Unité" />
      </SelectTrigger>
      <SelectContent>
        {units.map((u) => (
          <SelectItem key={u.id} value={u.id}>
            {u.name || u.abbreviation}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Unified Units + Packaging Settings — single entry point
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useState } from "react";
import { UnitsGuideBlock } from "./UnitsGuideBlock";
import { UnitsSettingsTable } from "./UnitsSettingsTable";
import { PackagingSection } from "./PackagingSection";
import { Separator } from "@/components/ui/separator";
import { useSeedVisionAIData } from "@/modules/visionAI";

export function UnifiedUnitsSettings() {
  useSeedVisionAIData();
  const [activeFilter, setActiveFilter] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <UnitsGuideBlock activeFilter={activeFilter} onFilterChange={setActiveFilter} />
      <UnitsSettingsTable activeFilter={activeFilter} />
      <Separator />
      <PackagingSection />
    </div>
  );
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * STATUS BADGE COMPONENT
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Displays status badge for extracted product lines using design system colors.
 * - validated: Check icon only (no text)
 * - needs_action: No badge (action buttons shown separately)
 */

import { Check } from "lucide-react";
import type { LineStatus } from "@/modules/analyseFacture";

interface ProductStatusBadgeProps {
  status: LineStatus;
  label: string;
  message?: string | null;
}

export function ProductStatusBadge({ 
  status, 
  label, 
}: ProductStatusBadgeProps) {
  switch (status) {
    case "validated":
      return (
        <div 
          className="inline-flex items-center justify-center h-7 w-7 rounded-full bg-primary/10 text-primary cursor-help"
          title={label}
        >
          <Check className="h-4 w-4" strokeWidth={2.5} />
        </div>
      );
    
    case "needs_action":
      // No badge for needs_action — action buttons (Package/Search) are shown separately
      return null;
    
    default:
      return null;
  }
}

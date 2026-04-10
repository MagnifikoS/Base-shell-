/**
 * MobileEstablishmentSwitcher
 * 
 * UI component for header: displays active establishment name
 * and allows switching between establishments.
 * 
 * RULES:
 * - Uses useEstablishmentAccess as single source of truth
 * - Invalidates relevant queries on switch (via the hook)
 * - No isAdmin/pathname gating - visibility controlled by parent
 */

import { useState } from "react";
import { useEstablishmentAccess } from "@/hooks/useEstablishmentAccess";
import { Building2, ChevronDown, Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export function MobileEstablishmentSwitcher() {
  const {
    accessibleEstablishments,
    activeEstablishment,
    activeEstablishmentId,
    setActiveEstablishment,
  } = useEstablishmentAccess();

  const [open, setOpen] = useState(false);

  // Don't render if no establishment or only one
  // (Parent should check showSelector before rendering)
  if (!activeEstablishment || accessibleEstablishments.length <= 1) {
    if (activeEstablishment) {
      // Show name without dropdown if single establishment
      return (
        <div className="flex items-center gap-1.5 px-2 py-1">
          <Building2 className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground truncate max-w-[120px]">
            {activeEstablishment.name}
          </span>
        </div>
      );
    }
    return null;
  }

  const handleSelect = (establishment: typeof activeEstablishment) => {
    if (!establishment || establishment.id === activeEstablishmentId) {
      setOpen(false);
      return;
    }

    setActiveEstablishment(establishment);
    setOpen(false);
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            "flex items-center gap-1.5 px-2 py-1 rounded-md",
            "hover:bg-accent/50 active:bg-accent transition-colors",
            "focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1"
          )}
          aria-label="Changer d'établissement"
        >
          <Building2 className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground truncate max-w-[100px]">
            {activeEstablishment.name}
          </span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {accessibleEstablishments.map((est) => (
          <DropdownMenuItem
            key={est.id}
            onClick={() => handleSelect(est)}
            className="flex items-center justify-between gap-2"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Building2 className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <span className="truncate">{est.name}</span>
            </div>
            {est.id === activeEstablishmentId && (
              <Check className="h-4 w-4 text-primary flex-shrink-0" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

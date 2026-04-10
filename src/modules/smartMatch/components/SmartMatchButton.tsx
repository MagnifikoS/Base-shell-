/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SMART_MATCH — SmartMatchButton (icône ⚡ pour ouvrir le drawer)
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface SmartMatchButtonProps {
  onClick: () => void;
  disabled?: boolean;
  size?: "sm" | "icon";
}

export function SmartMatchButton({ onClick, disabled, size = "icon" }: SmartMatchButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size={size === "icon" ? "icon" : "sm"}
          variant="ghost"
          className="h-7 w-7 text-primary hover:text-primary/80 hover:bg-primary/10"
          onClick={onClick}
          disabled={disabled}
          aria-label="SmartMatch — Recherche intelligente"
        >
          <Zap className="h-3.5 w-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p className="text-xs">SmartMatch — Recherche intelligente</p>
      </TooltipContent>
    </Tooltip>
  );
}

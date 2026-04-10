/**
 * Eye toggle button for showing/hiding amounts.
 */

import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";

interface VisibilityToggleProps {
  visible: boolean;
  onToggle: () => void;
}

export function VisibilityToggle({ visible, onToggle }: VisibilityToggleProps) {
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onToggle}
      aria-label={visible ? "Masquer les montants" : "Afficher les montants"}
      className="h-9 w-9"
    >
      {visible ? (
        <EyeOff className="h-4 w-4 text-muted-foreground" />
      ) : (
        <Eye className="h-4 w-4 text-muted-foreground" />
      )}
    </Button>
  );
}

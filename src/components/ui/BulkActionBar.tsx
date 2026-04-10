import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

interface BulkActionBarProps {
  selectedCount: number;
  onClear: () => void;
  children: ReactNode;
}

export function BulkActionBar({ selectedCount, onClear, children }: BulkActionBarProps) {
  if (selectedCount === 0) return null;

  return (
    <div className="sticky bottom-0 z-10 flex items-center gap-3 rounded-lg border bg-background p-3 shadow-md">
      <span className="text-sm font-medium">{selectedCount} selectionne(s)</span>
      <Button variant="ghost" size="sm" onClick={onClear}>
        <X className="mr-1 h-4 w-4" />
        Tout deselectionner
      </Button>
      <div className="ml-auto flex items-center gap-2">{children}</div>
    </div>
  );
}

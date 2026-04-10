import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface PrintButtonProps {
  className?: string;
}

export function PrintButton({ className }: PrintButtonProps) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => window.print()}
      className={cn("no-print gap-1.5", className)}
      aria-label="Imprimer"
    >
      <Printer className="h-4 w-4" />
      Imprimer
    </Button>
  );
}

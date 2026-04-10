import { useEffect, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { FileText, ScanLine } from "lucide-react";

interface ExtractionProgressModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Vertical extraction progress modal with scanning illustration and timer
 */
export function ExtractionProgressModal({ open, onOpenChange }: ExtractionProgressModalProps) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (!open) {
      setElapsedSeconds(0);
      return;
    }

    const interval = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, [open]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xs p-8">
        <div className="flex flex-col items-center justify-center space-y-8">
          {/* Scanning illustration */}
          <div className="relative w-32 h-40">
            {/* Document */}
            <div className="absolute inset-0 bg-muted rounded-lg border-2 border-border shadow-lg flex items-center justify-center">
              <FileText className="h-16 w-16 text-muted-foreground" />
            </div>

            {/* Scanning line animation */}
            <div className="absolute inset-x-0 top-0 h-full overflow-hidden rounded-lg">
              <div className="animate-scan absolute inset-x-0 h-1 bg-gradient-to-r from-transparent via-primary to-transparent opacity-80" />
            </div>

            {/* Scan icon */}
            <div className="absolute -right-3 -top-3 bg-primary rounded-full p-2 shadow-lg">
              <ScanLine className="h-5 w-5 text-primary-foreground" />
            </div>
          </div>

          {/* Status text */}
          <p className="text-lg font-medium text-foreground">Scan en cours...</p>

          {/* Timer */}
          <div className="text-5xl font-mono font-bold text-foreground tabular-nums">
            {formatTime(elapsedSeconds)}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

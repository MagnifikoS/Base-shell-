import { ScrollArea } from "@/components/ui/scroll-area";
import { ScanHistoryRow } from "./ScanHistoryRow";
import type { ScanDocument } from "../../types/scanHistory";

interface ScanHistoryListProps {
  scans: ScanDocument[];
  onScanClick: (scan: ScanDocument) => void;
}

export function ScanHistoryList({ scans, onScanClick }: ScanHistoryListProps) {
  return (
    <ScrollArea className="max-h-[calc(100vh-16rem)]">
      <div className="space-y-2">
        {scans.map((scan) => (
          <ScanHistoryRow key={scan.id} scan={scan} onClick={onScanClick} />
        ))}
      </div>
    </ScrollArea>
  );
}

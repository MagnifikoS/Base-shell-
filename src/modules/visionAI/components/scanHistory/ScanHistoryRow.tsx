import { FileText, Image, ChevronRight, RotateCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { ScanDocument } from "../../types/scanHistory";
import type { ScanDocType } from "../../types/scanHistory";

interface ScanHistoryRowProps {
  scan: ScanDocument;
  onClick: (scan: ScanDocument) => void;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatFileSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

function isImage(fileType: string): boolean {
  return fileType.startsWith("image/");
}

const DOC_TYPE_BADGE_CONFIG: Record<ScanDocType, { label: string; className: string }> = {
  facture: {
    label: "Facture",
    className: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300",
  },
  bl: {
    label: "BL",
    className: "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300",
  },
  releve: {
    label: "Relev\u00e9",
    className: "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300",
  },
};

export function ScanHistoryRow({ scan, onClick }: ScanHistoryRowProps) {
  const FileIcon = isImage(scan.file_type) ? Image : FileText;
  const docType = scan.doc_type ?? "facture";
  const badgeConfig = DOC_TYPE_BADGE_CONFIG[docType];

  return (
    <button
      type="button"
      onClick={() => onClick(scan)}
      className="w-full flex items-center gap-3 p-3 rounded-lg border border-border/50 hover:border-border hover:bg-muted/30 transition-all text-left group"
    >
      {/* File icon */}
      <div className="h-10 w-10 rounded-lg bg-primary/5 flex items-center justify-center flex-shrink-0">
        <FileIcon className="h-5 w-5 text-primary/70" />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{scan.original_filename}</span>
          <span
            className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium leading-none ${badgeConfig.className}`}
          >
            {badgeConfig.label}
          </span>
          {scan.runs_count > 1 && (
            <Badge
              variant="secondary"
              className="text-[10px] px-1.5 py-0 flex items-center gap-0.5"
            >
              <RotateCw className="h-2.5 w-2.5" />
              {scan.runs_count}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
          {scan.supplier_name && (
            <>
              <span className="truncate max-w-[150px]">{scan.supplier_name}</span>
              <span className="text-border">|</span>
            </>
          )}
          {scan.invoice_number && (
            <>
              <span className="truncate max-w-[100px]">{scan.invoice_number}</span>
              <span className="text-border">|</span>
            </>
          )}
          {scan.bl_number && (
            <>
              <span className="truncate max-w-[100px]">BL {scan.bl_number}</span>
              <span className="text-border">|</span>
            </>
          )}
          <span>{formatDate(scan.created_at)}</span>
          {scan.file_size_bytes && (
            <>
              <span className="text-border">|</span>
              <span>{formatFileSize(scan.file_size_bytes)}</span>
            </>
          )}
        </div>
      </div>

      {/* Arrow */}
      <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
    </button>
  );
}

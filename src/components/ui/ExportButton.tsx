import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ExportButtonProps {
  data: Record<string, unknown>[];
  filename: string;
  columns: { key: string; label: string }[];
  className?: string;
}

export function ExportButton({ data, filename, columns, className }: ExportButtonProps) {
  const handleExport = () => {
    if (data.length === 0) return;
    const header = columns.map((c) => c.label).join(",");
    const escape = (val: unknown): string => {
      if (val === null || val === undefined) return "";
      const s = String(val);
      return s.includes(",") || s.includes('"') || s.includes("\n")
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    };
    const rows = data.map((row) => columns.map((c) => escape(row[c.key])).join(","));
    const csv = [header, ...rows].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleExport}
      disabled={data.length === 0}
      className={cn("no-print gap-1.5", className)}
    >
      <Download className="h-4 w-4" />
      Exporter CSV
    </Button>
  );
}

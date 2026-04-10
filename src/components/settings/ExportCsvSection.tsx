import { useState } from "react";
import { Download, Loader2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { exportTableToCsv, getExportableTables, type ExportableTable } from "@/utils/exportCsv";
import { toast } from "sonner";

export function ExportCsvSection() {
  const tables = getExportableTables();
  const [loading, setLoading] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const handleExport = async (key: ExportableTable) => {
    setLoading(key);
    setDone(null);
    try {
      const { count } = await exportTableToCsv(key);
      toast.success(`${count} lignes exportées`);
      setDone(key);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erreur lors de l'export");
    } finally {
      setLoading(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Download className="h-5 w-5" />
          Export CSV
        </CardTitle>
        <CardDescription>Téléchargez vos données au format CSV (compatible Excel)</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        {tables.map((t) => (
          <Button
            key={t.key}
            variant="outline"
            className="justify-start gap-2 h-auto py-3"
            disabled={loading !== null}
            onClick={() => handleExport(t.key)}
          >
            {loading === t.key ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : done === t.key ? (
              <CheckCircle2 className="h-4 w-4 text-primary" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            <div className="text-left">
              <div className="font-medium">{t.label}</div>
              <div className="text-xs text-muted-foreground">{t.key}.csv</div>
            </div>
          </Button>
        ))}
      </CardContent>
    </Card>
  );
}

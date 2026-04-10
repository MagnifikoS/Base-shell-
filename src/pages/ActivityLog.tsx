import { useState } from "react";
import { ResponsiveLayout } from "@/components/mobile/ResponsiveLayout";
import {
  useActivityLog,
  useActionTypes,
  type DateRangeOption,
  type AuditLogRow,
} from "@/hooks/useActivityLog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TableSkeleton } from "@/components/ui/TableSkeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, AlertTriangle, ChevronLeft, ChevronRight } from "lucide-react";

const PAGE_SIZE = 25;

const DATE_RANGE_OPTIONS: { value: DateRangeOption; label: string }[] = [
  { value: "24h", label: "Dernières 24h" },
  { value: "7d", label: "7 derniers jours" },
  { value: "30d", label: "30 derniers jours" },
];

function formatDateTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleString("fr-FR", {
      timeZone: "Europe/Paris",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return isoString;
  }
}

function formatDetails(metadata: Record<string, unknown> | null): string {
  if (!metadata || Object.keys(metadata).length === 0) {
    return "-";
  }
  try {
    // Show a compact summary of metadata
    const entries = Object.entries(metadata);
    if (entries.length <= 3) {
      return entries.map(([key, value]) => `${key}: ${String(value)}`).join(", ");
    }
    return entries
      .slice(0, 3)
      .map(([key, value]) => `${key}: ${String(value)}`)
      .concat([`+${entries.length - 3} autres`])
      .join(", ");
  } catch {
    return JSON.stringify(metadata).slice(0, 100);
  }
}

function ActionBadge({ action }: { action: string }) {
  let variant: "default" | "secondary" | "destructive" | "outline" = "default";

  const lower = action.toLowerCase();
  if (lower.includes("delete") || lower.includes("suppr")) {
    variant = "destructive";
  } else if (lower.includes("create") || lower.includes("insert") || lower.includes("creat")) {
    variant = "default";
  } else if (lower.includes("update") || lower.includes("modif")) {
    variant = "secondary";
  } else {
    variant = "outline";
  }

  return <Badge variant={variant}>{action}</Badge>;
}

function ActivityLogContent() {
  const [dateRange, setDateRange] = useState<DateRangeOption>("7d");
  const [actionType, setActionType] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  const {
    data: result,
    isLoading,
    isError,
    error,
    refetch,
  } = useActivityLog({
    dateRange,
    actionType,
    page,
    pageSize: PAGE_SIZE,
  });

  const { data: actionTypes } = useActionTypes();

  const logs = result?.data ?? [];
  const totalCount = result?.count ?? 0;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  const handleDateRangeChange = (value: string) => {
    setDateRange(value as DateRangeOption);
    setPage(0);
  };

  const handleActionTypeChange = (value: string) => {
    setActionType(value === "all" ? null : value);
    setPage(0);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Activity className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">Journal d'activite</h1>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <CardTitle className="text-lg">Historique des actions</CardTitle>
            <div className="flex gap-3 ml-auto">
              <Select value={dateRange} onValueChange={handleDateRangeChange}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Periode" />
                </SelectTrigger>
                <SelectContent>
                  {DATE_RANGE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={actionType ?? "all"} onValueChange={handleActionTypeChange}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Type d'action" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes les actions</SelectItem>
                  {(actionTypes ?? []).map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {isLoading ? (
            <TableSkeleton rows={10} columns={5} />
          ) : isError ? (
            <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
              <AlertTriangle className="h-12 w-12 text-destructive" />
              <p className="text-lg font-medium text-destructive">Erreur de chargement</p>
              <p className="text-sm text-muted-foreground">
                {error instanceof Error ? error.message : "Une erreur est survenue"}
              </p>
              <Button variant="outline" onClick={() => refetch()}>
                Réessayer
              </Button>
            </div>
          ) : logs.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Activity className="h-12 w-12 mx-auto mb-4 opacity-30" />
              <p>Aucune activite trouvee pour cette periode.</p>
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Utilisateur</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log: AuditLogRow) => (
                    <TableRow key={log.id}>
                      <TableCell className="whitespace-nowrap text-sm">
                        {formatDateTime(log.created_at)}
                      </TableCell>
                      <TableCell className="text-sm">
                        {log.user_id ? log.user_id.slice(0, 8) + "..." : "Systeme"}
                      </TableCell>
                      <TableCell>
                        <ActionBadge action={log.action} />
                      </TableCell>
                      <TableCell className="text-sm">{log.target_type}</TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-[300px] truncate">
                        {formatDetails(log.metadata)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* Pagination */}
              <div className="flex items-center justify-between mt-4 pt-4 border-t">
                <p className="text-sm text-muted-foreground">
                  {totalCount} resultat{totalCount > 1 ? "s" : ""} — Page {page + 1} /{" "}
                  {totalPages || 1}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                  >
                    <ChevronLeft className="h-4 w-4 mr-1" />
                    Precedent
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                    disabled={page >= totalPages - 1}
                  >
                    Suivant
                    <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function ActivityLog() {
  return (
    <ResponsiveLayout>
      <ActivityLogContent />
    </ResponsiveLayout>
  );
}

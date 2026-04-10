import { useState } from "react";
import { Building2, Users, Layers, Activity, Plus, Pencil, Check, X, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PlatformLayout } from "@/components/platform/PlatformLayout";
import { PlatformCreateOrgWizard } from "@/components/platform/PlatformCreateOrgWizard";
import { platformGetKpis, platformListOrganizations, platformRenameOrganization, platformDeleteOrganization } from "@/lib/platform/rpcPlatform";
import type { PlatformKpis, PlatformOrgRow } from "@/lib/platform/rpcPlatform";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export default function PlatformDashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<PlatformOrgRow | null>(null);

  const { data: kpis, isLoading: kpisLoading } = useQuery({
    queryKey: ["platform-kpis"],
    queryFn: platformGetKpis,
  });

  const { data: orgs = [], isLoading: orgsLoading } = useQuery({
    queryKey: ["platform-organizations"],
    queryFn: platformListOrganizations,
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => platformRenameOrganization(id, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platform-organizations"] });
      queryClient.invalidateQueries({ queryKey: ["platform-kpis"] });
      toast.success("Organisation renommée");
      setEditingId(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => platformDeleteOrganization(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platform-organizations"] });
      queryClient.invalidateQueries({ queryKey: ["platform-kpis"] });
      toast.success("Organisation supprimée");
      setDeleteTarget(null);
    },
    onError: (e: Error) => {
      toast.error(e.message);
      setDeleteTarget(null);
    },
  });

  const isLoading = kpisLoading || orgsLoading;

  const effectiveKpis: PlatformKpis | null = kpis ?? (orgs.length > 0 ? {
    total_organizations: orgs.length,
    total_establishments: orgs.reduce((sum, o) => sum + (o.establishment_count ?? 0), 0),
    total_users: orgs.reduce((sum, o) => sum + (o.user_count ?? 0), 0),
    active_establishments: 0,
    suspended_establishments: 0,
  } : null);

  const startEditing = (org: PlatformOrgRow, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(org.id);
    setEditName(org.name);
  };

  const confirmRename = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (editingId && editName.trim()) {
      renameMutation.mutate({ id: editingId, name: editName.trim() });
    }
  };

  const cancelEditing = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(null);
  };

  return (
    <PlatformLayout>
      <div className="p-6 md:p-8 space-y-8 max-w-7xl mx-auto">
        {/* KPIs */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <KpiCard icon={Building2} label="Organisations" value={effectiveKpis?.total_organizations ?? 0} detail={`${effectiveKpis?.active_establishments ?? 0} établ. actifs`} loading={isLoading} />
          <KpiCard icon={Layers} label="Établissements" value={effectiveKpis?.total_establishments ?? 0} loading={isLoading} />
          <KpiCard icon={Users} label="Utilisateurs" value={effectiveKpis?.total_users ?? 0} loading={isLoading} />
          <KpiCard icon={Activity} label="Suspendus" value={effectiveKpis?.suspended_establishments ?? 0} loading={isLoading} />
        </div>

        {/* Organizations list */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">Organisations</h2>
            <Button size="sm" className="gap-1.5" onClick={() => setWizardOpen(true)}>
              <Plus className="w-3.5 h-3.5" /> Nouvelle organisation
            </Button>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
            </div>
          ) : orgs.length === 0 ? (
            <p className="text-muted-foreground text-center py-12">Aucune organisation trouvée.</p>
          ) : (
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Organisation</th>
                    <th className="text-center px-4 py-3 font-medium text-muted-foreground">Établissements</th>
                    <th className="text-center px-4 py-3 font-medium text-muted-foreground">Utilisateurs</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground w-24">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {orgs.map((org: PlatformOrgRow) => (
                    <tr
                      key={org.id}
                      className="border-b last:border-0 hover:bg-muted/30 transition-colors cursor-pointer group"
                      onClick={() => editingId !== org.id && navigate(`/platform/org/${org.id}`)}
                    >
                      <td className="px-4 py-3 font-medium text-foreground">
                        {editingId === org.id ? (
                          <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                            <Input
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              className="h-7 text-sm font-semibold w-56"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === "Enter") confirmRename(e as unknown as React.MouseEvent);
                                if (e.key === "Escape") setEditingId(null);
                              }}
                            />
                            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={confirmRename} disabled={renameMutation.isPending}>
                              <Check className="w-3.5 h-3.5 text-primary" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={cancelEditing}>
                              <X className="w-3.5 h-3.5 text-destructive" />
                            </Button>
                          </div>
                        ) : (
                          org.name
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">{org.establishment_count}</td>
                      <td className="px-4 py-3 text-center">{org.user_count}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {editingId !== org.id && (
                            <button
                              onClick={(e) => startEditing(org, e)}
                              className="p-1 rounded hover:bg-muted"
                              title="Renommer"
                            >
                              <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                            </button>
                          )}
                          <button
                            onClick={(e) => { e.stopPropagation(); setDeleteTarget(org); }}
                            className="p-1 rounded hover:bg-destructive/10"
                            title="Supprimer"
                          >
                            <Trash2 className="w-3.5 h-3.5 text-destructive" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <PlatformCreateOrgWizard open={wizardOpen} onOpenChange={setWizardOpen} />

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer « {deleteTarget?.name} » ?</AlertDialogTitle>
            <AlertDialogDescription>
              Cette action est irréversible. L'organisation, ses établissements et toutes les données associées seront définitivement supprimés.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Suppression…" : "Supprimer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PlatformLayout>
  );
}

function KpiCard({ icon: Icon, label, value, detail, loading }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  detail?: string;
  loading?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <Icon className="w-4 h-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="h-8 w-12 bg-muted animate-pulse rounded" />
        ) : (
          <>
            <div className="text-2xl font-bold text-foreground">{value}</div>
            {detail && <p className="text-xs text-muted-foreground mt-1">{detail}</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}
